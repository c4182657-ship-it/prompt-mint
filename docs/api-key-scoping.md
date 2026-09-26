# Developer API Key Scoping Guide

PromptMint features fine-grained access control for developer API keys. Keys can be scoped to specific resources, preventing overprivileged integrations.

## Available Scopes

| Scope | Category | Risk Level | Description |
|-------|----------|------------|-------------|
| `prompts:read` | Catalog | Low | Search and query catalog listings, prompt metadata, and active pricing. |
| `prompts:write` | Catalog | Medium | Create, mint, update, or unlist prompts on the marketplace. |
| `licenses:read` | Licenses | Low | Inspect on-chain license verification and purchase history. |
| `licenses:write` | Licenses | High | Trigger contract purchase calls and transfer prompt licenses. |
| `webhooks:manage` | Integrations | Medium | Register, pause, and configure event delivery endpoints. |
| `analytics:read` | Integrations | Low | Query developer usage metrics, rate limit counters, and sales telemetry. |
| `admin` | Admin | High | Full administrative access across all endpoints. |

## Pre-configured Presets

- **Marketplace Reader**: `prompts:read`, `licenses:read`
- **Autonomous Creator**: `prompts:read`, `prompts:write`, `analytics:read`
- **Commerce Integrator**: `prompts:read`, `licenses:read`, `licenses:write`
- **Webhook Consumer**: `webhooks:manage`, `analytics:read`
- **Full Admin**: `admin`

## Managing Scopes in the UI

1. Navigate to `/settings/api-keys`.
2. Connect your Stellar wallet.
3. When creating a key, choose a preset or toggle individual scopes in the permissions matrix.
4. Active keys can be re-scoped at any time by clicking **Edit Scopes** without revoking the key.

## Authenticating Requests

Pass the key in the standard `Authorization` header:

```bash
curl -H "Authorization: Bearer pm_your_key_secret" \
  https://api.promptmint.io/api/prompts
```
