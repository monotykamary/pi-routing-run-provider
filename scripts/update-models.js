#!/usr/bin/env node
/**
 * Update Routing.Run models from API
 *
 * Fetches models from https://api.routing.run/v1/models and pricing from
 * https://api.routing.run/v1/pricing, then updates:
 * - models.json: Pure API model definitions (no patches baked in)
 * - README.md: Model table with patch.json overrides applied
 *
 * The /v1/models endpoint is public (no API key required).
 * The /v1/pricing endpoint requires authentication (ROUTING_RUN_API_KEY).
 * If no API key is available, pricing is preserved from existing models.json.
 *
 * The API does NOT report reasoning capability or compat settings — patch.json
 * corrects these at runtime (index.ts) and is also applied when generating the
 * README table so the docs reflect reality.
 *
 * patch.json and custom-models.json are applied at runtime by the provider.
 * They are NOT baked into models.json, but ARE used to generate the README table.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODELS_API_URLS = [
  'https://api.routing.sh/v1/models',
  'https://api.routing.run/v1/models',
];
const PRICING_API_URLS = [
  'https://api.routing.sh/v1/pricing',
  'https://api.routing.run/v1/pricing',
];
const MODELS_JSON_PATH = path.join(__dirname, '..', 'models.json');
const PATCH_JSON_PATH = path.join(__dirname, '..', 'patch.json');
const CUSTOM_MODELS_JSON_PATH = path.join(__dirname, '..', 'custom-models.json');
const README_PATH = path.join(__dirname, '..', 'README.md');

const FETCH_TIMEOUT_MS = 30_000;
const MIN_MODELS_EXPECTED = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ Saved ${path.basename(filePath)}`);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ─── API Fetch ───────────────────────────────────────────────────────────────

async function fetchModels() {
  let lastError;
  for (const url of MODELS_API_URLS) {
    try {
      console.log(`Fetching models from ${url}...`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      const models = data.data || data;
      if (!Array.isArray(models)) {
        throw new Error('API response does not contain an array of models');
      }
      console.log(`✓ Fetched ${models.length} models from ${url}`);
      return models;
    } catch (error) {
      lastError = error;
      console.warn(`⚠ Failed to fetch models from ${url}: ${error.message}`);
    }
  }
  throw new Error(`Failed to fetch models from all endpoints: ${lastError.message}`);
}

async function fetchPricing(apiKey) {
  if (!apiKey) {
    console.log('No API key set, skipping pricing fetch (ROUTING_RUN_API_KEY)');
    return null;
  }
  for (const url of PRICING_API_URLS) {
    try {
      console.log(`Fetching pricing from ${url}...`);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.warn(`⚠ Pricing API at ${url} returned HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      const models = data.models || [];
      console.log(`✓ Fetched ${models.length} pricing entries from ${url}`);
      return models;
    } catch (error) {
      console.warn(`⚠ Pricing fetch from ${url} failed: ${error.message}`);
    }
  }
  console.warn('⚠ Pricing fetch failed from all endpoints, preserving existing pricing');
  return null;
}

// ─── Transform ───────────────────────────────────────────────────────────────

function transformModel(apiModel, pricingMap, existingModelsMap) {
  const modelId = apiModel.id;

  // Filter non-chat models (embeddings, rerankers, TTS, STT, image gen)
  if (apiModel.capability !== 'chat') return null;

  const modalities = apiModel.modalities || {};
  const limit = apiModel.limit || {};
  const input = (modalities.input || ['text']).filter(m => m === 'text' || m === 'image');
  const tier = apiModel.tier || 'free';
  const contextWindow = limit.context || 131072;
  const maxTokens = limit.output || contextWindow;

  // Get pricing from pricing API (lowest tier entry per model)
  const pricing = pricingMap.get(modelId) || {};
  const displayName = pricing.display_name || null;
  const inputCost = pricing.input_per_million || 0;
  const outputCost = pricing.output_per_million || 0;

  // Preserve existing curated data (reasoning, compat, display names, cache pricing)
  if (existingModelsMap[modelId]) {
    const existing = { ...existingModelsMap[modelId] };

    // Update metadata from API
    existing.contextWindow = contextWindow;
    if (maxTokens) existing.maxTokens = maxTokens;
    existing.input = input;

    // Update pricing from API (only if > 0, preserving existing otherwise)
    if (inputCost > 0) existing.cost.input = round2(inputCost);
    if (outputCost > 0) existing.cost.output = round2(outputCost);

    // Update display name from pricing API if available
    if (displayName) existing.name = displayName;

    // _meta for README generation (stripped before saving to models.json)
    existing._meta = { tier };

    return existing;
  }

  // New model — build from API data + sensible defaults
  // Curate models.json manually after discovery for reasoning, thinkingFormat, etc.
  return {
    id: modelId,
    name: displayName || apiModel.name || modelId,
    reasoning: false, // API doesn't report this, patch.json corrects
    input,
    cost: {
      input: round2(inputCost),
      output: round2(outputCost),
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens,
    _meta: { tier },
  };
}

// ─── Patch & Custom Models ──────────────────────────────────────────────────

function applyPatch(model, patch) {
  const result = { ...model };
  if (patch.name !== undefined) result.name = patch.name;
  if (patch.reasoning !== undefined) result.reasoning = patch.reasoning;
  if (patch.input !== undefined) result.input = patch.input;
  if (patch.contextWindow !== undefined) result.contextWindow = patch.contextWindow;
  if (patch.maxTokens !== undefined) result.maxTokens = patch.maxTokens;
  if (patch.cost) {
    result.cost = {
      input: patch.cost.input ?? result.cost.input,
      output: patch.cost.output ?? result.cost.output,
      cacheRead: patch.cost.cacheRead ?? result.cost.cacheRead,
      cacheWrite: patch.cost.cacheWrite ?? result.cost.cacheWrite,
    };
  }
  if (patch.compat) {
    result.compat = { ...(result.compat || {}), ...patch.compat };
  }
  if (!result.reasoning && result.compat?.thinkingFormat) {
    delete result.compat.thinkingFormat;
  }
  if (result.compat && Object.keys(result.compat).length === 0) {
    delete result.compat;
  }
  return result;
}

function buildModels(baseModels, customModels, patchData) {
  const modelMap = new Map();
  for (const model of baseModels) {
    modelMap.set(model.id, model);
  }
  for (const [id, patchEntry] of Object.entries(patchData)) {
    const existing = modelMap.get(id);
    if (existing) {
      modelMap.set(id, applyPatch(existing, patchEntry));
    }
  }
  for (const model of customModels) {
    const existing = modelMap.get(model.id);
    const patchEntry = patchData[model.id];
    if (existing && patchEntry) {
      modelMap.set(model.id, applyPatch(model, patchEntry));
    } else if (existing) {
      modelMap.set(model.id, model);
    } else if (patchEntry) {
      modelMap.set(model.id, applyPatch(model, patchEntry));
    } else {
      modelMap.set(model.id, model);
    }
  }
  return Array.from(modelMap.values());
}

// ─── README generation ──────────────────────────────────────────────────────

function formatContext(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return n.toString();
}

function formatCost(cost) {
  if (cost === 0) return '—';
  if (cost === null || cost === undefined) return '—';
  return `$${cost.toFixed(3)}`;
}

function capitalizeTier(tier) {
  if (!tier) return 'Free';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function generateReadmeTable(models) {
  const lines = [
    '| Model | Context | Max Output | Tier | Reasoning | Input $/M | Output $/M | Cache $/M |',
    '|-------|---------|------------|------|-----------|-----------|------------|-----------|',
  ];

  for (const model of models) {
    const context = formatContext(model.contextWindow);
    const maxOut = formatContext(model.maxTokens);
    const tier = capitalizeTier(model._meta?.tier);
    const reasoning = model.reasoning ? '✅' : '❌';
    const inputCost = formatCost(model.cost.input);
    const outputCost = formatCost(model.cost.output);
    const cacheCost = formatCost(model.cost.cacheRead);

    lines.push(
      `| ${model.name} | ${context} | ${maxOut} | ${tier} | ${reasoning} | ${inputCost} | ${outputCost} | ${cacheCost} |`
    );
  }

  return lines.join('\n');
}

function updateReadme(models) {
  let readme = fs.readFileSync(README_PATH, 'utf8');
  const newTable = generateReadmeTable(models);

  // Update model count lines
  readme = readme.replace(
    /\*\*\d+ models\*\*/g,
    `**${models.length} models**`
  );
  readme = readme.replace(
    /(\d+ of )\d+( models)/g,
    (match, prefix, suffix) => `${prefix}${models.length}${suffix}`
  );

  const tableRegex =
    /(## Available Models\n\n)\| Model \|[^\n]+\|\n\|[-| ]+\|(\n\|[^\n]+\|)*\n*/;

  if (tableRegex.test(readme)) {
    readme = readme.replace(
      tableRegex,
      (match, header) => `${header}${newTable}\n\n`
    );
    fs.writeFileSync(README_PATH, readme);
    console.log('✓ Updated README.md');
  } else {
    console.warn('⚠ Could not find model table in "## Available Models" section');
  }
}

