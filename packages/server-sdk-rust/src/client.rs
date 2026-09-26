//! HTTP client for the Prompt Mint API.
//! Mirrors `packages/server-sdk/src/client.ts` and `packages/server-sdk-go/client.go`.

use std::collections::HashMap;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::{api_error_from_parts, ApiError, NetworkError, SdkError};

const DEFAULT_API_VERSION: &str = "latest";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_MAX_RETRIES: usize = 2;
const DEFAULT_RETRY_BASE: Duration = Duration::from_millis(250);
const DEFAULT_RETRY_MAX: Duration = Duration::from_secs(10);
const DEFAULT_USER_AGENT: &str = "prompthash-server-sdk/0.1.0";

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub base_url: String,
    pub api_key: Option<String>,
    pub api_version: Option<String>,
    pub timeout: Option<Duration>,
    pub max_retries: Option<usize>,
    pub retry_base_delay: Option<Duration>,
    pub retry_max_delay: Option<Duration>,
    pub default_headers: Option<HashMap<String, String>>,
    pub user_agent: Option<String>,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            api_key: None,
            api_version: None,
            timeout: None,
            max_retries: None,
            retry_base_delay: None,
            retry_max_delay: None,
            default_headers: None,
            user_agent: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct RequestOptions {
    pub query: Option<HashMap<String, String>>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<Value>,
    pub idempotency_key: Option<String>,
    /// `None` means use client's max_retries; `Some(0)` disables retries.
    pub retry: Option<usize>,
}

impl RequestOptions {
    pub fn new() -> Self { Self::default() }
}

#[derive(Debug, Clone)]
pub struct Client {
    base_url: String,
    api_key: String,
    api_version: String,
    timeout: Duration,
    max_retries: usize,
    retry_base_delay: Duration,
    retry_max_delay: Duration,
    default_headers: HashMap<String, String>,
    user_agent: String,
}

impl Client {
    pub fn new(cfg: ClientConfig) -> Result<Self, SdkError> {
        let base_url = cfg.base_url.trim().trim_end_matches('/').to_string();
        if base_url.is_empty() {
            return Err(SdkError::Config("PromptHashServerClient requires a baseUrl.".to_string()));
        }
        // Validate URL
        let parsed = url::Url::parse(&base_url).map_err(|e| SdkError::Config(format!("Invalid baseUrl: {}", e)))?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(SdkError::Config("baseUrl must be http(s)".to_string()));
        }
        let api_version = cfg.api_version.unwrap_or_else(|| DEFAULT_API_VERSION.to_string());
        let api_version = if api_version.trim().is_empty() { DEFAULT_API_VERSION.to_string() } else { api_version.trim().to_string() };
        let timeout = cfg.timeout.unwrap_or(DEFAULT_TIMEOUT);
        let max_retries = cfg.max_retries.unwrap_or(DEFAULT_MAX_RETRIES);
        let base = cfg.retry_base_delay.unwrap_or(DEFAULT_RETRY_BASE);
        let max_delay = cfg.retry_max_delay.unwrap_or(DEFAULT_RETRY_MAX);
        let retry_max_delay = if max_delay < base { base } else { max_delay };

