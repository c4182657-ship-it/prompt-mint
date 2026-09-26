package prompthash

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAPIVersion    = "latest"
	defaultTimeout       = 30 * time.Second
	defaultMaxRetries    = 2
	defaultRetryBase     = 250 * time.Millisecond
	defaultRetryMax      = 10 * time.Second
	defaultUserAgent     = "prompthash-server-sdk/0.1.0"
	maxResponseBytes     = 8 << 20
)

// Config configures a Client.
type Config struct {
	// BaseURL is the API origin, e.g. "https://api.promptmint.io".
	BaseURL string
	// APIKey is a plaintext key ("pm_<prefix>_<secret>") sent as
	// Authorization: Bearer. Optional for public reads.
	APIKey string
	// APIVersion is the Accept-Version value. Defaults to "latest".
	APIVersion string
	// Timeout bounds a single attempt. Defaults to 30s.
	Timeout time.Duration
	// MaxRetries is the number of attempts after the first. Defaults to 2;
	// set it negative to disable retries entirely.
	MaxRetries int
	// RetryBaseDelay and RetryMaxDelay bound the exponential backoff.
	RetryBaseDelay time.Duration
	RetryMaxDelay  time.Duration
	// HTTPClient overrides the transport. Defaults to a client using Timeout.
	HTTPClient *http.Client
	// Sleep is the backoff hook; defaults to time.Sleep honouring ctx.
	Sleep func(ctx context.Context, delay time.Duration) error
	// DefaultHeaders are merged into every request; per-call headers win.
	DefaultHeaders map[string]string
	UserAgent      string
}

// RequestOptions are the per-call knobs shared by every verb helper.
type RequestOptions struct {
	// Query is appended as a URL query string. Nil values are dropped.
	Query url.Values
	// Headers are merged over the defaults for this call.
	Headers map[string]string
	// Body is JSON-encoded when non-nil.
	Body any
	// IdempotencyKey is sent on state-changing calls. It is what makes a
	// retry after a timeout safe.
	IdempotencyKey string
	// RetryBudget overrides Config.MaxRetries for this call.
	RetryBudget *int
}

// Client is the Prompt Mint server-side HTTP client.
type Client struct {
	baseURL        string
	apiKey         string
	apiVersion     string
	timeout        time.Duration
	maxRetries     int
	retryBaseDelay time.Duration
	retryMaxDelay  time.Duration
	httpClient     *http.Client
	sleep          func(ctx context.Context, delay time.Duration) error
	defaultHeaders map[string]string
	userAgent      string
}

// NewClient validates cfg and returns a ready Client.
func NewClient(cfg Config) (*Client, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("prompthash: Config.BaseURL is required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("prompthash: Config.BaseURL must be an http(s) URL")
	}

	maxRetries := cfg.MaxRetries
	if maxRetries == 0 {
		maxRetries = defaultMaxRetries
	}
	if maxRetries < 0 {
		maxRetries = 0
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	base := cfg.RetryBaseDelay
	if base <= 0 {
		base = defaultRetryBase
	}
	maxDelay := cfg.RetryMaxDelay
	if maxDelay <= 0 {
		maxDelay = defaultRetryMax
	}
	if maxDelay < base {
		maxDelay = base
	}
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: timeout}
	}
	sleep := cfg.Sleep
	if sleep == nil {
		sleep = func(ctx context.Context, delay time.Duration) error {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		}
	}
	headers := map[string]string{}
	for key, value := range cfg.DefaultHeaders {
		headers[key] = value
	}
	agent := cfg.UserAgent
	if agent == "" {
		agent = defaultUserAgent
	}
	version := strings.TrimSpace(cfg.APIVersion)
	if version == "" {
		version = defaultAPIVersion
	}

	return &Client{
		baseURL:        baseURL,
		apiKey:         strings.TrimSpace(cfg.APIKey),
		apiVersion:     version,
		timeout:        timeout,
		maxRetries:     maxRetries,
		retryBaseDelay: base,
		retryMaxDelay:  maxDelay,
		httpClient:     httpClient,
		sleep:          sleep,
		defaultHeaders: headers,
		userAgent:      agent,
	}, nil
}

