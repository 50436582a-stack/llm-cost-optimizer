import { priceFor, resolveModel, PRICING, CACHE_DISCOUNT } from './pricing.js';

/**
 * Normalize a log entry into a canonical record.
 * Accepts: OpenAI chat.completion, Anthropic messages, or generic {model, tokens}.
 */
export function normalize(entry) {
  // OpenAI /v1/chat/completions style
  if (entry.model && entry.usage) {
    return {
      model: entry.model,
      timestamp: entry.created || entry.timestamp || Date.now() / 1000,
      inputTokens: entry.usage.prompt_tokens || 0,
      outputTokens: entry.usage.completion_tokens || 0,
      cachedInputTokens: entry.usage.prompt_tokens_details?.cached_tokens || 0,
      reasoningTokens: entry.usage.completion_tokens_details?.reasoning_tokens || 0,
      user: entry.user || entry.metadata?.user_id || 'unknown',
      requestId: entry.id || entry.request_id,
      latencyMs: entry.latency_ms,
      stream: entry.stream || false,
      raw: entry,
    };
  }
  // Anthropic messages style
  if (entry.model && (entry.input_tokens !== undefined || entry.output_tokens !== undefined)) {
    return {
      model: entry.model,
      timestamp: entry.timestamp || Date.now() / 1000,
      inputTokens: entry.input_tokens || 0,
      outputTokens: entry.output_tokens || 0,
      cachedInputTokens: entry.cache_read_input_tokens || 0,
      cacheWriteTokens: entry.cache_creation_input_tokens || 0,
      user: entry.user_id || 'unknown',
      requestId: entry.id,
      raw: entry,
    };
  }
  // Generic minimal shape
  if (entry.model) {
    return {
      model: entry.model,
      timestamp: entry.timestamp || Date.now() / 1000,
      inputTokens: entry.input_tokens || entry.prompt_tokens || 0,
      outputTokens: entry.output_tokens || entry.completion_tokens || 0,
      cachedInputTokens: entry.cached_tokens || 0,
      user: entry.user || 'unknown',
      raw: entry,
    };
  }
  return null;
}

/**
 * Calculate cost for a single record.
 */
export function costOf(record) {
  const price = priceFor(record.model);
  if (!price) return { cost: 0, unknown: true };
  
  const inputCost = (record.inputTokens / 1_000_000) * price.input;
  const outputCost = (record.outputTokens / 1_000_000) * price.output;
  
  // Apply cache discount if applicable
  let cachedCost = 0;
  if (record.cachedInputTokens > 0) {
    const discount = CACHE_DISCOUNT[price.provider] ?? 0.5;
    cachedCost = (record.cachedInputTokens / 1_000_000) * price.input * discount;
    // Cached cost REPLACES input cost for cached portion
    const nonCachedInput = record.inputTokens - record.cachedInputTokens;
    const total = (nonCachedInput / 1_000_000) * price.input + cachedCost + outputCost;
    return { cost: total, inputCost: (nonCachedInput / 1_000_000) * price.input, cachedCost, outputCost };
  }
  
  return { cost: inputCost + outputCost, inputCost, outputCost };
}

/**
 * Analyze an array of log records and return aggregated metrics.
 */
export function analyze(records) {
  const startTime = Date.now();
  const normalized = records.map(normalize).filter(Boolean);
  
  const byModel = new Map();
  const byUser = new Map();
  const byHour = new Map();
  const unknown = [];
  
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalRequests = 0;
  let cachedRequests = 0;
  let streamingRequests = 0;
  let errorCount = 0;
  let reasoningRequests = 0;
  
  for (const r of normalized) {
    if (r.raw.error || r.raw.status === 'error') {
      errorCount++;
      continue;
    }
    
    const price = priceFor(r.model);
    if (!price) {
      unknown.push(r.model);
      continue;
    }
    
    const c = costOf(r);
    totalCost += c.cost;
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalRequests++;
    if (r.cachedInputTokens > 0) cachedRequests++;
    if (r.stream) streamingRequests++;
    if (r.reasoningTokens > 0) reasoningRequests++;
    
    // By model
    if (!byModel.has(r.model)) {
      byModel.set(r.model, { model: r.model, requests: 0, inputTokens: 0, outputTokens: 0, cost: 0, tier: price.tier });
    }
    const m = byModel.get(r.model);
    m.requests++;
    m.inputTokens += r.inputTokens;
    m.outputTokens += r.outputTokens;
    m.cost += c.cost;
    
    // By user
    if (!byUser.has(r.user)) byUser.set(r.user, { user: r.user, requests: 0, cost: 0 });
    const u = byUser.get(r.user);
    u.requests++;
    u.cost += c.cost;
    
    // By hour bucket
    const hour = new Date(r.timestamp * 1000).toISOString().slice(0, 13) + ':00';
    if (!byHour.has(hour)) byHour.set(hour, { hour, requests: 0, cost: 0 });
    const h = byHour.get(hour);
    h.requests++;
    h.cost += c.cost;
  }
  
  return {
    totalCost,
    totalInput,
    totalOutput,
    totalRequests,
    cachedRequests,
    streamingRequests,
    reasoningRequests,
    errorCount,
    avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
    avgInputPerRequest: totalRequests > 0 ? totalInput / totalRequests : 0,
    avgOutputPerRequest: totalRequests > 0 ? totalOutput / totalRequests : 0,
    cacheHitRate: totalRequests > 0 ? cachedRequests / totalRequests : 0,
    byModel: Array.from(byModel.values()).sort((a, b) => b.cost - a.cost),
    byUser: Array.from(byUser.values()).sort((a, b) => b.cost - a.cost),
    byHour: Array.from(byHour.values()).sort((a, b) => a.hour.localeCompare(b.hour)),
    unknownModels: Array.from(new Set(unknown)),
    analysisTimeMs: Date.now() - startTime,
  };
}

export { resolveModel, PRICING };