// ─── Clean ───────────────────────────────────────────────────────────────────

function cleanModelForJson(model) {
  const { _meta, ...cleanModel } = model;
  return cleanModel;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ROUTING_RUN_API_KEY;

  // Fetch from API
  const apiModels = await fetchModels();
  const pricingEntries = await fetchPricing(apiKey);

  // Build pricing map (first occurrence per model ID = lowest tier)
  const pricingMap = new Map();
  if (pricingEntries) {
    for (const entry of pricingEntries) {
      if (!pricingMap.has(entry.model)) {
        pricingMap.set(entry.model, entry);
      }
    }
  }

  // Load existing models.json — source of truth for curated specs
  let existingModels = [];
  try {
    existingModels = JSON.parse(fs.readFileSync(MODELS_JSON_PATH, 'utf8'));
  } catch {
    // File might not exist or be invalid
  }
  const existingModelsMap = {};
  for (const m of existingModels) {
    existingModelsMap[m.id] = m;
  }

  // Transform models from API, preserving existing curated data
  let models = apiModels
    .map(m => transformModel(m, pricingMap, existingModelsMap))
    .filter(m => m !== null);

  // Validate
  if (models.length < MIN_MODELS_EXPECTED) {
    throw new Error(
      `Only ${models.length} chat models found (expected at least ${MIN_MODELS_EXPECTED}). ` +
      `The API may be having issues.`
    );
  }

  // Sort: reasoning first, then alphabetically
  models.sort((a, b) => {
    if (a.reasoning !== b.reasoning) return b.reasoning - a.reasoning;
    return a.name.localeCompare(b.name);
  });

  // Save models.json — pure API data, no patches baked in
  const cleanModels = models.map(cleanModelForJson);
  saveJson(MODELS_JSON_PATH, cleanModels);

  // Build full model list for README: base → patch → custom
  const patchData = loadJson(PATCH_JSON_PATH);
  const customModels = loadJson(CUSTOM_MODELS_JSON_PATH);
  const readmeModels = buildModels(models, Array.isArray(customModels) ? customModels : [], patchData);
  readmeModels.sort((a, b) => {
    if (a.reasoning !== b.reasoning) return b.reasoning - a.reasoning;
    return a.name.localeCompare(b.name);
  });

  // Update README
  updateReadme(readmeModels);

  // Summary
  const newIds = new Set(models.map(m => m.id));
  const oldIds = new Set(Object.keys(existingModelsMap));
  const added = [...newIds].filter(id => !oldIds.has(id));
  const removed = [...oldIds].filter(id => !newIds.has(id));

  console.log('\n--- Summary ---');
  console.log(`Total API models: ${apiModels.length}`);
  console.log(`Chat models: ${models.length}`);
  console.log(`Reasoning models (patched): ${readmeModels.filter(m => m.reasoning).length}`);
  console.log(`Vision models: ${readmeModels.filter(m => m.input.includes('image')).length}`);
  if (added.length > 0) console.log(`New models: ${added.join(', ')}`);
  if (removed.length > 0) console.log(`Removed models: ${removed.join(', ')}`);

  // List models
  console.log('\nModels:');
  for (const m of models) {
    const r = m.reasoning ? '🧠' : '  ';
    const v = m.input.includes('image') ? '👁' : '  ';
    const in$ = m.cost.input > 0 ? `$${m.cost.input.toFixed(3)}` : '—';
    const out$ = m.cost.output > 0 ? `$${m.cost.output.toFixed(3)}` : '—';
    const tier = (m._meta?.tier || '?').padEnd(8);
    console.log(`  ${r}${v} ${m.id.padEnd(40)} tier:${tier} in:${in$.padStart(8)}  out:${out$.padStart(8)}  ctx:${formatContext(m.contextWindow).padStart(6)}`);
  }

  // Pricing changes
  for (const model of models) {
    const oldModel = existingModels.find(m => m.id === model.id);
    if (oldModel) {
      const oldInput = oldModel.cost?.input || 0;
      const oldOutput = oldModel.cost?.output || 0;
      if (oldInput !== model.cost.input || oldOutput !== model.cost.output) {
        console.log(`\nPricing change for ${model.id}:`);
        if (oldInput !== model.cost.input) {
          console.log(`  Input: $${oldInput}/M → $${model.cost.input}/M`);
        }
        if (oldOutput !== model.cost.output) {
          console.log(`  Output: $${oldOutput}/M → $${model.cost.output}/M`);
        }
      }
    }
  }

  // Note models needing patch.json curation
  const uncurated = models.filter(m => !m.reasoning && !existingModelsMap[m.id]);
  if (uncurated.length > 0) {
    console.log(`\nNew models needing patch.json curation (reasoning, compat, pricing):`);
    for (const m of uncurated) {
      console.log(`  ${m.id}`);
    }
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
