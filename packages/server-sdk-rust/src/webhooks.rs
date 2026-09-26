//! Webhook delivery verification.
//! Mirrors `packages/server-sdk/src/webhooks.ts` and `packages/server-sdk-go/webhooks.go`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use sha2::Sha256;
use thiserror::Error;

pub const SIGNATURE_HEADER: &str = "X-PromptHash-Signature";
pub const DELIVERY_HEADER: &str = "X-PromptHash-Delivery";
pub const EVENT_HEADER: &str = "X-PromptHash-Event";
pub const TIMESTAMP_HEADER: &str = "X-PromptHash-Timestamp";
pub const SCHEMA_VERSION_HEADER: &str = "X-PromptHash-Schema-Version";
pub const SIGNATURE_PREFIX: &str = "sha256=";
pub const DEFAULT_TOLERANCE_SECONDS: u64 = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailureReason {
    MissingSecret,
    MissingSignature,
    MissingTimestamp,
    MalformedSignature,
    SignatureMismatch,
    StaleTimestamp,
    FutureTimestamp,
    InvalidPayload,
    DuplicateDelivery,
}

impl FailureReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            FailureReason::MissingSecret => "missing_secret",
            FailureReason::MissingSignature => "missing_signature",
            FailureReason::MissingTimestamp => "missing_timestamp",
            FailureReason::MalformedSignature => "malformed_signature",
            FailureReason::SignatureMismatch => "signature_mismatch",
            FailureReason::StaleTimestamp => "stale_timestamp",
            FailureReason::FutureTimestamp => "future_timestamp",
            FailureReason::InvalidPayload => "invalid_payload",
            FailureReason::DuplicateDelivery => "duplicate_delivery",
        }
    }
}

#[derive(Debug, Error)]
#[error("[{reason:?}] {message}")]
pub struct WebhookVerificationError {
    pub reason: FailureReason,
    pub message: String,
}

impl WebhookVerificationError {
    pub fn new(reason: FailureReason, message: impl Into<String>) -> Self {
        Self {
            reason,
            message: message.into(),
        }
    }
    pub fn reason_str(&self) -> &'static str {
        self.reason.as_str()
    }
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct WebhookEnvelope {
    #[serde(default)]
    pub version: Option<u32>,
    #[serde(rename = "schemaVersion", default)]
    pub schema_version: Option<String>,
    pub event: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    pub timestamp: String,
    pub data: serde_json::Value,
}

/// Compute the `sha256=<hex>` signature for a raw body.
pub fn sign_webhook_body(secret: &str, body: &str) -> Result<String, WebhookVerificationError> {
    if secret.is_empty() {
        return Err(WebhookVerificationError::new(
            FailureReason::MissingSecret,
            "Webhook secret is required.",
        ));
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| WebhookVerificationError::new(FailureReason::MissingSecret, "Invalid secret"))?;
    mac.update(body.as_bytes());
    let result = mac.finalize().into_bytes();
    Ok(format!("{}{}", SIGNATURE_PREFIX, hex::encode(result)))
}

/// Constant-time signature check. Returns false for anything not exactly expected.
pub fn verify_webhook_signature(secret: &str, body: &str, signature: &str) -> bool {
    if secret.is_empty() || signature.is_empty() {
        return false;
    }
    let expected = match sign_webhook_body(secret, body) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let received = signature.trim();
    if expected.len() != received.len() {
        return false;
    }
    use subtle::ConstantTimeEq;
    expected.as_bytes().ct_eq(received.as_bytes()).unwrap_u8() == 1
}

#[derive(Debug, Clone, Default)]
pub struct VerifyOptions {
    pub tolerance: Option<Duration>,
    pub now: Option<SystemTime>,
    pub replay_guard: Option<Arc<WebhookReplayGuard>>,
}

