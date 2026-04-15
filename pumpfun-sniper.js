/**
 * PUMP.FUN SNIPER BOT
 * ═══════════════════════════════════════════════════════════════
 * Strategy: Monitor pump.fun for new token launches via WebSocket.
 *           Filter by momentum signals. Buy early, exit fast.
 *
 * SETUP:
 *   npm install @solana/web3.js node-fetch dotenv bs58 ws
 *
 * CONFIG:
 *   Create a .env file:
 *     PRIVATE_KEY=your_base58_private_key
 *     RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
 *
 * RUN:
 *   node pumpfun-sniper.js
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const { Connection, Keypair, VersionedTransaction, PublicKey } = require('@solana/web3.js');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const bs58 = require('bs58');
const fs = require('fs');

// ─── CONFIG ────────────────────────────────────────────────────

const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  SOL_PER_SNIPE: 0.05,
  MAX_CONCURRENT_POSITIONS: 5,
  MAX_TOTAL_SPENT_SOL: 0.5,
  TAKE_PROFIT_PCT: 1.50,
  STOP_LOSS_PCT: 0.50,
  MAX_HOLD_SECONDS: 300,
  MIN_INITIAL_BUY_SOL: 0.5,
  MIN_UNIQUE_BUYERS_TO_CONFIRM: 3,
  CONFIRM_WINDOW_MS: 20000,
  SLIPPAGE_BPS: 2000,
  PUMPFUN_WS: 'wss://pumpportal.fun/api/data',
  SOL_MINT: 'So11111111111111111111111111111111111111112',
  LOG_FILE: './sniper-trades.json',
  RUNTIME_MS: 24 * 60 * 60 * 1000,
};

const state = {
  wallet: null,
  connection: null,
  solBalance: 0,
  positions: {},
  pendingTokens: {},
  trades: [],
  totalSpent: 0,
  startTime: Date.now(),
  running: true,
};

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  const emoji = { INFO: '•', WARN: '⚠', ERROR: '✗', TRADE: '◆' }[level] || '•';
  const line = `[${ts}] ${emoji} ${msg}`;
  console.log(line);
  fs.appendFileSync('./sniper.log', line + '\n');
}

function saveTrades() {
  fs.writeFileSync(CONFIG.LOG_FILE, JSON.stringify({
    startTime: state.startTime,
    solBalance: state.solBalance,
    totalSpent: state.totalSpent,
    trades: state.trades,
    openPositions: state.positions,
  }, null, 2));
}

function loadWallet() {
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY missing from .env');
  return Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
}

async function updateBalance() {
  const lamports = await state.connection.getBalance(state.wallet.publicKey);
  state.solBalance = lamports / 1e9;
  return state.solBalance;
}

async function jupiterSwap(inputMint, outputMint, amountLamports) {
  const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${CONFIG.SLIPPAGE_BPS}`;
  const quoteRes = await fetch(quoteUrl);
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(`Quote error: ${quote.error}`);

  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: state.wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  const swapData = await swapRes.json();
  if (!swapData.swapTransaction) throw new Error('No swap transaction');

  const tx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
  tx.sign([state.wallet]);
  const sig = await state.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await state.connection.confirmTransaction(sig, 'confirmed');
  return { sig, quote };
}

async function getTokenPriceInSOL(mint) {
  try {
    const url = `https://price.jup.ag/v6/price?ids=${mint}&vsToken=${CONFIG.SOL_MINT}`;
    const res = await fetch(url);
    const data = await res.json();
    return data?.data?.[mint]?.price || null;
  } catch {
    return null;
  }
}

async function snipeToken(mint, symbol, initialBuySOL) {
  if (state.positions[mint]) return;
  if (Object.keys(state.positions).length >= CONFIG.MAX_CONCURRENT_POSITIONS) {
    log(`Max positions reached, skipping ${symbol}`);
    return;
  }
  if (state.totalSpent + CONFIG.SOL_PER_SNIPE > CONFIG.MAX_TOTAL_SPENT_SOL) {
    log(`Max total spend reached, skipping ${symbol}`);
    return;
  }

  const lamports = Math.floor(CONFIG.SOL_PER_SNIPE * 1e9);

  try {
    log(`🎯 SNIPING ${symbol} (${mint.slice(0, 8)}...) | Initial buy: ${initialBuySOL.toFixed(3)} SOL`, 'TRADE');
    const { sig, quote } = await jupiterSwap(CONFIG.SOL_MINT, mint, lamports);

    const outAmount = parseInt(quote.outAmount);
    const entryPrice = CONFIG.SOL_PER_SNIPE / (outAmount / 1e6);

    state.positions[mint] = {
      symbol, mint, entryPrice,
      amount: outAmount,
      entryTime: Date.now(),
      solSpent: CONFIG.SOL_PER_SNIPE,
    };

    state.totalSpent += CONFIG.SOL_PER_SNIPE;
    await updateBalance();

    state.trades.push({
      type: 'BUY', symbol, mint,
      solSpent: CONFIG.SOL_PER_SNIPE,
      tokensReceived: outAmount,
      sig, time: new Date().toISOString(),
    });

    saveTrades();
    log(`✔ BUY ${symbol} | ${CONFIG.SOL_PER_SNIPE} SOL | tx: ${sig}`, 'TRADE');

    setTimeout(() => {
      if (state.positions[mint]) {
        log(`⏰ Force exit ${symbol} — max hold time reached`);
        exitPosition(mint, 'TIMEOUT');
      }
    }, CONFIG.MAX_HOLD_SECONDS * 1000);

  } catch (e) {
    log(`Snipe failed for ${symbol}: ${e.message}`, 'ERROR');
  }
}

async function exitPosition(mint, reason) {
  const pos = state.positions[mint];
  if (!pos) return;

  try {
    log(`📤 EXITING ${pos.symbol} | reason: ${reason}`, 'TRADE');
    const { sig, quote } = await jupiterSwap(mint, CONFIG.SOL_MINT, pos.amount);
    const solReceived = parseInt(quote.outAmount) / 1e9;
    const pnl = solReceived - pos.solSpent;
    const pct = ((pnl / pos.solSpent) * 100).toFixed(1);

    state.trades.push({
      type: 'SELL', symbol: pos.symbol, mint,
      solReceived, pnlSOL: pnl,
      pnlPct: parseFloat(pct),
      reason, sig, time: new Date().toISOString(),
    });

    delete state.positions[mint];
    await updateBalance();
    saveTrades();

    const emoji = pnl > 0 ? '🟢' : '🔴';
    log(`${emoji} SELL ${pos.symbol} | ${pnl > 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${pct}%) | tx: ${sig}`, 'TRADE');
  } catch (e) {
    log(`Exit failed for ${pos.symbol}: ${e.message}`, 'ERROR');
  }
}

async function monitorPositions() {
  while (state.running) {
    for (const [mint, pos] of Object.entries(state.positions)) {
      try {
        const price = await getTokenPriceInSOL(mint);
        if (!price) continue;
        const pnl = (price - pos.entryPrice) / pos.entryPrice;
        if (pnl >= CONFIG.TAKE_PROFIT_PCT) {
          log(`🚀 ${pos.symbol} hit take profit: +${(pnl * 100).toFixed(1)}%`);
          await exitPosition(mint, 'TAKE_PROFIT');
        } else if (pnl <= -CONFIG.STOP_LOSS_PCT) {
          log(`💀 ${pos.symbol} hit stop loss: ${(pnl * 100).toFixed(1)}%`);
          await exitPosition(mint, 'STOP_LOSS');
        }
      } catch (e) {}
    }
    await sleep(10000);
  }
}

function connectPumpFun() {
  log(`Connecting to pump.fun WebSocket...`);
  const ws = new WebSocket(CONFIG.PUMPFUN_WS);

  ws.on('open', () => {
    log('✔ Connected to pump.fun stream');
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    ws.send(JSON.stringify({ method: 'subscribeTokenTrade' }));
    log('Subscribed to: new token launches + trade stream');
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      await handlePumpMessage(msg);
    } catch (e) {}
  });

  ws.on('close', () => {
    log('WebSocket disconnected. Reconnecting in 5s...', 'WARN');
    setTimeout(connectPumpFun, 5000);
  });

  ws.on('error', (e) => {
    log(`WebSocket error: ${e.message}`, 'ERROR');
  });

  return ws;
}

async function handlePumpMessage(msg) {
  if (msg.txType === 'create') {
    const { mint, name, symbol, solAmount } = msg;
    if (!mint || !symbol) return;
    log(`🆕 New token: ${symbol} (${name}) | Dev buy: ${(solAmount || 0).toFixed(3)} SOL`);
    state.pendingTokens[mint] = {
      symbol, name, mint,
      firstSeenTime: Date.now(),
      initialBuySOL: solAmount || 0,
      buyers: [],
      volume: solAmount || 0,
    };
    if ((solAmount || 0) < CONFIG.MIN_INITIAL_BUY_SOL) {
      log(`⏭ Skipping ${symbol} — dev buy too small`);
      delete state.pendingTokens[mint];
    }
  }

  if (msg.txType === 'buy') {
    const { mint, traderPublicKey, solAmount } = msg;
    if (!mint) return;
    const pending = state.pendingTokens[mint];
    if (pending) {
      if (!pending.buyers.includes(traderPublicKey)) {
        pending.buyers.push(traderPublicKey);
        pending.volume += solAmount || 0;
      }
      const ageMs = Date.now() - pending.firstSeenTime;
      const uniqueBuyers = pending.buyers.length;
      if (
        uniqueBuyers >= CONFIG.MIN_UNIQUE_BUYERS_TO_CONFIRM &&
        ageMs < CONFIG.CONFIRM_WINDOW_MS &&
        !state.positions[mint]
      ) {
        log(`📈 ${pending.symbol} momentum confirmed: ${uniqueBuyers} buyers in ${(ageMs / 1000).toFixed(1)}s`);
        delete state.pendingTokens[mint];
        await snipeToken(mint, pending.symbol, pending.initialBuySOL);
      }
      if (ageMs > CONFIG.CONFIRM_WINDOW_MS) {
        delete state.pendingTokens[mint];
      }
    }
  }
}

function cleanupPending() {
  const now = Date.now();
  for (const [mint, token] of Object.entries(state.pendingTokens)) {
    if (now - token.firstSeenTime > CONFIG.CONFIRM_WINDOW_MS * 2) {
      delete state.pendingTokens[mint];
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function printStats() {
  const sells = state.trades.filter(t => t.type === 'SELL');
  const totalPnl = sells.reduce((sum, t) => sum + (t.pnlSOL || 0), 0);
  const wins = sells.filter(t => t.pnlSOL > 0).length;
  const runtime = ((Date.now() - state.startTime) / 1000 / 60).toFixed(1);
  log(`─── STATS | ${runtime}m | Balance: ${state.solBalance.toFixed(4)} SOL | PnL: ${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(4)} SOL | Trades: ${sells.length} | Win rate: ${sells.length ? ((wins / sells.length) * 100).toFixed(0) : 0}%`);
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════╗
║      PUMP.FUN SNIPER BOT  🎯              ║
║      Strategy: New launch momentum        ║
╚═══════════════════════════════════════════╝
  `);

  state.wallet = loadWallet();
  state.connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  log(`Wallet: ${state.wallet.publicKey.toString()}`);
  await updateBalance();
  log(`SOL balance: ${state.solBalance.toFixed(4)} SOL`);

  if (state.solBalance < 0.1) {
    log('Low balance warning — need at least 0.1 SOL', 'WARN');
  }

  const endTime = state.startTime + CONFIG.RUNTIME_MS;
  log(`Running until: ${new Date(endTime).toISOString()}`);

  connectPumpFun();
  monitorPositions();
  setInterval(printStats, 5 * 60 * 1000);
  setInterval(cleanupPending, 30000);

  setTimeout(async () => {
    log('24 hours complete — closing all positions...');
    state.running = false;
    for (const mint of Object.keys(state.positions)) {
      await exitPosition(mint, 'END_OF_RUN');
    }
    await updateBalance();
    printStats();
    saveTrades();
    process.exit(0);
  }, CONFIG.RUNTIME_MS);
}

process.on('SIGINT', async () => {
  log('Shutting down...');
  state.running = false;
  for (const mint of Object.keys(state.positions)) {
    await exitPosition(mint, 'MANUAL_STOP');
  }
  printStats();
  saveTrades();
  process.exit(0);
});

main().catch(e => {
  log(`Fatal: ${e.message}`, 'ERROR');
  process.exit(1);
});
