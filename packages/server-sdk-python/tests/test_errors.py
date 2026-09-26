"""Tests for typed errors, retry classification, and header parsing."""

import time
import unittest

from prompthash_server_sdk import (
    ERROR_CODES,
    PromptHashApiError,
    api_error_from_parts,
    is_retryable,
    parse_retry_after,
)


class IsRetryableTests(unittest.TestCase):
    def test_retries_throttles_and_transient_failures(self):
        for status in (408, 425, 429, 500, 502, 503, 504):
            with self.subTest(status=status):
                self.assertTrue(is_retryable(status))

    def test_never_retries_client_mistakes(self):
        for status in (400, 401, 403, 404, 405, 410, 422):
            with self.subTest(status=status):
                self.assertFalse(is_retryable(status))

    def test_never_retries_integrity_failure(self):
        self.assertFalse(is_retryable(500, ERROR_CODES["INTEGRITY_FAILURE"]))

    def test_never_retries_access_denied(self):
        self.assertFalse(is_retryable(403, ERROR_CODES["ACCESS_NOT_PURCHASED"]))

    def test_retries_in_flight_idempotency_lock(self):
        self.assertTrue(
            is_retryable(
                409, None, "A request with this Idempotency-Key is still being processed."
            )
        )

    def test_does_not_retry_reused_idempotency_key(self):
        self.assertFalse(
            is_retryable(
                409,
                None,
                "This Idempotency-Key was already used with a different request.",
            )
        )


class ParseRetryAfterTests(unittest.TestCase):
    def test_parses_delta_seconds(self):
        self.assertEqual(parse_retry_after("3"), 3000)
        self.assertEqual(parse_retry_after(" 12 "), 12000)

    def test_parses_http_date(self):
        now = 1_767_225_600_000.0  # 2026-01-01T00:00:00Z
        self.assertEqual(
            parse_retry_after("Thu, 01 Jan 2026 00:00:30 GMT", now=now), 30_000
        )

    def test_ignores_absent_or_junk_values(self):
        self.assertIsNone(parse_retry_after(None))
        self.assertIsNone(parse_retry_after(""))
        self.assertIsNone(parse_retry_after("soon"))


class ApiErrorFromPartsTests(unittest.TestCase):
    def test_reads_the_serverless_envelope(self):
        now = time.time() * 1000
        error = api_error_from_parts(
            429,
            "Too Many Requests",
            '{"apiVersion":"2025-01-01","error":"Too many requests. '
            'Please try again later.","code":"RATE_LIMIT_IP",'
            f'"reset":{int(now) + 5000}}}',
            {},
            method="POST",
            url="https://api.example.test/api/prompts",
        )

        self.assertIsInstance(error, PromptHashApiError)
        self.assertEqual(error.status, 429)
        self.assertEqual(error.code, "RATE_LIMIT_IP")
        self.assertEqual(error.api_version, "2025-01-01")
        self.assertIn("Too many requests", error.message)
        self.assertTrue(error.retryable)
        self.assertGreaterEqual(error.retry_after_ms(), 4000)
        self.assertEqual(error.method, "POST")

    def test_prefers_reset_over_retry_after_header(self):
        now = time.time() * 1000
        error = api_error_from_parts(
            429,
            "Too Many Requests",
            f'{{"error":"slow down","reset":{int(now) + 7000}}}',
            {"retry-after": "1"},
        )

        self.assertGreaterEqual(error.retry_after_ms(), 6000)
        self.assertEqual(error.retry_after_header_ms, 1000)

    def test_falls_back_to_retry_after_header(self):
        error = api_error_from_parts(
            429,
            "Too Many Requests",
            '{"error":"slow down"}',
            {"Retry-After": "4"},
        )
        self.assertEqual(error.retry_after_ms(), 4000)

    def test_handles_case_insensitive_headers(self):
        error = api_error_from_parts(
            429,
            "Too Many Requests",
            '{"error":"slow down"}',
            {"X-Whatever": "1"},
        )
        self.assertIsNone(error.retry_after_header_ms)

    def test_handles_an_express_body_without_api_version(self):
        error = api_error_from_parts(
            404, "Not Found", '{"error":"Prompt not found.","code":"NOT_FOUND"}', {}
        )

        self.assertEqual(error.code, "NOT_FOUND")
        self.assertIsNone(error.api_version)
        self.assertFalse(error.retryable)

    def test_survives_a_non_json_body(self):
        error = api_error_from_parts(502, "Bad Gateway", "<html>bad</html>", {})

        self.assertIsNone(error.code)
        self.assertIn("bad", error.message)
        self.assertTrue(error.retryable)

    def test_synthesises_a_message_when_the_body_is_empty(self):
        error = api_error_from_parts(503, "Service Unavailable", "", {})

        self.assertIn("503", error.message)
        self.assertTrue(error.retryable)

    def test_serialises_to_a_log_friendly_shape(self):
        error = api_error_from_parts(
            400,
            "Bad Request",
            '{"error":"bad","code":"INVALID_INPUT"}',
            {},
            url="https://api.example.test/x",
        )

        payload = error.to_dict()
        self.assertEqual(payload["status"], 400)
        self.assertEqual(payload["code"], "INVALID_INPUT")
        self.assertEqual(payload["message"], "bad")


if __name__ == "__main__":
    unittest.main()
