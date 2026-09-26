package prompthash

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

var testNow = time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)

const testSecret = "d1a4f0c6b2e84a1f9c7d3e5b6a8f0c2d"

func envelopeJSON(t *testing.T, overrides map[string]any) string {
	t.Helper()
	payload := map[string]any{
		"version":       1,
		"schemaVersion": "2025-01-01",
		"event":         "PromptPurchased",
		"deliveryId":    "9d1c0d3e-0000-4000-8000-000000000001",
		"timestamp":     testNow.Format(time.RFC3339),
		"data":          map[string]any{"promptId": "p1", "buyer": "GABC"},
	}
	for key, value := range overrides {
		payload[key] = value
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	return string(raw)
}

func mustSign(t *testing.T, secret, body string) string {
	t.Helper()
	signature, err := SignWebhookBody(secret, body)
	if err != nil {
		t.Fatalf("SignWebhookBody: %v", err)
	}
	return signature
}

func signedHeaders(t *testing.T, secret, body string) http.Header {
	t.Helper()
	headers := http.Header{}
	headers.Set(SignatureHeader, mustSign(t, secret, body))
	return headers
}

func expectReason(t *testing.T, err error, reason FailureReason) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected WebhookVerificationError %q, got nil", reason)
	}
	var verifyErr *WebhookVerificationError
	if !errors.As(err, &verifyErr) {
		t.Fatalf("expected *WebhookVerificationError, got %T: %v", err, err)
	}
	if verifyErr.Reason != reason {
		t.Fatalf("reason = %q, want %q", verifyErr.Reason, reason)
	}
}

func TestSignWebhookBodyProducesASha256HexDigest(t *testing.T) {
	signature := mustSign(t, testSecret, envelopeJSON(t, nil))

	if !strings.HasPrefix(signature, SignaturePrefix) {
		t.Errorf("signature = %q", signature)
	}
	digest := strings.TrimPrefix(signature, SignaturePrefix)
	if len(digest) != 64 {
		t.Errorf("digest length = %d, want 64", len(digest))
	}
	if _, err := hex.DecodeString(digest); err != nil {
		t.Errorf("digest is not hex: %v", err)
	}
}

func TestSignWebhookBodyIsDeterministic(t *testing.T) {
	body := envelopeJSON(t, nil)
	if mustSign(t, testSecret, body) != mustSign(t, testSecret, body) {
		t.Error("signing is not deterministic")
	}
	if mustSign(t, testSecret+"x", body) == mustSign(t, testSecret, body) {
		t.Error("changing the secret must change the signature")
	}
	if mustSign(t, testSecret, body+" ") == mustSign(t, testSecret, body) {
		t.Error("changing the body must change the signature")
	}
}

func TestSignWebhookBodyRejectsAnEmptySecret(t *testing.T) {
	_, err := SignWebhookBody("", "{}")
	expectReason(t, err, ReasonMissingSecret)
}

func TestVerifyWebhookSignature(t *testing.T) {
	body := envelopeJSON(t, nil)
	signature := mustSign(t, testSecret, body)

	if !VerifyWebhookSignature(testSecret, body, signature) {
		t.Error("matching signature should verify")
	}
	if VerifyWebhookSignature(testSecret+"x", body, signature) {
		t.Error("wrong secret must not verify")
	}
	if VerifyWebhookSignature(testSecret, envelopeJSON(t, map[string]any{
		"data": map[string]any{"promptId": "p2"},
	}), signature) {
		t.Error("tampered body must not verify")
	}
	if VerifyWebhookSignature(testSecret, body, "") {
		t.Error("empty signature must not verify")
	}
	if VerifyWebhookSignature(testSecret, body, "sha256=deadbeef") {
		t.Error("short digest must not verify")
	}
	if VerifyWebhookSignature("", body, signature) {
		t.Error("empty secret must not verify")
	}
}

func TestVerifyWebhookParsesAValidDelivery(t *testing.T) {
	body := envelopeJSON(t, nil)

	envelope, err := VerifyWebhook(testSecret, body, signedHeaders(t, testSecret, body),
		VerifyOptions{Now: testNow})
	if err != nil {
		t.Fatalf("VerifyWebhook: %v", err)
	}
	if envelope.Event != "PromptPurchased" {
		t.Errorf("event = %q", envelope.Event)
	}
	if envelope.SchemaVersion != "2025-01-01" {
		t.Errorf("schemaVersion = %q", envelope.SchemaVersion)
	}
	if envelope.DeliveryID == "" {
		t.Error("deliveryId is empty")
	}
	if envelope.Data["promptId"] != "p1" {
		t.Errorf("data = %v", envelope.Data)
	}
}

func TestVerifyWebhookRejectsAMissingSignature(t *testing.T) {
	body := envelopeJSON(t, nil)

	_, err := VerifyWebhook(testSecret, body, http.Header{}, VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonMissingSignature)
}

func TestVerifyWebhookRejectsASignatureWithoutThePrefix(t *testing.T) {
	body := envelopeJSON(t, nil)
	headers := http.Header{}
	headers.Set(SignatureHeader, strings.TrimPrefix(mustSign(t, testSecret, body), SignaturePrefix))

	_, err := VerifyWebhook(testSecret, body, headers, VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonMalformedSignature)
}