// Do performs a request and returns the raw response body.
//
// It resolves with the body for any 2xx status, and returns *APIError for a
// non-2xx response or *NetworkError when no response was received.
func (c *Client) Do(ctx context.Context, method, path string, opts RequestOptions) ([]byte, error) {
	endpoint, err := c.buildURL(path, opts.Query)
	if err != nil {
		return nil, err
	}

	var payload []byte
	if opts.Body != nil {
		payload, err = json.Marshal(opts.Body)
		if err != nil {
			return nil, fmt.Errorf("prompthash: encoding request body: %w", err)
		}
	}

	headers := c.buildHeaders(opts, payload != nil)
	budget := c.maxRetries
	if opts.RetryBudget != nil {
		budget = *opts.RetryBudget
		if budget < 0 {
			budget = 0
		}
	}

	attempt := 0
	for {
		body, apiErr, netErr := c.attempt(ctx, method, endpoint, headers, payload)
		if netErr != nil {
			if attempt < budget {
				if err := c.sleep(ctx, c.backoff(attempt, nil)); err != nil {
					return nil, &NetworkError{Method: method, URL: endpoint, Err: err}
				}
				attempt++
				continue
			}
			return nil, &NetworkError{Method: method, URL: endpoint, Err: netErr}
		}
		if apiErr == nil {
			return body, nil
		}
		if apiErr.Retryable() && attempt < budget {
			delay := c.backoff(attempt, apiErr)
			if err := c.sleep(ctx, delay); err != nil {
				return nil, &NetworkError{Method: method, URL: endpoint, Err: err}
			}
			attempt++
			continue
		}
		return nil, apiErr
	}
}

// Get performs a GET and decodes the JSON response into out when out is not nil.
func (c *Client) Get(ctx context.Context, path string, opts RequestOptions, out any) error {
	return c.decode(ctx, http.MethodGet, path, opts, out)
}

// Post performs a POST.
func (c *Client) Post(ctx context.Context, path string, opts RequestOptions, out any) error {
	return c.decode(ctx, http.MethodPost, path, opts, out)
}

// Put performs a PUT.
func (c *Client) Put(ctx context.Context, path string, opts RequestOptions, out any) error {
	return c.decode(ctx, http.MethodPut, path, opts, out)
}

// Patch performs a PATCH.
func (c *Client) Patch(ctx context.Context, path string, opts RequestOptions, out any) error {
	return c.decode(ctx, http.MethodPatch, path, opts, out)
}

// Delete performs a DELETE.
func (c *Client) Delete(ctx context.Context, path string, opts RequestOptions, out any) error {
	return c.decode(ctx, http.MethodDelete, path, opts, out)
}

func (c *Client) decode(
	ctx context.Context,
	method string,
	path string,
	opts RequestOptions,
	out any,
) error {
	raw, err := c.Do(ctx, method, path, opts)
	if err != nil {
		return err
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("prompthash: decoding response from %s: %w", path, err)
	}
	return nil
}

// ── Resource helpers ──────────────────────────────────────────────────────

// MarketplacePage is the GET /api/prompts envelope.
type MarketplacePage struct {
	Prompts []map[string]any `json:"prompts"`
	Items   []map[string]any `json:"items"`
	Total   int              `json:"total"`
	Page    int              `json:"page"`
}

// ListPromptsParams are the GET /api/prompts query parameters.
type ListPromptsParams struct {
	Page   int
	Limit  int
	Sort   string
	Search string
}

