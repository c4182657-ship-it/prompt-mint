/**
 * @prompthash/sdk — Issue #110
 *
 * Lightweight JS/TS SDK for interacting with the PromptHash Stellar protocol.
 * Covers: fetching prompts, buying prompts, and verifying license ownership.
 */

export { PromptHashClient } from "./client.js";
export type {
  PromptInfo,
  PurchaseResult,
  ClientConfig,
  VoteResult,
  VersionedApiResponse,
  WebhookDelivery,
} from "./types.js";

// ── Mock responses library (Issue #771) ──────────────────────────────────────
export { Mocks } from "./mocks.js";
export {
  MOCK_API_VERSION,
  MOCK_WALLET_ADDRESS,
  MOCK_CREATOR_ADDRESS,
  ERROR_MESSAGES as MOCK_ERROR_MESSAGES,
  HTTP_STATUS_FOR,
  prompt as mockPrompt,
  promptList as mockPromptList,
  listPromptsResponse as mockListPromptsResponse,
  challengeResponse as mockChallengeResponse,
  unlockResponse as mockUnlockResponse,
  unlockIntegrityFailure as mockUnlockIntegrityFailure,
  purchaseResult as mockPurchaseResult,
  voteResult as mockVoteResult,
  topPromptsResponse as mockTopPromptsResponse,
  webhookRegistration as mockWebhookRegistration,
  webhookEnvelope as mockWebhookEnvelope,
  promptPurchasedWebhook as mockPromptPurchasedWebhook,
  promptCreatedWebhook as mockPromptCreatedWebhook,
  apiError as mockApiError,
  httpStatusFor,
  rateLimitHeaders as mockRateLimitHeaders,
  healthResponse as mockHealthResponse,
} from "./mocks.js";
export type {
  MockPrompt,
  MockChallengeResponse,
  MockUnlockResponse,
  MockPurchaseResult,
  MockVoteResult,
  MockTopPromptsResponse,
  MockWebhookRegistration,
  MockWebhookEnvelope,
  MockApiError,
  MockErrorCode,
  MockRateLimitHeaders,
  MockHealthResponse,
  ListPromptsResponse,
  VersionedEnvelope,
} from "./mocks.js";
