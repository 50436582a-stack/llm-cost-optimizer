# LLM Cost Optimizer

Analyze your LLM API usage, calculate cost, and get actionable optimization recommendations in seconds.

Works with **OpenAI**, **Anthropic Claude**, **Google Gemini**, **DeepSeek**, **Qwen**, **Mistral**, and any OpenAI-compatible API.

## Quick start

```bash
npm install
npm run demo
```

Or pipe your own logs:

```bash
cat api_logs.jsonl | npx llm-cost analyze -
```

## Sample output

```
══════════════════════════════════════════════════════════════════════
  LLM COST ANALYSIS REPORT
══════════════════════════════════════════════════════════════════════

  Current spend            $12.95
  Potential monthly savings $4.54 (35.0%)
  Implementation effort      9 hours
  Top recommendation         Enable prompt caching

  ─── Spend by Model ───
  Model                                       Reqs        Cost       %
  claude-3-opus-20240229                        33       $7.87   60.8%
  gpt-4o                                        67       $2.23   17.2%
  claude-3-5-sonnet-20241022                    34       $1.49   11.5%
  o1-mini                                       33       $1.29   10.0%
  gpt-4o-mini                                   33       $0.07    0.5%

  ─── Optimization Recommendations ───

  #1 [MEDIUM] Enable prompt caching
     Only 6.5% of 200 requests use cached prefixes. ...
     Savings: $2.33/mo
     Action: Pass the same system prompt or context across requests...
     Effort: 2 hours

  #2 [MEDIUM] Switch gpt-4o to gpt-4o-mini for simpler tasks
     gpt-4o ($2.5/$10) costs 16.7x more than gpt-4o-mini...
     Savings: $1.56/mo
     Action: Route simple queries to gpt-4o-mini...
     Effort: 4 hours
```

## Features

- 📊 **Multi-model support** — OpenAI, Anthropic, Google, DeepSeek, Qwen, Mistral, more
- 💰 **Cache-aware cost calculation** — credits cached tokens at provider-specific discounts
- 🎯 **Actionable recommendations** — ranked by savings, with effort estimates
- 🌐 **Web dashboard** — visual analysis with charts (no backend needed)
- ⚡ **Streaming & reasoning tracking** — separate metrics for reasoning models (o1/o3)
- 🚨 **Error rate detection** — flags wasteful retry storms
- 📦 **JSON or JSONL input** — drop-in compatible with most log formats

## Web dashboard

```bash
npm run serve
# → http://localhost:8765
```

Upload a JSON/JSONL file in the browser to get instant analysis without sending data anywhere.

## Pricing accuracy

Pricing data is embedded in `src/pricing.js`, sourced from provider pricing pages. Last updated 2026-06-14.

## License

MIT
