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
 * Model resolution strategy: Stale-While-Revalidate
 *   1. Serve stale immediately: disk cache → embedded models.json (zero-latency)
 *   2. Revalidate in background: live API /models → merge with embedded → cache → hot-swap
 *   3. patch.json + custom-models.json applied on top of whichever source won
 *
 * Merge order: [live|cache|embedded] → apply patch.json → merge custom-models.json
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
import fs from "fs";
import os from "os";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Patch & Custom Model Merging ─────────────────────────────────────────────

function applyPatch(models: JsonModel[], patch: PatchData): JsonModel[] {
  return models.map((model) => {
    const overrides = patch[model.id];
    if (!overrides) return model;

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

    if (!merged.reasoning && merged.compat?.thinkingFormat) {
      delete merged.compat.thinkingFormat;
    }
    if (merged.compat && Object.keys(merged.compat).length === 0) {
      delete merged.compat;
    }

    return merged;
  });
}

function mergeCustomModels(regular: JsonModel[], custom: JsonModel[]): JsonModel[] {
  const modelMap = new Map<string, JsonModel>();
  for (const model of regular) {
    modelMap.set(model.id, model);
  }
  for (const model of custom) {
    modelMap.set(model.id, model);
  }
  return Array.from(modelMap.values());
}

/** Full pipeline: base → patch → custom */
function buildModels(base: JsonModel[]): JsonModel[] {
  const patched = applyPatch(base, patchData as PatchData);
  return mergeCustomModels(patched, customModelsData as JsonModel[]);
}

// ─── Stale-While-Revalidate Model Sync ────────────────────────────────────────

const PROVIDER_ID = "routing-run";
const BASE_URL = "https://api.routing.run/v1";
const MODELS_URL = `${BASE_URL}/models`;
const CACHE_DIR = path.join(os.homedir(), ".pi", "agent", "cache");
const CACHE_PATH = path.join(CACHE_DIR, `${PROVIDER_ID}-models.json`);
const LIVE_FETCH_TIMEOUT_MS = 8000;

/** Transform a model from the Routing.Run /v1/models API. No pricing or reasoning info. */
function transformApiModel(apiModel: any): JsonModel | null {
  const modalities = apiModel.modalities || {};
  const limit = apiModel.limit || {};
  const input = (modalities.input || ["text"]) as ("text" | "image")[];
  return {
    id: apiModel.id,
    name: apiModel.name || apiModel.id,
    reasoning: false, // Can't determine from API, patch.json corrects
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: limit.context || 131072,
    maxTokens: limit.output || 131072,
  };
}

async function fetchLiveModels(apiKey: string): Promise<JsonModel[] | null> {
  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const apiModels = Array.isArray(data) ? data : (data.data || []);
    if (!Array.isArray(apiModels) || apiModels.length === 0) return null;
    return apiModels.map(transformApiModel).filter((m): m is JsonModel => m !== null);
  } catch {
    return null;
  }
}

function loadCachedModels(): JsonModel[] | null {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function cacheModels(models: JsonModel[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(models, null, 2) + "\n");
  } catch {
    // Cache write failure is non-fatal
  }
}

function mergeWithEmbedded(liveModels: JsonModel[], embeddedModels: JsonModel[]): JsonModel[] {
  const embeddedIds = new Set(embeddedModels.map(m => m.id));
  const result = [...embeddedModels];
  for (const model of liveModels) {
    if (!embeddedIds.has(model.id)) {
      result.push(model);
    }
  }
  return result;
}

function loadStaleModels(embeddedModels: JsonModel[]): JsonModel[] {
  const cached = loadCachedModels();
  if (cached && cached.length > 0) return cached;
  return embeddedModels;
}

async function revalidateModels(apiKey: string | undefined, embeddedModels: JsonModel[]): Promise<JsonModel[] | null> {
  if (!apiKey) return null;
  const liveModels = await fetchLiveModels(apiKey);
  if (!liveModels || liveModels.length === 0) return null;
  const merged = mergeWithEmbedded(liveModels, embeddedModels);
  cacheModels(merged);
  return merged;
}

// ─── API Key Resolution (via ModelRegistry) ────────────────────────────────────

let cachedApiKey: string | undefined;

async function resolveApiKey(modelRegistry: ModelRegistry): Promise<void> {
  cachedApiKey = await modelRegistry.getApiKeyForProvider("routing-run") ?? undefined;
}

// ─── Extension Entry Point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const embeddedModels = modelsData as JsonModel[];
  const staleBase = loadStaleModels(embeddedModels);
  const staleModels = buildModels(staleBase);

  pi.registerProvider("routing-run", {
    baseUrl: BASE_URL,
    apiKey: "ROUTING_RUN_API_KEY",
    api: "openai-completions",
    models: staleModels,
  });

  pi.on("session_start", async (_event, ctx) => {
    await resolveApiKey(ctx.modelRegistry);
    revalidateModels(cachedApiKey, embeddedModels).then((freshBase) => {
      if (freshBase) {
        pi.registerProvider("routing-run", {
          baseUrl: BASE_URL,
          apiKey: "ROUTING_RUN_API_KEY",
          api: "openai-completions",
          models: buildModels(freshBase),
        });
      }
    });
  });
}
