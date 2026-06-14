import { PRICING, resolveModel } from './pricing.js';

/**
 * Generate actionable cost optimization recommendations based on analysis.
 * Each recommendation includes: title, severity, savings estimate, description, action.
 */
export function recommend(analysis) {
  const recs = [];
  
  // 1. Check for caching opportunities
  if (analysis.cacheHitRate < 0.1 && analysis.totalRequests > 100) {
    const eligibleCost = estimateCacheEligibleCost(analysis);
    const savings = eligibleCost * 0.6; // Cache saves ~60% on repeated prefixes
    recs.push({
      severity: savings > 50 ? 'high' : 'medium',
      title: 'Enable prompt caching',
      description: `Only ${(analysis.cacheHitRate * 100).toFixed(1)}% of ${analysis.totalRequests} requests use cached prefixes. Most LLM providers offer 50-90% discounts on cached input tokens (Anthropic: 90% off, OpenAI: 50% off).`,
      estimatedMonthlySavings: savings,
      action: 'Pass the same system prompt or context across requests. For OpenAI, send cached portions in their own message. For Anthropic, mark cache_control breakpoints on long contexts.',
      effortHours: 2,
    });
  }
  
  // 2. Check for over-spec'd models
  for (const m of analysis.byModel) {
    const price = PRICING[m.model];
    if (!price) continue;
    
    // Find cheaper alternative in same provider
    const cheaper = Object.entries(PRICING)
      .filter(([k, p]) => p.provider === price.provider && p.tier === 'mini' && p.input < price.input)
      .map(([k, p]) => ({ model: k, input: p.input, output: p.output }));
    
    if (cheaper.length > 0 && price.tier === 'flagship' && m.requests > 50) {
      const savings = m.cost * 0.7; // Mini models typically save 70-90%
      const best = cheaper[0];
      recs.push({
        severity: savings > 100 ? 'high' : 'medium',
        title: `Switch ${m.model} to ${best.model} for simpler tasks`,
        description: `${m.model} ($${price.input}/$${price.output}) costs ${(price.input / best.input).toFixed(1)}x more than ${best.model} ($${best.input}/$${best.output}) per input token. Used in ${m.requests} requests totaling $${m.cost.toFixed(2)}.`,
        estimatedMonthlySavings: savings,
        action: `Route simple queries (classification, extraction, short completions) to ${best.model}. Use ${m.model} only for complex reasoning. Implement a router that classifies task difficulty first.`,
        effortHours: 4,
      });
    }
  }
  
  // 3. Check reasoning model overuse
  if (analysis.reasoningRequests > 0) {
    const reasoningCost = analysis.byModel
      .filter(m => PRICING[m.model]?.tier?.includes('reasoning'))
      .reduce((sum, m) => sum + m.cost, 0);
    if (reasoningCost > 20) {
      recs.push({
        severity: reasoningCost > 100 ? 'high' : 'medium',
        title: 'Reduce reasoning model usage',
        description: `${analysis.reasoningRequests} requests used reasoning-capable models (o1/o3/claude-reasoning), costing $${reasoningCost.toFixed(2)}. Reasoning models are 5-20x more expensive than regular models.`,
        estimatedMonthlySavings: reasoningCost * 0.5,
        action: 'Default to non-reasoning models. Only escalate to reasoning models when the task explicitly requires multi-step planning or math. Add a "needs_reasoning" flag to your routing layer.',
        effortHours: 3,
      });
    }
  }
  
  // 4. Check for high output-to-input ratio
  for (const m of analysis.byModel) {
    if (m.outputTokens > m.inputTokens * 5 && m.requests > 30) {
      const outputCost = (m.outputTokens / 1_000_000) * PRICING[m.model].output;
      const inputCost = (m.inputTokens / 1_000_000) * PRICING[m.model].input;
      const wasteIfShortened = outputCost * 0.3;
      recs.push({
        severity: wasteIfShortened > 20 ? 'medium' : 'low',
        title: `Reduce output length on ${m.model}`,
        description: `Output tokens (${m.outputTokens.toLocaleString()}) are ${(m.outputTokens / Math.max(m.inputTokens, 1)).toFixed(1)}x input tokens. Output is typically 3-5x more expensive than input.`,
        estimatedMonthlySavings: wasteIfShortened,
        action: 'Add max_tokens limits, request "concise" responses in system prompts, or use response streaming with early termination. Consider structured outputs (JSON schema) to constrain verbosity.',
        effortHours: 2,
      });
    }
  }
  
  // 5. Cross-provider recommendation if using only one provider at high cost
  const providerSpend = new Map();
  for (const m of analysis.byModel) {
    const p = PRICING[m.model]?.provider || 'unknown';
    providerSpend.set(p, (providerSpend.get(p) || 0) + m.cost);
  }
  const sortedProviders = Array.from(providerSpend.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedProviders.length === 1 && sortedProviders[0][1] > 50) {
    const [provider, cost] = sortedProviders[0];
    const altProvider = provider === 'openai' ? 'deepseek' : provider === 'anthropic' ? 'alibaba' : 'openai';
    const altCheapest = Object.entries(PRICING).filter(([, p]) => p.provider === altProvider).map(([, p]) => p).sort((a, b) => a.input - b.input)[0];
    if (altCheapest) {
      recs.push({
        severity: cost > 200 ? 'high' : 'medium',
        title: `Multi-provider failover to ${altProvider}`,
        description: `All $${cost.toFixed(2)} of LLM spend goes to ${provider}. ${altProvider} offers models starting at $${altCheapest.input}/$${altCheapest.output} per 1M tokens — typically 80%+ cheaper.`,
        estimatedMonthlySavings: cost * 0.4,
        action: `Add ${altProvider} as fallback for non-critical workloads. Many providers offer OpenAI-compatible APIs so integration is minimal.`,
        effortHours: 6,
      });
    }
  }
  
  // 6. Streaming recommendation
  if (analysis.streamingRequests === 0 && analysis.totalRequests > 50) {
    const interactiveCost = analysis.totalCost * 0.4; // Assume 40% of requests are interactive
    recs.push({
      severity: 'low',
      title: 'Enable streaming for interactive requests',
      description: 'No streaming detected. Streaming reduces time-to-first-token and improves UX but does not reduce cost. However, you may be able to cancel long-running requests earlier.',
      estimatedMonthlySavings: 0,
      action: 'Stream for chatbot/UIs. Allow user cancellation. Some providers give partial refund for cancelled requests.',
      effortHours: 1,
    });
  }
  
  // 7. Error retry cost
  if (analysis.errorCount > analysis.totalRequests * 0.05) {
    recs.push({
      severity: 'medium',
      title: 'High error rate detected',
      description: `${analysis.errorCount} errors out of ${analysis.totalRequests + analysis.errorCount} requests (${(analysis.errorCount / (analysis.totalRequests + analysis.errorCount) * 100).toFixed(1)}%). Each retry wastes tokens.`,
      estimatedMonthlySavings: analysis.totalCost * 0.05,
      action: 'Implement exponential backoff, max retry limits, and circuit breakers. Log error reasons to fix root causes.',
      effortHours: 2,
    });
  }
  
  // Sort by potential savings
  recs.sort((a, b) => (b.estimatedMonthlySavings || 0) - (a.estimatedMonthlySavings || 0));
  
  return recs;
}

function estimateCacheEligibleCost(analysis) {
  // Heuristic: ~30% of requests typically have cacheable prefixes
  return analysis.totalCost * 0.3;
}

export function summarize(analysis, recs) {
  const totalSavings = recs.reduce((sum, r) => sum + (r.estimatedMonthlySavings || 0), 0);
  const effortHours = recs.reduce((sum, r) => sum + (r.effortHours || 0), 0);
  return {
    currentMonthlyCost: analysis.totalCost,
    potentialMonthlySavings: totalSavings,
    savingsPercent: analysis.totalCost > 0 ? (totalSavings / analysis.totalCost) * 100 : 0,
    implementationHours: effortHours,
    topRecommendation: recs[0]?.title || 'No major optimizations found',
  };
}
