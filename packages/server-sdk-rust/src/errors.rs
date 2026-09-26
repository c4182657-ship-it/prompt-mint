//! Typed errors and machine-readable error codes.
//! Mirrors `packages/server-sdk/src/errors.ts` and `packages/server-sdk-go/errors.go`.

use std::collections::HashSet;
use std::time::{Duration, SystemTime};
use thiserror::Error;

/// Known error codes the API may return. The type is open — new codes may be added server-side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ErrorCode(pub &'static str);

impl ErrorCode {
    pub const fn as_str(&self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

/// All known codes, matching `docs/sdk-error-codes.md`.
pub mod ERROR_CODES {
    use super::ErrorCode;
    pub const MISSING_FIELDS: ErrorCode = ErrorCode("MISSING_FIELDS");
    pub const METHOD_NOT_ALLOWED: ErrorCode = ErrorCode("METHOD_NOT_ALLOWED");
    pub const INVALID_INPUT: ErrorCode = ErrorCode("INVALID_INPUT");
    pub const INVALID_VERSION: ErrorCode = ErrorCode("INVALID_VERSION");
    pub const INVALID_WALLET: ErrorCode = ErrorCode("INVALID_WALLET");
    pub const CHALLENGE_MALFORMED: ErrorCode = ErrorCode("CHALLENGE_MALFORMED");
    pub const CHALLENGE_EXPIRED: ErrorCode = ErrorCode("CHALLENGE_EXPIRED");
    pub const CHALLENGE_INVALID: ErrorCode = ErrorCode("CHALLENGE_INVALID");
    pub const INVALID_SIGNATURE: ErrorCode = ErrorCode("INVALID_SIGNATURE");
    pub const CHALLENGE_INVALID_SIGNATURE: ErrorCode = ErrorCode("CHALLENGE_INVALID_SIGNATURE");
    pub const CHALLENGE_MISMATCH: ErrorCode = ErrorCode("CHALLENGE_MISMATCH");
    pub const ACCESS_NOT_PURCHASED: ErrorCode = ErrorCode("ACCESS_NOT_PURCHASED");
    pub const UNAUTHENTICATED: ErrorCode = ErrorCode("UNAUTHENTICATED");
    pub const FORBIDDEN: ErrorCode = ErrorCode("FORBIDDEN");
    pub const KEY_NOT_FOUND: ErrorCode = ErrorCode("KEY_NOT_FOUND");
    pub const NOT_FOUND: ErrorCode = ErrorCode("NOT_FOUND");
    pub const RATE_LIMIT_IP: ErrorCode = ErrorCode("RATE_LIMIT_IP");
    pub const RATE_LIMIT_WALLET: ErrorCode = ErrorCode("RATE_LIMIT_WALLET");
    pub const RATE_LIMITED: ErrorCode = ErrorCode("RATE_LIMITED");
    pub const ACCOUNT_LOCKED: ErrorCode = ErrorCode("ACCOUNT_LOCKED");
    pub const CAPTCHA_REQUIRED: ErrorCode = ErrorCode("CAPTCHA_REQUIRED");
    pub const CAPTCHA_INVALID: ErrorCode = ErrorCode("CAPTCHA_INVALID");
    pub const CONCURRENT_VERSION_CONFLICT: ErrorCode = ErrorCode("CONCURRENT_VERSION_CONFLICT");
    pub const UNKNOWN_EVENT: ErrorCode = ErrorCode("UNKNOWN_EVENT");
    pub const INVALID_EVENT_PAYLOAD: ErrorCode = ErrorCode("INVALID_EVENT_PAYLOAD");
    pub const EXPORT_EXPIRED: ErrorCode = ErrorCode("EXPORT_EXPIRED");
    pub const CONFIGURATION_ERROR: ErrorCode = ErrorCode("CONFIGURATION_ERROR");
    pub const INTEGRITY_FAILURE: ErrorCode = ErrorCode("INTEGRITY_FAILURE");
    pub const TEMPORARY_FAILURE: ErrorCode = ErrorCode("TEMPORARY_FAILURE");
    pub const UNSUPPORTED_VERSION: ErrorCode = ErrorCode("UNSUPPORTED_VERSION");
    pub const PAYLOAD_TOO_LARGE: ErrorCode = ErrorCode("PAYLOAD_TOO_LARGE");
    pub const WALLET_NOT_FUNDED: ErrorCode = ErrorCode("WALLET_NOT_FUNDED");
}

fn retryable_statuses() -> HashSet<u16> {
    [408, 425, 429, 500, 502, 503, 504].iter().copied().collect()
}

fn non_retryable_codes() -> HashSet<&'static str> {
    [
        ERROR_CODES::INTEGRITY_FAILURE.0,
        ERROR_CODES::ACCESS_NOT_PURCHASED.0,
        ERROR_CODES::INVALID_INPUT.0,
        ERROR_CODES::MISSING_FIELDS.0,
        ERROR_CODES::METHOD_NOT_ALLOWED.0,
        ERROR_CODES::UNSUPPORTED_VERSION.0,
        ERROR_CODES::UNKNOWN_EVENT.0,
        ERROR_CODES::INVALID_EVENT_PAYLOAD.0,
        ERROR_CODES::CHALLENGE_EXPIRED.0,
        ERROR_CODES::CHALLENGE_INVALID.0,
        ERROR_CODES::INVALID_SIGNATURE.0,
    ]
    .iter()
    .copied()
    .collect()
}

/// Whether replaying the identical request can succeed.
pub fn is_retryable(status: u16, code: Option<&str>, message: Option<&str>) -> bool {
    if let Some(c) = code {
        if non_retryable_codes().contains(c) {
            return false;
        }
    }
    if retryable_statuses().contains(&status) {
        return true;
    }
    if status == 409 {
        if let Some(msg) = message {
            if msg.to_lowercase().contains("still being processed") {
                return true;
            }
        }
    }
    false
}

/// Error returned for every non-2xx API response.
#[derive(Debug, Clone, Error)]
#[error("prompthash: HTTP {status} ({code:?}): {message}")]
pub struct ApiError {
    pub status: u16,
    pub message: String,
    pub code: Option<String>,
    pub api_version: Option<String>,
    /// Unix epoch milliseconds at which a 429 resets.
    pub reset: Option<i64>,
    /// Duration parsed from a `Retry-After` header, if any.
    pub retry_after_header: Option<Duration>,
    pub method: Option<String>,
    pub url: Option<String>,
    pub body: Option<serde_json::Value>,
}

impl ApiError {
    pub fn retryable(&self) -> bool {
        is_retryable(self.status, self.code.as_deref(), Some(&self.message))
    }

