// Crypto payment module: generate one-time addresses, monitor payments
import { Wallet, getBytes, hexlify } from 'ethers';
import { randomBytes } from 'crypto';

// USDC contract addresses (Ethereum mainnet and L2s)
export const USDC_CONTRACTS = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base:     '0x833589fCD6eDbDbE98f4Fa9800174Bd66B10F50c',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  polygon:  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

// USDC has 6 decimals
const USDC_DECIMALS = 6;

/**
 * Create a new wallet (one-time-use deposit address).
 * Returns { address, privateKey }
 */
export function createDepositAddress() {
  const privateKey = '0x' + randomBytes(32).toString('hex');
  const wallet = new Wallet(privateKey);
  return {
    address: wallet.address,
    privateKey,
  };
}

/**
 * Check a USDC payment on a chain using Etherscan-compatible API.
 * Returns the matched transfer or null.
 */
export async function checkUsdcPayment(chain, address, sinceTimestampSec, expectedAmountUsdc, etherscanApiKey) {
  const chainIds = { ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137 };
  const baseUrls = {
    ethereum: 'https://api.etherscan.io/api',
    base: 'https://api.basescan.org/api',
    arbitrum: 'https://api.arbiscan.io/api',
    optimism: 'https://api-optimistic.etherscan.io/api',
    polygon: 'https://api.polygonscan.com/api',
  };
  
  const baseUrl = baseUrls[chain];
  if (!baseUrl) throw new Error(`Unknown chain: ${chain}`);
  
  const contract = USDC_CONTRACTS[chain];
  const apiKey = etherscanApiKey || 'YourApiKeyToken'; // Free tier works without key (rate-limited)
  
  // Get latest block number, then filter by address
  const url = `${baseUrl}?module=account&action=tokentx&contractaddress=${contract}&address=${address}&page=1&offset=10&sort=desc&apikey=${apiKey}`;
  
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== '1' || !Array.isArray(data.result)) return null;
    
    // Find matching transfer
    for (const tx of data.result) {
      const txTime = parseInt(tx.timeStamp);
      if (txTime < sinceTimestampSec) continue;
      const value = parseInt(tx.value) / Math.pow(10, USDC_DECIMALS);
      // Allow some tolerance for rounding
      if (Math.abs(value - expectedAmountUsdc) < 0.01) {
        return { txHash: tx.hash, from: tx.from, to: tx.to, value, timestamp: txTime, confirmations: tx.confirmations };
      }
    }
    return null;
  } catch (e) {
    console.error(`Etherscan check failed for ${chain}:`, e.message);
    return null;
  }
}

/**
 * Generate a unique order ID
 */
export function generateOrderId() {
  return 'ord_' + randomBytes(8).toString('hex');
}

/**
 * Verify order is paid
 */
export async function verifyPayment(order, etherscanApiKey) {
  for (const chain of Object.keys(USDC_CONTRACTS)) {
    const payment = await checkUsdcPayment(chain, order.depositAddress, order.createdAt, order.amountUsdc, etherscanApiKey);
    if (payment) return { paid: true, chain, ...payment };
  }
  return { paid: false };
}
