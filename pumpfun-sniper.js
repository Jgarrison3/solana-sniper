require('dotenv').config();
const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js');
const fetch = require('node-fetch');
const bs58 = require('bs58').default || require('bs58');
const fs = require('fs');

const BRAIN_FILE = './brain.json';

function log(msg) {
  const ts = new Date().toISOString();
  const line = '[' + ts + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync('./sniper.log', line + '\n'); } catch (e) {}
}

function loadBrain() {
  try {
    if (fs.existsSync(BRAIN_FILE)) {
      const b = JSON.parse(fs.readFileSync(BRAIN_FILE));
      log('Brain loaded: ' + b.totalTrades + ' trades | ' + b.wins + 'W/' + b.losses + 'L');
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
    stopLoss: 0.30,
    maxHoldSec: 300,
    solPerSnipe: 0.05,
    minMomentumPct: 20,
    streak: 0,
    bestStreak: 0,
    recentTrades: [],
    startingBalance: 0,
  };
}

function saveBrain() {
  fs.writeFileSync(BRAIN_FILE, JSON.stringify(brain, null, 2));
}

function adapt() {
  const { totalTrades, recentTrades, streak } = brain;
  if (totalTrades < 2) return;

  const recent = recentTrades.slice(-6);
  const recentWinRate = recent.length > 0 ? recent.filter(function(t) { return t.pnl > 0; }).length / recent.length : 0.5;

  const balanceGrowth = state.solBalance / (brain.startingBalance || state.solBalance);
  if (balanceGrowth > 1.5) {
    brain.solPerSnipe = Math.min(0.20, brain.solPerSnipe * 1.15);
    log('Brain: Balance up - scaling to ' + brain.solPerSnipe.toFixed(3) + ' SOL/trade');
  } else if (balanceGrowth < 0.7) {
    brain.solPerSnipe = Math.max(0.02, brain.solPerSnipe * 0.85);
    log('Brain: Balance down - scaling back to ' + brain.solPerSnipe.toFixed(3) + ' SOL/trade');
  }

  if (streak >= 3) {
    brain.takeProfit = Math.min(3.0, brain.takeProfit * 1.2);
    log('Brain: Hot streak - raising TP to ' + (brain.takeProfit * 100).toFixed(0) + '%');
  } else if (recentWinRate < 0.3) {
    brain.takeProfit = Math.max(0.50, brain.takeProfit * 0.9);
    log('Brain: Cold - lowering TP to ' + (brain.takeProfit * 100).toFixed(0) + '%');
  }

  if (streak <= -3) {
    brain.stopLoss = Math.max(0.15, brain.stopLoss * 0.85);
    log('Brain: Loss streak - tightening SL to ' + (brain.stopLoss * 100).toFixed(0) + '%');
  } else if (streak >= 3) {
    brain.stopLoss = Math.min(0.45, brain.stopLoss * 1.1);
  }

  if (recentWinRate < 0.25 && totalTrades >= 5) {
    brain.minMomentumPct = Math.min(50, brain.minMomentumPct + 5);
    log('Brain: Raising momentum threshold to ' + brain.minMomentumPct + '%');
  } else if (recentWinRate > 0.6 && totalTrades >= 5) {
    brain.minMomentumPct = Math.max(10, brain.minMomentumPct - 5);
    log('Brain: Lowering momentum threshold to ' + brain.minMomentumPct + '%');
  }

  saveBrain();
}

function recordTrade(pnlSOL, pnlPct, holdTime, reason) {
  brain.recentTrades.push({ pnl: pnlSOL, pct: pnlPct, holdTime: holdTime, reason: reason, time: Date.now() });
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

  saveBrain();
  adapt();
}

const brain = loadBrain();

const state = {
  wallet: null,
  connection: null,
  solBalance: 0,
  positions: {},
  trades: [],
  watchlist: {},
  totalSpent: 0,
  startTime: Date.now(),
  running: true,
};

const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  MAX_POSITIONS: 5,
  MAX_TOTAL_SOL: 0.55,
  RUNTIME_MS: 24 * 60 * 60 * 1000,
  SCAN_INTERVAL_MS: 15000,
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

async function swap(isBuy, mint, lamports) {
  const body = {
    publicKey: state.wallet.publicKey.toString(),
    action: isBuy ? 'buy' : 'sell',
    mint: mint,
    amount: lamports,
    denominatedInSol: isBuy ? 'true' : 'false',
    slippage: 25,
    priorityFee: 0.005,
    pool: 'pump'
  };

  const res = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status !== 200) throw new Error('PumpPortal error: ' + res.status);

  const data = await res.arrayBuffer();
  const tx = VersionedTransaction.deserialize(new Uint8Array(data));
  tx.sign([state.wallet]);

  const sig = await state.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await state.connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

async function buy(mint, symbol, priceChange) {
  if (state.positions[mint]) return;
  if (Object.keys(state.positions).length >= CONFIG.MAX_POSITIONS) return;
  if (state.totalSpent >= CONFIG.MAX_TOTAL_SOL) { log('Spend cap hit'); return; }

  const size = Math.max(0.02, Math.min(brain.solPerSnipe, state.solBalance * 0.08));
  const lamports = Math.floor(size * 1e9);

  try {
    log('BUY ' + symbol + ' | 5min change: +' + priceChange.toFixed(1) + '% | Size: ' + size.toFixed(3) + ' SOL | TP: ' + (brain.takeProfit * 100).toFixed(0) + '% | SL: ' + (brain.stopLoss * 100).toFixed(0) + '%');
    const sig = await swap(true, mint, lamports);

    state.positions[mint] = {
      symbol: symbol,
      mint: mint,
      entryTime: Date.now(),
      solSpent: size,
      tp: brain.takeProfit,
      sl: brain.stopLoss,
      maxHold: brain.maxHoldSec,
      amount: lamports,
      entryPrice: 0,
    };

    state.totalSpent += size;
    await updateBalance();
    state.trades.push({ type: 'BUY', symbol: symbol, mint: mint, solSpent: size, sig: sig, time: new Date().toISOString() });
    log('BUY confirmed ' + symbol + ' | tx: ' + sig + ' | Bal: ' + state.solBalance.toFixed(4) + ' SOL');

    delete state.watchlist[mint];

    setTimeout(function() {
      if (state.positions[mint]) exitPos(mint, 'TIMEOUT');
    }, brain.maxHoldSec * 1000);

  } catch (e) {
    log('Buy failed ' + symbol + ': ' + e.message);
  }
}

async function exitPos(mint, reason) {
  const pos = state.positions[mint];
  if (!pos) return;
  try {
    log('SELLING ' + pos.symbol + ' | reason: ' + reason);
    const sig = await swap(false, mint, pos.amount);
    const holdTime = (Date.now() - pos.entryTime) / 1000;

    await updateBalance();
    const pnl = state.solBalance - (brain.startingBalance - state.totalSpent + pos.solSpent);
    const pct = (pnl / pos.solSpent) * 100;

    state.trades.push({ type: 'SELL', symbol: pos.symbol, mint: mint, reason: reason, sig: sig, time: new Date().toISOString() });
    delete state.positions[mint];
    recordTrade(pnl, pct, holdTime, reason);

    const result = pnl > 0 ? 'WIN' : 'LOSS';
    log(result + ' ' + pos.symbol + ' | ' + (pnl > 0 ? '+' : '') + pnl.toFixed(4) + ' SOL (' + pct.toFixed(1) + '%) | ' + holdTime.toFixed(0) + 's | ' + reason);
    log('Brain: ' + brain.wins + 'W/' + brain.losses + 'L | PnL: ' + brain.totalPnlSOL.toFixed(4) + ' SOL | Streak: ' + brain.streak + ' | Bal: ' + state.solBalance.toFixed(4) + ' SOL');
    fs.writeFileSync('./trades.json', JSON.stringify({ trades: state.trades, brain: brain }, null, 2));
  } catch (e) {
    log('Exit failed ' + pos.symbol + ': ' + e.message);
  }
}

async function scanDexScreener() {
  try {
    const url = 'https://api.dexscreener.com/token-boosts/latest/v1';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      log('DexScreener error: ' + res.status);
      return;
    }
    const tokens = await res.json();
    log('DexScreener scan: ' + tokens.length + ' tokens found');

    for (const token of tokens) {
      if (!token.tokenAddress || !token.chainId) continue;
      if (token.chainId !== 'solana') continue;

      const mint = token.tokenAddress;
      if (state.positions[mint]) continue;

      const pairUrl = 'https://api.dexscreener.com/latest/dex/tokens/' + mint;
      const pairRes = await fetch(pairUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!pairRes.ok) continue;
      const pairData = await pairRes.json();

      if (!pairData.pairs || pairData.pairs.length === 0) continue;

      const pair = pairData.pairs[0];
      const symbol = pair.baseToken ? pair.baseToken.symbol : 'UNKNOWN';
      const priceChange5m = pair.priceChange ? (pair.priceChange.m5 || 0) : 0;
      const volume5m = pair.volume ? (pair.volume.m5 || 0) : 0;
      const liquidity = pair.liquidity ? (pair.liquidity.usd || 0) : 0;
      const pairCreated = pair.pairCreatedAt || 0;
      const ageMin = pairCreated > 0 ? (Date.now() - pairCreated) / 1000 / 60 : 999;

      if (ageMin < 2 || ageMin > 60) continue;
      if (liquidity < 1000) continue;
      if (volume5m < 500) continue;

      if (priceChange5m >= brain.minMomentumPct) {
        log('MOMENTUM ' + symbol + ' | 5m: +' + priceChange5m.toFixed(1) + '% | Vol5m: $' + volume5m.toFixed(0) + ' | Liq: $' + liquidity.toFixed(0) + ' | Age: ' + ageMin.toFixed(1) + 'min');
        await buy(mint, symbol, priceChange5m);
      }
    }
  } catch (e) {
    log('Scan error: ' + e.message);
  }
}

