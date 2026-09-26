"""Tests for HMAC signing, envelope verification, and replay protection."""

import json
import unittest

from prompthash_server_sdk import (
    SIGNATURE_HEADER,
    WebhookReplayGuard,
    WebhookVerificationError,
    sign_webhook_body,
    verify_webhook,
    verify_webhook_signature,
)

SECRET = "d1a4f0c6b2e84a1f9c7d3e5b6a8f0c2d"
NOW = 1_790_251_200_000.0  # 2026-09-24T12:00:00Z


def envelope(**overrides):
    payload = {
        "version": 1,
        "schemaVersion": "2025-01-01",
        "event": "PromptPurchased",
        "deliveryId": "9d1c0d3e-0000-4000-8000-000000000001",
        "timestamp": "2026-09-24T12:00:00.000000+00:00",
        "data": {"promptId": "p1", "buyer": "GABC"},
    }
    payload.update(overrides)
    return json.dumps(payload)


def signed_headers(body, extra=None):
    headers = {"x-prompthash-signature": sign_webhook_body(SECRET, body)}
    headers.update(extra or {})
    return headers


class SigningTests(unittest.TestCase):
    def test_produces_a_sha256_hex_digest(self):
        signature = sign_webhook_body(SECRET, envelope())

        self.assertTrue(signature.startswith("sha256="))
        self.assertEqual(len(signature[len("sha256=") :]), 64)
        int(signature[len("sha256=") :], 16)

    def test_is_deterministic(self):
        body = envelope()
        self.assertEqual(sign_webhook_body(SECRET, body), sign_webhook_body(SECRET, body))

    def test_changes_with_secret_or_body(self):
        body = envelope()
        base = sign_webhook_body(SECRET, body)

        self.assertNotEqual(sign_webhook_body(SECRET + "x", body), base)
        self.assertNotEqual(sign_webhook_body(SECRET, body + " "), base)

    def test_rejects_an_empty_secret(self):
        with self.assertRaises(WebhookVerificationError) as ctx:
            sign_webhook_body("", "{}")
        self.assertEqual(ctx.exception.reason, "missing_secret")


class SignatureTests(unittest.TestCase):
    def test_accepts_the_matching_signature(self):
        body = envelope()
        self.assertTrue(
            verify_webhook_signature(SECRET, body, sign_webhook_body(SECRET, body))
        )

    def test_rejects_a_tampered_body(self):
        body = envelope()
        signature = sign_webhook_body(SECRET, body)
        tampered = envelope(data={"promptId": "p2"})

        self.assertFalse(verify_webhook_signature(SECRET, tampered, signature))

    def test_rejects_wrong_secret_and_malformed_signatures(self):
        body = envelope()
        signature = sign_webhook_body(SECRET, body)

        self.assertFalse(verify_webhook_signature(SECRET + "x", body, signature))
        self.assertFalse(verify_webhook_signature(SECRET, body, None))
        self.assertFalse(verify_webhook_signature(SECRET, body, "sha256=deadbeef"))
        self.assertFalse(verify_webhook_signature(SECRET, body, "not-a-signature"))


