/**
 * PUMP.FUN MAX PROFIT SNIPER v3
 * ═══════════════════════════════════════════════════════════════
 * Goal: Maximize SOL in 24 hours.
 * Strategy: Aggressive early entry, adaptive exits, reinvest profits.
 * Brain: Learns which tokens/patterns pump. Gets smarter every trade.
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const bs58 = require('bs58').default || require('bs58');
const fs = require('fs');

const BRAIN_FILE = './brain.json';

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync('./sniper.log', line + '\n'); } catch (e) {}
}

function loadBrain() {
  try {
    if (fs.existsSync(BRAIN_FILE)) {
      const b = JSON.parse(fs.readFileSync(BRAIN_FILE));
      log(`🧠 Brain loaded: ${b.totalTrades} trades | ${b.wins}W/${b.losses}L | PnL: ${b.totalPnlSOL > 0 ? '+' : ''}${b.totalPnlSOL.toFixed(4)} SOL`);
      return b;
    }
  } catch (e) {}
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnlSOL: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    avgHoldTimeWin: 0,
    takeProfit: 1.00,
    stopLoss: 0.40,
    maxHoldSec: 240,
    solPerSnipe: 0.05,
    minDevBuy: 0.05,
    minBuyers: 2,
    confirmWindowMs: 60000,
    streak: 0,
    bestStreak: 0,
    recentTrades: [],
    devBuyStats: {},
    startingBalance: 0,
  };
}

function saveBrain() {
  fs.writeFileSync(BRAIN_FILE, JSON.stringify(brain, null, 2));
}

function adapt() {
  const { totalTrades, wins, recentTrades, streak } = brain;
  if (totalTrades < 2) return;

  const recent = recentTrades.slice(-6);
  const recentWinRate = recent.length > 0 ? recent.filter(t => t.pnl > 0).length / recent.length : 0.5;

  const balanceGrowth = state.solBalance / (brain.startingBalance || state.solBalance);
  if (balanceGrowth > 1.5) {
    brain.solPerSnipe = Math.min(0.20, brain.solPerSnipe * 1.15);
    log(`🧠 Balance up ${((balanceGrowth - 1) * 100).toFixed(0)}% — scaling to ${brain.solPerSnipe.toFixed(3)} SOL/trade`);
  } else if (balanceGrowth < 0.7) {
    brain.solPerSnipe = Math.max(0.02, brain.solPerSnipe * 0.85);
    log(`🧠 Balance down — scaling back to ${brain.solPerSnipe.toFixed(3)} SOL/trade`);
  }

  if (streak >= 3) {
    brain.takeProfit = Math.min(3.0, brain.takeProfit * 1.2);
    log(`🧠 Hot streak (${streak}) — raising TP to ${(brain.takeProfit * 100).toFixed(0)}%`);
  } else if (recentWinRate > 0.6) {
    brain.takeProfit = Math.min(2.5, brain.takeProfit * 1.1);
  } else if (recentWinRate < 0.3) {
    brain.takeProfit = Math.max(0.50, brain.takeProfit * 0.9);
    log(`🧠 Cold — lowering TP to ${(brain.takeProfit * 100).toFixed(0)}%`);
  }

  if (streak <= -3) {
    brain.stopLoss = Math.max(0.20, brain.stopLoss * 0.85);
    log(`🧠 Loss streak (${streak}) — tightening SL to ${(brain.stopLoss * 100).toFixed(0)}%`);
  } else if (streak >= 3) {
    brain.stopLoss = Math.min(0.55, brain.stopLoss * 1.1);
  }

  if (brain.avgHoldTimeWin > 0) {
    brain.maxHoldSec = Math.round(Math.min(360, Math.max(60, brain.avgHoldTimeWin * 1.8)));
  }

  if (recentWinRate < 0.25 && totalTrades >= 5) {
    brain.minBuyers = Math.min(4, brain.minBuyers + 1);
    brain.minDevBuy = Math.min(0.5, brain.minDevBuy * 1.5);
    log(`🧠 Too many rugs — raising entry bar: ${brain.minBuyers} buyers, ${brain.minDevBuy.toFixed(2)} SOL dev buy`);
  } else if (recentWinRate > 0.6 && totalTrades >= 5) {
    brain.minBuyers = Math.max(1, brain.minBuyers - 1);
    brain.minDevBuy = Math.max(0.05, brain.minDevBuy * 0.8);
    log(`🧠 Winning — lowering entry bar to catch more trades`);
  }

  saveBrain();
}

function recordTrade(pnlSOL, pnlPct, holdTime, devBuy, reason) {
  brain.recentTrades.push({ pnl: pnlSOL, pct: pnlPct, holdTime, devBuy, reason, time: Date.now() });
  if (brain.recentTrades.length > 30) brain.recentTrades.shift();

  brain.totalTrades++;
  brain.totalPnlSOL += pnlSOL;

  if (pnlSOL > 0) {
    brain.wins++;
    brain.streak = Math.max(0, brain.streak) + 1;
    brain.bestStreak = Math.max(brain.bestStreak, brain.streak);
    brain.avgWinPct = ((brain.avgWinPct * (brain.wins - 1)) + pnlPct) / brain.wins;
    brain.avgHoldTimeWin = ((brain.avgHoldTimeWin * (brain.wins - 1)) + holdTime) / brain.wins;
  } else {
    brain.losses++;
    brain.streak = Math.min(0, brain.streak) - 1;
    brain.avgLossPct = ((brain.avgLossPct * (brain.losses - 1)) + pnlPct) / brain.losses;
  }

  const bucket = devBuy < 0.5 ? 'micro' : devBuy < 2 ? 'small' : devBuy < 10 ? 'medium' : 'large';
  if (!brain.devBuyStats[bucket]) brain.devBuyStats[bucket] = { trades: 0, wins: 0, pnl: 0 };
  brain.devBuyStats[bucket].trades++;
  if (pnlSOL > 0) brain.devBuyStats[bucket].wins++;
  brain.devBuyStats[bucket].pnl += pnlSOL;

  saveBrain();
  adapt();
}

const brain = loadBrain();

const state = {
  wallet: null,
  connection: null,
  solBalance: 0,
  positions: {},
  pending: {},
  trades: [],
  totalSpent: 0,
  startTime: Date.now(),
  running: true,
};

const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  MAX_POSITIONS: 6,
  MAX_TOTAL_SOL: 0.55,
  PUMPFUN_WS: 'wss://pumpportal.fun/api/data',
  SOL_MINT: 'So11111111111111111111111111111111111111112',
  RUNTIME_MS: 24 * 60 * 60 * 1000,
};

function loadWallet() {
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY missing');
  return Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
}

async function updateBalance() {
  const lamps = await state.connection.getBalance(state.wallet.publicKey);
  state.solBalance = lamps / 1e9;
  return state.solBalance;
}

async function swap(inMint, outMint, lamports) {
  const slippage = brain.streak >= 3 ? 1500 : 2500;
  const q = await (await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${lamports}&slippageBps=${slippage}`
  )).json();
  if (q.error) throw new Error(q.error);

  const s = await (await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: q,
      userPublicKey: state.wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  })).json();
  if (!s.swapTransaction) throw new Error('No swap tx');

  const tx = VersionedTransaction.deserialize(Buffer.from(s.swapTransaction, 'base64'));
  tx.sign([state.wallet]);
  const sig = await state.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await state.connection.confirmTransaction(sig, 'confirmed');
  return { sig, outAmount: parseInt(q.outAmount), inAmount: parseInt(q.inAmount) };
}

async function getPrice(mint) {
  try {
    const d = await (await fetch(`https://price.jup.ag/v6/price?ids=${mint}&vsToken=${CONFIG.SOL_MINT}`)).json();
    return d?.data?.[mint]?.price || null;
  } catch { return null; }
}

async function snipe(mint, symbol, devBuy) {
  if (state.positions[mint]) return;
  if (Object.keys(state.positions).length >= CONFIG.MAX_POSITIONS) return;
  if (state.totalSpent >= CONFIG.MAX_TOTAL_SOL) { log(`⚠ Spend cap hit`); return; }

  const pctOfBalance = 0.08;
  const size = Math.max(0.02, Math.min(brain.solPerSnipe, state.solBalance * pctOfBalance));
  const lamports = Math.floor(size * 1e9);

  try {
    log(`🎯 SNIPE ${symbol} | Dev: ${devBuy.toFixed(3)} SOL | Size: ${size.toFixed(3)} SOL | TP: ${(brain.takeProfit * 100).toFixed(0)}% | SL: ${(brain.stopLoss * 100).toFixed(0)}%`);
    const { sig, outAmount } = await swap(CONFIG.SOL_MINT, mint, lamports);
    const entryPrice = size / (outAmount / 1e6);

    state.positions[mint] = {
      symbol, mint, entryPrice,
      amount: outAmount,
      entryTime: Date.now(),
      solSpent: size,
      devBuy,
      tp: brain.takeProfit,
      sl: brain.stopLoss,
      maxHold: brain.maxHoldSec,
    };

    state.totalSpent += size;
    await updateBalance();
    state.trades.push({ type: 'BUY', symbol, mint, solSpent: size, sig, time: new Date().toISOString() });
    log(`✔ BUY ${symbol} | tx: ${sig}`);

    setTimeout(() => {
      if (state.positions[mint]) exitPos(mint, 'TIMEOUT');
    }, state.positions[mint].maxHold * 1000);

  } catch (e) {
    log(`✗ Snipe failed ${symbol}: ${e.message}`);
  }
}

async function exitPos(mint, reason) {
  const pos = state.positions[mint];
  if (!pos) return;
  try {
    const { sig, outAmount } = await swap(mint, CONFIG.SOL_MINT, pos.amount);
    const solOut = outAmount / 1e9;
    const pnl = solOut - pos.solSpent;
    const pct = (pnl / pos.solSpent) * 100;
    const holdTime = (Date.now() - pos.entryTime) / 1000;

    state.trades.push({ type: 'SELL', symbol: pos.symbol, mint, solOut, pnl, pct, reason, sig, time: new Date().toISOString() });
    delete state.positions[mint];
    await updateBalance();
    recordTrade(pnl, pct, holdTime, pos.devBuy, reason);

    const e = pnl > 0 ? '🟢' : '🔴';
    log(`${e} ${pos.symbol} | ${pnl > 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${pct.toFixed(1)}%) | ${holdTime.toFixed(0)}s | ${reason}`);
    log(`🧠 ${brain.wins}W/${brain.losses}L | PnL: ${brain.totalPnlSOL > 0 ? '+' : ''}${brain.totalPnlSOL.toFixed(4)} SOL | Streak: ${brain.streak} | Balance: ${state.solBalance.toFixed(4)} SOL`);
    saveState();
  } catch (e) {
    log(`✗ Exit failed ${pos.symbol}: ${e.message}`);
  }
}

function saveState() {
  fs.writeFileSync('./trades.json', JSON.stringify({ trades: state.trades, brain }, null, 2));
}

async function monitor() {
  while (state.running) {
    for (const [mint, pos] of Object.entries(state.positions)) {
      try {
        const price = await getPrice(mint);
        if (!price) continue;
        const pnl = (price - pos.entryPrice) / pos.entryPrice;
        if (pnl >= pos.tp) {
          log(`🚀 ${pos.symbol} TP hit: +${(pnl * 100).toFixed(1)}%`);
          await exitPos(mint, '​​​​​​​​​​​​​​​​
