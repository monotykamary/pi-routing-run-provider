#!/usr/bin/env node
/**
 * Update Routing.Run models by scraping the public models page.
 *
 * Scrapes https://routing.run/models (public, no API key required) and updates:
 * - models.json: Provider model definitions (with pricing, reasoning, compat)
 * - README.md: Model table in the Available Models section
 *
 * The page renders model data inside a <astro-island> component. Currently it
 * uses a "ModelsMasonry" component whose props contain the full model catalog
 * as an array. This gives us the complete catalog regardless of plan tier.
 *
 * Previous versions used individual "ProfileCard" components — if the page
 * structure changes again, the script tries both patterns and warns clearly.
 *
 * patch.json and custom-models.json are applied at runtime by the provider.
 * They are NOT baked into models.json, but ARE used to generate the README table.
 *
 * No API key required. No authentication needed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODELS_PAGE_URL = 'https://routing.run/models';
const MODELS_JSON_PATH = path.join(__dirname, '..', 'models.json');
const PATCH_JSON_PATH = path.join(__dirname, '..', 'patch.json');
const CUSTOM_MODELS_JSON_PATH = path.join(__dirname, '..', 'custom-models.json');
const README_PATH = path.join(__dirname, '..', 'README.md');

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout, retries, and exponential backoff.
 * Follows redirects automatically (node fetch does this by default).
 */
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      const isAbort = error.name === 'AbortError';
      if (attempt < retries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const reason = isAbort ? 'timeout' : error.message;
        console.warn(
          `⚠ Attempt ${attempt}/${retries} failed (${reason}). Retrying in ${delay}ms...`
        );
        await sleep(delay);
      }
    }
  }
  throw new Error(
    `Failed to fetch ${url} after ${retries} attempts: ${lastError.message}`
  );
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
 * Extract models from the ModelsMasonry component's props.
 * The props look like: {"models":[1,[[0,{...}],[0,{...}],...]]}
 * Each model object uses the same astro props format internally.
 */
function extractModelsFromMasonry(propsStr) {
  const decoded = propsStr
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const parsed = JSON.parse(decoded);
  const modelsRaw = parsed.models;
  if (!Array.isArray(modelsRaw) || modelsRaw.length < 2) {
    throw new Error('ModelsMasonry props has unexpected "models" format');
  }

  // modelsRaw is [1, [[0, {modelProps}], [0, {modelProps}], ...]]
  const modelsArray = modelsRaw[1];
  if (!Array.isArray(modelsArray)) {
    throw new Error('Models array is not an array');
  }

  const models = [];
  for (const entry of modelsArray) {
    if (!Array.isArray(entry) || entry.length < 2) {
      console.warn('⚠ Skipping malformed model entry');
      continue;
    }
    // entry is [0, {key: [type, value], ...}]
    const modelProps = entry[1];
    if (typeof modelProps !== 'object' || modelProps === null) {
      console.warn('⚠ Skipping model with non-object props');
      continue;
    }
    // Decode the nested astro props format for each model
    const model = {};
    for (const [key, val] of Object.entries(modelProps)) {
      if (Array.isArray(val) && val.length >= 2) {
        model[key] = val[1];
      } else {
        model[key] = val;
      }
    }
    models.push(model);
  }

  return models;
}

/**
 * Extract models from individual ProfileCard astro-islands (legacy format).
 * Each island looks like: <astro-island ... component-url="...ProfileCard..." props="..." ...>
 */
function extractModelsFromProfileCards(html) {
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
      console.warn(`⚠ Failed to parse ProfileCard props: ${e.message}`);
    }
  }

  return models;
}

/**
 * Fetch the models page and extract model data.
 * Tries the current ModelsMasonry format first, then falls back to
 * the legacy ProfileCard format.
 */