func TestVerifyWebhookRejectsATamperedBody(t *testing.T) {
	body := envelopeJSON(t, nil)
	headers := signedHeaders(t, testSecret, body)
	tampered := envelopeJSON(t, map[string]any{"event": "DisputeOpened"})

	_, err := VerifyWebhook(testSecret, tampered, headers, VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonSignatureMismatch)
}

func TestVerifyWebhookRejectsNonJSONAndIncompleteEnvelopes(t *testing.T) {
	html := "<html>nope</html>"
	_, err := VerifyWebhook(testSecret, html, signedHeaders(t, testSecret, html),
		VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonInvalidPayload)

	noEvent, err := json.Marshal(map[string]any{
		"deliveryId": "d",
		"timestamp":  testNow.Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	_, err = VerifyWebhook(testSecret, string(noEvent),
		signedHeaders(t, testSecret, string(noEvent)), VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonInvalidPayload)
}

func TestVerifyWebhookEnforcesTheReplayWindow(t *testing.T) {
	stale := envelopeJSON(t, map[string]any{
		"timestamp": testNow.Add(-400 * time.Second).Format(time.RFC3339),
	})
	_, err := VerifyWebhook(testSecret, stale, signedHeaders(t, testSecret, stale),
		VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonStaleTimestamp)

	future := envelopeJSON(t, map[string]any{
		"timestamp": testNow.Add(400 * time.Second).Format(time.RFC3339),
	})
	_, err = VerifyWebhook(testSecret, future, signedHeaders(t, testSecret, future),
		VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonFutureTimestamp)
}

func TestVerifyWebhookPrefersTheHeaderTimestamp(t *testing.T) {
	body := envelopeJSON(t, nil)
	headers := signedHeaders(t, testSecret, body)
	headers.Set(TimestampHeader, testNow.Add(-400*time.Second).Format(time.RFC3339))

	_, err := VerifyWebhook(testSecret, body, headers, VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonStaleTimestamp)
}

func TestVerifyWebhookAcceptsEpochTimestamps(t *testing.T) {
	for _, timestamp := range []string{
		strconv.FormatInt(testNow.Unix(), 10),
		strconv.FormatInt(testNow.UnixMilli(), 10),
	} {
		body := envelopeJSON(t, map[string]any{"timestamp": timestamp})
		if _, err := VerifyWebhook(testSecret, body, signedHeaders(t, testSecret, body),
			VerifyOptions{Now: testNow}); err != nil {
			t.Errorf("timestamp %q rejected: %v", timestamp, err)
		}
	}
}

func TestVerifyWebhookHonoursACustomTolerance(t *testing.T) {
	body := envelopeJSON(t, map[string]any{
		"timestamp": testNow.Add(-120 * time.Second).Format(time.RFC3339),
	})

	_, err := VerifyWebhook(testSecret, body, signedHeaders(t, testSecret, body),
		VerifyOptions{Now: testNow, Tolerance: 60 * time.Second})
	expectReason(t, err, ReasonStaleTimestamp)
}

func TestVerifyWebhookRejectsReplaysWithAGuard(t *testing.T) {
	body := envelopeJSON(t, nil)
	headers := signedHeaders(t, testSecret, body)
	guard := NewWebhookReplayGuard(600*time.Second, 0)

	if _, err := VerifyWebhook(testSecret, body, headers,
		VerifyOptions{Now: testNow, ReplayGuard: guard}); err != nil {
		t.Fatalf("first delivery: %v", err)
	}
	_, err := VerifyWebhook(testSecret, body, headers,
		VerifyOptions{Now: testNow, ReplayGuard: guard})
	expectReason(t, err, ReasonDuplicateDelivery)
}

func TestVerifyWebhookRequiresASecretAndATimestamp(t *testing.T) {
	body := envelopeJSON(t, nil)
	_, err := VerifyWebhook("", body, http.Header{}, VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonMissingSecret)

	missing := envelopeJSON(t, map[string]any{"timestamp": ""})
	_, err = VerifyWebhook(testSecret, missing, signedHeaders(t, testSecret, missing),
		VerifyOptions{Now: testNow})
	expectReason(t, err, ReasonMissingTimestamp)
}

func TestWebhookReplayGuard(t *testing.T) {
	guard := NewWebhookReplayGuard(60*time.Second, 2)

	if !guard.Accept("a", testNow) {
		t.Error("first accept should succeed")
	}
	if guard.Accept("a", testNow.Add(time.Second)) {
		t.Error("replay inside the window should fail")
	}
	if !guard.Accept("b", testNow.Add(2*time.Second)) {
		t.Error("distinct id should succeed")
	}
	if !guard.Accept("c", testNow.Add(3*time.Second)) {
		t.Error("distinct id should succeed")
	}
	if guard.Size() != 2 {
		t.Errorf("size = %d, want 2", guard.Size())
	}
	if !guard.Accept("a", testNow.Add(4*time.Second)) {
		t.Error("the oldest id should have been evicted")
	}

	expiring := NewWebhookReplayGuard(60*time.Second, 0)
	if !expiring.Accept("x", testNow) {
		t.Error("first accept should succeed")
	}
	if !expiring.Accept("x", testNow.Add(120*time.Second)) {
		t.Error("id should be forgotten after the window elapses")
	}
}
