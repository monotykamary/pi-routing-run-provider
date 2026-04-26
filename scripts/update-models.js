#!/usr/bin/env node
/**
 * Update Routing.Run models by scraping the public models page.
 *
 * Scrapes https://routing.run/models (public, no API key required) and updates:
 * - models.json: Provider model definitions (with pricing, reasoning, compat)
 * - README.md: Model table in the Available Models section
 *
 * The page renders model cards as <astro-island> components whose props
 * contain the full model catalog (name, modelId, context, tiers, pricing, etc.).
 * This gives us the complete catalog regardless of plan tier.
 *
 * patch.json is applied at runtime by the provider — not baked into models.json.
 *
 * No API key required. No authentication needed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODELS_PAGE_URL = 'https://routing.run/models';
const MODELS_JSON_PATH = path.join(__dirname, '..', 'models.json');
const README_PATH = path.join(__dirname, '..', 'README.md');

// ─── Reasoning / thinking-format detection by model family ──────────────────
//
// Determined from known provider SDKs and routing.run documentation.
// "false" means we currently believe the model does NOT support extended
// thinking. Override via patch.json at runtime if proven otherwise.

const REASONING_CONFIG = {
  // DeepSeek — openai thinking format (thinking: {type: "enabled/disabled"})
  deepseek: { reasoning: true, thinkingFormat: 'openai' },
  // Kimi (Moonshot) — zai thinking format
  kimi: { reasoning: true, thinkingFormat: 'zai' },
  // GLM (Zhipu AI) — qwen-chat-template (chat_template_kwargs.enable_thinking)
  glm: { reasoning: true, thinkingFormat: 'qwen-chat-template' },
  // Qwen large MoE models — qwen top-level enable_thinking
  qwen: { reasoning: false }, // set per model below
  // MiniMax — typically qwen-compatible thinking
  minimax: { reasoning: true, thinkingFormat: 'qwen' },
  // MiMo (Xiaomi) — typically supports reasoning
  mimo: { reasoning: true, thinkingFormat: 'qwen' },
  // Google Gemma — openai thinking format
  gemma: { reasoning: true, thinkingFormat: 'openai' },
};

// Per-model reasoning overrides (modelId → { reasoning?, thinkingFormat? })
const REASONING_OVERRIDES = {
  'route/qwen3.5-9b': { reasoning: false },
  'route/qwen3.5-397b-a17b': { reasoning: true, thinkingFormat: 'qwen' },
  'route/qwen3.5-plus': { reasoning: true, thinkingFormat: 'qwen' },
  'route/qwen3.6-plus': { reasoning: true, thinkingFormat: 'qwen' },
  'route/deepseek-r1': { reasoning: true, thinkingFormat: 'openai' },
};

/**
 * Detect reasoning and thinking format for a model.
 */
function detectReasoning(modelId) {
  // Check explicit overrides first
  if (REASONING_OVERRIDES[modelId]) {
    return REASONING_OVERRIDES[modelId];
  }

  // Match by family prefix
  const slug = modelId.replace('route/', '');
  for (const [family, config] of Object.entries(REASONING_CONFIG)) {
    if (slug.startsWith(family)) {
      return config;
    }
  }

  return { reasoning: false };
}

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

// ─── Scrape models page ──────────────────────────────────────────────────────

/**
 * Parse Astro island props format: {"key":[0,"value"],"key2":[1,[...]],...}
 * The first array element is a type tag (0=string, 1=array), second is the value.
 */
function parseAstroProps(propsJson) {
  const raw = JSON.parse(propsJson);
  const model = {};
  for (const [key, val] of Object.entries(raw)) {
    if (Array.isArray(val) && val.length >= 2) {
      model[key] = val[1];
    } else {
      model[key] = val;
    }
  }
  return model;
}

/**
 * Fetch the models page and extract all ProfileCard astro-island props.
 */
async function scrapeModels() {
  console.log(`Fetching models page: ${MODELS_PAGE_URL}...`);
  const response = await fetch(MODELS_PAGE_URL);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  console.log(`✓ Fetched page (${(html.length / 1024).toFixed(0)} KB)`);

  // Extract all ProfileCard astro-island props
  // Pattern: <astro-island ... component-url="...ProfileCard..." props="..." ...>
  const propsPattern = /<astro-island[^>]*component-url="[^"]*ProfileCard[^"]*"[^>]*props="([^"]*)"[^>]*>/g;
  const models = [];
  let match;

  while ((match = propsPattern.exec(html)) !== null) {
    try {
      const propsStr = match[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      models.push(parseAstroProps(propsStr));
    } catch (e) {
      console.warn(`⚠ Failed to parse props: ${e.message}`);
    }
  }

  if (models.length === 0) {
    throw new Error('No model cards found on the page. The page structure may have changed.');
  }

  console.log(`✓ Extracted ${models.length} model cards`);
  return models;
}

