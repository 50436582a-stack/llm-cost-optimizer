#!/usr/bin/env node
// Web server + crypto payment processor
import { createServer } from 'http';
import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { analyze } from '../src/analyzer.js';
import { recommend, summarize } from '../src/recommendations.js';
import { createDepositAddress, checkUsdcPayment, generateOrderId } from '../src/payment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 8765;
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || '';
const PAYOUT_ADDRESS = process.env.PAYOUT_ADDRESS || '0x536DC8Eb3463a9Eb7f040E46421eb275fce30402';
const ORDERS_FILE = '/tmp/llm-cost-orders.json';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

async function loadOrders() {
  try {
    const data = await readFile(ORDERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return { orders: [] };
  }
}

async function saveOrders(orders) {
  await writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

async function serveFile(req, res, filePath) {
  try {
    const data = await readFile(filePath);
    const type = TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // === HEALTH ===
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), orders: (await loadOrders()).orders.length }));
  }
  
  // === ANALYZE ===
  if (url.pathname === '/api/analyze' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const text = body.trim();
      let records;
      if (text.startsWith('{') && text.includes('\n{')) {
        records = text.split('\n').filter(Boolean).map(l => JSON.parse(l));
      } else {
        const parsed = JSON.parse(text);
        records = Array.isArray(parsed) ? parsed : [parsed];
      }
      const analysis = analyze(records);
      const recs = recommend(analysis);
      const summary = summarize(analysis, recs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ analysis, recommendations: recs, summary }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  
  // === CREATE ORDER (crypto payment) ===
  if (url.pathname === '/api/order' && req.method === 'POST') {
    const body = await readBody(req);
    let input;
    try { input = JSON.parse(body); } catch (e) { input = {}; }
    const product = input.product || 'pro-license';
    const amount = parseFloat(input.amount) || 49;
    
    const deposit = createDepositAddress();
    const orderId = generateOrderId();
    const order = {
      id: orderId,
      product,
      amountUsdc: amount,
      depositAddress: deposit.address,
      depositPrivateKey: deposit.privateKey,  // We keep this to sweep later
      payoutAddress: PAYOUT_ADDRESS,
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 86400, // 24h
      paid: false,
      chains: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'],
      contactEmail: input.email || null,
    };
    
    const data = await loadOrders();
    data.orders.push(order);
    await saveOrders(data);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      orderId: order.id,
      depositAddress: order.depositAddress,
      amountUsdc: order.amountUsdc,
      chains: order.chains,
      expiresAt: order.expiresAt,
      // Note: never expose privateKey
    }));
  }
  
  // === CHECK ORDER ===
  if (url.pathname.startsWith('/api/order/') && req.method === 'GET') {
    const orderId = url.pathname.split('/').pop();
    const data = await loadOrders();
    const order = data.orders.find(o => o.id === orderId);
    if (!order) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Order not found' }));
    }
    
    // If not paid, check on-chain
    if (!order.paid && Date.now() / 1000 < order.expiresAt) {
      for (const chain of order.chains) {
        const payment = await checkUsdcPayment(chain, order.depositAddress, order.createdAt, order.amountUsdc, ETHERSCAN_KEY);
        if (payment) {
          order.paid = true;
          order.paidAt = payment.timestamp;
          order.paidChain = chain;
          order.paidTx = payment.txHash;
          order.deliveryKey = generateDeliveryKey(order.id);
          await saveOrders(data);
          break;
        }
      }
    }
    
    // Return safe info (no private key)
    return res.end(JSON.stringify({
      orderId: order.id,
      paid: order.paid,
      amountUsdc: order.amountUsdc,
      depositAddress: order.depositAddress,
      product: order.product,
      deliveryKey: order.deliveryKey || null,
      expiresAt: order.expiresAt,
    }));
  }
  
  // === STATIC FILES ===
  let filePath;
  if (url.pathname === '/') filePath = '/web/buy.html';
  else if (url.pathname === '/dashboard.html') filePath = '/web/dashboard.html';
  else if (url.pathname.startsWith('/web/')) filePath = url.pathname;
  else if (url.pathname.endsWith('.html')) filePath = '/web' + url.pathname;
  else filePath = url.pathname;
  const fullPath = join(ROOT, filePath);
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  try {
    const s = await stat(fullPath);
    if (s.isDirectory()) return serveFile(req, res, join(fullPath, 'index.html'));
    return serveFile(req, res, fullPath);
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
});

function generateDeliveryKey(orderId) {
  // Simple license key derived from orderId
  return 'LCO-' + orderId.slice(4, 12).toUpperCase() + '-' + Buffer.from(orderId).toString('base64').slice(0, 8).toUpperCase();
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LLM Cost Optimizer running at http://localhost:${PORT}`);
  console.log(`  Buy page:  http://localhost:${PORT}/buy.html`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`  API:       POST http://localhost:${PORT}/api/analyze`);
  console.log(`  Payments:  POST http://localhost:${PORT}/api/order`);
  console.log(`  Payout to: ${PAYOUT_ADDRESS}`);
});