class VerifyWebhookTests(unittest.TestCase):
    def test_parses_a_valid_delivery(self):
        body = envelope()

        result = verify_webhook(SECRET, body, signed_headers(body), now=NOW)

        self.assertEqual(result["event"], "PromptPurchased")
        self.assertEqual(result["schemaVersion"], "2025-01-01")
        self.assertIn("-", result["deliveryId"])
        self.assertEqual(result["data"], {"promptId": "p1", "buyer": "GABC"})

    def test_accepts_a_mapping_with_differently_cased_keys(self):
        body = envelope()
        headers = {SIGNATURE_HEADER.upper(): sign_webhook_body(SECRET, body)}

        result = verify_webhook(SECRET, body, headers, now=NOW)
        self.assertEqual(result["event"], "PromptPurchased")

    def test_rejects_a_missing_signature_header(self):
        body = envelope()
        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, {}, now=NOW)
        self.assertEqual(ctx.exception.reason, "missing_signature")

    def test_rejects_a_signature_without_the_prefix(self):
        body = envelope()
        headers = {SIGNATURE_HEADER: sign_webhook_body(SECRET, body)[len("sha256=") :]}

        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, headers, now=NOW)
        self.assertEqual(ctx.exception.reason, "malformed_signature")

    def test_rejects_a_body_that_does_not_match_the_signature(self):
        body = envelope()
        headers = signed_headers(body)
        tampered = envelope(event="DisputeOpened")

        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, tampered, headers, now=NOW)
        self.assertEqual(ctx.exception.reason, "signature_mismatch")

    def test_rejects_a_validly_signed_body_that_is_not_json(self):
        body = "<html>nope</html>"
        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, signed_headers(body), now=NOW)
        self.assertEqual(ctx.exception.reason, "invalid_payload")

    def test_rejects_a_json_body_without_an_event(self):
        body = json.dumps(
            {"deliveryId": "d", "timestamp": "2026-09-24T12:00:00+00:00"}
        )
        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, signed_headers(body), now=NOW)
        self.assertEqual(ctx.exception.reason, "invalid_payload")

    def test_rejects_a_delivery_older_than_the_window(self):
        body = envelope(timestamp="2026-09-24T11:53:20+00:00")  # -400 s

        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, signed_headers(body), now=NOW)
        self.assertEqual(ctx.exception.reason, "stale_timestamp")

    def test_rejects_a_delivery_too_far_in_the_future(self):
        body = envelope(timestamp="2026-09-24T12:06:40+00:00")  # +400 s

        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, signed_headers(body), now=NOW)
        self.assertEqual(ctx.exception.reason, "future_timestamp")

    def test_header_timestamp_wins_over_the_envelope(self):
        body = envelope()
        headers = signed_headers(
            body, {"X-PromptHash-Timestamp": "2026-09-24T11:53:20+00:00"}
        )

        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, headers, now=NOW)
        self.assertEqual(ctx.exception.reason, "stale_timestamp")

    def test_accepts_epoch_second_timestamps(self):
        body = envelope(timestamp=str(int(NOW // 1000)))

        result = verify_webhook(SECRET, body, signed_headers(body), now=NOW)
        self.assertEqual(result["event"], "PromptPurchased")

    def test_accepts_epoch_millisecond_timestamps(self):
        body = envelope(timestamp=str(int(NOW)))

        result = verify_webhook(SECRET, body, signed_headers(body), now=NOW)
        self.assertEqual(result["event"], "PromptPurchased")

    def test_honours_a_custom_tolerance(self):
        body = envelope(timestamp="2026-09-24T11:59:00+00:00")  # -120 s

        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(
                SECRET, body, signed_headers(body), now=NOW, tolerance_seconds=60
            )
        self.assertEqual(ctx.exception.reason, "stale_timestamp")

    def test_rejects_a_replayed_delivery_when_a_guard_is_supplied(self):
        body = envelope()
        headers = signed_headers(body)
        guard = WebhookReplayGuard(tolerance_seconds=600)

        result = verify_webhook(SECRET, body, headers, now=NOW, replay_guard=guard)
        self.assertEqual(result["event"], "PromptPurchased")

        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, headers, now=NOW, replay_guard=guard)
        self.assertEqual(ctx.exception.reason, "duplicate_delivery")

    def test_requires_a_secret(self):
        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook("", "{}", {}, now=NOW)
        self.assertEqual(ctx.exception.reason, "missing_secret")

    def test_rejects_a_missing_timestamp(self):
        body = envelope(timestamp="")
        headers = signed_headers(body)

        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(SECRET, body, headers, now=NOW)
        self.assertEqual(ctx.exception.reason, "missing_timestamp")


class WebhookReplayGuardTests(unittest.TestCase):
    def test_remembers_ids_inside_the_window(self):
        guard = WebhookReplayGuard()

        self.assertTrue(guard.accept("a", NOW))
        self.assertFalse(guard.accept("a", NOW + 1000))
        self.assertTrue(guard.accept("b", NOW))
        self.assertEqual(guard.size, 2)

    def test_forgets_ids_once_the_window_elapses(self):
        guard = WebhookReplayGuard(tolerance_seconds=60)

        self.assertTrue(guard.accept("a", NOW))
        self.assertTrue(guard.accept("a", NOW + 120_000))

    def test_evicts_the_oldest_ids_once_max_entries_is_reached(self):
        guard = WebhookReplayGuard(max_entries=2)

        guard.accept("a", NOW)
        guard.accept("b", NOW)
        guard.accept("c", NOW)

        self.assertEqual(guard.size, 2)
        self.assertTrue(guard.accept("a", NOW))


if __name__ == "__main__":
    unittest.main()
