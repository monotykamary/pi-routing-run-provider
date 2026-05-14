# pi-routing-run-provider

A [pi](https://github.com/badlogic/pi-mono) extension that adds [Routing.Run](https://routing.run) as a custom model provider.

## Features

- **OpenAI-compatible API** — Uses routing.run's `/v1/chat/completions` endpoint
- **Dual endpoints** — `api.routing.sh` (primary, faster) with `api.routing.run` fallback
- **Smart routing** — Auto-selects the optimal upstream provider for each request
- **API-driven catalog** — Models fetched from `/v1/models` + `/v1/pricing` APIs
- **Reasoning/thinking** — Extended thinking on 23 of 41 models
- **Provider failover** — Automatic fallback when upstream providers have issues
- **Pricing included** — Per-model input/output/cache pricing from the `/v1/pricing` API
- **Streaming** — Real-time token streaming via SSE

## Available Models

| Model | Context | Max Output | Tier | Reasoning | Input $/M | Output $/M | Cache $/M |
|-------|---------|------------|------|-----------|-----------|------------|-----------|
| DeepSeek V3.2 | 164K | 164K | Free | ✅ | $0.490 | $0.740 | — |
| DeepSeek V3.2 Speciale | 164K | 164K | Max | ✅ | $0.550 | $0.820 | — |
| Deepseek V4 Pro | 1.0M | 131K | Lite | ✅ | $0.490 | $0.740 | $0.230 |
| Gemma-4 31B IT | 131K | 131K | Free | ✅ | $0.100 | $0.300 | — |
| Glm 4.7 | 128K | 128K | Lite | ✅ | $1.320 | $4.400 | — |
| Glm 4.7 Flash | 128K | 128K | Lite | ✅ | $1.320 | $4.400 | — |
| Glm 5 Highspeed | 203K | 203K | Max | ✅ | $1.110 | $3.540 | — |
| Glm 5.1 | 203K | 203K | Lite | ✅ | $1.000 | $3.000 | — |
| Glm 5.1 Precision | 203K | 203K | Lite | ✅ | $1.200 | $3.500 | — |
| GLM-5 | 203K | 203K | Free | ✅ | $0.790 | $2.530 | — |
| Kimi K2.5 | 131K | 33K | Free | ✅ | $0.460 | $2.420 | — |
| Kimi K2.5 Highspeed | 131K | 33K | Lite | ✅ | $0.650 | $3.390 | — |
| Kimi K2.6 Precision | 262K | 262K | Premium | ✅ | $0.650 | $3.390 | — |
| Mimo V2.5 Pro | 1.0M | 262K | Premium | ✅ | $0.450 | $1.350 | — |
| MiMo-V2.5 | 256K | 256K | Premium | ✅ | $0.450 | $1.350 | — |
| MiniMax M2.5 | 100K | 100K | Lite | ✅ | $0.190 | $1.240 | — |
| MiniMax M2.5 Highspeed | 100K | 100K | Premium | ✅ | $0.190 | $1.240 | — |
| MiniMax M2.7 | 100K | 100K | Premium | ✅ | $0.330 | $1.320 | — |
| MiniMax M2.7 Highspeed | 100K | 100K | Lite | ✅ | $0.330 | $1.320 | — |
| Qwen3.5 397B A17B | 262K | 262K | Free | ✅ | $1.100 | $3.300 | — |
| Qwen3.5 Plus | 131K | 131K | Premium | ✅ | $0.550 | $1.650 | — |
| Qwen3.6 Plus | 131K | 131K | Premium | ✅ | $0.600 | $1.800 | — |
| Deepseek V4 Flash | 1.0M | 131K | Lite | ❌ | $0.490 | $0.740 | $0.020 |
| Deepseek V4 Flash Full | 1.0M | 131K | Premium | ❌ | $0.490 | $0.740 | $0.020 |
| Deepseek V4 Pro Precision | 1.0M | 131K | Premium | ❌ | $0.740 | $1.110 | $0.250 |
| Glm 5.1 Fp16 | 203K | 203K | Premium | ❌ | $1.200 | $3.500 | — |
| Glm 5.1 Full | 203K | 203K | Premium | ❌ | $1.200 | $3.500 | — |
| Kimi K2.6 | 262K | 262K | Lite | ❌ | $0.460 | $2.420 | — |
| Kimi K2.6 Full | 262K | 262K | Premium | ❌ | $0.460 | $2.420 | — |
| Mimo V2.5 Pro Precision | 1.0M | 131K | Premium | ❌ | $0.450 | $1.350 | — |
| Mistral Large 3 | 128K | 33K | Premium | ❌ | — | — | — |
| Mistral Medium 2505 | 128K | 33K | Premium | ❌ | — | — | — |
| Mistral Small 2503 | 128K | 33K | Premium | ❌ | — | — | — |
| Qwen3.5 9B | 262K | 262K | Free | ❌ | $0.200 | $0.600 | — |
| Qwen3.5 9B Chat | 262K | 262K | Free | ❌ | $0.200 | $0.600 | — |
| Qwen3.6 27B | 262K | 262K | Free | ❌ | $1.100 | $3.300 | — |
| route/step-3.5-flash-full | 262K | 66K | Premium | ❌ | — | — | — |
| Step 3.5 Flash | 262K | 66K | Premium | ❌ | — | — | — |
| Step 3.5 Flash 2603 | 262K | 66K | Premium | ❌ | — | — | — |
| Xiaomi MiMo V2 Omni | 256K | 256K | Premium | ❌ | $0.550 | $1.650 | — |
| Xiaomi MiMo V2 Pro | 256K | 256K | Premium | ❌ | $0.450 | $1.350 | — |

*Pricing per million tokens. Fetched from https://api.routing.sh/v1/pricing — subject to change.*

## Installation

### Option 1: Using `pi install` (Recommended)

Install directly from GitHub:

```bash
pi install git:github.com/monotykamary/pi-routing-run-provider
```

Then set your API key and run pi:
```bash
# Recommended: add to auth.json
# See Authentication section below

# Or set as environment variable
export ROUTING_RUN_API_KEY=your-api-key-here

pi
```

Get your API key at [routing.run](https://routing.run).

### Option 2: Manual Clone

1. Clone this repository:
   ```bash
   git clone https://github.com/monotykamary/pi-routing-run-provider.git
   cd pi-routing-run-provider
   ```

2. Set your Routing.Run API key:
   ```bash
   # Recommended: add to auth.json
   # See Authentication section below

   # Or set as environment variable
   export ROUTING_RUN_API_KEY=your-api-key-here
   ```

3. Run pi with the extension:
   ```bash
   pi -e /path/to/pi-routing-run-provider
   ```

## Authentication

The Routing.Run API key can be configured in multiple ways (resolved in this order):

1. **`auth.json`** (recommended) — Add to `~/.pi/agent/auth.json`:
   ```json
   { "routing-run": { "type": "api_key", "key": "your-api-key" } }
   ```
   The `key` field supports literal values, env var names, and shell commands (prefix with `!`). See [pi's auth file docs](https://github.com/badlogic/pi-mono) for details.
2. **Runtime override** — Use the `--api-key` CLI flag
3. **Environment variable** — Set `ROUTING_RUN_API_KEY`

Get your API key at [routing.run](https://routing.run).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ROUTING_RUN_API_KEY` | No | Your Routing.Run API key (fallback if not in auth.json) |

## Configuration

Add to your pi configuration for automatic loading:

```json
{
  "extensions": [
    "/path/to/pi-routing-run-provider"
  ]
}
```

## Usage

Once loaded, select a model with:

```
/model routing-run route/deepseek-v3.2
```

Or use `/models` to browse all available Routing.Run models.

### Thinking Mode

Reasoning-capable models use their respective thinking format automatically:

| Provider | Thinking Format | Mechanism |
|----------|----------------|-----------|
| DeepSeek | `openai` | `thinking: {type: "enabled/disabled"}` |
| Kimi | `zai` | Kimi-native thinking API |
| GLM | `qwen-chat-template` | `chat_template_kwargs.enable_thinking` |
| Qwen | `qwen` | Top-level `enable_thinking: true` |
| MiniMax | `qwen` | Qwen-compatible thinking |
| MiMo | `qwen` | Qwen-compatible thinking |
| Gemma | `openai` | OpenAI-compatible thinking |

## Data Flow

```
api.routing.sh/v1/models  ← public, no API key (primary)
api.routing.run/v1/models ← public, no API key (fallback)
api.routing.sh/v1/pricing  ← requires API key (primary)
api.routing.run/v1/pricing ← requires API key (fallback)
         ↓
models.json           ← merged API data (models + pricing)
patch.json            ← manual overrides (reasoning corrections, compat)
custom-models.json    ← hidden/router models not in the API
         ↓
   merge order: models.json → patch.json → custom-models.json
```

- **`models.json`** — Full catalog from the `/v1/models` + `/v1/pricing` APIs. Updated automatically by the CI workflow. `/v1/models` is public (no API key). `/v1/pricing` requires an API key — if unavailable, existing pricing is preserved.
- **`patch.json`** — Corrections for API data inconsistencies (reasoning flags, compat settings, display names). Applied at runtime. Manually maintained.
- **`custom-models.json`** — Additional models not returned by the API (routers, experimental). Manually maintained.

## Updating Models

Run the update script to fetch the latest models from the Routing.Run API:

```bash
# With API key (fetches models + pricing)
ROUTING_RUN_API_KEY=your-key node scripts/update-models.js

# Without API key (fetches models only, preserves existing pricing)
node scripts/update-models.js
```

This will:
1. Fetch models from `https://api.routing.sh/v1/models` (falls back to `api.routing.run`)
2. Fetch pricing from `https://api.routing.sh/v1/pricing` (if API key is set)
3. Update `models.json` and the README model table

A GitHub Actions workflow runs this daily and creates a PR if models have changed.

### CI Setup

To enable automated updates with pricing:

1. Add `ROUTING_RUN_API_KEY` as a repository secret (optional — models fetch works without it)
2. GitHub Actions uses `GITHUB_TOKEN` (auto-provisioned) for creating PRs

## API Documentation

- Routing.Run Docs: https://docs.routing.run
- Models Catalog: https://routing.run/models
- API endpoint (primary): `https://api.routing.sh/v1`
- API endpoint (fallback): `https://api.routing.run/v1`
- Models API: `GET /v1/models` (public, no auth required)
- Pricing API: `GET /v1/pricing` (requires API key)
- API Reference: https://docs.routing.run/llms.txt

## License

MIT
