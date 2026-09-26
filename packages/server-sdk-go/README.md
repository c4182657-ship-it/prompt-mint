# `server-sdk-go`

Server-side Go SDK for the Prompt Mint API. Standard library only — no third-party dependencies.

- **API-key auth** — sends `Authorization: Bearer pm_<prefix>_<secret>` (the server also accepts `X-Api-Key`)
- **Version negotiation** — `Accept-Version` on every call, defaulting to `latest`
- **Idempotent writes** — `Idempotency-Key` on POST/PUT/PATCH/DELETE
- **Typed errors** — `*APIError` with `Status`, `Code`, `Retryable()`, and `RetryAfter()`
- **Bounded retry** — exponential backoff with jitter on `408`/`425`/`429`/`5xx`, honouring `reset` and `Retry-After`, cancelled by `context`
- **Webhook verification** — constant-time HMAC-SHA256 check of `X-PromptHash-Signature`, timestamp window, concurrency-safe replay guard

The browser TypeScript SDK lives in [`packages/sdk`](../sdk); the server-side TypeScript and Python SDKs are in [`packages/server-sdk`](../server-sdk) and [`packages/server-sdk-python`](../server-sdk-python).

## Install

```bash
go get github.com/PromptMintLabs/prompt-mint/packages/server-sdk-go
```

Requires Go 1.21+.

## Quick start

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	prompthash "github.com/PromptMintLabs/prompt-mint/packages/server-sdk-go"
)

func main() {
	client, err := prompthash.NewClient(prompthash.Config{
		BaseURL: "https://api.promptmint.io",
		APIKey:  os.Getenv("PROMPTMINT_API_KEY"),
	})
	if err != nil {
		panic(err)
	}

	page, err := client.ListPrompts(context.Background(), prompthash.ListPromptsParams{
		Page:  1,
		Limit: 20,
		Sort:  "upvotes",
	})
	if err != nil {
		var apiErr *prompthash.APIError
		if errors.As(err, &apiErr) {
			fmt.Println(apiErr.Status, apiErr.Code, apiErr.Retryable())
		}
		return
	}
	fmt.Println(page.Total, len(page.Prompts))
}
```

### Retries and error codes

```go
opts := prompthash.RequestOptions{
	Body: map[string]string{"walletAddress": wallet, "url": url},
	// Required to make a retry safe after a timeout.
	IdempotencyKey: uuid.NewString(),
}

if _, err := client.Do(ctx, "POST", "/api/webhooks", opts); err != nil {
	var apiErr *prompthash.APIError
	switch {
	case errors.As(err, &apiErr) && apiErr.Code == prompthash.CodeRateLimitIP:
		if wait, ok := apiErr.RetryAfter(time.Now()); ok {
			time.Sleep(wait)
		}
	case errors.As(err, &apiErr) && !apiErr.Retryable():
		return err
	}
	return err
}
```

Tune the budget with `MaxRetries` (default `2`), `RetryBaseDelay` (default `250ms`), and `RetryMaxDelay` (default `10s`); set `RequestOptions.RetryBudget` to `0` to disable retries for one call.

### Webhook verification

```go
func handler(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read failed", http.StatusBadRequest)
		return
	}

	guard := prompthash.NewWebhookReplayGuard(prompthash.DefaultTolerance, 0)
	envelope, err := prompthash.VerifyWebhook(
		os.Getenv("PROMPTMINT_WEBHOOK_SECRET"),
		string(raw), // raw bytes — never a re-serialised object
		r.Header,
		prompthash.VerifyOptions{ReplayGuard: guard},
	)
	if err != nil {
		var verifyErr *prompthash.WebhookVerificationError
		if errors.As(err, &verifyErr) {
			log.Printf("rejected webhook: %s", verifyErr.Reason)
		}
		http.Error(w, "rejected", http.StatusBadRequest)
		return
	}
	log.Printf("%s %s", envelope.Event, envelope.DeliveryID)
	w.WriteHeader(http.StatusOK)
}
```

`VerifyWebhook` returns a `*WebhookVerificationError` whose `Reason` is one of `missing_signature`, `missing_timestamp`, `malformed_signature`, `signature_mismatch`, `stale_timestamp`, `future_timestamp`, `invalid_payload`, or `duplicate_delivery`.

## Resource helpers

| Method | Route |
|---|---|
| `ListPrompts(ctx, params)` | `GET /api/prompts` |
| `GetPrompt(ctx, id)` | `GET /api/prompts/:id` |
| `RegisterWebhook(ctx, params)` | `POST /api/webhooks` |
| `RotateWebhookSecret(ctx, wallet)` | `POST /api/webhooks/rotate-secret` |
| `DeleteWebhook(ctx, wallet)` | `DELETE /api/webhooks` |
| `ListWebhookDeliveries(ctx, wallet)` | `GET /api/webhooks/deliveries` |
| `ListWebhookDeadLetters(ctx, wallet, resolved, limit)` | `GET /api/webhooks/dead-letters` |

Anything else goes through `client.Do`, `client.Get`, `client.Post`, `client.Put`, `client.Patch`, or `client.Delete`.

## Testing

```bash
cd packages/server-sdk-go
go test ./...
go vet ./...
gofmt -l .
```

The tests use `httptest` from the standard library — no network access required.

## Error codes

The full table of codes, statuses, retry guidance, and envelope shapes is in [docs/sdk-error-codes.md](../../docs/sdk-error-codes.md).

## Related Documentation

- [docs/integration-guide.md](../../docs/integration-guide.md)
- [docs/api-reference.md](../../docs/api-reference.md)
- [docs/payload-versioning.md](../../docs/payload-versioning.md)
- [docs/monorepo-map.md](../../docs/monorepo-map.md)
