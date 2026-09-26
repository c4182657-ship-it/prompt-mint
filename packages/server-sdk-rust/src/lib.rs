//! `prompthash-server-sdk` — server-side Rust SDK for the Prompt Mint API.
//!
//! Covers API-key auth, `Accept-Version` negotiation, idempotent writes, typed
//! errors with machine-readable codes, bounded retry, and webhook verification.
//!
//! See `docs/sdk-error-codes.md` for the error-code reference card and
//! `docs/integration-guide.md` for usage examples.

pub mod client;
pub mod errors;
pub mod webhooks;

pub use client::{
    Client, ClientConfig, CreateApiKeyParams, ListPromptsParams, MarketplacePage,
    RegisterWebhookParams, RequestOptions, WebhookRegistration,
};
pub use errors::{ApiError, NetworkError, SdkError, ERROR_CODES, is_retryable, parse_retry_after, api_error_from_parts};
pub use webhooks::{
    verify_webhook, verify_webhook_signature, sign_webhook_body, WebhookReplayGuard,
    VerifyOptions, WebhookEnvelope, WebhookVerificationError, FailureReason,
    SIGNATURE_HEADER, DELIVERY_HEADER, EVENT_HEADER, TIMESTAMP_HEADER, SCHEMA_VERSION_HEADER,
    SIGNATURE_PREFIX, DEFAULT_TOLERANCE_SECONDS,
};

/// Re-exported webhook event names, matching `packages/server-sdk/src/types.ts`.
pub const WEBHOOK_EVENTS: &[&str] = &[
    "PromptCreated",
    "PromptPurchased",
    "PromptPriceUpdated",
    "LicenseTransferred",
    "DisputeOpened",
    "DisputeResolved",
    "EncryptionRotated",
];
