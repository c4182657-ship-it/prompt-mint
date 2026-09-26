import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseContractEvent, type RawSorobanEvent } from "./parser.js";
import type {
  ConsumerConfig,
  EventCheckpoint,
  EventHandler,
  ParsedContractEvent,
} from "./types.js";

export class ContractEventConsumer {
  private config: Required<Omit<ConsumerConfig, "startLedger" | "checkpointFile">> & {
    startLedger?: number;
    checkpointFile?: string;
  };
  private isRunning: boolean = false;
  private currentLedger: number = 0;
  private processedEventIds: Set<string> = new Set();
  private handlers: Map<string, EventHandler[]> = new Map();
  private anyHandlers: EventHandler[] = [];
  private errorHandlers: ((err: Error) => void)[] = [];
  private timeoutId: NodeJS.Timeout | null = null;

  constructor(config: ConsumerConfig) {
    this.config = {
      rpcUrl: config.rpcUrl,
      contractId: config.contractId,
      startLedger: config.startLedger,
      pollIntervalMs: config.pollIntervalMs ?? 3000,
      batchSize: config.batchSize ?? 50,
      checkpointFile: config.checkpointFile,
    };
  }

  public on<T extends ParsedContractEvent["type"]>(
    eventType: T,
    handler: EventHandler<Extract<ParsedContractEvent, { type: T }>>,
  ): this {
    const list = this.handlers.get(eventType) || [];
    list.push(handler as EventHandler);
    this.handlers.set(eventType, list);
    return this;
  }

  public onAny(handler: EventHandler<ParsedContractEvent>): this {
    this.anyHandlers.push(handler);
    return this;
  }

  public onError(handler: (err: Error) => void): this {
    this.errorHandlers.push(handler);
    return this;
  }

  public async loadCheckpoint(): Promise<number | null> {
    if (!this.config.checkpointFile) return null;
    try {
      const data = await fs.readFile(this.config.checkpointFile, "utf-8");
      const parsed: EventCheckpoint = JSON.parse(data);
      if (parsed && typeof parsed.lastLedger === "number") {
        return parsed.lastLedger;
      }
    } catch {
      // File may not exist yet on first boot
    }
    return null;
  }

  public async saveCheckpoint(ledger: number, lastEventId?: string): Promise<void> {
    if (!this.config.checkpointFile) return;
    const checkpoint: EventCheckpoint = {
      lastLedger: ledger,
      lastEventId,
      updatedAt: new Date().toISOString(),
    };
    try {
      const dir = path.dirname(this.config.checkpointFile);
      if (dir && dir !== ".") {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(
        this.config.checkpointFile,
        JSON.stringify(checkpoint, null, 2),
        "utf-8",
      );
    } catch (err) {
      this.notifyError(
        new Error(`Failed to save checkpoint: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  public async getLatestLedger(): Promise<number> {
    try {
      const res = await fetch(this.config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getLatestLedger",
        }),
      });
      if (!res.ok) {
        throw new Error(`RPC error HTTP ${res.status}`);
      }
      const data = (await res.json()) as { result?: { sequence?: number } };
      return data?.result?.sequence ?? 0;
    } catch {
      return 0;
    }
  }

  public async fetchRawEvents(startLedger: number): Promise<{ events: RawSorobanEvent[]; latestLedger: number }> {
    const res = await fetch(this.config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getEvents",
        params: {
          startLedger,
          filters: [
            {
              type: "contract",
              contractIds: [this.config.contractId],
            },
          ],
          limit: this.config.batchSize,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`RPC responded with status ${res.status}`);
    }

    const payload = (await res.json()) as {
      result?: {
        events?: RawSorobanEvent[];
        latestLedger?: number;
      };
      error?: { message: string };
    };

    if (payload.error) {
      throw new Error(`RPC error: ${payload.error.message}`);
    }

    return {
      events: payload.result?.events ?? [],
      latestLedger: payload.result?.latestLedger ?? startLedger,
    };
  }

  public async pollOnce(): Promise<number> {
    try {
      const { events: rawEvents, latestLedger } = await this.fetchRawEvents(this.currentLedger);
      let count = 0;

      for (const raw of rawEvents) {
        if (this.processedEventIds.has(raw.id)) {
          continue;
        }

        const parsed = parseContractEvent(raw);
        if (parsed) {
          await this.dispatch(parsed);
          count++;
        }

        this.processedEventIds.add(raw.id);
        if (this.processedEventIds.size > 10000) {
          // Keep deduplication set bounded to last 5000 IDs
          const iterator = this.processedEventIds.values();
          for (let i = 0; i < 5000; i++) {
            this.processedEventIds.delete(iterator.next().value!);
          }
        }

        if (raw.ledger > this.currentLedger) {
          this.currentLedger = raw.ledger;
        }
      }

      if (latestLedger > this.currentLedger) {
        this.currentLedger = latestLedger;
      }

      await this.saveCheckpoint(this.currentLedger);
      return count;
    } catch (err) {
      this.notifyError(err instanceof Error ? err : new Error(String(err)));
      return 0;
    }
  }

  public async dispatch(event: ParsedContractEvent): Promise<void> {
    // Typed event handlers
    const specificHandlers = this.handlers.get(event.type) || [];
    for (const handler of specificHandlers) {
      try {
        await handler(event);
      } catch (err) {
        this.notifyError(
          new Error(`Error in handler for ${event.type}: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }

    // Universal handlers
    for (const handler of this.anyHandlers) {
      try {
        await handler(event);
      } catch (err) {
        this.notifyError(
          new Error(`Error in onAny handler: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Determine initial ledger
    const checkpointLedger = await this.loadCheckpoint();
    if (checkpointLedger !== null) {
      this.currentLedger = checkpointLedger;
    } else if (this.config.startLedger !== undefined) {
      this.currentLedger = this.config.startLedger;
    } else {
      const latest = await this.getLatestLedger();
      this.currentLedger = latest > 0 ? latest : 1;
    }

    const loop = async () => {
      if (!this.isRunning) return;
      await this.pollOnce();
      if (this.isRunning) {
        this.timeoutId = setTimeout(loop, this.config.pollIntervalMs);
      }
    };

    loop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  public getCurrentLedger(): number {
    return this.currentLedger;
  }

  public setCurrentLedger(ledger: number): void {
    this.currentLedger = ledger;
  }

  private notifyError(err: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(err);
      } catch {
        // Prevent recursive error loop
      }
    }
  }
}