        Ok(Self {
            base_url,
            api_key: cfg.api_key.unwrap_or_default().trim().to_string(),
            api_version,
            timeout,
            max_retries,
            retry_base_delay: base,
            retry_max_delay,
            default_headers: cfg.default_headers.unwrap_or_default(),
            user_agent: cfg.user_agent.unwrap_or_else(|| DEFAULT_USER_AGENT.to_string()),
        })
    }

    fn build_url(&self, path: &str, query: Option<&HashMap<String,String>>) -> String {
        let normalized = if path.starts_with('/') { path.to_string() } else { format!("/{}", path) };
        let mut url = format!("{}{}", self.base_url, normalized);
        if let Some(q) = query {
            if !q.is_empty() {
                let qs: Vec<String> = q.iter().map(|(k,v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v))).collect();
                let sep = if url.contains('?') { "&" } else { "?" };
                url.push_str(sep);
                url.push_str(&qs.join("&"));
            }
        }
        url
    }

    fn build_headers(&self, opts: &RequestOptions, has_body: bool) -> HashMap<String,String> {
        let mut headers = HashMap::new();
        headers.insert("Accept".to_string(), "application/json".to_string());
        headers.insert("Accept-Version".to_string(), self.api_version.clone());
        headers.insert("User-Agent".to_string(), self.user_agent.clone());
        if has_body {
            headers.insert("Content-Type".to_string(), "application/json".to_string());
        }
        if !self.api_key.is_empty() {
            headers.insert("Authorization".to_string(), format!("Bearer {}", self.api_key));
        }
        if let Some(k) = &opts.idempotency_key {
            headers.insert("Idempotency-Key".to_string(), k.clone());
        }
        for (k,v) in &self.default_headers {
            headers.insert(k.clone(), v.clone());
        }
        if let Some(extra) = &opts.headers {
            for (k,v) in extra {
                headers.insert(k.clone(), v.clone());
            }
        }
        headers
    }

    /// Core request pipeline. Returns raw response body bytes on success.
    pub fn request(&self, method: &str, path: &str, opts: RequestOptions) -> Result<String, SdkError> {
        let url = self.build_url(path, opts.query.as_ref());
        let attempts_allowed = opts.retry.unwrap_or(self.max_retries);
        let headers = self.build_headers(&opts, opts.body.is_some());
        let payload = opts.body.as_ref().map(|b| serde_json::to_string(b).unwrap());

        let mut attempt: usize = 0;
        loop {
            match self.attempt(method, &url, &headers, payload.as_deref()) {
                Ok((status, status_text, resp_headers, body)) => {
                    if (200..300).contains(&status) {
                        return Ok(body);
                    }
                    let api_err = api_error_from_parts(status, &status_text, &body, Some(&resp_headers), Some(method), Some(&url));
                    if api_err.retryable() && attempt < attempts_allowed {
                        let delay = self.backoff(attempt, Some(&api_err));
                        std::thread::sleep(delay);
                        attempt += 1;
                        continue;
                    }
                    return Err(SdkError::Api(api_err));
                }
                Err(e) => {
                    if attempt < attempts_allowed {
                        let delay = self.backoff(attempt, None);
                        std::thread::sleep(delay);
                        attempt += 1;
                        continue;
                    }
                    return Err(SdkError::Network(e));
                }
            }
        }
    }

    fn attempt(&self, method: &str, url: &str, headers: &HashMap<String,String>, payload: Option<&str>) -> Result<(u16, String, HashMap<String,String>, String), NetworkError> {
        let agent = ureq::AgentBuilder::new()
            .timeout(self.timeout)
            .build();
        let req = match method.to_uppercase().as_str() {
            "GET" => agent.get(url),
            "POST" => agent.post(url),
            "PUT" => agent.put(url),
            "PATCH" => agent.request("PATCH", url),
            "DELETE" => agent.delete(url),
            other => agent.request(other, url),
        };
        let mut req = req;
        for (k,v) in headers {
            req = req.set(k, v);
        }
        let resp = if let Some(body) = payload {
            req.send_string(body)
        } else {
            req.call()
        };
        match resp {
            Ok(r) => {
                let status = r.status();
                let status_text = r.status_text().to_string();
                let mut h = HashMap::new();
                for k in r.headers_names() {
                    if let Some(v) = r.header(&k) {
                        h.insert(k.clone(), v.to_string());
                    }
                }
                let text = r.into_string().unwrap_or_default();
                Ok((status, status_text, h, text))
            }
            Err(ureq::Error::Status(code, resp)) => {
                let status_text = resp.status_text().to_string();
                let mut h = HashMap::new();
                for k in resp.headers_names() {
                    if let Some(v) = resp.header(&k) {
                        h.insert(k.clone(), v.to_string());
                    }
                }
                let text = resp.into_string().unwrap_or_default();
                Ok((code, status_text, h, text))
            }
            Err(ureq::Error::Transport(t)) => {
                Err(NetworkError::new(method, url, Box::new(std::io::Error::new(std::io::ErrorKind::Other, t.to_string()))))
            }
        }
    }

    fn backoff(&self, attempt: usize, err: Option<&ApiError>) -> Duration {
        if let Some(e) = err {
            if let Some(wait) = e.retry_after(std::time::SystemTime::now()) {
                if wait > self.retry_max_delay {
                    return self.retry_max_delay;
                }
                if wait > Duration::from_millis(0) {
                    return wait;
                }
            }
        }
        let base = self.retry_base_delay * (1 << attempt) as u32;
        let base = if base > self.retry_max_delay || base.is_zero() { self.retry_max_delay } else { base };
        let jitter_ms = (rand::random::<u64>() % (base.as_millis() as u64 / 4 + 1)) as u64;
        base + Duration::from_millis(jitter_ms)
    }

    // Convenience verbs returning parsed JSON Value (or String if not JSON)
    pub fn get(&self, path: &str, opts: RequestOptions) -> Result<Value, SdkError> {
        let raw = self.request("GET", path, opts)?;
        Ok(parse_body(&raw))
    }
    pub fn post(&self, path: &str, opts: RequestOptions) -> Result<Value, SdkError> {
        let raw = self.request("POST", path, opts)?;
        Ok(parse_body(&raw))
    }
    pub fn put(&self, path: &str, opts: RequestOptions) -> Result<Value, SdkError> {
        let raw = self.request("PUT", path, opts)?;
        Ok(parse_body(&raw))
    }
    pub fn patch(&self, path: &str, opts: RequestOptions) -> Result<Value, SdkError> {
        let raw = self.request("PATCH", path, opts)?;
        Ok(parse_body(&raw))
    }
    pub fn delete(&self, path: &str, opts: RequestOptions) -> Result<Value, SdkError> {
        let raw = self.request("DELETE", path, opts)?;
        Ok(parse_body(&raw))
    }

    // ── Resource helpers ─────────────────────────────────────────────────

    pub fn list_prompts(&self, params: ListPromptsParams) -> Result<MarketplacePage, SdkError> {
        let mut q = HashMap::new();
        if let Some(p) = params.page { q.insert("page".to_string(), p.to_string()); }
        if let Some(l) = params.limit { q.insert("limit".to_string(), l.to_string()); }
        if let Some(s) = params.sort { q.insert("sort".to_string(), s); }
        if let Some(search) = params.search { q.insert("search".to_string(), search); }
        let v = self.get("/api/prompts", RequestOptions { query: Some(q), ..Default::default() })?;
        // MarketplacePage may come as generic Value; deserialize
        let page: MarketplacePage = serde_json::from_value(v.clone()).unwrap_or(MarketplacePage { prompts: vec![], items: vec![], total: 0, page: 0, raw: Some(v) });
        Ok(page)
    }

    pub fn get_prompt(&self, prompt_id: &str) -> Result<Value, SdkError> {
        let path = format!("/api/prompts/{}", urlencoding::encode(prompt_id));
        self.get(&path, RequestOptions::default())
    }

    pub fn register_webhook(&self, params: RegisterWebhookParams) -> Result<WebhookRegistration, SdkError> {
        let body = serde_json::to_value(params).unwrap();
        let v = self.post("/api/webhooks", RequestOptions { body: Some(body), ..Default::default() })?;
        Ok(serde_json::from_value(v).unwrap())
    }

    pub fn get_webhook(&self, wallet_address: &str) -> Result<Value, SdkError> {
        let mut q = HashMap::new();
        q.insert("walletAddress".to_string(), wallet_address.to_string());
        self.get("/api/webhooks", RequestOptions { query: Some(q), ..Default::default() })
    }

    pub fn delete_webhook(&self, wallet_address: &str) -> Result<Value, SdkError> {
        let body = serde_json::json!({"walletAddress": wallet_address});
        self.delete("/api/webhooks", RequestOptions { body: Some(body), ..Default::default() })
    }

    pub fn rotate_webhook_secret(&self, wallet_address: &str) -> Result<WebhookRegistration, SdkError> {
        let body = serde_json::json!({"walletAddress": wallet_address});
        let v = self.post("/api/webhooks/rotate-secret", RequestOptions { body: Some(body), ..Default::default() })?;
        Ok(serde_json::from_value(v).unwrap())
    }

    pub fn test_webhook(&self, wallet_address: &str) -> Result<Value, SdkError> {
        let body = serde_json::json!({"walletAddress": wallet_address});
        self.post("/api/webhooks/test", RequestOptions { body: Some(body), ..Default::default() })
    }

    pub fn list_webhook_deliveries(&self, wallet_address: &str) -> Result<Value, SdkError> {
        let mut q = HashMap::new();
        q.insert("walletAddress".to_string(), wallet_address.to_string());
        self.get("/api/webhooks/deliveries", RequestOptions { query: Some(q), ..Default::default() })
    }

    pub fn list_webhook_dead_letters(&self, wallet_address: &str, resolved: Option<bool>, limit: Option<u32>) -> Result<Value, SdkError> {
        let mut q = HashMap::new();
        q.insert("walletAddress".to_string(), wallet_address.to_string());
        if let Some(r) = resolved { q.insert("resolved".to_string(), if r {"true"} else {"false"}.to_string()); }
        if let Some(l) = limit { q.insert("limit".to_string(), l.to_string()); }
        self.get("/api/webhooks/dead-letters", RequestOptions { query: Some(q), ..Default::default() })
    }

    pub fn list_api_keys(&self, owner_wallet: &str) -> Result<Value, SdkError> {
        let mut q = HashMap::new();
        q.insert("ownerWallet".to_string(), owner_wallet.to_string());
        self.get("/api-keys", RequestOptions { query: Some(q), ..Default::default() })
    }

    pub fn create_api_key(&self, params: CreateApiKeyParams) -> Result<Value, SdkError> {
        let body = serde_json::to_value(params).unwrap();
        self.post("/api-keys", RequestOptions { body: Some(body), ..Default::default() })
    }

    pub fn rotate_api_key(&self, key_id: &str, owner_wallet: &str) -> Result<Value, SdkError> {
        let path = format!("/api-keys/{}/rotate", urlencoding::encode(key_id));
        let body = serde_json::json!({"ownerWallet": owner_wallet});
        self.post(&path, RequestOptions { body: Some(body), ..Default::default() })
    }

    pub fn revoke_api_key(&self, key_id: &str, owner_wallet: &str) -> Result<Value, SdkError> {
        let path = format!("/api-keys/{}", urlencoding::encode(key_id));
        let body = serde_json::json!({"ownerWallet": owner_wallet});
        self.delete(&path, RequestOptions { body: Some(body), ..Default::default() })
    }
}

