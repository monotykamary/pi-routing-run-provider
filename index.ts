/**
 * Routing.Run Provider Extension
 *
 * Registers Routing.Run (api.routing.run) as a custom provider.
 * Base URL: https://api.routing.run/v1 (OpenAI-compatible)
 *
 * Routing.Run is an LLM router that auto-selects the optimal provider
 * for each request. All models use the `route/` prefix.
 *
 * Features:
 *   - OpenAI-compatible API
 *   - Multi-provider routing with fallback
 *   - Reasoning/thinking support (model-dependent)
 *   - latency_ms and provider metadata on responses
 *
 * Data flow:
 *   models.json       → auto-generated from routing.run API (model discovery)
 *   patch.json        → manual overrides (reasoning, compat, pricing)
 *   custom-models.json → hidden/router models not in the API
 *
 * Merge order: models.json → apply patch.json → merge custom-models.json
 *
 * Usage:
 *   # Option 1: Store in auth.json (recommended)
 *   # Add to ~/.pi/agent/auth.json:
 *   #   "routing-run": { "type": "api_key", "key": "your-api-key" }
 *
 *   # Option 2: Set as environment variable
 *   export ROUTING_RUN_API_KEY=your-api-key
 *
 *   # Run pi with the extension
 *   pi -e /path/to/pi-routing-run-provider
 *
 * Then use /model to select from available models
 */

import type { ExtensionAPI, ModelRegistry } from "@mariozechner/pi-coding-agent";
import modelsData from "./models.json" with { type: "json" };
import patchData from "./patch.json" with { type: "json" };
import customModelsData from "./custom-models.json" with { type: "json" };

// Model data structure from models.json
interface JsonModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  compat?: {
    supportsDeveloperRole?: boolean;
    supportsStore?: boolean;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    thinkingFormat?: "openai" | "zai" | "qwen" | "qwen-chat-template";
    supportsReasoningEffort?: boolean;
  };
}

// Patch override structure (keyed by model ID, sparse)
interface PatchEntry {
  name?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  compat?: Record<string, unknown>;
}

type PatchData = Record<string, PatchEntry>;

// ─── Model merging ─────────────────────────────────────────────────────────────

/**
 * Apply patch overrides on top of models.json data.
 * Deep-merges compat, shallow-merges cost, direct-assigns everything else.
 */
function applyPatch(models: JsonModel[], patch: PatchData): JsonModel[] {
  return models.map((model) => {
    const overrides = patch[model.id];
    if (!overrides) return model;

    // Deep merge compat, shallow merge everything else
    const merged = { ...model };
    if (overrides.compat) {
      merged.compat = { ...(merged.compat || {}), ...overrides.compat };
      delete (overrides as Record<string, unknown>).compat;
    }
    if (overrides.cost) {
      merged.cost = { ...merged.cost, ...overrides.cost };
      delete (overrides as Record<string, unknown>).cost;
    }
    Object.assign(merged, overrides);

    // Remove thinkingFormat from non-reasoning models
    if (!merged.reasoning && merged.compat?.thinkingFormat) {
      delete merged.compat.thinkingFormat;
    }
    // Remove empty compat leftover
    if (merged.compat && Object.keys(merged.compat).length === 0) {
      delete merged.compat;
    }

    return merged;
  });
}

/**
 * Merge custom-models.json on top of the patched regular models.
 * Custom models take precedence for matching IDs.
 */
function mergeCustomModels(
  regular: JsonModel[],
  custom: JsonModel[]
): JsonModel[] {
  const modelMap = new Map<string, JsonModel>();

  for (const model of regular) {
    modelMap.set(model.id, model);
  }

  // Custom models override or add
  for (const model of custom) {
    modelMap.set(model.id, model);
  }

  return Array.from(modelMap.values());
}

// Build the final model list
const patchedModels = applyPatch(
  modelsData as JsonModel[],
  patchData as PatchData
);
const models = mergeCustomModels(
  patchedModels,
  customModelsData as JsonModel[]
);

// ─── API Key Resolution (via ModelRegistry) ────────────────────────────────────

/**
 * Cached API key resolved from ModelRegistry.
 *
 * Pi's core resolves the key via ModelRegistry before making requests,
 * but we also cache it here so we can resolve it in contexts where the resolved
 * key isn't directly available (e.g. future features like quota fetching) and
 * to make the dependency explicit.
 *
 * Resolution order (via ModelRegistry.getApiKeyForProvider):
 *   1. Runtime override (CLI --api-key)
 *   2. auth.json stored credentials (manual entry in ~/.pi/agent/auth.json)
 *   3. OAuth tokens (auto-refreshed)
 *   4. Environment variable (from auth.json or provider config)
 */
let cachedApiKey: string | undefined;

/**
 * Resolve the Routing.Run API key via ModelRegistry and cache the result.
 * Called on session_start and whenever ctx.modelRegistry is available.
 */
async function resolveApiKey(modelRegistry: ModelRegistry): Promise<void> {
  cachedApiKey = await modelRegistry.getApiKeyForProvider("routing-run") ?? undefined;
}

export default function (pi: ExtensionAPI) {
  // Resolve API key via ModelRegistry on session start
  pi.on("session_start", async (_event, ctx) => {
    await resolveApiKey(ctx.modelRegistry);
  });

  pi.registerProvider("routing-run", {
    baseUrl: "https://api.routing.run/v1",
    apiKey: "ROUTING_RUN_API_KEY",
    api: "openai-completions",
    models,
  });
}
