import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { parseContractEvent, type RawSorobanEvent } from "../../examples/contract-event-consumer/src/parser";
import { ContractEventConsumer } from "../../examples/contract-event-consumer/src/consumer";
import type { PromptCreatedEvent, PromptPurchasedEvent } from "../../examples/contract-event-consumer/src/types";

describe("Contract Event Consumer", () => {
  describe("Event Parser (parseContractEvent)", () => {
    it("parses PromptCreated event with plain object value", () => {
      const raw: RawSorobanEvent = {
        id: "0000000001-0000000001",
        ledger: 100,
        ledgerClosedAt: "2026-03-29T12:00:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        txHash: "0xabc123",
        topic: ["PromptCreated", "42"],
        value: {
          prompt_id: "42",
          creator: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGXDECKXOWBLNL2WIO",
          price_stroops: "50000000",
          asset: "XLM",
        },
      };

      const parsed = parseContractEvent(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("PromptCreated");
      const event = parsed as PromptCreatedEvent;
      expect(event.promptId).toBe("42");
      expect(event.creator).toBe("GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGXDECKXOWBLNL2WIO");
      expect(event.priceStroops).toBe("50000000");
      expect(event.asset).toBe("XLM");
      expect(event.ledger).toBe(100);
      expect(event.txHash).toBe("0xabc123");
    });

    it("parses PromptPurchased event correctly", () => {
      const raw: RawSorobanEvent = {
        id: "0000000002-0000000001",
        ledger: 105,
        ledgerClosedAt: "2026-03-29T12:05:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        txHash: "0xdef456",
        topic: ["PromptPurchased", "42"],
        value: {
          prompt_id: "42",
          buyer: "GBUYER11111111111111111111111111111111111111111111111111",
          creator: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGXDECKXOWBLNL2WIO",
          price_stroops: "50000000",
          creator_amount: "47500000",
          platform_amount: "2500000",
          referrer: "GREFER1111111111111111111111111111111111111111111111111",
          referrer_amount: "1000000",
        },
      };

      const parsed = parseContractEvent(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("PromptPurchased");
      const event = parsed as PromptPurchasedEvent;
      expect(event.buyer).toBe("GBUYER11111111111111111111111111111111111111111111111111");
      expect(event.creatorAmount).toBe("47500000");
      expect(event.platformAmount).toBe("2500000");
      expect(event.referrer).toBe("GREFER1111111111111111111111111111111111111111111111111");
      expect(event.referrerAmount).toBe("1000000");
    });

    it("parses PromptPriceUpdated and PromptSaleStatusUpdated events", () => {
      const priceRaw: RawSorobanEvent = {
        id: "0000000003-0000000001",
        ledger: 110,
        ledgerClosedAt: "2026-03-29T12:10:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        topic: ["PromptPriceUpdated", "101"],
        value: {
          prompt_id: "101",
          previous_price: "50000000",
          price_stroops: "75000000",
        },
      };
      const priceEvent = parseContractEvent(priceRaw);
      expect(priceEvent?.type).toBe("PromptPriceUpdated");

      const statusRaw: RawSorobanEvent = {
        id: "0000000004-0000000001",
        ledger: 115,
        ledgerClosedAt: "2026-03-29T12:15:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        topic: ["PromptSaleStatusUpdated", "101"],
        value: {
          prompt_id: "101",
          active: false,
        },
      };
      const statusEvent = parseContractEvent(statusRaw);
      expect(statusEvent?.type).toBe("PromptSaleStatusUpdated");
      if (statusEvent && statusEvent.type === "PromptSaleStatusUpdated") {
        expect(statusEvent.active).toBe(false);
      }
    });

    it("parses LicenseTransferred and ContractPausedStateChanged events", () => {
      const transferRaw: RawSorobanEvent = {
        id: "0000000005-0000000001",
        ledger: 120,
        ledgerClosedAt: "2026-03-29T12:20:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        topic: ["LicenseTransferred", "101"],
        value: {
          prompt_id: "101",
          seller: "GSELLER",
          buyer: "GBUYER",
          creator: "GCREATOR",
          resale_price: "100000000",
          royalty_amount: "5000000",
        },
      };
      const transferEvent = parseContractEvent(transferRaw);
      expect(transferEvent?.type).toBe("LicenseTransferred");

      const pauseRaw: RawSorobanEvent = {
        id: "0000000006-0000000001",
        ledger: 125,
        ledgerClosedAt: "2026-03-29T12:25:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        topic: ["ContractPausedStateChanged"],
        value: { is_paused: true },
      };
      const pauseEvent = parseContractEvent(pauseRaw);
      expect(pauseEvent?.type).toBe("ContractPausedStateChanged");
      if (pauseEvent && pauseEvent.type === "ContractPausedStateChanged") {
        expect(pauseEvent.isPaused).toBe(true);
      }
    });

    it("returns null for unrecognized topics", () => {
      const unknownRaw: RawSorobanEvent = {
        id: "0000000007-0000000001",
        ledger: 130,
        ledgerClosedAt: "2026-03-29T12:30:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        topic: ["UnknownEventTopic"],
        value: {},
      };
      expect(parseContractEvent(unknownRaw)).toBeNull();
    });
  });

  describe("ContractEventConsumer Runtime", () => {
    let tempDir: string;
    let checkpointPath: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "consumer-test-"));
      checkpointPath = path.join(tempDir, "checkpoint.json");
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it("saves and loads checkpoint correctly", async () => {
      const consumer = new ContractEventConsumer({
        rpcUrl: "http://localhost:8000",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        checkpointFile: checkpointPath,
      });

      expect(await consumer.loadCheckpoint()).toBeNull();

      await consumer.saveCheckpoint(54321, "evt-001");
      const loaded = await consumer.loadCheckpoint();
      expect(loaded).toBe(54321);

      const content = JSON.parse(await fs.readFile(checkpointPath, "utf-8"));
      expect(content.lastLedger).toBe(54321);
      expect(content.lastEventId).toBe("evt-001");
      expect(content.updatedAt).toBeDefined();
    });

    it("dispatches typed and any events to registered listeners", async () => {
      const consumer = new ContractEventConsumer({
        rpcUrl: "http://localhost:8000",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      });

      const promptCreatedHandler = vi.fn();
      const anyHandler = vi.fn();

      consumer.on("PromptCreated", promptCreatedHandler);
      consumer.onAny(anyHandler);

      const event: PromptCreatedEvent = {
        id: "test-id",
        type: "PromptCreated",
        ledger: 200,
        ledgerClosedAt: "2026-03-29T12:00:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        txHash: "0x123",
        promptId: "1",
        creator: "GCREATOR",
        priceStroops: "10000000",
        asset: "XLM",
      };

      await consumer.dispatch(event);

      expect(promptCreatedHandler).toHaveBeenCalledTimes(1);
      expect(promptCreatedHandler).toHaveBeenCalledWith(event);
      expect(anyHandler).toHaveBeenCalledTimes(1);
      expect(anyHandler).toHaveBeenCalledWith(event);
    });

    it("polls and deduplicates events correctly", async () => {
      const consumer = new ContractEventConsumer({
        rpcUrl: "http://localhost:8000",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        checkpointFile: checkpointPath,
      });

      const rawEvent: RawSorobanEvent = {
        id: "ledger-200-idx-1",
        ledger: 200,
        ledgerClosedAt: "2026-03-29T12:00:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        topic: ["PromptCreated", "1"],
        value: {
          prompt_id: "1",
          creator: "GCREATOR",
          price_stroops: "10000000",
          asset: "XLM",
        },
      };

      vi.spyOn(consumer, "fetchRawEvents").mockResolvedValue({
        events: [rawEvent],
        latestLedger: 200,
      });

      const handler = vi.fn();
      consumer.on("PromptCreated", handler);

      const processedCount1 = await consumer.pollOnce();
      expect(processedCount1).toBe(1);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(consumer.getCurrentLedger()).toBe(200);

      // Second poll with same event id should deduplicate and skip
      const processedCount2 = await consumer.pollOnce();
      expect(processedCount2).toBe(0);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("notifies error handlers when polling fails", async () => {
      const consumer = new ContractEventConsumer({
        rpcUrl: "http://localhost:8000",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      });

      vi.spyOn(consumer, "fetchRawEvents").mockRejectedValue(new Error("RPC Connection Refused"));

      const errorHandler = vi.fn();
      consumer.onError(errorHandler);

      const processed = await consumer.pollOnce();
      expect(processed).toBe(0);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain("RPC Connection Refused");
    });
  });
});
