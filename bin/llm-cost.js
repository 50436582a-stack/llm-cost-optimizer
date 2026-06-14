#!/usr/bin/env node
import { readFileSync } from 'fs';
import { analyze } from '../src/analyzer.js';
import { recommend, summarize } from '../src/recommendations.js';
import { PRICING, resolveModel } from '../src/pricing.js';

const USAGE = `llm-cost - LLM API usage cost analyzer and optimizer

Usage:
  llm-cost analyze <file>     Analyze a JSON/JSONL log file
  llm-cost demo               Run on a built-in demo dataset
  llm-cost price [model]      Show pricing for a model (or list all)
  llm-cost help               Show this help

Log format:
  Each line is a JSON object. Accepts OpenAI chat.completion shape,
  Anthropic messages shape, or generic {model, input_tokens, output_tokens}.

Example:
  cat api_logs.jsonl | llm-cost analyze -
  llm-cost analyze logs.json
`;

function parseStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

async function loadRecords(path) {
  let raw;
  if (path === '-' || !path) {
    raw = await parseStdin();
  } else {
    raw = readFileSync(path, 'utf-8');
  }
  raw = raw.trim();
  if (!raw) return [];
  if (raw.startsWith('{') && raw.includes('\n{')) {
    return raw.split('\n').filter(Boolean).map((line, i) => {
      try { return JSON.parse(line); }
      catch (e) { throw new Error(`Line ${i + 1} not valid JSON: ${e.message}`); }
    });
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    throw new Error(`Input not valid JSON or JSONL: ${e.message}`);
  }
}

const fmtUsd = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtNum = n => n.toLocaleString();
const c = (s, code) => process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;

function report(analysis, recs, format = 'text') {
  const summary = summarize(analysis, recs);
  
  if (format === 'json') {
    console.log(JSON.stringify({ analysis, recommendations: recs, summary }, null, 2));
    return;
  }
  
  console.log('');
  console.log(c('═'.repeat(70), '1'));
  console.log(c('  LLM COST ANALYSIS REPORT', '1;36'));
  console.log(c('═'.repeat(70), '1'));
  console.log('');
  
  console.log(c('  Current spend', '33'), '          ', c(fmtUsd(analysis.totalCost), '1;33'));
  console.log(c('  Potential monthly savings', '33'), c(fmtUsd(summary.potentialMonthlySavings) + ` (${summary.savingsPercent.toFixed(1)}%)`, '1;32'));
  console.log(c('  Implementation effort', '33'), '    ', `${summary.implementationHours} hours`);
  console.log(c('  Top recommendation', '33'), '       ', c(summary.topRecommendation, '1'));
  console.log('');
  
  console.log(c('  ─── Usage Summary ───', '1;36'));
  console.log(`  Total requests:        ${fmtNum(analysis.totalRequests)}`);
  console.log(`  Input tokens:          ${fmtNum(analysis.totalInput)}`);
  console.log(`  Output tokens:         ${fmtNum(analysis.totalOutput)}`);
  console.log(`  Avg cost/request:      ${fmtUsd(analysis.avgCostPerRequest)}`);
  console.log(`  Cache hit rate:        ${(analysis.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`  Streaming requests:    ${fmtNum(analysis.streamingRequests)}`);
  console.log(`  Reasoning requests:    ${fmtNum(analysis.reasoningRequests)}`);
  console.log(`  Error requests:        ${fmtNum(analysis.errorCount)}`);
  console.log('');
  
  if (analysis.byModel.length > 0) {
    console.log(c('  ─── Spend by Model ───', '1;36'));
    console.log(c('  ' + 'Model'.padEnd(40) + 'Reqs'.padStart(8) + 'Cost'.padStart(12) + '%'.padStart(8), '2'));
    for (const m of analysis.byModel.slice(0, 10)) {
      const pct = analysis.totalCost > 0 ? (m.cost / analysis.totalCost * 100).toFixed(1) : '0.0';
      console.log(`  ${m.model.padEnd(40)}${fmtNum(m.requests).padStart(8)}${fmtUsd(m.cost).padStart(12)}${pct.padStart(7)}%`);
    }
    console.log('');
  }
  
  if (analysis.byUser.length > 0) {
    console.log(c('  ─── Top Users by Spend ───', '1;36'));
    for (const u of analysis.byUser.slice(0, 5)) {
      console.log(`  ${u.user.padEnd(30)}${fmtUsd(u.cost).padStart(12)} (${fmtNum(u.requests)} reqs)`);
    }
    console.log('');
  }
  
  if (recs.length > 0) {
    console.log(c('  ─── Optimization Recommendations ───', '1;36'));
    recs.forEach((r, i) => {
      const sevColor = r.severity === 'high' ? '31' : r.severity === 'medium' ? '33' : '36';
      console.log('');
      console.log(`  ${c('#' + (i + 1) + ' [' + r.severity.toUpperCase() + ']', sevColor)} ${c(r.title, '1')}`);
      console.log(`     ${r.description}`);
      if (r.estimatedMonthlySavings > 0) {
        console.log(`     ${c('Savings:', '2')} ${c(fmtUsd(r.estimatedMonthlySavings) + '/mo', '1;32')}`);
      }
      console.log(`     ${c('Action:', '2')} ${r.action}`);
      console.log(`     ${c('Effort:', '2')} ${r.effortHours} hour${r.effortHours !== 1 ? 's' : ''}`);
    });
    console.log('');
  }
  
  console.log(c('═'.repeat(70), '1'));
  console.log('');
}

async function cmdAnalyze(args) {
  const path = args[0];
  if (!path) { console.error('Usage: llm-cost analyze <file>'); process.exit(1); }
  const records = await loadRecords(path);
  if (records.length === 0) { console.error('No records found in input'); process.exit(1); }
  const analysis = analyze(records);
  const recs = recommend(analysis);
  report(analysis, recs, args.includes('--json') ? 'json' : 'text');
}

async function cmdDemo() {
  const demo = await loadRecords(new URL('../examples/demo-logs.jsonl', import.meta.url).pathname);
  const analysis = analyze(demo);
  const recs = recommend(analysis);
  report(analysis, recs);
}

function cmdPrice(args) {
  const name = args[0];
  if (!name) {
    console.log('Available models:');
    for (const k of Object.keys(PRICING).sort()) {
      console.log(`  ${k.padEnd(40)} $${PRICING[k].input.toFixed(2)} / $${PRICING[k].output.toFixed(2)} per 1M tokens (${PRICING[k].provider})`);
    }
    return;
  }
  const key = resolveModel(name);
  if (!key) { console.error(`Unknown model: ${name}`); process.exit(1); }
  const p = PRICING[key];
  console.log(`${key} (${p.provider}, ${p.tier})`);
  console.log(`  Input:  $${p.input.toFixed(4)} per 1M tokens`);
  console.log(`  Output: $${p.output.toFixed(4)} per 1M tokens`);
}

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);
  switch (cmd) {
    case 'analyze': return cmdAnalyze(args);
    case 'demo':    return cmdDemo();
    case 'price':   return cmdPrice(args);
    case 'help':
    case '--help':
    case '-h':
    case undefined:  console.log(USAGE); return;
    default:
      console.error(`Unknown command: ${cmd}\n${USAGE}`);
      process.exit(1);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