// ListPrompts fetches a page of the marketplace listing.
func (c *Client) ListPrompts(ctx context.Context, params ListPromptsParams) (*MarketplacePage, error) {
	query := url.Values{}
	if params.Page > 0 {
		query.Set("page", strconv.Itoa(params.Page))
	}
	if params.Limit > 0 {
		query.Set("limit", strconv.Itoa(params.Limit))
	}
	if params.Sort != "" {
		query.Set("sort", params.Sort)
	}
	if params.Search != "" {
		query.Set("search", params.Search)
	}

	var page MarketplacePage
	if err := c.Get(ctx, "/api/prompts", RequestOptions{Query: query}, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

// GetPrompt fetches a single prompt record.
func (c *Client) GetPrompt(ctx context.Context, promptID string) (map[string]any, error) {
	var prompt map[string]any
	path := "/api/prompts/" + url.PathEscape(promptID)
	if err := c.Get(ctx, path, RequestOptions{}, &prompt); err != nil {
		return nil, err
	}
	return prompt, nil
}

// RegisterWebhookParams are the POST /api/webhooks fields.
type RegisterWebhookParams struct {
	WalletAddress string   `json:"walletAddress"`
	URL           string   `json:"url"`
	Events        []string `json:"events,omitempty"`
}

// WebhookRegistration is returned by registration and secret rotation. Secret
// is shown exactly once — store it to verify deliveries.
type WebhookRegistration struct {
	Message string `json:"message"`
	ID      string `json:"id"`
	Secret  string `json:"secret"`
}

// RegisterWebhook registers or updates a wallet's webhook subscription.
func (c *Client) RegisterWebhook(ctx context.Context, params RegisterWebhookParams) (*WebhookRegistration, error) {
	var registration WebhookRegistration
	if err := c.Post(ctx, "/api/webhooks", RequestOptions{Body: params}, &registration); err != nil {
		return nil, err
	}
	return &registration, nil
}

// RotateWebhookSecret issues a new signing secret; the previous one stops
// verifying immediately.
func (c *Client) RotateWebhookSecret(ctx context.Context, walletAddress string) (*WebhookRegistration, error) {
	var registration WebhookRegistration
	opts := RequestOptions{Body: map[string]string{"walletAddress": walletAddress}}
	if err := c.Post(ctx, "/api/webhooks/rotate-secret", opts, &registration); err != nil {
		return nil, err
	}
	return &registration, nil
}

// DeleteWebhook removes a wallet's webhook subscription.
func (c *Client) DeleteWebhook(ctx context.Context, walletAddress string) error {
	opts := RequestOptions{Body: map[string]string{"walletAddress": walletAddress}}
	return c.Delete(ctx, "/api/webhooks", opts, nil)
}

// ListWebhookDeliveries returns recent delivery attempts for a wallet.
func (c *Client) ListWebhookDeliveries(ctx context.Context, walletAddress string) ([]any, error) {
	query := url.Values{}
	query.Set("walletAddress", walletAddress)

	var deliveries []any
	if err := c.Get(ctx, "/api/webhooks/deliveries", RequestOptions{Query: query}, &deliveries); err != nil {
		return nil, err
	}
	return deliveries, nil
}

// ListWebhookDeadLetters returns deliveries that exhausted their retry budget.
func (c *Client) ListWebhookDeadLetters(
	ctx context.Context,
	walletAddress string,
	resolved *bool,
	limit *int,
) ([]any, error) {
	query := url.Values{}
	query.Set("walletAddress", walletAddress)
	if resolved != nil {
		query.Set("resolved", strconv.FormatBool(*resolved))
	}
	if limit != nil {
		query.Set("limit", strconv.Itoa(*limit))
	}

	var deadLetters []any
	if err := c.Get(ctx, "/api/webhooks/dead-letters", RequestOptions{Query: query}, &deadLetters); err != nil {
		return nil, err
	}
	return deadLetters, nil
}

// ── Internals ─────────────────────────────────────────────────────────────

func (c *Client) buildURL(path string, query url.Values) (string, error) {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	endpoint := c.baseURL + path
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("prompthash: invalid path %q: %w", path, err)
	}
	if len(query) > 0 {
		encoded := query.Encode()
		if parsed.RawQuery == "" {
			parsed.RawQuery = encoded
		} else {
			parsed.RawQuery = parsed.RawQuery + "&" + encoded
		}
	}
	return parsed.String(), nil
}

func (c *Client) buildHeaders(opts RequestOptions, hasBody bool) map[string]string {
	headers := map[string]string{
		"Accept":        "application/json",
		"Accept-Version": c.apiVersion,
		"User-Agent":    c.userAgent,
	}
	if hasBody {
		headers["Content-Type"] = "application/json"
	}
	if c.apiKey != "" {
		headers["Authorization"] = "Bearer " + c.apiKey
	}
	if opts.IdempotencyKey != "" {
		headers["Idempotency-Key"] = opts.IdempotencyKey
	}
	for key, value := range c.defaultHeaders {
		headers[key] = value
	}
	for key, value := range opts.Headers {
		headers[key] = value
	}
	return headers
}

func (c *Client) attempt(
	ctx context.Context,
	method string,
	endpoint string,
	headers map[string]string,
	payload []byte,
) ([]byte, *APIError, error) {
	attemptCtx := ctx
	if c.timeout > 0 {
		var cancel context.CancelFunc
		attemptCtx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}

	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(attemptCtx, method, endpoint, reader)
	if err != nil {
		return nil, nil, err
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
	}()

	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return nil, nil, err
	}
	if len(body) > maxResponseBytes {
		return nil, nil, fmt.Errorf("prompthash: response body exceeds %d bytes", maxResponseBytes)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, apiErrorFromParts(
			response.StatusCode,
			response.Status,
			body,
			response.Header,
			method,
			endpoint,
		), nil
	}
	return body, nil, nil
}

// backoff returns the delay before attempt+1, honouring the server's hint.
func (c *Client) backoff(attempt int, apiErr *APIError) time.Duration {
	if apiErr != nil {
		if hinted, ok := apiErr.RetryAfter(time.Now()); ok {
			if hinted > c.retryMaxDelay {
				return c.retryMaxDelay
			}
			return hinted
		}
	}
	base := c.retryBaseDelay << uint(attempt)
	if base > c.retryMaxDelay || base <= 0 {
		base = c.retryMaxDelay
	}
	jitter := time.Duration(rand.Int63n(int64(base)/4 + 1))
	return base + jitter
}
