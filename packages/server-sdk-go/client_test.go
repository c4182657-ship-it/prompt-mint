package prompthash

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type recordedRequest struct {
	Method        string
	Path          string
	RawQuery      string
	Authorization string
	AcceptVersion string
	ContentType   string
	Idempotency   string
	Body          string
}

type testServer struct {
	mu       sync.Mutex
	statuses []int
	bodies   []string
	requests []recordedRequest
	index    int
}

func (s *testServer) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)

		s.mu.Lock()
		i := s.index
		if i >= len(s.statuses) {
			i = len(s.statuses) - 1
		}
		status := s.statuses[i]
		body := s.bodies[i]
		s.index++
		s.requests = append(s.requests, recordedRequest{
			Method:        r.Method,
			Path:          r.URL.Path,
			RawQuery:      r.URL.RawQuery,
			Authorization: r.Header.Get("Authorization"),
			AcceptVersion: r.Header.Get("Accept-Version"),
			ContentType:   r.Header.Get("Content-Type"),
			Idempotency:   r.Header.Get("Idempotency-Key"),
			Body:          string(raw),
		})
		s.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

func (s *testServer) call(index int) recordedRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if index >= len(s.requests) {
		return recordedRequest{}
	}
	return s.requests[index]
}

func (s *testServer) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.requests)
}

type harness struct {
	client *Client
	server *httptest.Server
	rec    *testServer
	delays *[]time.Duration
}

func newHarness(t *testing.T, cfg Config, statuses []int, bodies []string) *harness {
	t.Helper()

	rec := &testServer{statuses: statuses, bodies: bodies}
	server := httptest.NewServer(rec.handler())
	t.Cleanup(server.Close)

	var delays []time.Duration
	cfg.BaseURL = server.URL
	if cfg.Sleep == nil {
		cfg.Sleep = func(_ context.Context, delay time.Duration) error {
			delays = append(delays, delay)
			return nil
		}
	}
	client, err := NewClient(cfg)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return &harness{client: client, server: server, rec: rec, delays: &delays}
}

func TestNewClientRequiresAValidBaseURL(t *testing.T) {
	if _, err := NewClient(Config{}); err == nil {
		t.Error("empty BaseURL should fail")
	}
	if _, err := NewClient(Config{BaseURL: "ftp://example.test"}); err == nil {
		t.Error("non-http BaseURL should fail")
	}
	if _, err := NewClient(Config{BaseURL: "https://api.example.test/"}); err != nil {
		t.Errorf("trailing slash should be accepted: %v", err)
	}
}

func TestRequestSendsAuthVersioningAndIdempotencyHeaders(t *testing.T) {
	h := newHarness(t, Config{
		APIKey:     "pm_abc123_supersecret",
		APIVersion: "2025-01-01",
	}, []int{200}, []string{`{"ok":true}`})

	err := h.client.Post(context.Background(), "/api/webhooks", RequestOptions{
		Body:           map[string]string{"walletAddress": "GABC"},
		IdempotencyKey: "idem-1",
	}, nil)
	if err != nil {
		t.Fatalf("Post: %v", err)
	}

	call := h.rec.call(0)
	if call.Method != http.MethodPost {
		t.Errorf("method = %q", call.Method)
	}
	if call.Authorization != "Bearer pm_abc123_supersecret" {
		t.Errorf("authorization = %q", call.Authorization)
	}
	if call.AcceptVersion != "2025-01-01" {
		t.Errorf("accept-version = %q", call.AcceptVersion)
	}
	if call.ContentType != "application/json" {
		t.Errorf("content-type = %q", call.ContentType)
	}
	if call.Idempotency != "idem-1" {
		t.Errorf("idempotency-key = %q", call.Idempotency)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(call.Body), &payload); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if payload["walletAddress"] != "GABC" {
		t.Errorf("body = %q", call.Body)
	}
}

func TestOmitsAuthorizationWithoutAnAPIKey(t *testing.T) {
	h := newHarness(t, Config{}, []int{200}, []string{`{}`})

	if err := h.client.Get(context.Background(), "/api/prompts", RequestOptions{}, nil); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if call := h.rec.call(0); call.Authorization != "" {
		t.Errorf("authorization = %q", call.Authorization)
	}
}