async function monitorPositions() {
  for (const mint in state.positions) {
    try {
      const pos = state.positions[mint];
      const pairUrl = 'https://api.dexscreener.com/latest/dex/tokens/' + mint;
      const res = await fetch(pairUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.pairs || data.pairs.length === 0) continue;

      const pair = data.pairs[0];
      const priceChange = pair.priceChange ? (pair.priceChange.h1 || 0) : 0;

      if (priceChange >= pos.tp * 100) {
        log('TP hit ' + pos.symbol + ': +' + priceChange.toFixed(1) + '%');
        await exitPos(mint, 'TAKE_PROFIT');
      } else if (priceChange <= -(pos.sl * 100)) {
        log('SL hit ' + pos.symbol + ': ' + priceChange.toFixed(1) + '%');
        await exitPos(mint, 'STOP_LOSS');
      }
    } catch (e) {}
  }
}

async function mainLoop() {
  while (state.running) {
    await scanDexScreener();
    await monitorPositions();
    await new Promise(function(r) { setTimeout(r, CONFIG.SCAN_INTERVAL_MS); });
  }
}

async function main() {
  log('PUMP.FUN MOMENTUM TRADER v4');
  log('Data source: DexScreener API');
  log('Strategy: Buy Solana tokens showing 5min momentum');

  state.wallet = loadWallet();
  state.connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  log('Wallet: ' + state.wallet.publicKey.toString());
  await updateBalance();
  brain.startingBalance = state.solBalance;
  log('Starting balance: ' + state.solBalance.toFixed(4) + ' SOL');
  log('TP: ' + (brain.takeProfit * 100).toFixed(0) + '% | SL: ' + (brain.stopLoss * 100).toFixed(0) + '% | Min 5m momentum: ' + brain.minMomentumPct + '%');
  log('Running until: ' + new Date(Date.now() + CONFIG.RUNTIME_MS).toISOString());

  mainLoop();

  setInterval(function() {
    const wr = brain.totalTrades > 0 ? ((brain.wins / brain.totalTrades) * 100).toFixed(0) : 0;
    log('STATS | ' + brain.wins + 'W/' + brain.losses + 'L (' + wr + '%) | PnL: ' + brain.totalPnlSOL.toFixed(4) + ' SOL | Bal: ' + state.solBalance.toFixed(4) + ' SOL | Streak: ' + brain.streak + ' | Open: ' + Object.keys(state.positions).length);
  }, 3 * 60 * 1000);

  setTimeout(async function() {
    log('24h complete - closing all positions');
    state.running = false;
    for (const mint in state.positions) {
      await exitPos(mint, 'END_OF_RUN');
    }
    await updateBalance();
    const profit = state.solBalance - brain.startingBalance;
    log('FINAL: ' + state.solBalance.toFixed(4) + ' SOL | ' + (profit > 0 ? '+' : '') + profit.toFixed(4) + ' SOL profit | ' + brain.wins + 'W/' + brain.losses + 'L');
    process.exit(0);
  }, CONFIG.RUNTIME_MS);
}

process.on('SIGINT', async function() {
  state.running = false;
  for (const mint in state.positions) {
    await exitPos(mint, 'MANUAL_STOP');
  }
  const profit = state.solBalance - brain.startingBalance;
  log('Stopped: ' + state.solBalance.toFixed(4) + ' SOL | ' + (profit > 0 ? '+' : '') + profit.toFixed(4) + ' SOL');
  process.exit(0);
});

main().catch(function(e) {
  log('Fatal: ' + e.message);
  process.exit(1);
});