    /// How long to wait before retrying, or `None` when the server gave no hint.
    /// Prefers `reset` timestamp on 429 responses.
    pub fn retry_after(&self, now: SystemTime) -> Option<Duration> {
        if let Some(reset_ms) = self.reset {
            let now_ms = now
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            let wait_ms = (reset_ms - now_ms).max(0) as u64;
            return Some(Duration::from_millis(wait_ms));
        }
        self.retry_after_header
    }
}

/// Thrown when no response was received (DNS failure, timeout, etc.).
#[derive(Debug, Error)]
#[error("prompthash: {method} {url} failed: {source}")]
pub struct NetworkError {
    pub method: String,
    pub url: String,
    #[source]
    pub source: Box<dyn std::error::Error + Send + Sync>,
}

impl NetworkError {
    pub fn new(method: impl Into<String>, url: impl Into<String>, source: Box<dyn std::error::Error + Send + Sync>) -> Self {
        Self {
            method: method.into(),
            url: url.into(),
            source,
        }
    }
}

/// Unified SDK error.
#[derive(Debug, Error)]
pub enum SdkError {
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error(transparent)]
    Network(#[from] NetworkError),
    #[error("{0}")]
    Config(String),
}

impl SdkError {
    pub fn is_api_error(&self) -> bool {
        matches!(self, SdkError::Api(_))
    }
    pub fn as_api_error(&self) -> Option<&ApiError> {
        match self {
            SdkError::Api(e) => Some(e),
            _ => None,
        }
    }
    pub fn is_network_error(&self) -> bool {
        matches!(self, SdkError::Network(_))
    }
}

/// Parses a `Retry-After` header (delta-seconds or HTTP-date) into a Duration.
pub fn parse_retry_after(value: Option<&str>, now: SystemTime) -> Option<Duration> {
    let raw = value?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    if raw.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(secs) = raw.parse::<u64>() {
            return Some(Duration::from_secs(secs));
        }
    }
    // Try HTTP-date via `httpdate` parsing (use `email.utils` equivalent).
    // We try parsing with `chrono` if available, otherwise fallback to `httpdate` crate style.
    // ureq/hyper headers use RFC1123.
    if let Ok(parsed) = httpdate::parse_http_date(&raw) {
        let wait = parsed.duration_since(now).unwrap_or(Duration::from_secs(0));
        return Some(wait);
    }
    // Try RFC3339
    if let Ok(dt) = raw.parse::<chrono::DateTime<chrono::Utc>>() {
        let parsed: SystemTime = dt.into();
        let wait = parsed.duration_since(now).unwrap_or(Duration::from_secs(0));
        return Some(wait);
    }
    None
}

