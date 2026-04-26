# pi-routing-run-provider

A [pi](https://github.com/badlogic/pi-mono) extension that adds [Routing.Run](https://routing.run) as a custom model provider.

## Features

- **OpenAI-compatible API** — Uses routing.run's `/v1/chat/completions` endpoint
- **Smart routing** — Auto-selects the optimal upstream provider for each request
- **24 models** — DeepSeek, Kimi, GLM, Qwen, MiniMax, MiMo, Gemma across multiple providers
- **Reasoning/thinking** — Extended thinking on 23 of 24 models
- **Provider failover** — Automatic fallback when upstream providers have issues
- **Pricing included** — Per-model input/output/cache pricing scraped from the catalog
- **Streaming** — Real-time token streaming via SSE

## Available Models

| Model | Context | Max Output | Reasoning | Input $/M | Output $/M | Cache $/M |
|-------|---------|------------|-----------|-----------|------------|-----------|
| DeepSeek R1 | 167K | 167K | ✅ | $0.495 | $2.365 | — |
| DeepSeek V3.2 | 168K | 164K | ✅ | $0.493 | $0.739 | — |
| DeepSeek V3.2 Speciale | 168K | 168K | ✅ | $0.550 | $0.820 | — |
| DeepSeek V4 Pro | 1.0M | 134K | ✅ | $1.150 | $3.000 | $0.230 |
| Gemma 4 31B IT | 134K | 262K | ✅ | $0.100 | $0.300 | — |
| GLM 4.7 | 205K | 205K | ✅ | $1.320 | $4.400 | — |
| GLM 4.7 Flash | 205K | 205K | ✅ | $1.320 | $4.400 | — |
| GLM 5 | 205K | 203K | ✅ | $0.792 | $2.530 | — |
| GLM 5 Highspeed | 205K | 205K | ✅ | $1.109 | $3.542 | — |
| GLM 5.1 | 205K | 205K | ✅ | $1.000 | $3.000 | — |
| GLM 5.1 Precision | 205K | 205K | ✅ | $1.200 | $3.500 | — |
| Kimi K2.5 | 134K | 33K | ✅ | $0.462 | $2.420 | — |
| Kimi K2.5 Highspeed | 134K | 134K | ✅ | $0.647 | $3.388 | — |
| Kimi K2.6 Precision | 262K | 262K | ✅ | $0.462 | $2.420 | — |
| MiMo-V2.5 | 262K | 262K | ✅ | $0.450 | $1.350 | — |
| MiMo-V2.5-Pro | 262K | 262K | ✅ | $0.450 | $1.350 | — |
| MiniMax M2.5 | 102K | 102K | ✅ | $0.193 | $1.238 | — |
| MiniMax M2.5 Highspeed | 102K | 102K | ✅ | $0.193 | $1.238 | — |
| MiniMax M2.7 | 102K | 102K | ✅ | $0.330 | $1.320 | — |
| MiniMax M2.7 Highspeed | 102K | 102K | ✅ | $0.330 | $1.320 | — |
| Qwen 3.5 397B A17B | 134K | 262K | ✅ | $1.100 | $3.300 | — |
| Qwen3.5 Plus | 134K | 134K | ✅ | $0.550 | $1.650 | — |
| Qwen3.6 Plus | 134K | 134K | ✅ | $0.600 | $1.800 | — |
| Qwen 3.5 9B | 134K | 262K | ❌ | $0.200 | $0.600 | — |

*Pricing per million tokens. Scraped from https://routing.run/models — subject to change.*

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
models.json           ← scraped from routing.run/models (public page, no API key)
patch.json            ← manual overrides (reasoning corrections, compat, pricing)
custom-models.json    ← hidden/router models not in the catalog
         ↓
   merge order: models.json → patch.json → custom-models.json
```

- **`models.json`** — Full catalog scraped from the public models page. Updated automatically by the CI workflow. No API key required.
- **`patch.json`** — Corrections for scraped data inconsistencies. Applied at runtime. Manually maintained.
- **`custom-models.json`** — Additional models not listed on the public page (routers, experimental). Manually maintained.

## Updating Models

Run the update script to scrape the latest models from routing.run's public catalog:

```bash
node scripts/update-models.js
```

No API key is required — the script scrapes the public models page. This will:
1. Fetch `https://routing.run/models`
2. Extract all model cards (name, ID, context, tiers, pricing)
3. Detect reasoning capabilities per model family
4. Update `models.json` and the README model table

A GitHub Actions workflow runs this daily and creates a PR if models have changed.

### CI Setup

To enable automated updates, add a repository secret:

1. No secrets required for model scraping (public page)
2. GitHub Actions uses `GITHUB_TOKEN` (auto-provisioned) for creating PRs

## API Documentation

- Routing.Run Docs: https://docs.routing.run
- Models Catalog: https://routing.run/models
- OpenAI-compatible endpoint: `https://api.routing.run/v1`
- API Reference: https://docs.routing.run/llms.txt

## License

MIT
