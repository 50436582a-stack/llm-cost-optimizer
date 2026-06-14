import { test } from 'node:test';
import assert from 'node:assert';
import { analyze, costOf, normalize } from '../src/analyzer.js';
import { recommend, summarize } from '../src/recommendations.js';
import { PRICING, resolveModel, priceFor } from '../src/pricing.js';

test('resolveModel handles aliases', () => {
  assert.strictEqual(resolveModel('gpt-4'), 'gpt-4o');
  assert.strictEqual(resolveModel('claude-sonnet'), 'claude-3-5-sonnet-20241022');
  assert.strictEqual(resolveModel('haiku'), 'claude-3-5-haiku-20241022');
  assert.strictEqual(resolveModel('unknown-model-xyz'), null);
});

test('normalize handles OpenAI shape', () => {
  const rec = normalize({
    model: 'gpt-4o',
    created: 1700000000,
    usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 20 } }
  });
  assert.strictEqual(rec.inputTokens, 100);
  assert.strictEqual(rec.outputTokens, 50);
  assert.strictEqual(rec.cachedInputTokens, 20);
});

test('normalize handles Anthropic shape', () => {
  const rec = normalize({
    model: 'claude-3-5-sonnet-20241022',
    timestamp: 1700000000,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 30
  });
  assert.strictEqual(rec.inputTokens, 100);
  assert.strictEqual(rec.outputTokens, 50);
  assert.strictEqual(rec.cachedInputTokens, 30);
});

test('costOf calculates OpenAI gpt-4o correctly', () => {
  const rec = { model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0 };
  const c = costOf(rec);
  // gpt-4o: $2.5/M input, $10/M output → $2.50 + $10.00 = $12.50
  assert.ok(Math.abs(c.cost - 12.5) < 0.01, `Expected $12.50, got ${c.cost}`);
});

test('costOf applies cache discount', () => {
  const rec = { model: 'claude-3-5-sonnet-20241022', inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 };
  const c = costOf(rec);
  // claude-sonnet: $3/M input, 10% cache discount
  // 1M * 0.10 * $3 = $0.30
  assert.ok(Math.abs(c.cost - 0.30) < 0.01, `Expected $0.30, got ${c.cost}`);
});

test('analyze aggregates by model and user', () => {
  const records = [
    { model: 'gpt-4o', created: 1700000000, user: 'alice', usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } } },
    { model: 'gpt-4o', created: 1700000001, user: 'bob', usage: { prompt_tokens: 200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 0 } } },
    { model: 'gpt-4o-mini', created: 1700000002, user: 'alice', usage: { prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } } }
  ];
  const a = analyze(records);
  assert.strictEqual(a.totalRequests, 3);
  assert.strictEqual(a.byModel.length, 2);
  assert.strictEqual(a.byUser.length, 2);
  assert.ok(a.byModel[0].model === 'gpt-4o'); // highest cost first
});

test('recommend flags caching opportunity', () => {
  const records = [];
  for (let i = 0; i < 200; i++) {
    records.push({
      model: 'gpt-4o',
      created: 1700000000 + i,
      user: 'u',
      usage: { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 0 } }
    });
  }
  const a = analyze(records);
  const recs = recommend(a);
  const cacheRec = recs.find(r => r.title.toLowerCase().includes('cach'));
  assert.ok(cacheRec, 'Should recommend caching');
});

test('summarize computes savings', () => {
  const records = [];
  for (let i = 0; i < 200; i++) {
    records.push({
      model: 'gpt-4o',
      created: 1700000000 + i,
      user: 'u',
      usage: { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 0 } }
    });
  }
  const a = analyze(records);
  const recs = recommend(a);
  const s = summarize(a, recs);
  assert.ok(s.potentialMonthlySavings > 0);
  assert.ok(s.savingsPercent > 0);
  assert.ok(s.savingsPercent <= 100);
});

test('PRICING has all major providers', () => {
  const providers = new Set(Object.values(PRICING).map(p => p.provider));
  assert.ok(providers.has('openai'));
  assert.ok(providers.has('anthropic'));
  assert.ok(providers.has('google'));
  assert.ok(providers.has('deepseek'));
  assert.ok(providers.has('alibaba'));
});

test('priceFor returns correct pricing', () => {
  const p = priceFor('gpt-4o');
  assert.strictEqual(p.provider, 'openai');
  assert.strictEqual(p.input, 2.5);
  assert.strictEqual(p.output, 10.0);
});