func TestListPromptsBuildsTheQueryString(t *testing.T) {
	h := newHarness(t, Config{}, []int{200}, []string{`{"total":0}`})

	if _, err := h.client.ListPrompts(context.Background(), ListPromptsParams{
		Page:  2,
		Limit: 10,
		Sort:  "upvotes",
	}); err != nil {
		t.Fatalf("ListPrompts: %v", err)
	}

	call := h.rec.call(0)
	if call.Path != "/api/prompts" {
		t.Errorf("path = %q", call.Path)
	}
	values, err := url.ParseQuery(call.RawQuery)
	if err != nil {
		t.Fatalf("ParseQuery: %v", err)
	}
	if values.Get("page") != "2" || values.Get("limit") != "10" || values.Get("sort") != "upvotes" {
		t.Errorf("query = %q", call.RawQuery)
	}
}

func TestTypedErrorCarriesTheMachineReadableCode(t *testing.T) {
	h := newHarness(t, Config{}, []int{403}, []string{
		`{"apiVersion":"2025-01-01","error":"Prompt access has not been purchased.","code":"ACCESS_NOT_PURCHASED"}`,
	})

	err := h.client.GetPrompt(context.Background(), "abc")
	if err == nil {
		t.Fatal("expected an error")
	}

	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got %T: %v", err, err)
	}
	if apiErr.Status != 403 || apiErr.Code != CodeAccessNotPurchased {
		t.Errorf("error = %+v", apiErr)
	}
	if apiErr.Retryable() {
		t.Error("ACCESS_NOT_PURCHASED must not be retryable")
	}
	if !strings.Contains(apiErr.Message, "not been purchased") {
		t.Errorf("message = %q", apiErr.Message)
	}
	if h.rec.count() != 1 {
		t.Errorf("requests = %d, want 1", h.rec.count())
	}
}

func TestDoesNotRetryAValidationFailure(t *testing.T) {
	h := newHarness(t, Config{}, []int{400}, []string{
		`{"error":"Missing fields","code":"MISSING_FIELDS"}`,
	})

	err := h.client.Post(context.Background(), "/api/webhooks", RequestOptions{
		Body: map[string]string{},
	}, nil)
	if err == nil {
		t.Fatal("expected an error")
	}

	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != CodeMissingFields {
		t.Fatalf("expected MISSING_FIELDS *APIError, got %T: %v", err, err)
	}
	if h.rec.count() != 1 {
		t.Errorf("requests = %d, want 1", h.rec.count())
	}
}

func TestRetries429UsingTheResetTimestamp(t *testing.T) {
	reset := time.Now().Add(5 * time.Second).UnixMilli()
	h := newHarness(t, Config{}, []int{429, 200}, []string{
		`{"error":"Too many requests.","code":"RATE_LIMIT_IP","reset":` + strconv.FormatInt(reset, 10) + `}`,
		`{"prompts":[]}`,
	})

	var page MarketplacePage
	if err := h.client.Get(context.Background(), "/api/prompts", RequestOptions{}, &page); err != nil {
		t.Fatalf("Get: %v", err)
	}

	if h.rec.count() != 2 {
		t.Errorf("requests = %d, want 2", h.rec.count())
	}
	if len(*h.delays) != 1 {
		t.Fatalf("delays = %d, want 1", len(*h.delays))
	}
	if delay := (*h.delays)[0]; delay < 4*time.Second || delay > 5*time.Second {
		t.Errorf("delay = %v, want ~5s", delay)
	}
}

func TestRetriesTransientServerErrorsWithBackoff(t *testing.T) {
	h := newHarness(t, Config{
		RetryBaseDelay: 100 * time.Millisecond,
		RetryMaxDelay:  time.Second,
	}, []int{503, 503, 200}, []string{
		`{"error":"degraded"}`,
		`{"error":"degraded"}`,
		`{"ok":true}`,
	})

	if err := h.client.Get(context.Background(), "/api/prompts", RequestOptions{}, nil); err != nil {
		t.Fatalf("Get: %v", err)
	}

	if h.rec.count() != 3 {
		t.Errorf("requests = %d, want 3", h.rec.count())
	}
	delays := *h.delays
	if len(delays) != 2 {
		t.Fatalf("delays = %d, want 2", len(delays))
	}
	if delays[0] < 100*time.Millisecond {
		t.Errorf("first delay = %v, want >= 100ms", delays[0])
	}
	if delays[1] < 200*time.Millisecond {
		t.Errorf("second delay = %v, want >= 200ms", delays[1])
	}
}

