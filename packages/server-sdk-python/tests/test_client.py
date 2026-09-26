"""Tests for the HTTP pipeline: headers, retries, and typed errors."""

import json
import time
import unittest

from prompthash_server_sdk import (
    PromptHashApiError,
    PromptHashClient,
    PromptHashNetworkError,
)

from .support import RecordingSleep, StubTransport, json_response


def make_client(transport, **overrides):
    sleep = RecordingSleep()
    config = {
        "base_url": "https://api.example.test/",
        "api_key": "pm_abc123_supersecret",
        "api_version": "2025-01-01",
        "transport": transport,
        "sleep": sleep,
    }
    config.update(overrides)
    return PromptHashClient(**config), sleep


class RequestPipelineTests(unittest.TestCase):
    def test_requires_a_base_url(self):
        with self.assertRaises(ValueError):
            PromptHashClient("")

    def test_normalises_base_url_and_builds_query_string(self):
        transport = StubTransport(json_response(200, {"prompts": [], "total": 0}))
        client, _ = make_client(transport)

        client.list_prompts(page=2, limit=10, sort="upvotes", search=None)

        self.assertEqual(
            transport.calls[0]["url"],
            "https://api.example.test/api/prompts?page=2&limit=10&sort=upvotes",
        )

    def test_omits_null_query_values(self):
        transport = StubTransport(json_response(200, {}))
        client, _ = make_client(transport)

        client.get("/api/prompts", query={"cursor": None, "page": 1})

        self.assertEqual(
            transport.calls[0]["url"],
            "https://api.example.test/api/prompts?page=1",
        )

    def test_sends_auth_version_and_content_headers(self):
        transport = StubTransport(json_response(200, {}))
        client, _ = make_client(transport)

        client.post(
            "/api/webhooks",
            json_body={"walletAddress": "GABC"},
            has_body=True,
            idempotency_key="idem-1",
        )

        call = transport.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(
            call["headers"]["Authorization"], "Bearer pm_abc123_supersecret"
        )
        self.assertEqual(call["headers"]["Accept-Version"], "2025-01-01")
        self.assertEqual(call["headers"]["Content-Type"], "application/json")
        self.assertEqual(call["headers"]["Idempotency-Key"], "idem-1")
        self.assertEqual(json.loads(call["body"]), {"walletAddress": "GABC"})

    def test_omits_auth_header_without_an_api_key(self):
        transport = StubTransport(json_response(200, {}))
        client, _ = make_client(transport, api_key=None)

        client.get("/api/prompts")

        self.assertNotIn("Authorization", transport.calls[0]["headers"])

    def test_lets_per_call_headers_win(self):
        transport = StubTransport(json_response(200, {}))
        client, _ = make_client(
            transport,
            default_headers={"X-Trace-Id": "abc", "Accept-Version": "2024-01-01"},
        )

        client.get("/api/prompts", headers={"X-Trace-Id": "def"})

        headers = transport.calls[0]["headers"]
        self.assertEqual(headers["X-Trace-Id"], "def")
        self.assertEqual(headers["Accept-Version"], "2024-01-01")

    def test_returns_raw_text_when_the_response_is_not_json(self):
        transport = StubTransport(json_response(200, "pong"))
        client, _ = make_client(transport)

        self.assertEqual(client.get("/health"), "pong")

    def test_returns_none_for_an_empty_body(self):
        transport = StubTransport(json_response(204, ""))
        client, _ = make_client(transport)

        self.assertIsNone(client.get("/api/prompts"))


