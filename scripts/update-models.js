#!/usr/bin/env node
/**
 * Update Routing.Run models from API
 *
 * Fetches models from https://api.routing.run/v1/models and updates:
 * - models.json: Provider model definitions (enriched with known metadata)
 * - README.md: Model table in the Available Models section
 *
 * The Routing.Run /v1/models API returns model info (id, limit.context, limit.output,
 * modalities) but does NOT include pricing, reasoning flags, or compat settings.
 * Known model metadata is maintained in MODEL_METADATA below and carried forward
 * for known models. New models get sensible defaults.
 *
 * patch.json is applied at runtime by the provider — not baked into models.json.
 *
 * Requires ROUTING_RUN_API_KEY environment variable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODELS_API_URL = 'https://api.routing.run/v1/models';
const MODELS_JSON_PATH = path.join(__dirname, '..', 'models.json');
const README_PATH = path.join(__dirname, '..', 'README.md');

// ─── Known model metadata ────────────────────────────────────────────────────
// When routing.run's API doesn't provide reasoning/pricing/compat,
// we maintain them here. Update this when new models are added.
const MODEL_METADATA = {
  'route/deepseek-v3.2': {
    name: 'DeepSeek V3.2',
    reasoning: true,
    compat: {
      thinkingFormat: 'openai',
      maxTokensField: 'max_tokens',
      supportsDeveloperRole: false,
      supportsStore: false,
    },
  },
  'route/glm-5': {
    name: 'GLM 5',
    reasoning: true,
    compat: {
      thinkingFormat: 'qwen-chat-template',
      maxTokensField: 'max_tokens',
      supportsDeveloperRole: false,
      supportsStore: false,
    },
  },
  'route/kimi-k2.5': {
    name: 'Kimi K2.5',
    reasoning: true,
    compat: {
      thinkingFormat: 'zai',
      maxTokensField: 'max_tokens',
      supportsDeveloperRole: false,
      supportsStore: false,
    },
  },
  'route/qwen3.5-9b': {
    name: 'Qwen 3.5 9B',
    reasoning: false,
    compat: {
      maxTokensField: 'max_tokens',
      supportsDeveloperRole: false,
      supportsStore: false,
    },
  },
  'route/qwen3.5-397b-a17b': {
    name: 'Qwen 3.5 397B A17B',
    reasoning: true,
    compat: {
      thinkingFormat: 'qwen',
      maxTokensField: 'max_tokens',
      supportsDeveloperRole: false,
      supportsStore: false,
    },
  },
  'route/gemma-4-31b-it': {
    name: 'Gemma 4 31B IT',
    reasoning: false,
    compat: {
      maxTokensField: 'max_tokens',
      supportsDeveloperRole: false,
      supportsStore: false,
    },
  },
};

// Default metadata for unknown models
const DEFAULT_METADATA = {
  reasoning: false,
  compat: {
    maxTokensField: 'max_tokens',
    supportsDeveloperRole: false,
    supportsStore: false,
  },
};

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

// ─── API fetch ───────────────────────────────────────────────────────────────

async function fetchModels() {
  const apiKey = process.env.ROUTING_RUN_API_KEY;
  if (!apiKey) {
    throw new Error('ROUTING_RUN_API_KEY environment variable is required');
  }

  console.log(`Fetching models from ${MODELS_API_URL}...`);
  const response = await fetch(MODELS_API_URL, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const models = data.data || [];
  console.log(`✓ Fetched ${models.length} models from API`);
  return models;
}

// ─── Transform API model → models.json entry ────────────────────────────────

/**
 * Build a display name from a model ID by stripping the route/ prefix
 * and prettifying the remaining part.
 */
function generateDisplayName(id) {
  const name = id.startsWith('route/') ? id.slice(6) : id;
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\b(\d+)b\b/i, '$1B')
    .replace(/\b(\d+)k\b/i, '$1K')
    .replace(/\bA17b\b/i, 'A17B');
}