async function scrapeModels() {
  console.log(`Fetching models page: ${MODELS_PAGE_URL}...`);
  const response = await fetchWithRetry(MODELS_PAGE_URL);

  const html = await response.text();
  console.log(`✓ Fetched page (${(html.length / 1024).toFixed(0)} KB)`);

  // Strategy 1: Find ModelsMasonry component with models array
  const masonryPattern = /<astro-island[^>]*component-export="ModelsMasonry"[^>]*props="([^"]*)"[^>]*>/;
  const masonryMatch = masonryPattern.exec(html);

  if (masonryMatch) {
    try {
      const models = extractModelsFromMasonry(masonryMatch[1]);
      if (models.length > 0) {
        console.log(`✓ Extracted ${models.length} models from ModelsMasonry component`);
        return models;
      }
    } catch (e) {
      console.warn(`⚠ ModelsMasonry parsing failed: ${e.message}`);
    }
  }

  // Strategy 2: Find individual ProfileCard islands (legacy format)
  const profileModels = extractModelsFromProfileCards(html);
  if (profileModels.length > 0) {
    console.log(`✓ Extracted ${profileModels.length} models from ProfileCard components (legacy format)`);
    return profileModels;
  }

  // Strategy 3: Try a broader match for any astro-island with a "models" prop key
  const broadPattern = /<astro-island[^>]*props="\{&quot;models&quot;:[^"]*"[^>]*>/;
  const broadMatch = broadPattern.exec(html);
  if (broadMatch) {
    console.warn('⚠ Found astro-island with models data but unrecognized component name. Attempting extraction...');
    try {
      const propsStr = broadMatch[0].match(/props="([^"]*)"/)?.[1];
      if (propsStr) {
        const models = extractModelsFromMasonry(propsStr);
        if (models.length > 0) {
          console.log(`✓ Extracted ${models.length} models from fallback astro-island`);
          return models;
        }
      }
    } catch (e) {
      console.warn(`⚠ Fallback extraction failed: ${e.message}`);
    }
  }

  throw new Error(
    'No model data found on the page. The page structure may have changed.\n' +
    '  Searched for: ModelsMasonry component, ProfileCard components, or any astro-island with "models" prop.\n' +
    '  Check https://routing.run/models manually and update the scraping logic.'
  );
}

// ─── Context parsing ─────────────────────────────────────────────────────────

/**
 * Parse context strings like "131K", "1M", "262144", "200K", "164K", "256K", "100K".
 * Returns null for "N/A" or other unparseable strings.
 * Uses *1024 for K/M suffixes to match observed API values (e.g. "131K" → 131072).
 */
function parseContext(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s || s === 'N/A' || s === '-') return null;

  if (s.endsWith('M')) {
    return Math.round(parseFloat(s) * 1_000_000);
  }
  if (s.endsWith('K')) {
    return Math.round(parseFloat(s) * 1024);
  }
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

// ─── Model type detection ────────────────────────────────────────────────────

/**
 * Determine if a model is a chat/completion LLM (vs embedding, reranker,
 * image gen, TTS, STT, etc.). Non-LLM models get filtered out of models.json
 * since they can't be used with /v1/chat/completions.
 */
function isChatModel(card) {
  const id = (card.modelId || '').toLowerCase();
  const provider = (card.provider || '').toLowerCase();

  // Known non-chat providers
  if (['elevenlabs', 'bfl', 'stability', 'tencent'].includes(provider)) return false;

  // Known non-chat model name patterns
  const nonChatPatterns = [
    /embed/i,       // embeddings: cohere-embed-*, qwen3-embedding-*
    /rerank/i,      // rerankers: cohere-rerank-*
    /-image-/i,     // image gen: qwen-image-*, (but not image in model name like "GLM 5 Image")
    /tts/i,
    /speak/i,
    /whisper/i,     // STT
    /scribe/i,      // STT
    /flux/i,        // image gen
    /diffusion/i,   // image gen
    /hunyuan/i,     // image gen
    /eleven-/i,     // TTS
    /qwen-image/i,  // image gen
  ];

  for (const pattern of nonChatPatterns) {
    if (pattern.test(id)) return false;
  }

  // If context is "N/A" and no pricing, likely not a chat model
  const ctx = (card.context || '').trim();
  if ((ctx === 'N/A' || ctx === '') && !card.inputPrice && !card.outputPrice) {
    return false;
  }

  return true;
}

