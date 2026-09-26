export type ContractEventType =
  | "PromptCreated"
  | "PromptPurchased"
  | "PromptPriceUpdated"
  | "PromptSaleStatusUpdated"
  | "LicenseTransferred"
  | "ReferralRewardPaid"
  | "ContractPausedStateChanged";

export interface BaseContractEvent {
  id: string;
  type: ContractEventType;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  txHash: string;
}

export interface PromptCreatedEvent extends BaseContractEvent {
  type: "PromptCreated";
  promptId: string;
  creator: string;
  priceStroops: string;
  asset: string;
}

export interface PromptPurchasedEvent extends BaseContractEvent {
  type: "PromptPurchased";
  promptId: string;
  buyer: string;
  creator: string;
  priceStroops: string;
  referrer?: string;
  creatorAmount: string;
  platformAmount: string;
  referrerAmount: string;
}

export interface PromptPriceUpdatedEvent extends BaseContractEvent {
  type: "PromptPriceUpdated";
  promptId: string;
  previousPrice: string;
  priceStroops: string;
}

export interface PromptSaleStatusUpdatedEvent extends BaseContractEvent {
  type: "PromptSaleStatusUpdated";
  promptId: string;
  active: boolean;
}

export interface LicenseTransferredEvent extends BaseContractEvent {
  type: "LicenseTransferred";
  promptId: string;
  seller: string;
  buyer: string;
  creator: string;
  resalePrice: string;
  royaltyAmount: string;
}

export interface ReferralRewardPaidEvent extends BaseContractEvent {
  type: "ReferralRewardPaid";
  promptId: string;
  referrer: string;
  buyer: string;
  rewardAmount: string;
}

export interface ContractPausedStateChangedEvent extends BaseContractEvent {
  type: "ContractPausedStateChanged";
  isPaused: boolean;
}

export type ParsedContractEvent =
  | PromptCreatedEvent
  | PromptPurchasedEvent
  | PromptPriceUpdatedEvent
  | PromptSaleStatusUpdatedEvent
  | LicenseTransferredEvent
  | ReferralRewardPaidEvent
  | ContractPausedStateChangedEvent;

export interface ConsumerConfig {
  rpcUrl: string;
  contractId: string;
  startLedger?: number;
  pollIntervalMs?: number;
  batchSize?: number;
  checkpointFile?: string;
}

export interface EventCheckpoint {
  lastLedger: number;
  lastEventId?: string;
  updatedAt: string;
}

export type EventHandler<T extends ParsedContractEvent = ParsedContractEvent> = (
  event: T,
) => Promise<void> | void;
