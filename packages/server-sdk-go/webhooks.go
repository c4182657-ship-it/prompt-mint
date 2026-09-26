package prompthash

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Webhook delivery headers.
const (
	SignatureHeader     = "X-PromptHash-Signature"
	DeliveryHeader      = "X-PromptHash-Delivery"
	EventHeader         = "X-PromptHash-Event"
	TimestampHeader     = "X-PromptHash-Timestamp"
	SchemaVersionHeader = "X-PromptHash-Schema-Version"
	SignaturePrefix     = "sha256="

	// DefaultTolerance is the default replay window for delivery timestamps.
	DefaultTolerance = 300 * time.Second
)

// FailureReason identifies why a delivery was rejected. It is safe to log.
type FailureReason string

const (
	ReasonMissingSecret      FailureReason = "missing_secret"
	ReasonMissingSignature   FailureReason = "missing_signature"
	ReasonMissingTimestamp   FailureReason = "missing_timestamp"
	ReasonMalformedSignature FailureReason = "malformed_signature"
	ReasonSignatureMismatch  FailureReason = "signature_mismatch"
	ReasonStaleTimestamp     FailureReason = "stale_timestamp"
	ReasonFutureTimestamp    FailureReason = "future_timestamp"
	ReasonInvalidPayload     FailureReason = "invalid_payload"
	ReasonDuplicateDelivery  FailureReason = "duplicate_delivery"
)

// WebhookVerificationError is returned by VerifyWebhook.
type WebhookVerificationError struct {
	Reason  FailureReason
	Message string
}

func (e *WebhookVerificationError) Error() string { return e.Message }

// WebhookEnvelope is the outbound webhook body.
type WebhookEnvelope struct {
	Version       int            `json:"version"`
	SchemaVersion string         `json:"schemaVersion"`
	Event         string         `json:"event"`
	DeliveryID    string         `json:"deliveryId"`
	Timestamp     string         `json:"timestamp"`
	Data          map[string]any `json:"data"`
}

// SignWebhookBody computes the "sha256=<hex>" signature for a raw body.
func SignWebhookBody(secret, body string) (string, error) {
	if secret == "" {
		return "", &WebhookVerificationError{
			Reason:  ReasonMissingSecret,
			Message: "Webhook secret is required.",
		}
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return SignaturePrefix + hex.EncodeToString(mac.Sum(nil)), nil
}

// VerifyWebhookSignature reports whether signature matches the HMAC of body.
// It never panics and returns false for anything that is not exactly the
// expected digest.
func VerifyWebhookSignature(secret, body, signature string) bool {
	if secret == "" || signature == "" {
		return false
	}
	expected, err := SignWebhookBody(secret, body)
	if err != nil {
		return false
	}
	received := strings.TrimSpace(signature)
	if len(expected) != len(received) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(received)) == 1
}

// VerifyOptions tunes VerifyWebhook.
type VerifyOptions struct {
	// Tolerance bounds accepted clock skew. Defaults to DefaultTolerance.
	Tolerance time.Duration
	// Now overrides the clock; zero means time.Now().
	Now time.Time
	// ReplayGuard, when set, rejects repeated delivery ids.
	ReplayGuard *WebhookReplayGuard
}

// VerifyWebhook checks a delivery and returns its parsed envelope.
//
// Always pass the raw request body — never a re-serialised object, because
// whitespace and key order change the digest.
func VerifyWebhook(
	secret string,
	body string,
	headers http.Header,
	opts VerifyOptions,
) (*WebhookEnvelope, error) {
	if secret == "" {
		return nil, &WebhookVerificationError{
			Reason:  ReasonMissingSecret,
			Message: "Webhook secret is required.",
		}
	}

	signature := headers.Get(SignatureHeader)
	if signature == "" {
		return nil, &WebhookVerificationError{
			Reason:  ReasonMissingSignature,
			Message: SignatureHeader + " header is missing.",
		}
	}
	if !strings.HasPrefix(signature, SignaturePrefix) {
		return nil, &WebhookVerificationError{
			Reason:  ReasonMalformedSignature,
			Message: SignatureHeader + " must start with " + SignaturePrefix + ".",
		}
	}
	if !VerifyWebhookSignature(secret, body, signature) {
		return nil, &WebhookVerificationError{
			Reason:  ReasonSignatureMismatch,
			Message: "Webhook signature does not match the request body.",
		}
	}

	var envelope WebhookEnvelope
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		return nil, &WebhookVerificationError{
			Reason:  ReasonInvalidPayload,
			Message: "Webhook body is not valid JSON.",
		}
	}
	if envelope.Event == "" {
		return nil, &WebhookVerificationError{
			Reason:  ReasonInvalidPayload,
			Message: "Webhook envelope is missing `event`.",
		}
	}
	if envelope.DeliveryID == "" {
		return nil, &WebhookVerificationError{
			Reason:  ReasonInvalidPayload,
			Message: "Webhook envelope is missing `deliveryId`.",
		}
	}

	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	tolerance := opts.Tolerance
	if tolerance <= 0 {
		tolerance = DefaultTolerance
	}

	timestamp := headers.Get(TimestampHeader)
	if timestamp == "" {
		timestamp = envelope.Timestamp
	}
	if err := assertFreshness(timestamp, tolerance, now); err != nil {
		return nil, err
	}

	if opts.ReplayGuard != nil && !opts.ReplayGuard.Accept(envelope.DeliveryID, now) {
		return nil, &WebhookVerificationError{
			Reason:  ReasonDuplicateDelivery,
			Message: fmt.Sprintf("Delivery %s has already been processed.", envelope.DeliveryID),
		}
	}

	return &envelope, nil
}