func TestRetryBudgetOfZeroDisablesRetries(t *testing.T) {
	h := newHarness(t, Config{}, []int{503}, []string{`{"error":"degraded"}`})
	zero := 0

	err := h.client.Get(context.Background(), "/api/prompts", RequestOptions{
		RetryBudget: &zero,
	}, nil)
	if err == nil {
		t.Fatal("expected an error")
	}
	if h.rec.count() != 1 {
		t.Errorf("requests = %d, want 1", h.rec.count())
	}
	if len(*h.delays) != 0 {
		t.Errorf("delays = %d, want 0", len(*h.delays))
	}
}

func TestStopsAfterTheConfiguredRetryBudget(t *testing.T) {
	h := newHarness(t, Config{MaxRetries: 3}, []int{500}, []string{`{"error":"boom"}`})

	if err := h.client.Get(context.Background(), "/api/prompts", RequestOptions{}, nil); err == nil {
		t.Fatal("expected an error")
	}
	if h.rec.count() != 4 {
		t.Errorf("requests = %d, want 4", h.rec.count())
	}
	if len(*h.delays) != 3 {
		t.Errorf("delays = %d, want 3", len(*h.delays))
	}
}

func TestWrapsTransportFailuresInANetworkError(t *testing.T) {
	// Nothing listens on this port, so the request fails before any response.
	var delays []time.Duration
	client, err := NewClient(Config{
		BaseURL: "http://127.0.0.1:1",
		Sleep: func(_ context.Context, delay time.Duration) error {
			delays = append(delays, delay)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	failure := client.Get(context.Background(), "/api/prompts", RequestOptions{}, nil)
	if failure == nil {
		t.Fatal("expected an error")
	}

	var netErr *NetworkError
	if !errors.As(failure, &netErr) {
		t.Fatalf("expected *NetworkError, got %T: %v", failure, failure)
	}
	if netErr.Method != http.MethodGet {
		t.Errorf("method = %q", netErr.Method)
	}
	if !strings.Contains(netErr.URL, "/api/prompts") {
		t.Errorf("url = %q", netErr.URL)
	}
	if len(delays) != 2 {
		t.Errorf("delays = %d, want 2", len(delays))
	}
}

func TestRegisterWebhookSendsTheSubscriptionBody(t *testing.T) {
	h := newHarness(t, Config{}, []int{201}, []string{
		`{"id":"w1","secret":"s3cret"}`,
	})

	registration, err := h.client.RegisterWebhook(context.Background(), RegisterWebhookParams{
		WalletAddress: "GABC",
		URL:           "https://example.test/hook",
		Events:        []string{"PromptPurchased"},
	})
	if err != nil {
		t.Fatalf("RegisterWebhook: %v", err)
	}
	if registration.Secret != "s3cret" {
		t.Errorf("secret = %q", registration.Secret)
	}

	var body map[string]any
	if err := json.Unmarshal([]byte(h.rec.call(0).Body), &body); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if body["walletAddress"] != "GABC" || body["url"] != "https://example.test/hook" {
		t.Errorf("body = %v", body)
	}
}

func TestListWebhookDeliveriesScopesByWallet(t *testing.T) {
	h := newHarness(t, Config{}, []int{200}, []string{`[]`})

	if _, err := h.client.ListWebhookDeliveries(context.Background(), "GABC"); err != nil {
		t.Fatalf("ListWebhookDeliveries: %v", err)
	}

	values, err := url.ParseQuery(h.rec.call(0).RawQuery)
	if err != nil {
		t.Fatalf("ParseQuery: %v", err)
	}
	if values.Get("walletAddress") != "GABC" {
		t.Errorf("query = %q", h.rec.call(0).RawQuery)
	}
}

func TestGetPromptEscapesPathSegments(t *testing.T) {
	h := newHarness(t, Config{}, []int{200}, []string{`{"id":"1"}`})

	if _, err := h.client.GetPrompt(context.Background(), "prompt 1/2"); err != nil {
		t.Fatalf("GetPrompt: %v", err)
	}

	if call := h.rec.call(0); call.Path != "/api/prompts/prompt 1/2" {
		t.Errorf("decoded path = %q", call.Path)
	}
}