/// Normalises a response into an `ApiError`.
pub fn api_error_from_parts(
    status: u16,
    status_text: &str,
    text: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    method: Option<&str>,
    url: Option<&str>,
) -> ApiError {
    let mut body: Option<serde_json::Value> = None;
    let mut message = String::new();
    let mut code: Option<String> = None;
    let mut api_version: Option<String> = None;
    let mut reset: Option<i64> = None;

    if !text.is_empty() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
            body = Some(v.clone());
            if let Some(obj) = v.as_object() {
                if let Some(e) = obj.get("error").and_then(|x| x.as_str()) {
                    message = e.to_string();
                }
                if let Some(c) = obj.get("code").and_then(|x| x.as_str()) {
                    code = Some(c.to_string());
                }
                if let Some(av) = obj.get("apiVersion").and_then(|x| x.as_str()) {
                    api_version = Some(av.to_string());
                }
                if let Some(r) = obj.get("reset").and_then(|x| x.as_i64()) {
                    reset = Some(r);
                }
            }
        }
    }

    if message.is_empty() && !text.is_empty() {
        message = text.chars().take(300).collect();
    }
    if message.is_empty() {
        let suffix = if status_text.is_empty() {
            "".to_string()
        } else {
            format!(" {}", status_text)
        };
        message = format!("Request failed with HTTP {}{}.", status, suffix);
    }

    let retry_after_header = headers
        .and_then(|h| {
            // case-insensitive lookup
            h.get("retry-after")
                .or_else(|| h.get("Retry-After"))
                .or_else(|| {
                    h.iter()
                        .find(|(k, _)| k.to_lowercase() == "retry-after")
                        .map(|(_, v)| v)
                })
                .map(|s| s.as_str())
        })
        .and_then(|v| parse_retry_after(Some(v), SystemTime::now()));

    ApiError {
        status,
        message,
        code,
        api_version,
        reset,
        retry_after_header,
        method: method.map(|s| s.to_string()),
        url: url.map(|s| s.to_string()),
        body,
    }
}

// Minimal httpdate parser without extra dep: we implement a fallback using `chrono`.
mod httpdate {
    use std::time::{Duration, SystemTime};

    pub fn parse_http_date(s: &str) -> Result<SystemTime, String> {
        // Try RFC1123: "Sun, 06 Nov 1994 08:49:37 GMT"
        // Use chrono for parsing.
        let fmt1 = "%a, %d %b %Y %H:%M:%S GMT";
        let fmt2 = "%A, %d-%b-%y %H:%M:%S GMT";
        let fmt3 = "%a %b %d %H:%M:%S %Y";
        for fmt in [fmt1, fmt2, fmt3] {
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
                let dt_utc = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc);
                return Ok(SystemTime::from(dt_utc));
            }
        }
        // Try RFC3339
        if let Ok(dt) = s.parse::<chrono::DateTime<chrono::Utc>>() {
            return Ok(SystemTime::from(dt));
        }
        Err("unparseable".to_string())
    }

    #[allow(dead_code)]
    pub fn _unused_duration(_d: Duration) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_retryable_positive_cases() {
        assert!(is_retryable(429, None, None));
        assert!(is_retryable(500, None, None));
        assert!(is_retryable(503, None, None));
        assert!(is_retryable(408, None, None));
        assert!(is_retryable(409, None, Some("A request with this Idempotency-Key is still being processed.")));
    }

    #[test]
    fn is_retryable_non_retryable_code() {
        assert!(!is_retryable(500, Some("INTEGRITY_FAILURE"), None));
        assert!(!is_retryable(429, Some("INVALID_INPUT"), None));
        assert!(!is_retryable(400, None, None));
    }

    #[test]
    fn parse_retry_after_delta() {
        let d = parse_retry_after(Some("120"), SystemTime::now()).unwrap();
        assert_eq!(d, Duration::from_secs(120));
    }

    #[test]
    fn api_error_from_json() {
        let text = r#"{"error":"Too many requests","code":"RATE_LIMIT_IP","reset":1234567890,"apiVersion":"2025-01-01"}"#;
        let err = api_error_from_parts(429, "Too Many Requests", text, None, Some("GET"), Some("https://example.com"));
        assert_eq!(err.code.as_deref(), Some("RATE_LIMIT_IP"));
        assert_eq!(err.reset, Some(1234567890));
        assert_eq!(err.api_version.as_deref(), Some("2025-01-01"));
        assert!(err.retryable());
    }

    #[test]
    fn retry_after_prefers_reset() {
        let now = SystemTime::now();
        let reset_ms = (now.duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis() as i64) + 5000;
        let err = ApiError {
            status: 429,
            message: "rate".into(),
            code: Some("RATE_LIMIT_IP".into()),
            api_version: None,
            reset: Some(reset_ms),
            retry_after_header: Some(Duration::from_secs(1)),
            method: None,
            url: None,
            body: None,
        };
        let wait = err.retry_after(now).unwrap();
        assert!(wait.as_millis() >= 4900 && wait.as_millis() <= 5100);
    }
}