class ErrorHandlingTests(unittest.TestCase):
    def test_throws_a_typed_error_with_the_machine_readable_code(self):
        transport = StubTransport(
            json_response(
                403,
                {
                    "apiVersion": "2025-01-01",
                    "error": "Prompt access has not been purchased.",
                    "code": "ACCESS_NOT_PURCHASED",
                },
            )
        )
        client, sleep = make_client(transport)

        with self.assertRaises(PromptHashApiError) as ctx:
            client.get_prompt("abc")

        self.assertEqual(ctx.exception.status, 403)
        self.assertEqual(ctx.exception.code, "ACCESS_NOT_PURCHASED")
        self.assertFalse(ctx.exception.retryable)
        self.assertIn("not been purchased", ctx.exception.message)
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(sleep.delays, [])

    def test_does_not_retry_a_validation_failure(self):
        transport = StubTransport(
            json_response(400, {"error": "Missing fields", "code": "MISSING_FIELDS"})
        )
        client, _ = make_client(transport)

        with self.assertRaises(PromptHashApiError):
            client.post("/api/webhooks", json_body={}, has_body=True)

        self.assertEqual(len(transport.calls), 1)

    def test_retries_a_429_using_the_reset_timestamp_then_succeeds(self):
        reset = int(time.time() * 1000) + 5000
        transport = StubTransport(
            json_response(
                429,
                {
                    "error": "Too many requests.",
                    "code": "RATE_LIMIT_IP",
                    "reset": reset,
                },
            ),
            json_response(200, {"prompts": []}),
        )
        client, sleep = make_client(transport)

        self.assertEqual(client.list_prompts(), {"prompts": []})

        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(len(sleep.delays), 1)
        self.assertGreaterEqual(sleep.delays[0], 4000)
        self.assertLessEqual(sleep.delays[0], 5000)

    def test_retries_transient_failures_with_exponential_backoff(self):
        transport = StubTransport(
            json_response(503, {"error": "degraded"}),
            json_response(503, {"error": "degraded"}),
            json_response(200, {"ok": True}),
        )
        client, sleep = make_client(
            transport, retry_base_delay=0.1, retry_max_delay=1.0
        )

        self.assertEqual(client.get("/api/prompts"), {"ok": True})

        self.assertEqual(len(transport.calls), 3)
        self.assertEqual(len(sleep.delays), 2)
        self.assertGreaterEqual(sleep.delays[0], 100)
        self.assertGreaterEqual(sleep.delays[1], 200)

    def test_retries_an_in_flight_idempotency_lock(self):
        transport = StubTransport(
            json_response(
                409,
                {"error": "A request with this Idempotency-Key is still being processed."},
            ),
            json_response(200, {"message": "ok"}),
        )
        client, _ = make_client(transport)

        result = client.post(
            "/api/prompts",
            json_body={"title": "t"},
            has_body=True,
            idempotency_key="k-1",
            retry=1,
        )

        self.assertEqual(result, {"message": "ok"})
        self.assertEqual(len(transport.calls), 2)
        self.assertEqual(transport.calls[1]["headers"]["Idempotency-Key"], "k-1")

    def test_honours_retry_false(self):
        transport = StubTransport(json_response(503, {"error": "degraded"}))
        client, sleep = make_client(transport)

        with self.assertRaises(PromptHashApiError):
            client.get("/api/prompts", retry=False)

        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(sleep.delays, [])

    def test_stops_after_the_configured_retry_budget(self):
        transport = StubTransport(json_response(500, {"error": "boom"}))
        client, sleep = make_client(transport, max_retries=3)

        with self.assertRaises(PromptHashApiError):
            client.get("/api/prompts")

        self.assertEqual(len(transport.calls), 4)
        self.assertEqual(len(sleep.delays), 3)

    def test_wraps_transport_failures_in_a_network_error(self):
        transport = StubTransport(RuntimeError("ECONNRESET"))
        client, sleep = make_client(transport)

        with self.assertRaises(PromptHashNetworkError) as ctx:
            client.get("/api/prompts")

        self.assertEqual(str(ctx.exception), "ECONNRESET")
        self.assertEqual(ctx.exception.method, "GET")
        self.assertEqual(
            ctx.exception.url, "https://api.example.test/api/prompts"
        )
        self.assertEqual(len(transport.calls), 3)
        self.assertEqual(len(sleep.delays), 2)


class ResourceHelperTests(unittest.TestCase):
    def test_registers_a_webhook_subscription(self):
        transport = StubTransport(
            json_response(201, {"id": "w1", "secret": "s3cret"})
        )
        client, _ = make_client(transport)

        result = client.register_webhook(
            "GABC", "https://example.test/hook", ["PromptPurchased"]
        )

        self.assertEqual(result["secret"], "s3cret")
        self.assertEqual(transport.calls[0]["url"], "https://api.example.test/api/webhooks")
        self.assertEqual(
            json.loads(transport.calls[0]["body"]),
            {
                "walletAddress": "GABC",
                "url": "https://example.test/hook",
                "events": ["PromptPurchased"],
            },
        )

    def test_scopes_webhook_reads_by_wallet(self):
        transport = StubTransport(json_response(200, {"url": "https://x"}))
        client, _ = make_client(transport)

        client.list_webhook_deliveries("GABC")

        self.assertEqual(
            transport.calls[0]["url"],
            "https://api.example.test/api/webhooks/deliveries?walletAddress=GABC",
        )

    def test_encodes_path_segments(self):
        transport = StubTransport(json_response(200, {"id": "1"}))
        client, _ = make_client(transport)

        client.get_prompt("prompt 1/2")

        self.assertEqual(
            transport.calls[0]["url"],
            "https://api.example.test/api/prompts/prompt%201%2F2",
        )

    def test_serialises_dead_letter_filters(self):
        transport = StubTransport(json_response(200, []))
        client, _ = make_client(transport)

        client.list_webhook_dead_letters("GABC", resolved=False, limit=10)

        self.assertEqual(
            transport.calls[0]["url"],
            "https://api.example.test/api/webhooks/dead-letters"
            "?walletAddress=GABC&resolved=false&limit=10",
        )


if __name__ == "__main__":
    unittest.main()
