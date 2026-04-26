# pi-routing-run-provider

A [pi](https://github.com/badlogic/pi-mono) extension that adds [Routing.Run](https://routing.run) as a custom model provider.

## Features

- **OpenAI-compatible API** — Uses routing.run's `/v1/chat/completions` endpoint
- **Smart routing** — Auto-selects the optimal upstream provider for each request
- **Multi-model** — DeepSeek V3.2, Kimi K2.5, GLM 5, Qwen 3.5, Gemma 4
- **Reasoning/thinking** — Extended thinking support on compatible models
- **Fallback routing** — Automatic failover if the primary provider is unavailable
- **Streaming** — Real-time token streaming via SSE

## Available Models

| Model | Context | Max Output | Reasoning | Thinking Format |
|-------|---------|------------|-----------|-----------------|
| DeepSeek V3.2 | 164K | 164K | ✅ | openai |
| GLM 5 | 203K | 203K | ✅ | qwen-chat-template |
| Kimi K2.5 | 131K | 33K | ✅ | zai |
| Qwen 3.5 397B A17B | 262K | 262K | ✅ | qwen |
| Gemma 4 31B IT | 262K | 262K | ❌ | — |
| Qwen 3.5 9B | 262K | 262K | ❌ | — |

*Pricing is determined by routing.run — check [routing.run](https://routing.run) for current rates.*

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

Reasoning-capable models automatically use their respective thinking format:

- **`openai`** — DeepSeek V3.2 (`thinking: {type: "enabled"}`)
- **`zai`** — Kimi K2.5
- **`qwen`** — Qwen 3.5 397B A17B (`enable_thinking: true`)
- **`qwen-chat-template`** — GLM 5 (`chat_template_kwargs.enable_thinking`)

## Data Flow

```
models.json           ← auto-generated from routing.run API (model discovery)
patch.json            ← manual overrides (reasoning, compat, pricing)
custom-models.json    ← hidden/router models not in the API
         ↓
   merge order: models.json → patch.json → custom-models.json
```

- **`models.json`** — Pure API data. Updated automatically by the CI workflow.
- **`patch.json`** — Corrections for API inconsistencies. Applied at runtime. Manually maintained.
- **`custom-models.json`** — Additional models not exposed by the API (routers, experimental). Manually maintained.

## Updating Models

Run the update script to fetch the latest models from routing.run's API:

```bash
export ROUTING_RUN_API_KEY=your-api-key
node scripts/update-models.js
```

This will:
1. Fetch models from `https://api.routing.run/v1/models`
2. Preserve known metadata from existing `models.json`
3. Update `models.json` and the README model table

A GitHub Actions workflow runs this daily and creates a PR if models have changed.

## API Documentation

- Routing.Run Docs: https://docs.routing.run
- API Reference: https://docs.routing.run/llms.txt
- OpenAI-compatible endpoint: `https://api.routing.run/v1`

## License

MIT