fn parse_body(raw: &str) -> Value {
    if raw.is_empty() { return Value::Null; }
    serde_json::from_str(raw).unwrap_or(Value::String(raw.to_string()))
}

// ── Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListPromptsParams {
    pub page: Option<u32>,
    pub limit: Option<u32>,
    pub sort: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplacePage {
    #[serde(default)]
    pub prompts: Vec<Value>,
    #[serde(default)]
    pub items: Vec<Value>,
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub page: u32,
    #[serde(skip)]
    pub raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterWebhookParams {
    #[serde(rename = "walletAddress")]
    pub wallet_address: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookRegistration {
    pub message: Option<String>,
    pub id: Option<String>,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApiKeyParams {
    #[serde(rename = "ownerWallet")]
    pub owner_wallet: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(rename = "rateLimitTier", skip_serializing_if = "Option::is_none")]
    pub rate_limit_tier: Option<String>,
}

// Needed for urlencoding helper
mod urlencoding {
    pub fn encode(s: &str) -> String {
        url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn client_requires_base_url() {
        let c = Client::new(ClientConfig { base_url: "".into(), ..Default::default() });
        assert!(c.is_err());
    }

    #[test]
    fn build_url_appends_query() {
        let c = Client::new(ClientConfig { base_url: "https://api.example.com".into(), ..Default::default() }).unwrap();
        let mut q = HashMap::new();
        q.insert("page".to_string(), "1".to_string());
        let url = c.build_url("/api/prompts", Some(&q));
        assert!(url.contains("page=1"));
        assert!(url.starts_with("https://api.example.com/api/prompts"));
    }

    #[test]
    fn build_headers_includes_auth_and_version() {
        let c = Client::new(ClientConfig { base_url: "https://api.example.com".into(), api_key: Some("pm_test_secret".into()), ..Default::default() }).unwrap();
        let h = c.build_headers(&RequestOptions::default(), false);
        assert_eq!(h.get("Authorization").unwrap(), "Bearer pm_test_secret");
        assert_eq!(h.get("Accept-Version").unwrap(), "latest");
    }
}
