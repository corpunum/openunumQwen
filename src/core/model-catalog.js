const CATALOG_CONTRACT_VERSION = '2026-04-01.model-catalog.v1';
export const PROVIDER_ORDER = ['ollama', 'nvidia', 'openrouter', 'openai'];

const PROVIDER_LABELS = {
  ollama: 'Ollama',
  nvidia: 'Nvidia',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
};

const PROVIDER_ALIASES = {
  generic: 'openai',
  'ollama-cloud': 'ollama',
  'ollama-local': 'ollama',
};

const SEED_MODELS = {
  ollama: [
    seed('ollama', 'qwen3.5:397b-cloud', 'Qwen 3.5 397B Cloud', 262144, 100, 'medium', 'medium', true, false, true),
    seed('ollama', 'kimi-k2.5:cloud', 'Kimi K2.5 Cloud', 262144, 97, 'medium', 'medium', true, false, true),
    seed('ollama', 'glm-5:cloud', 'GLM-5 Cloud', 262144, 95, 'medium', 'medium', true, false, true),
    seed('ollama', 'minimax-m2.7:cloud', 'MiniMax M2.7 Cloud', 1048576, 94, 'high', 'medium', true, false, true),
    seed('ollama', 'minimax-m2.5:cloud', 'MiniMax M2.5 Cloud', 1048576, 92, 'high', 'medium', true, false, true),
    seed('ollama', 'qwen3.5:9b-262k', 'Qwen 3.5 9B 262K', 262144, 82, 'low', 'low', true, false, true),
    seed('ollama', 'qwen3.5:9b-128k', 'Qwen 3.5 9B 128K', 131072, 80, 'low', 'low', true, false, true),
    seed('ollama', 'qwen3.5:9b-64k', 'Qwen 3.5 9B 64K', 65536, 78, 'low', 'low', true, false, true),
  ],
  nvidia: [
    seed('nvidia', 'meta/llama-3.1-405b-instruct', 'Llama 3.1 405B Instruct', 131072, 96, 'high', 'high', true, false, true),
    seed('nvidia', 'qwen/qwen3.5-397b-a17b', 'Qwen 3.5 397B A17B', 131072, 94, 'high', 'high', true, false, true),
    seed('nvidia', 'llama-3.3-nemotron-super-49b-v1', 'Llama 3.3 Nemotron Super 49B', 131072, 91, 'medium', 'medium', true, false, true),
  ],
  openrouter: [
    seed('openrouter', 'anthropic/claude-3.5-sonnet', 'Claude 3.5 Sonnet', 200000, 97, 'medium', 'high', true, true, true),
    seed('openrouter', 'openai/gpt-4o-mini', 'GPT-4o Mini', 128000, 89, 'low', 'medium', true, true, true),
  ],
  openai: [
    seed('openai', 'gpt-5.4', 'GPT-5.4', 262144, 100, 'medium', 'high', true, true, true),
    seed('openai', 'gpt-5.3-codex', 'GPT-5.3 Codex', 262144, 98, 'medium', 'high', true, false, true),
  ],
};

function seed(provider, modelId, displayName, contextWindow, capabilityScore, latencyTier, costTier, supportsTools, supportsVision, supportsReasoning) {
  return {
    provider,
    model_id: modelId,
    display_name: displayName,
    context_window: contextWindow,
    supports_tools: supportsTools,
    supports_vision: supportsVision,
    supports_reasoning: supportsReasoning,
    latency_tier: latencyTier,
    cost_tier: costTier,
    capability_score: capabilityScore,
    rank: 0,
    canonical_key: canonicalKey(provider, modelId),
  };
}

export function normalizeProviderId(rawProvider) {
  const provider = String(rawProvider || 'ollama').trim().toLowerCase();
  return PROVIDER_ALIASES[provider] || (PROVIDER_ORDER.includes(provider) ? provider : 'ollama');
}

export function normalizeModelId(provider, rawModel) {
  const normalizedProvider = normalizeProviderId(provider);
  const model = String(rawModel || '').trim();
  if (!model) return '';

  const prefixes = [
    `${normalizedProvider}/`,
    `${String(provider || '').trim().toLowerCase()}/`,
    'generic/',
    'ollama-cloud/',
    'ollama-local/',
  ].filter(Boolean);

  for (const prefix of prefixes) {
    if (model.startsWith(prefix)) return model.slice(prefix.length);
  }

  return model;
}

export function canonicalKey(provider, modelId) {
  return `${normalizeProviderId(provider)}/${normalizeModelId(provider, modelId)}`;
}

function getProviderConnection(config, provider) {
  if (provider === 'ollama') return { baseUrl: config.ollamaBaseUrl, apiKey: config.ollamaApiKey };
  if (provider === 'nvidia') return { baseUrl: config.nvidiaBaseUrl, apiKey: config.nvidiaApiKey };
  if (provider === 'openrouter') return { baseUrl: config.openrouterBaseUrl, apiKey: config.openrouterApiKey };
  return { baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey };
}