function transformApiModel(apiModel, existingModelsMap) {
  const id = apiModel.id;

  // Start from existing model data if we have it (preserves pricing, compat, etc.)
  if (existingModelsMap[id]) {
    const existing = { ...existingModelsMap[id] };
    // Update context/maxTokens from API if changed
    if (apiModel.limit?.context) {
      existing.contextWindow = apiModel.limit.context;
    }
    if (apiModel.limit?.output) {
      existing.maxTokens = apiModel.limit.output;
    }
    // Update input modalities from API
    const apiInput = apiModel.modalities?.input || ['text'];
    const existingInput = new Set(existing.input);
    for (const mod of apiInput) {
      if (mod === 'image' && !existingInput.has('image')) {
        existing.input = ['text', 'image'];
        break;
      }
    }
    return existing;
  }

  // New model — build from API data + known metadata
  const metadata = MODEL_METADATA[id] || DEFAULT_METADATA;
  const input = (apiModel.modalities?.input || ['text']).filter(
    m => m === 'text' || m === 'image'
  );

  const model = {
    id,
    name: metadata.name || generateDisplayName(id),
    reasoning: metadata.reasoning || false,
    input,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: apiModel.limit?.context || 131072,
    maxTokens: apiModel.limit?.output || 32768,
  };

  // Add compat settings
  if (metadata.compat) {
    model.compat = { ...metadata.compat };
  }

  // Remove thinkingFormat from non-reasoning models
  if (!model.reasoning && model.compat?.thinkingFormat) {
    delete model.compat.thinkingFormat;
  }

  return model;
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
  return `$${cost.toFixed(2)}`;
}

function generateReadmeTable(models) {
  const lines = [
    '| Model | Context | Max Output | Reasoning | Thinking Format |',
    '|-------|---------|------------|-----------|-----------------|',
  ];

  for (const model of models) {
    const context = formatContext(model.contextWindow);
    const maxOut = formatContext(model.maxTokens);
    const reasoning = model.reasoning ? '✅' : '❌';
    const thinkingFormat = model.compat?.thinkingFormat || '—';

    lines.push(
      `| ${model.name} | ${context} | ${maxOut} | ${reasoning} | ${thinkingFormat} |`
    );
  }

  return lines.join('\n');
}

function updateReadme(models) {
  let readme = fs.readFileSync(README_PATH, 'utf8');
  const newTable = generateReadmeTable(models);

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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const apiModels = await fetchModels();

    // Load existing models.json for metadata preservation
    const existingModels = loadJson(MODELS_JSON_PATH);
    const existingModelsMap = {};
    for (const m of Array.isArray(existingModels) ? existingModels : []) {
      existingModelsMap[m.id] = m;
    }

    // Transform API models, preserving existing data where available
    let models = apiModels.map(m =>
      transformApiModel(m, existingModelsMap)
    );

    // Keep models from models.json that are NOT in the API response
    // (e.g. deprecated but still usable models)
    const apiIds = new Set(apiModels.map(m => m.id));
    for (const existing of Object.values(existingModelsMap)) {
      if (!apiIds.has(existing.id)) {
        models.push(existing);
      }
    }

    // Sort: reasoning models first, then alphabetically
    models.sort((a, b) => {
      if (a.reasoning !== b.reasoning) return b.reasoning - a.reasoning;
      return a.name.localeCompare(b.name);
    });

    // Save models.json
    saveJson(MODELS_JSON_PATH, models);

    // Update README
    updateReadme(models);

    // Summary
    const newIds = new Set(models.map(m => m.id));
    const oldIds = new Set(Object.keys(existingModelsMap));
    const added = [...newIds].filter(id => !oldIds.has(id));
    const removed = [...oldIds].filter(id => !newIds.has(id));

    console.log('\n--- Summary ---');
    console.log(`Total models: ${models.length}`);
    console.log(`Reasoning models: ${models.filter(m => m.reasoning).length}`);
    if (added.length > 0) console.log(`New models: ${added.join(', ')}`);
    if (removed.length > 0) console.log(`Removed models: ${removed.join(', ')}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