/// Verify a delivery and return its parsed envelope.
pub fn verify_webhook(
    secret: &str,
    body: &str,
    headers: &HashMap<String, String>,
    opts: VerifyOptions,
) -> Result<WebhookEnvelope, WebhookVerificationError> {
    if secret.is_empty() {
        return Err(WebhookVerificationError::new(
            FailureReason::MissingSecret,
            "Webhook secret is required.",
        ));
    }

    let signature = get_header(headers, SIGNATURE_HEADER);
    let sig = match signature {
        Some(s) if !s.is_empty() => s,
        _ => {
            return Err(WebhookVerificationError::new(
                FailureReason::MissingSignature,
                format!("{} header is missing.", SIGNATURE_HEADER),
            ))
        }
    };
    if !sig.starts_with(SIGNATURE_PREFIX) {
        return Err(WebhookVerificationError::new(
            FailureReason::MalformedSignature,
            format!("{} must start with {}.", SIGNATURE_HEADER, SIGNATURE_PREFIX),
        ));
    }
    if !verify_webhook_signature(secret, body, &sig) {
        return Err(WebhookVerificationError::new(
            FailureReason::SignatureMismatch,
            "Webhook signature does not match the request body.",
        ));
    }

    let envelope: WebhookEnvelope = serde_json::from_str(body).map_err(|_| {
        WebhookVerificationError::new(FailureReason::InvalidPayload, "Webhook body is not valid JSON.")
    })?;
    if envelope.event.is_empty() {
        return Err(WebhookVerificationError::new(
            FailureReason::InvalidPayload,
            "Webhook envelope is missing `event`.",
        ));
    }
    if envelope.delivery_id.is_empty() {
        return Err(WebhookVerificationError::new(
            FailureReason::InvalidPayload,
            "Webhook envelope is missing `deliveryId`.",
        ));
    }

    let now = opts.now.unwrap_or_else(SystemTime::now);
    let tolerance = opts.tolerance.unwrap_or(Duration::from_secs(DEFAULT_TOLERANCE_SECONDS));

    let timestamp_raw = get_header(headers, TIMESTAMP_HEADER).unwrap_or_else(|| envelope.timestamp.clone());
    assert_freshness(&timestamp_raw, tolerance, now)?;

    if let Some(guard) = opts.replay_guard {
        if !guard.accept(&envelope.delivery_id, now) {
            return Err(WebhookVerificationError::new(
                FailureReason::DuplicateDelivery,
                format!("Delivery {} has already been processed.", envelope.delivery_id),
            ));
        }
    }

    Ok(envelope)
}

fn get_header(headers: &HashMap<String, String>, name: &str) -> Option<String> {
    // case-insensitive lookup
    for (k, v) in headers {
        if k.eq_ignore_ascii_case(name) {
            return Some(v.clone());
        }
    }
    None
}

fn assert_freshness(raw: &str, tolerance: Duration, now: SystemTime) -> Result<(), WebhookVerificationError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(WebhookVerificationError::new(
            FailureReason::MissingTimestamp,
            "Webhook timestamp is missing.",
        ));
    }

    let at = parse_webhook_timestamp(trimmed).ok_or_else(|| {
        WebhookVerificationError::new(
            FailureReason::InvalidPayload,
            format!("Webhook timestamp is not parseable: {}", raw),
        )
    })?;

    let skew = if now.duration_since(at).is_ok() {
        now.duration_since(at).unwrap()
    } else {
        // at is in future, skew negative
        Duration::from_secs(0)
    };
    // Determine direction: if at > now, it's future
    if at > now {
        let future_skew = at.duration_since(now).unwrap();
        if future_skew > tolerance {
            return Err(WebhookVerificationError::new(
                FailureReason::FutureTimestamp,
                "Webhook timestamp is too far in the future.",
            ));
        }
    } else if skew > tolerance {
        return Err(WebhookVerificationError::new(
            FailureReason::StaleTimestamp,
            "Webhook timestamp is outside the accepted replay window.",
        ));
    }
    Ok(())
}

fn parse_webhook_timestamp(raw: &str) -> Option<SystemTime> {
    let trimmed = raw.trim();
    // numeric epoch seconds or milliseconds
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(digits) = trimmed.parse::<i64>() {
            if trimmed.len() <= 10 {
                return Some(UNIX_EPOCH + Duration::from_secs(digits as u64));
            } else {
                return Some(UNIX_EPOCH + Duration::from_millis(digits as u64));
            }
        }
    }
    // RFC3339
    if let Ok(dt) = trimmed.parse::<chrono::DateTime<chrono::Utc>>() {
        return Some(SystemTime::from(dt));
    }
    // HTTP-date via chrono fallback
    let fmts = ["%a, %d %b %Y %H:%M:%S GMT", "%A, %d-%b-%y %H:%M:%S GMT", "%a %b %d %H:%M:%S %Y"];
    for fmt in fmts {
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(trimmed, fmt) {
            let dt = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc);
            return Some(SystemTime::from(dt));
        }
    }
    // Try RFC2822
    if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(trimmed) {
        return Some(SystemTime::from(dt));
    }
    None
}