function heuristicScore(modelId, displayName) {
  const text = `${modelId} ${displayName || ''}`.toLowerCase();
  if (text.includes('gpt-5.4')) return 100;
  if (text.includes('gpt-5.3-codex')) return 98;
  if (text.includes('claude-3.5-sonnet')) return 97;
  if (text.includes('405b')) return 96;
  if (text.includes('397b')) return 95;
  if (text.includes('glm-5')) return 94;
  if (text.includes('nemotron-super')) return 91;
  if (text.includes('gpt-4o-mini')) return 89;
  if (text.includes('9b-262k')) return 82;
  if (text.includes('9b-128k')) return 80;
  if (text.includes('9b-64k')) return 78;
  return 72;
}

function heuristicContext(modelId, fallback = 65536) {
  const text = String(modelId || '').toLowerCase();
  if (text.includes('1048576') || text.includes('m2.7') || text.includes('m2.5')) return 1048576;
  if (text.includes('262k')) return 262144;
  if (text.includes('200000')) return 200000;
  if (text.includes('128k')) return 131072;
  if (text.includes('64k')) return 65536;
  if (text.includes('405b') || text.includes('397b') || text.includes('gpt-5') || text.includes('claude-3.5')) return 131072;
  return fallback;
}

function makeModel(provider, modelId, displayName, partial = {}) {
  const normalizedProvider = normalizeProviderId(provider);
  const normalizedModelId = normalizeModelId(provider, modelId);
  const contextWindow = Number(partial.context_window || partial.contextWindow || heuristicContext(normalizedModelId, 65536));
  const capabilityScore = Number(partial.capability_score || heuristicScore(normalizedModelId, displayName));

  return {
    provider: normalizedProvider,
    model_id: normalizedModelId,
    display_name: displayName || normalizedModelId,
    context_window: contextWindow,
    supports_tools: partial.supports_tools ?? true,
    supports_vision: partial.supports_vision ?? /gpt-4o|gpt-5|claude/i.test(normalizedModelId),
    supports_reasoning: partial.supports_reasoning ?? true,
    latency_tier: partial.latency_tier || 'medium',
    cost_tier: partial.cost_tier || 'medium',
    capability_score: capabilityScore,
    rank: 0,
    canonical_key: canonicalKey(normalizedProvider, normalizedModelId),
  };
}

async function fetchRemoteModels(provider, config) {
  const connection = getProviderConnection(config, provider);
  const baseUrl = String(connection.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('base_url_missing');

  const headers = {};
  if (connection.apiKey && provider !== 'ollama') headers.Authorization = `Bearer ${connection.apiKey}`;

  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) throw new Error(`models_${response.status}`);
  const json = await response.json();
  const data = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : []);

  return data
    .map((item) => {
      const modelId = item.id || item.name || item.model || '';
      if (!modelId) return null;
      return makeModel(provider, modelId, item.name || modelId, {
        context_window: item.context_window || item.context_length,
        supports_tools: item.supports_tools,
        supports_vision: item.supports_vision,
        supports_reasoning: item.supports_reasoning,
      });
    })
    .filter(Boolean);
}

function sortAndRank(models) {
  return models
    .slice()
    .sort((a, b) => {
      if (b.capability_score !== a.capability_score) return b.capability_score - a.capability_score;
      if (b.context_window !== a.context_window) return b.context_window - a.context_window;
      if (a.display_name !== b.display_name) return a.display_name.localeCompare(b.display_name);
      return a.canonical_key.localeCompare(b.canonical_key);
    })
    .map((model, index) => ({ ...model, rank: index + 1 }));
}

function mergeModels(provider, remoteModels = []) {
  const merged = new Map();
  for (const model of SEED_MODELS[provider] || []) merged.set(model.canonical_key, { ...model });
  for (const model of remoteModels) {
    const existing = merged.get(model.canonical_key);
    merged.set(
      model.canonical_key,
      existing
        ? { ...existing, ...model, capability_score: Math.max(existing.capability_score, model.capability_score) }
        : model,
    );
  }
  return sortAndRank([...merged.values()]);
}

function selectedPointer(config, provider, modelId) {
  const resolvedProvider = normalizeProviderId(provider || config.provider);
  const resolvedModel = normalizeModelId(resolvedProvider, modelId || config.model || config.providerModels?.[resolvedProvider]);
  return {
    provider: resolvedProvider,
    model_id: resolvedModel,
    canonical_key: canonicalKey(resolvedProvider, resolvedModel),
  };
}

export async function buildModelCatalog(config) {
  const providers = [];

  for (const provider of PROVIDER_ORDER) {
    let status = 'healthy';
    let degradedReason = null;
    let remoteModels = [];

    try {
      remoteModels = await fetchRemoteModels(provider, config);
    } catch (error) {
      status = 'degraded';
      degradedReason = String(error.message || error);
    }

    providers.push({
      provider,
      display_name: PROVIDER_LABELS[provider],
      status,
      degraded_reason: degradedReason,
      models: mergeModels(provider, remoteModels),
    });
  }

  return {
    contract_version: CATALOG_CONTRACT_VERSION,
    generated_at: new Date().toISOString(),
    provider_order: [...PROVIDER_ORDER],
    selected: selectedPointer(config),
    fallback: selectedPointer(config, config.fallbackProvider, config.fallbackModel),
    providers,
  };
}

export async function buildLegacyProviderModels(config, provider) {
  const catalog = await buildModelCatalog(config);
  const requestedProvider = normalizeProviderId(provider || config.provider);
  return catalog.providers.find((entry) => entry.provider === requestedProvider)?.models || [];
}
