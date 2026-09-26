// Package prompthash is the server-side Go SDK for the Prompt Mint API.
//
// It adds API-key authentication, Accept-Version negotiation, idempotent
// writes, typed errors with machine-readable codes, bounded retry with
// backoff, and webhook verification on top of net/http.
//
// See docs/sdk-error-codes.md for the error-code reference card.
package prompthash

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ErrorCode is a machine-readable error code returned by the API. It is an
// open type because the server gains codes over time; the constants below are
// the ones known to exist today.
type ErrorCode string

// Codes emitted by the serverless handlers (src/lib/api/errorCodes.ts) and by
// the Express API (server/src/**/AppError).
const (
	// Request errors (4xx).
	CodeMissingFields       ErrorCode = "MISSING_FIELDS"
	CodeMethodNotAllowed    ErrorCode = "METHOD_NOT_ALLOWED"
	CodeInvalidInput        ErrorCode = "INVALID_INPUT"
	CodeInvalidVersion      ErrorCode = "INVALID_VERSION"
	CodeInvalidWallet       ErrorCode = "INVALID_WALLET"
	CodeChallengeMalformed  ErrorCode = "CHALLENGE_MALFORMED"

	// Auth / access errors (4xx).
	CodeChallengeExpired          ErrorCode = "CHALLENGE_EXPIRED"
	CodeChallengeInvalid          ErrorCode = "CHALLENGE_INVALID"
	CodeInvalidSignature          ErrorCode = "INVALID_SIGNATURE"
	CodeChallengeInvalidSignature ErrorCode = "CHALLENGE_INVALID_SIGNATURE"
	CodeChallengeMismatch         ErrorCode = "CHALLENGE_MISMATCH"
	CodeAccessNotPurchased        ErrorCode = "ACCESS_NOT_PURCHASED"
	CodeUnauthenticated           ErrorCode = "UNAUTHENTICATED"
	CodeForbidden                 ErrorCode = "FORBIDDEN"
	CodeKeyNotFound               ErrorCode = "KEY_NOT_FOUND"
	CodeNotFound                  ErrorCode = "NOT_FOUND"

	// Rate limiting (429).
	CodeRateLimitIP      ErrorCode = "RATE_LIMIT_IP"
	CodeRateLimitWallet  ErrorCode = "RATE_LIMIT_WALLET"
	CodeRateLimited      ErrorCode = "RATE_LIMITED"
	CodeAccountLocked    ErrorCode = "ACCOUNT_LOCKED"
	CodeCaptchaRequired  ErrorCode = "CAPTCHA_REQUIRED"
	CodeCaptchaInvalid   ErrorCode = "CAPTCHA_INVALID"

	// Concurrency / idempotency (409).
	CodeConcurrentVersionConflict ErrorCode = "CONCURRENT_VERSION_CONFLICT"

	// Analytics errors (4xx).
	CodeUnknownEvent         ErrorCode = "UNKNOWN_EVENT"
	CodeInvalidEventPayload  ErrorCode = "INVALID_EVENT_PAYLOAD"

	// Expiry (410).
	CodeExportExpired ErrorCode = "EXPORT_EXPIRED"

	// Server errors (5xx).
	CodeConfigurationError  ErrorCode = "CONFIGURATION_ERROR"
	CodeIntegrityFailure    ErrorCode = "INTEGRITY_FAILURE"
	CodeTemporaryFailure    ErrorCode = "TEMPORARY_FAILURE"
	CodeUnsupportedVersion  ErrorCode = "UNSUPPORTED_VERSION"
	CodePayloadTooLarge     ErrorCode = "PAYLOAD_TOO_LARGE"
	CodeWalletNotFunded     ErrorCode = "WALLET_NOT_FUNDED"
)

var retryableStatuses = map[int]bool{
	http.StatusRequestTimeout:     true, // 408
	http.StatusTooEarly:           true, // 425
	http.StatusTooManyRequests:    true, // 429
	http.StatusInternalServerError: true, // 500
	http.StatusBadGateway:         true, // 502
	http.StatusServiceUnavailable: true, // 503
	http.StatusGatewayTimeout:     true, // 504
}

var nonRetryableCodes = map[ErrorCode]bool{
	CodeIntegrityFailure:    true,
	CodeAccessNotPurchased:  true,
	CodeInvalidInput:        true,
	CodeMissingFields:       true,
	CodeMethodNotAllowed:    true,
	CodeUnsupportedVersion:  true,
	CodeUnknownEvent:        true,
	CodeInvalidEventPayload: true,
	CodeChallengeExpired:    true,
	CodeChallengeInvalid:    true,
	CodeInvalidSignature:    true,
}