// ─── Transform scraped model → models.json entry ────────────────────────────

function transformScrapedModel(card, existingModelsMap) {
  const id = card.modelId;

  if (!id || !id.startsWith('route/')) {
    console.warn(`⚠ Skipping model with invalid ID: ${id}`);
    return null;
  }

  // Preserve existing curated data (reasoning, thinkingFormat, compat, etc.)
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

  // New model — build from scraped data + sensible defaults
  const contextWindow = parseContext(card.context) || 131072;
  const maxTokens = parseContext(card.outputContext) || contextWindow;

  const model = {
    id,
    name: card.name || id,
    reasoning: false,
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

  return model;
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

  // Also update model count lines
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cards = await scrapeModels();

  // Filter out non-chat models (embeddings, rerankers, image gen, TTS, STT)
  const chatCards = cards.filter(isChatModel);
  const filteredCount = cards.length - chatCards.length;
  if (filteredCount > 0) {
    console.log(`✓ Filtered out ${filteredCount} non-chat models (embeddings, rerankers, image gen, TTS, STT)`);
  }

  // Validate we got a reasonable number of models
  if (chatCards.length < MIN_MODELS_EXPECTED) {
    throw new Error(
      `Only ${chatCards.length} chat models found (expected at least ${MIN_MODELS_EXPECTED}). ` +
      `The page structure may have changed or there may be a scraping issue.`
    );
  }

  // Load existing models.json for metadata preservation
  const existingModels = loadJson(MODELS_JSON_PATH);
  const existingModelsMap = {};
  for (const m of Array.isArray(existingModels) ? existingModels : []) {
    existingModelsMap[m.id] = m;
  }

  // Transform scraped cards
  let models = chatCards
    .map(c => transformScrapedModel(c, existingModelsMap))
    .filter(m => m !== null);

  // Keep models from models.json that are NOT on the page at all
  // (e.g. removed from catalog but still usable, or custom models)
  // Use ALL page IDs (including non-chat) so we don't re-add models
  // that the page still has but were correctly filtered as non-chat.
  const allPageIds = new Set(cards.map(c => c.modelId));
  for (const existing of Object.values(existingModelsMap)) {
    if (!allPageIds.has(existing.id)) {
      models.push(existing);
    }
  }

  // Sort: reasoning first, then alphabetically
  models.sort((a, b) => {
    if (a.reasoning !== b.reasoning) return b.reasoning - a.reasoning;
    return a.name.localeCompare(b.name);
  });

  // Save models.json (pure API output, no patch/custom baked in)
  saveJson(MODELS_JSON_PATH, models);

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
  console.log(`Total models on page: ${cards.length} (${chatCards.length} chat, ${filteredCount} non-chat)`);
  console.log(`Total models in models.json: ${models.length}`);
  console.log(`Reasoning models: ${models.filter(m => m.reasoning).length}`);
  console.log(`Non-reasoning models: ${models.filter(m => !m.reasoning).length}`);
  if (added.length > 0) console.log(`New models: ${added.join(', ')}`);
  if (removed.length > 0) console.log(`Removed from page (preserved in models.json): ${removed.join(', ')}`);

  // List models with pricing
  console.log('\nModels (with pricing):');
  for (const m of models) {
    const r = m.reasoning ? '🧠' : '  ';
    const in$ = m.cost.input > 0 ? `$${m.cost.input.toFixed(3)}` : '—';
    const out$ = m.cost.output > 0 ? `$${m.cost.output.toFixed(3)}` : '—';
    console.log(`  ${r} ${m.id.padEnd(38)} in:${in$.padStart(8)}  out:${out$.padStart(8)}  ctx:${formatContext(m.contextWindow).padStart(5)}`);
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
