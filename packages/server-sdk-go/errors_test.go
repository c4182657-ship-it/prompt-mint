package prompthash

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestIsRetryable(t *testing.T) {
	retryable := []int{408, 425, 429, 500, 502, 503, 504}
	for _, status := range retryable {
		if !IsRetryable(status, "", "") {
			t.Errorf("status %d should be retryable", status)
		}
	}

	for _, status := range []int{400, 401, 403, 404, 405, 410, 422} {
		if IsRetryable(status, "", "") {
			t.Errorf("status %d should not be retryable", status)
		}
	}

	if IsRetryable(500, CodeIntegrityFailure, "hash mismatch") {
		t.Error("INTEGRITY_FAILURE must never be retried")
	}
	if IsRetryable(403, CodeAccessNotPurchased, "no license") {
		t.Error("ACCESS_NOT_PURCHASED must never be retried")
	}
	if !IsRetryable(409, "", "A request with this Idempotency-Key is still being processed.") {
		t.Error("in-flight idempotency lock should be retryable")
	}
	if IsRetryable(409, "", "This Idempotency-Key was already used with a different request.") {
		t.Error("reused idempotency key must not be retried")
	}
}

func TestParseRetryAfter(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	if duration, ok := parseRetryAfter("3", now); !ok || duration != 3*time.Second {
		t.Errorf("delta-seconds: got %v, %v", duration, ok)
	}
	if duration, ok := parseRetryAfter(" Thu, 01 Jan 2026 00:00:30 GMT ", now); !ok || duration != 30*time.Second {
		t.Errorf("HTTP-date: got %v, %v", duration, ok)
	}
	for _, junk := range []string{"", "soon", "not a date"} {
		if duration, ok := parseRetryAfter(junk, now); ok {
			t.Errorf("%q should not parse, got %v", junk, duration)
		}
	}
}

func TestAPIErrorFromPartsReadsServerlessEnvelope(t *testing.T) {
	now := time.Now()
	reset := now.Add(5 * time.Second).UnixMilli()
	payload := `{"apiVersion":"2025-01-01","error":"Too many requests. Please try again later.","code":"RATE_LIMIT_IP","reset":` +
		strconv.FormatInt(reset, 10) + `}`

	apiErr := apiErrorFromParts(
		http.StatusTooManyRequests,
		"429 Too Many Requests",
		[]byte(payload),
		http.Header{},
		"POST",
		"https://api.example.test/api/prompts",
	)

	if apiErr.Status != http.StatusTooManyRequests {
		t.Errorf("status = %d", apiErr.Status)
	}
	if apiErr.Code != CodeRateLimitIP {
		t.Errorf("code = %q", apiErr.Code)
	}
	if apiErr.APIVersion != "2025-01-01" {
		t.Errorf("apiVersion = %q", apiErr.APIVersion)
	}
	if !strings.Contains(apiErr.Message, "Too many requests") {
		t.Errorf("message = %q", apiErr.Message)
	}
	if !apiErr.Retryable() {
		t.Error("429 should be retryable")
	}
	if duration, ok := apiErr.RetryAfter(now); !ok || duration > 5*time.Second || duration < 4*time.Second {
		t.Errorf("retry after = %v, %v", duration, ok)
	}
}

func TestAPIErrorFromPartsFallsBackToRetryAfterHeader(t *testing.T) {
	header := http.Header{}
	header.Set("Retry-After", "4")

	apiErr := apiErrorFromParts(
		http.StatusTooManyRequests,
		"429 Too Many Requests",
		[]byte(`{"error":"slow down"}`),
		header,
		"GET",
		"https://api.example.test/x",
	)

	if apiErr.RetryAfterHeader != 4*time.Second {
		t.Errorf("Retry-After header = %v", apiErr.RetryAfterHeader)
	}
	if duration, ok := apiErr.RetryAfter(time.Now()); !ok || duration != 4*time.Second {
		t.Errorf("retry after = %v, %v", duration, ok)
	}
}

func TestAPIErrorFromPartsHandlesNonJSONAndEmptyBodies(t *testing.T) {
	html := apiErrorFromParts(http.StatusBadGateway, "502 Bad Gateway", []byte("<html>bad</html>"), http.Header{}, "GET", "/x")
	if html.Code != "" || !strings.Contains(html.Message, "bad") || !html.Retryable() {
		t.Errorf("non-json error = %+v", html)
	}

	empty := apiErrorFromParts(http.StatusServiceUnavailable, "503 Service Unavailable", nil, http.Header{}, "GET", "/x")
	if !strings.Contains(empty.Message, "503") || !empty.Retryable() {
		t.Errorf("empty error = %+v", empty)
	}
}

func TestAPIErrorExpressBodyWithoutAPIVersion(t *testing.T) {
	apiErr := apiErrorFromParts(
		http.StatusNotFound,
		"404 Not Found",
		[]byte(`{"error":"Prompt not found.","code":"NOT_FOUND"}`),
		http.Header{},
		"GET",
		"/api/prompts/x",
	)

	if apiErr.Code != CodeNotFound || apiErr.APIVersion != "" {
		t.Errorf("express error = %+v", apiErr)
	}
	if apiErr.Retryable() {
		t.Error("404 must not be retryable")
	}
}