// IsRetryable reports whether replaying the identical request can succeed.
func IsRetryable(status int, code ErrorCode, message string) bool {
	if code != "" && nonRetryableCodes[code] {
		return false
	}
	if retryableStatuses[status] {
		return true
	}
	if status == http.StatusConflict &&
		strings.Contains(strings.ToLower(message), "still being processed") {
		return true
	}
	return false
}

// APIError is returned for every non-2xx response.
//
// Code is the stable machine-readable value to branch on; Message is the
// human-readable copy the server considers safe to display.
type APIError struct {
	Status  int
	Code    ErrorCode
	Message string

	// APIVersion is present on serverless responses only.
	APIVersion string
	// Reset is the Unix millisecond timestamp at which a 429 resets.
	Reset int64
	// RetryAfterHeader is the parsed Retry-After header, if any.
	RetryAfterHeader time.Duration

	Method string
	URL    string
	// Body is the parsed JSON response, when the response was JSON.
	Body any
}

func (e *APIError) Error() string {
	code := string(e.Code)
	if code == "" {
		code = "unknown_code"
	}
	return fmt.Sprintf("prompthash: HTTP %d (%s): %s", e.Status, code, e.Message)
}

// Retryable reports whether the request that produced this error may be
// replayed.
func (e *APIError) Retryable() bool {
	return IsRetryable(e.Status, e.Code, e.Message)
}

// RetryAfter returns how long to wait before retrying. The second result is
// false when the server gave no hint.
func (e *APIError) RetryAfter(now time.Time) (time.Duration, bool) {
	if e.Reset > 0 {
		wait := time.UnixMilli(e.Reset).Sub(now)
		if wait < 0 {
			wait = 0
		}
		return wait, true
	}
	if e.RetryAfterHeader > 0 {
		return e.RetryAfterHeader, true
	}
	return 0, false
}

// NetworkError is returned when no response was received (DNS failure,
// connection reset, timeout). The request may still have reached the server,
// so it is only safe to retry when the caller supplied an Idempotency-Key.
type NetworkError struct {
	Method string
	URL    string
	Err    error
}

func (e *NetworkError) Error() string {
	return fmt.Sprintf("prompthash: %s %s failed: %v", e.Method, e.URL, e.Err)
}

func (e *NetworkError) Unwrap() error { return e.Err }

type errorEnvelope struct {
	APIVersion string `json:"apiVersion"`
	Error      string `json:"error"`
	Code       string `json:"code"`
	Reset      *int64 `json:"reset"`
}

// apiErrorFromParts normalises a response into an *APIError.
func apiErrorFromParts(
	status int,
	statusText string,
	payload []byte,
	header http.Header,
	method string,
	url string,
) *APIError {
	apiErr := &APIError{
		Status: status,
		Method: method,
		URL:    url,
	}

	var envelope errorEnvelope
	if len(payload) > 0 && json.Unmarshal(payload, &envelope) == nil {
		apiErr.Message = envelope.Error
		apiErr.Code = ErrorCode(envelope.Code)
		apiErr.APIVersion = envelope.APIVersion
		if envelope.Reset != nil {
			apiErr.Reset = *envelope.Reset
		}
		var parsed any
		if json.Unmarshal(payload, &parsed) == nil {
			apiErr.Body = parsed
		}
	}

	if apiErr.Message == "" && len(payload) > 0 {
		const max = 300
		message := string(payload)
		if len(message) > max {
			message = message[:max]
		}
		apiErr.Message = message
	}
	if apiErr.Message == "" {
		suffix := ""
		if statusText != "" {
			suffix = " " + statusText
		}
		apiErr.Message = fmt.Sprintf("Request failed with HTTP %d%s.", status, suffix)
	}

	if duration, ok := parseRetryAfter(header.Get("Retry-After"), time.Now()); ok {
		apiErr.RetryAfterHeader = duration
	}
	return apiErr
}

// parseRetryAfter parses a Retry-After header (delta-seconds or HTTP-date).
func parseRetryAfter(value string, now time.Time) (time.Duration, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, false
	}
	if seconds, err := strconv.Atoi(trimmed); err == nil {
		if seconds < 0 {
			return 0, false
		}
		return time.Duration(seconds) * time.Second, true
	}
	if at, err := http.ParseTime(trimmed); err == nil {
		wait := at.Sub(now)
		if wait < 0 {
			wait = 0
		}
		return wait, true
	}
	return 0, false
}
