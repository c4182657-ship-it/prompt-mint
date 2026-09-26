import { xdr, scValToNative } from "@stellar/stellar-sdk";
import type {
  ContractEventType,
  ParsedContractEvent,
  PromptCreatedEvent,
  PromptPurchasedEvent,
  PromptPriceUpdatedEvent,
  PromptSaleStatusUpdatedEvent,
  LicenseTransferredEvent,
  ReferralRewardPaidEvent,
  ContractPausedStateChangedEvent,
} from "./types.js";

export interface RawSorobanEvent {
  id: string;
  type?: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: { xdr: string } | string | Record<string, unknown>;
  txHash?: string;
}

/**
 * Safely decodes an XDR base64 string to a native JS value.
 */
export function decodeXdrScVal(base64Xdr: string): unknown {
  try {
    const val = xdr.ScVal.fromXDR(base64Xdr, "base64");
    return scValToNative(val);
  } catch {
    return null;
  }
}

/**
 * Extracts topic strings from an array of XDR or plain string topics.
 */
export function decodeTopicName(rawTopic: string): string {
  try {
    const decoded = decodeXdrScVal(rawTopic);
    if (typeof decoded === "string") return decoded;
    if (decoded && typeof decoded === "object" && "toString" in decoded) {
      return String(decoded);
    }
  } catch {
    // If not valid XDR base64, return as-is
  }
  return String(rawTopic);
}

/**
 * Parse a raw Soroban contract event into a strongly-typed domain event.
 */
export function parseContractEvent(raw: RawSorobanEvent): ParsedContractEvent | null {
  if (!raw || !raw.topic || raw.topic.length === 0) {
    return null;
  }

  const eventName = decodeTopicName(raw.topic[0]);
  const base = {
    id: raw.id,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt || new Date().toISOString(),
    contractId: raw.contractId,
    txHash: raw.txHash || "0x0",
  };

  let rawVal: string | null = null;
  if (typeof raw.value === "string") {
    rawVal = raw.value;
  } else if (
    typeof raw.value === "object" &&
    raw.value !== null &&
    "xdr" in raw.value &&
    typeof (raw.value as { xdr: unknown }).xdr === "string"
  ) {
    rawVal = (raw.value as { xdr: string }).xdr;
  }

  const decodedData = rawVal ? decodeXdrScVal(rawVal) : raw.value;

  switch (eventName) {
    case "PromptCreated": {
      const topicPromptId = raw.topic[1] ? String(decodeXdrScVal(raw.topic[1]) ?? raw.topic[1]) : "0";
      const valObj = (decodedData as Record<string, unknown>) || {};
      const evt: PromptCreatedEvent = {
        ...base,
        type: "PromptCreated",
        promptId: String(valObj.prompt_id ?? topicPromptId),
        creator: String(valObj.creator ?? ""),
        priceStroops: String(valObj.price_stroops ?? "0"),
        asset: String(valObj.asset ?? ""),
      };
      return evt;
    }

    case "PromptPurchased": {
      const topicPromptId = raw.topic[1] ? String(decodeXdrScVal(raw.topic[1]) ?? raw.topic[1]) : "0";
      const valObj = (decodedData as Record<string, unknown>) || {};
      const evt: PromptPurchasedEvent = {
        ...base,
        type: "PromptPurchased",
        promptId: String(valObj.prompt_id ?? topicPromptId),
        buyer: String(valObj.buyer ?? ""),
        creator: String(valObj.creator ?? ""),
        priceStroops: String(valObj.price_stroops ?? "0"),
        referrer: valObj.referrer ? String(valObj.referrer) : undefined,
        creatorAmount: String(valObj.creator_amount ?? "0"),
        platformAmount: String(valObj.platform_amount ?? "0"),
        referrerAmount: String(valObj.referrer_amount ?? "0"),
      };
      return evt;
    }

    case "PromptPriceUpdated": {
      const topicPromptId = raw.topic[1] ? String(decodeXdrScVal(raw.topic[1]) ?? raw.topic[1]) : "0";
      const valObj = (decodedData as Record<string, unknown>) || {};
      const evt: PromptPriceUpdatedEvent = {
        ...base,
        type: "PromptPriceUpdated",
        promptId: String(valObj.prompt_id ?? topicPromptId),
        previousPrice: String(valObj.previous_price ?? "0"),
        priceStroops: String(valObj.price_stroops ?? "0"),
      };
      return evt;
    }

    case "PromptSaleStatusUpdated": {
      const topicPromptId = raw.topic[1] ? String(decodeXdrScVal(raw.topic[1]) ?? raw.topic[1]) : "0";
      const valObj = (decodedData as Record<string, unknown>) || {};
      const evt: PromptSaleStatusUpdatedEvent = {
        ...base,
        type: "PromptSaleStatusUpdated",
        promptId: String(valObj.prompt_id ?? topicPromptId),
        active: Boolean(valObj.active),
      };
      return evt;
    }

    case "LicenseTransferred": {
      const topicPromptId = raw.topic[1] ? String(decodeXdrScVal(raw.topic[1]) ?? raw.topic[1]) : "0";
      const valObj = (decodedData as Record<string, unknown>) || {};
      const evt: LicenseTransferredEvent = {
        ...base,
        type: "LicenseTransferred",
        promptId: String(valObj.prompt_id ?? topicPromptId),
        seller: String(valObj.seller ?? ""),
        buyer: String(valObj.buyer ?? ""),
        creator: String(valObj.creator ?? ""),
        resalePrice: String(valObj.resale_price ?? "0"),
        royaltyAmount: String(valObj.royalty_amount ?? "0"),
      };
      return evt;
    }

    case "ReferralRewardPaid": {
      const topicPromptId = raw.topic[1] ? String(decodeXdrScVal(raw.topic[1]) ?? raw.topic[1]) : "0";
      const valObj = (decodedData as Record<string, unknown>) || {};
      const evt: ReferralRewardPaidEvent = {
        ...base,
        type: "ReferralRewardPaid",
        promptId: String(valObj.prompt_id ?? topicPromptId),
        referrer: String(valObj.referrer ?? ""),
        buyer: String(valObj.buyer ?? ""),
        rewardAmount: String(valObj.reward_amount ?? "0"),
      };
      return evt;
    }

    case "ContractPausedStateChanged": {
      const valObj = (decodedData as Record<string, unknown>) || {};
      const evt: ContractPausedStateChangedEvent = {
        ...base,
        type: "ContractPausedStateChanged",
        isPaused: Boolean(valObj.is_paused),
      };
      return evt;
    }

    default:
      return null;
  }
}