// ─── Context parsing ─────────────────────────────────────────────────────────

/**
 * Parse context strings like "131K", "1M", "262144", "200K", "164K", "256K", "100K".
 * Uses *1024 for K/M suffixes to match observed API values (e.g. "131K" → 131072).
 */
function parseContext(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;

  if (s.endsWith('M')) {
    return Math.round(parseFloat(s) * 1_000_000);
  }
  if (s.endsWith('K')) {
    return Math.round(parseFloat(s) * 1024);
  }
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

// ─── Transform scraped model → models.json entry ────────────────────────────

function transformScrapedModel(card, existingModelsMap) {
  const id = card.modelId;

  // Preserve existing data if available (for compat override stability)
  if (existingModelsMap[id]) {
    const existing = { ...existingModelsMap[id] };

    // Update context from scrape
    const ctx = parseContext(card.context);
    if (ctx && ctx !== existing.contextWindow) {
      existing.contextWindow = ctx;
    }

    // Update maxTokens from outputContext if available
    const maxOut = parseContext(card.outputContext);
    if (maxOut && maxOut !== existing.maxTokens) {
      existing.maxTokens = maxOut;
    } else if (!existing.maxTokens) {
      existing.maxTokens = ctx || existing.contextWindow;
    }

    // Update pricing from scrape
    if (card.inputPrice) {
      existing.cost.input = parseFloat(card.inputPrice) || 0;
    }
    if (card.outputPrice) {
      existing.cost.output = parseFloat(card.outputPrice) || 0;
    }
    if (card.cachePrice) {
      existing.cost.cacheRead = parseFloat(card.cachePrice) || 0;
    }

    return existing;
  }

  // New model — build from scraped data
  const contextWindow = parseContext(card.context) || 131072;
  const maxTokens = parseContext(card.outputContext) || contextWindow;

  const { reasoning, thinkingFormat } = detectReasoning(id);

  const model = {
    id,
    name: card.name || id,
    reasoning,
    input: ['text'],
    cost: {
      input: parseFloat(card.inputPrice) || 0,
      output: parseFloat(card.outputPrice) || 0,
      cacheRead: parseFloat(card.cachePrice) || 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens,
    compat: {
      maxTokensField: 'max_tokens',
      supportsDeveloperRole: false,
      supportsStore: false,
    },
  };

  if (reasoning && thinkingFormat) {
    model.compat.thinkingFormat = thinkingFormat;
  }

  // Remove thinkingFormat from non-reasoning
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
  return `$${cost.toFixed(3)}`;
}

function generateReadmeTable(models) {
  const lines = [
    '| Model | Context | Max Output | Reasoning | Input $/M | Output $/M | Cache $/M |',
    '|-------|---------|------------|-----------|-----------|------------|-----------|',
  ];

  for (const model of models) {
    const context = formatContext(model.contextWindow);
    const maxOut = formatContext(model.maxTokens);
    const reasoning = model.reasoning ? '✅' : '❌';
    const inputCost = formatCost(model.cost.input);
    const outputCost = formatCost(model.cost.output);
    const cacheCost = formatCost(model.cost.cacheRead);

    lines.push(
      `| ${model.name} | ${context} | ${maxOut} | ${reasoning} | ${inputCost} | ${outputCost} | ${cacheCost} |`
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
    const cards = await scrapeModels();

    // Load existing models.json for metadata preservation
    const existingModels = loadJson(MODELS_JSON_PATH);
    const existingModelsMap = {};
    for (const m of Array.isArray(existingModels) ? existingModels : []) {
      existingModelsMap[m.id] = m;
    }

    // Transform scraped cards
    let models = cards.map(c =>
      transformScrapedModel(c, existingModelsMap)
    );

    // Keep models from models.json that are NOT on the page
    // (e.g. removed from catalog but still usable, or custom models)
    const pageIds = new Set(cards.map(c => c.modelId));
    for (const existing of Object.values(existingModelsMap)) {
      if (!pageIds.has(existing.id)) {
        models.push(existing);
      }
    }

    // Sort: reasoning first, then alphabetically
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
    console.log(`Non-reasoning models: ${models.filter(m => !m.reasoning).length}`);
    if (added.length > 0) console.log(`New models: ${added.join(', ')}`);
    if (removed.length > 0) console.log(`Removed from page: ${removed.join(', ')}`);

    // List models with pricing
    console.log('\nModels (with pricing):');
    for (const m of models) {
      const r = m.reasoning ? '🧠' : '  ';
      const in$ = m.cost.input > 0 ? `$${m.cost.input.toFixed(3)}` : '—';
      const out$ = m.cost.output > 0 ? `$${m.cost.output.toFixed(3)}` : '—';
      console.log(`  ${r} ${m.id.padEnd(38)} in:${in$.padStart(8)}  out:${out$.padStart(8)}  ctx:${formatContext(m.contextWindow).padStart(5)}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