/// Bounded set of recently accepted delivery ids, so a replayed delivery is rejected.
pub struct WebhookReplayGuard {
    ttl: Duration,
    max_entries: usize,
    seen: Mutex<HashMap<String, SystemTime>>,
}

impl WebhookReplayGuard {
    pub fn new(tolerance_secs: u64, max_entries: usize) -> Arc<Self> {
        let ttl = Duration::from_secs(if tolerance_secs == 0 { DEFAULT_TOLERANCE_SECONDS } else { tolerance_secs });
        let max = if max_entries == 0 { 10_000 } else { max_entries };
        Arc::new(Self {
            ttl,
            max_entries: max,
            seen: Mutex::new(HashMap::new()),
        })
    }

    pub fn accept(&self, delivery_id: &str, now: SystemTime) -> bool {
        let mut seen = self.seen.lock().unwrap();
        // prune expired
        seen.retain(|_, at| now.duration_since(*at).unwrap_or(Duration::from_secs(0)) <= self.ttl);
        if seen.contains_key(delivery_id) {
            return false;
        }
        seen.insert(delivery_id.to_string(), now);
        // evict oldest if over capacity
        while seen.len() > self.max_entries {
            // find oldest
            let oldest = seen.iter().min_by_key(|(_, t)| *t).map(|(k, _)| k.clone());
            if let Some(k) = oldest {
                seen.remove(&k);
            } else {
                break;
            }
        }
        true
    }

    pub fn size(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
}

impl std::fmt::Debug for WebhookReplayGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebhookReplayGuard").field("size", &self.size()).finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn sign(secret: &str, body: &str) -> String {
        sign_webhook_body(secret, body).unwrap()
    }

    #[test]
    fn sign_and_verify_roundtrip() {
        let secret = "test_secret";
        let body = r#"{"event":"PromptPurchased","deliveryId":"abc","timestamp":"2025-01-01T00:00:00Z","data":{}}"#;
        let sig = sign(secret, body);
        assert!(verify_webhook_signature(secret, body, &sig));
        assert!(!verify_webhook_signature(secret, body, "sha256=deadbeef"));
    }

    #[test]
    fn verify_success() {
        let secret = "whsec_test";
        let delivery_id = "del_123";
        let ts = chrono::Utc::now().to_rfc3339();
        let body = serde_json::json!({
            "event": "PromptPurchased",
            "deliveryId": delivery_id,
            "timestamp": ts,
            "data": {"promptId": "1"}
        }).to_string();
        let sig = sign(secret, &body);
        let mut headers = HashMap::new();
        headers.insert(SIGNATURE_HEADER.to_string(), sig);
        headers.insert(TIMESTAMP_HEADER.to_string(), ts.clone());
        let envelope = verify_webhook(secret, &body, &headers, VerifyOptions::default()).unwrap();
        assert_eq!(envelope.event, "PromptPurchased");
        assert_eq!(envelope.delivery_id, delivery_id);
    }

    #[test]
    fn verify_fails_on_bad_signature() {
        let secret = "s";
        let body = r#"{"event":"PromptPurchased","deliveryId":"abc","timestamp":"2025-01-01T00:00:00Z","data":{}}"#;
        let mut headers = HashMap::new();
        headers.insert(SIGNATURE_HEADER.to_string(), "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef".to_string());
        let err = verify_webhook(secret, body, &headers, VerifyOptions::default()).unwrap_err();
        assert_eq!(err.reason, FailureReason::SignatureMismatch);
    }

    #[test]
    fn replay_guard_rejects_duplicate() {
        let guard = WebhookReplayGuard::new(300, 100);
        let now = SystemTime::now();
        assert!(guard.accept("id1", now));
        assert!(!guard.accept("id1", now));
        assert_eq!(guard.size(), 1);
    }

    #[test]
    fn stale_timestamp_rejected() {
        let secret = "s";
        let ts = "2020-01-01T00:00:00Z";
        let body = serde_json::json!({"event":"PromptPurchased","deliveryId":"id","timestamp":ts,"data":{}}).to_string();
        let sig = sign(secret, &body);
        let mut headers = HashMap::new();
        headers.insert(SIGNATURE_HEADER.to_string(), sig);
        headers.insert(TIMESTAMP_HEADER.to_string(), ts.to_string());
        let err = verify_webhook(secret, &body, &headers, VerifyOptions{ tolerance: Some(Duration::from_secs(10)), ..Default::default() }).unwrap_err();
        assert_eq!(err.reason, FailureReason::StaleTimestamp);
    }
}
