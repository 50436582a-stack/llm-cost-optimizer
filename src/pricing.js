// LLM pricing data, last updated 2026-06-14
// Prices in USD per 1M tokens (input / output)
// Source: provider pricing pages

export const PRICING = {
  // OpenAI
  'gpt-4o':         { input: 2.50,  output: 10.00, provider: 'openai',   tier: 'flagship' },
  'gpt-4o-mini':    { input: 0.15,  output: 0.60,  provider: 'openai',   tier: 'mini' },
  'gpt-4.1':        { input: 2.00,  output: 8.00,  provider: 'openai',   tier: 'flagship' },
  'gpt-4.1-mini':   { input: 0.40,  output: 1.60,  provider: 'openai',   tier: 'mini' },
  'gpt-4.1-nano':   { input: 0.10,  output: 0.40,  provider: 'openai',   tier: 'nano' },
  'o1':             { input: 15.00, output: 60.00, provider: 'openai',   tier: 'reasoning' },
  'o1-mini':        { input: 3.00,  output: 12.00, provider: 'openai',   tier: 'reasoning-mini' },
  'o3':             { input: 10.00, output: 40.00, provider: 'openai',   tier: 'reasoning' },
  'o3-mini':        { input: 1.10,  output: 4.40,  provider: 'openai',   tier: 'reasoning-mini' },
  'o4-mini':        { input: 1.10,  output: 4.40,  provider: 'openai',   tier: 'reasoning-mini' },

  // Anthropic
  'claude-3-7-sonnet-20250219':  { input: 3.00,  output: 15.00, provider: 'anthropic', tier: 'flagship' },
  'claude-3-5-sonnet-20241022':  { input: 3.00,  output: 15.00, provider: 'anthropic', tier: 'flagship' },
  'claude-3-5-haiku-20241022':   { input: 0.80,  output: 4.00,  provider: 'anthropic', tier: 'mini' },
  'claude-3-haiku-20240307':     { input: 0.25,  output: 1.25,  provider: 'anthropic', tier: 'mini' },
  'claude-3-opus-20240229':      { input: 15.00, output: 75.00, provider: 'anthropic', tier: 'flagship' },

  // Google
  'gemini-2.0-flash':           { input: 0.10,  output: 0.40,  provider: 'google',   tier: 'mini' },
  'gemini-2.5-pro':             { input: 1.25,  output: 10.00, provider: 'google',   tier: 'flagship' },
  'gemini-2.5-flash':           { input: 0.30,  output: 2.50,  provider: 'google',   tier: 'mini' },

  // DeepSeek (cheap Chinese model)
  'deepseek-chat':              { input: 0.14,  output: 0.28,  provider: 'deepseek', tier: 'mini' },
  'deepseek-reasoner':          { input: 0.55,  output: 2.19,  provider: 'deepseek', tier: 'reasoning' },

  // Qwen (cheap Chinese model)
  'qwen-plus':                  { input: 0.40,  output: 1.20,  provider: 'alibaba',  tier: 'mini' },
  'qwen-turbo':                 { input: 0.05,  output: 0.20,  provider: 'alibaba',  tier: 'nano' },
  'qwen-max':                   { input: 2.00,  output: 6.00,  provider: 'alibaba',  tier: 'flagship' },

  // Mistral
  'mistral-large-latest':       { input: 2.00,  output: 6.00,  provider: 'mistral',  tier: 'flagship' },
  'mistral-small-latest':       { input: 0.20,  output: 0.60,  provider: 'mistral',  tier: 'mini' },
};

// Cached tokens are typically 50-90% cheaper than regular input
export const CACHE_DISCOUNT = {
  openai: 0.5,     // 50% off cached input
  anthropic: 0.1,  // 90% off cached (Anthropic writes)
  google: 0.25,    // 75% off
};

// Aliases for fuzzy matching
export const ALIASES = {
  'gpt4': 'gpt-4o',
  'gpt-4': 'gpt-4o',
  'gpt4o': 'gpt-4o',
  'gpt4o-mini': 'gpt-4o-mini',
  'claude': 'claude-3-5-sonnet-20241022',
  'claude-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-haiku': 'claude-3-5-haiku-20241022',
  'sonnet': 'claude-3-5-sonnet-20241022',
  'haiku': 'claude-3-5-haiku-20241022',
  'opus': 'claude-3-opus-20240229',
};

export function resolveModel(name) {
  if (!name) return null;
  const norm = String(name).toLowerCase().trim();
  if (PRICING[norm]) return norm;
  if (ALIASES[norm]) return ALIASES[norm];
  // Try partial match
  for (const key of Object.keys(PRICING)) {
    if (key.includes(norm) || norm.includes(key)) return key;
  }
  return null;
}

export function priceFor(model) {
  const key = resolveModel(model);
  if (!key) return null;
  return PRICING[key];
}