// WebhookReplayGuard remembers recently accepted delivery ids so a replayed
// (but correctly signed) delivery is rejected. It is safe for concurrent use.
type WebhookReplayGuard struct {
	mu         sync.Mutex
	ttl        time.Duration
	maxEntries int
	seen       map[string]time.Time
}

// NewWebhookReplayGuard builds a guard with the given replay window and
// capacity. Non-positive values fall back to the defaults (300s, 10000).
func NewWebhookReplayGuard(tolerance time.Duration, maxEntries int) *WebhookReplayGuard {
	if tolerance <= 0 {
		tolerance = DefaultTolerance
	}
	if maxEntries <= 0 {
		maxEntries = 10000
	}
	return &WebhookReplayGuard{
		ttl:        tolerance,
		maxEntries: maxEntries,
		seen:       make(map[string]time.Time, 16),
	}
}

// Accept records deliveryID and reports whether it was unseen inside the
// window (true) or a replay (false).
func (g *WebhookReplayGuard) Accept(deliveryID string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()

	for id, at := range g.seen {
		if now.Sub(at) > g.ttl {
			delete(g.seen, id)
		}
	}
	if _, exists := g.seen[deliveryID]; exists {
		return false
	}
	g.seen[deliveryID] = now
	for len(g.seen) > g.maxEntries {
		oldestID := ""
		var oldest time.Time
		first := true
		for id, at := range g.seen {
			if first || at.Before(oldest) {
				oldestID, oldest, first = id, at, false
			}
		}
		if oldestID == "" {
			break
		}
		delete(g.seen, oldestID)
	}
	return true
}

// Size reports how many delivery ids are currently retained.
func (g *WebhookReplayGuard) Size() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.seen)
}

func assertFreshness(raw string, tolerance time.Duration, now time.Time) error {
	if strings.TrimSpace(raw) == "" {
		return &WebhookVerificationError{
			Reason:  ReasonMissingTimestamp,
			Message: "Webhook timestamp is missing.",
		}
	}

	at, ok := parseWebhookTimestamp(raw)
	if !ok {
		return &WebhookVerificationError{
			Reason:  ReasonInvalidPayload,
			Message: "Webhook timestamp is not parseable: " + raw,
		}
	}

	skew := now.Sub(at)
	if skew > tolerance {
		return &WebhookVerificationError{
			Reason:  ReasonStaleTimestamp,
			Message: "Webhook timestamp is outside the accepted replay window.",
		}
	}
	if -skew > tolerance {
		return &WebhookVerificationError{
			Reason:  ReasonFutureTimestamp,
			Message: "Webhook timestamp is too far in the future.",
		}
	}
	return nil
}

// parseWebhookTimestamp accepts epoch seconds, epoch milliseconds, and
// RFC 3339 / HTTP-date timestamps.
func parseWebhookTimestamp(raw string) (time.Time, bool) {
	trimmed := strings.TrimSpace(raw)
	if digits, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		if len(trimmed) <= 10 {
			return time.UnixMilli(digits * 1000), true
		}
		return time.UnixMilli(digits), true
	}
	if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
		return parsed, true
	}
	if parsed, err := http.ParseTime(trimmed); err == nil {
		return parsed, true
	}
	return time.Time{}, false
}
