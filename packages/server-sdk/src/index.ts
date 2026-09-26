/**
 * @prompthash/server-sdk — server-side TypeScript SDK for the Prompt Mint API.
 *
 * Covers API-key auth, `Accept-Version` negotiation, idempotent writes, typed
 * errors with machine-readable codes, bounded retry, and webhook verification.
 *
 * See `docs/sdk-error-codes.md` for the error-code reference card and
 * `docs/integration-guide.md` for usage examples.
 */

export { PromptHashServerClient } from "./client.js";
export type { MarketplacePage } from "./client.js";

export {
  ERROR_CODES,
  PromptHashApiError,
  PromptHashNetworkError,
  apiErrorFromParts,
  isRetryable,
  parseRetryAfter,
} from "./errors.js";
export type {
  ErrorCode,
  KnownErrorCode,
  PromptHashApiErrorInit,
} from "./errors.js";

export {
  DEFAULT_TOLERANCE_SECONDS,
  DELIVERY_HEADER,
  EVENT_HEADER,
  SCHEMA_VERSION_HEADER,
  SIGNATURE_HEADER,
  SIGNATURE_PREFIX,
  TIMESTAMP_HEADER,
  WebhookReplayGuard,
  WebhookVerificationError,
  signWebhookBody,
  verifyWebhook,
  verifyWebhookSignature,
} from "./webhooks.js";
export type {
  HeaderBag,
  VerifyWebhookOptions,
  WebhookEnvelope,
  WebhookFailureReason,
} from "./webhooks.js";

export { WEBHOOK_EVENTS } from "./types.js";
export type {
  ApiKeySummary,
  ApiScope,
  CreatedApiKey,
  FetchLike,
  FetchRequestInit,
  HttpResponseLike,
  ListPromptsParams,
  PromptSummary,
  RateLimitTier,
  RegisterWebhookParams,
  RequestOptions,
  ServerClientConfig,
  WebhookEventName,
  WebhookRegistration,
} from "./types.js";
