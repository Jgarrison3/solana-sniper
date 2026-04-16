require('dotenv').config();
const { Connection, Keypair, VersionedTransaction, SystemProgram, PublicKey, TransactionMessage } = require('@solana/web3.js');
const fetch = require('node-fetch');
const WebSocket = require('ws');
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
    stopLoss: 0.40,
    maxHoldSec: 240,
    solPerSnipe: 0.05,
    minDevBuy: 0.1,
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
    log('Brain: Scaling down to ' + brain.solPerSnipe.toFixed(3) + ' SOL/trade');
  }

  if (streak >= 3) {
    brain.takeProfit = Math.min(3.0, brain.takeProfit * 1.2);
    log('Brain: Hot streak - TP now ' + (brain.takeProfit * 100).toFixed(0) + '%');
  } else if (recentWinRate < 0.3) {
    brain.takeProfit = Math.max(0.50, brain.takeProfit * 0.9);
    log('Brain: Cold - TP now ' + (brain.takeProfit * 100).toFixed(0) + '%');
  }

  if (streak <= -3) {
    brain.stopLoss = Math.max(0.20, brain.stopLoss * 0.85);
    log('Brain: Loss streak - SL now ' + (brain.stopLoss * 100).toFixed(0) + '%');
  } else if (streak >= 3) {
    brain.stopLoss = Math.min(0.55, brain.stopLoss * 1.1);
  }

  if (brain.avgHoldTimeWin > 0) {
    brain.maxHoldSec = Math.round(Math.min(360, Math.max(60, brain.avgHoldTimeWin * 1.8)));
  }

  if (recentWinRate < 0.25 && totalTrades >= 5) {
    brain.minDevBuy = Math.min(1.0, brain.minDevBuy * 1.5);
    log('Brain: Too many rugs - min dev buy now ' + brain.minDevBuy.toFixed(2) + ' SOL');
  } else if (recentWinRate > 0.6 && totalTrades >= 5) {
    brain.minDevBuy = Math.max(0.05, brain.minDevBuy * 0.8);
    log('Brain: Winning - lowering entry bar');
  }

  saveBrain();
}

function recordTrade(pnlSOL, pnlPct, holdTime, devBuy, reason) {
  brain.recentTrades.push({ pnl: pnlSOL, pct: pnlPct, holdTime: holdTime, devBuy: devBuy, reason: reason, time: Date.now() });
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
  trades: [],
  recentlyTraded: {},
  totalSpent: 0,
  startTime: Date.now(),
  running: true,
};

const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  MAX_POSITIONS: 5,
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

async function buildBuyTx(mint, lamports) {
  const body = {
    publicKey: state.wallet.publicKey.toString(),
    action: 'buy',
    mint: mint,
    amount: lamports,
    denominatedInSol: 'true',
    slippage: 50,
    priorityFee: 0.005,
    pool: 'pump'
  };

  const res = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status !== 200) throw new Error('PumpPortal buy error: ' + res.status);
  const data = await res.arrayBuffer();
  return VersionedTransaction.deserialize(new Uint8Array(data));
}

async function buildSellTx(mint, amount) {
  const body = {
    publicKey: state.wallet.publicKey.toString(),
    action: 'sell',
    mint: mint,
    amount: amount,
    denominatedInSol: 'false',
    slippage: 50,
    priorityFee: 0.005,
    pool: 'pump'
  };

  const res = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status !== 200) throw new Error('PumpPortal sell error: ' + res.status);
  const data = await res.arrayBuffer();
  return VersionedTransaction.deserialize(new Uint8Array(data));
}

async function snipe(mint, symbol, devBuy) {
  if (state.positions[mint]) return;
  if (state.recentlyTraded[mint]) return;
  if (Object.keys(state.positions).length >= CONFIG.MAX_POSITIONS) return;
  if (state.totalSpent >= CONFIG.MAX_TOTAL_SOL) { log('Spend cap hit'); return; }

  const size = Math.max(0.02, Math.min(brain.solPerSnipe, state.solBalance * 0.08));
  const lamports = Math.floor(size * 1e9);

  try {
    log('SNIPE ' + symbol + ' | Dev: ' + devBuy.toFixed(3) + ' SOL | Size: ' + size.toFixed(3) + ' SOL | TP: ' + (brain.takeProfit * 100).toFixed(0) + '% | SL: ' + (brain.stopLoss * 100).toFixed(0) + '%');

    const buyTx = await buildBuyTx(mint, lamports);
    buyTx.sign([state.wallet]);

    const sig = await state.connection.sendRawTransaction(buyTx.serialize(), {
      skipPreflight: true,
      maxRetries: 5,
    });

    log('BUY tx sent: ' + sig + ' | Waiting for confirmation...');
    await state.connection.confirmTransaction(sig, 'confirmed');

    state.positions[mint] = {
      symbol: symbol,
      mint: mint,
      entryTime: Date.now(),
      solSpent: size,
      devBuy: devBuy,
      tp: brain.takeProfit,
      sl: brain.stopLoss,
      maxHold: brain.maxHoldSec,
      amount: lamports,
      sig: sig,
    };

    state.totalSpent += size;
    await updateBalance();
    state.trades.push({ type: 'BUY', symbol: symbol, mint: mint, solSpent: size, sig: sig, time: new Date().toISOString() });
    log('BUY confirmed ' + symbol + ' | tx: ' + sig + ' | Bal: ' + state.solBalance.toFixed(4) + ' SOL');

    setTimeout(function() {
      if (state.positions[mint]) exitPos(mint, 'TIMEOUT');
    }, brain.maxHoldSec * 1000);

  } catch (e) {
    log('Snipe failed ' + symbol + ': ' + e.message);
  }
}

async function exitPos(mint, reason) {
  const pos = state.positions[mint];
  if (!pos) return;
  try {
    log('SELLING ' + pos.symbol + ' | reason: ' + reason);

    const sellTx = await buildSellTx(mint, pos.amount);
    sellTx.sign([state.wallet]);

    const sig = await state.connection.sendRawTransaction(sellTx.serialize(), {
      skipPreflight: true,
      maxRetries: 5,
    });

    await state.connection.confirmTransaction(sig, 'confirmed');

    const holdTime = (Date.now() - pos.entryTime) / 1000;
    const prevBal = state.solBalance;
    await updateBalance();
    const pnl = state.solBalance - prevBal + pos.solSpent;
    const pct = (pnl / pos.solSpent) * 100;

    state.trades.push({ type: 'SELL', symbol: pos.symbol, mint: mint, pnl: pnl, pct: pct, reason: reason, sig: sig, time: new Date().toISOString() });
    delete state.positions[mint];
    state.recentlyTraded[mint] = Date.now();
    recordTrade(pnl, pct, holdTime, pos.devBuy, reason);

    const result = pnl > 0 ? 'WIN' : 'LOSS';
    log(result + ' ' + pos.symbol + ' | ' + (pnl > 0 ? '+' : '') + pnl.toFixed(4) + ' SOL (' + pct.toFixed(1) + '%) | ' + holdTime.toFixed(0) + 's | ' + reason);
    log('Brain: ' + brain.wins + 'W/' + brain.losses + 'L | PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL | Streak: ' + brain.streak + ' | Bal: ' + state.solBalance.toFixed(4) + ' SOL');
    fs.writeFileSync('./trades.json', JSON.stringify({ trades: state.trades, brain: brain }, null, 2));
  } catch (e) {
    log('Sell failed ' + pos.symbol + ': ' + e.message);
  }
}

async function monitorPositions() {
  while (state.running) {
    for (const mint in state.positions) {
      try {
        const pos = state.positions[mint];
        const url = 'https://api.dexscreener.com/latest/dex/tokens/' + mint;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data.pairs || data.pairs.length === 0) continue;

        const pair = data.pairs[0];
        const priceChange = pair.priceChange ? (pair.priceChange.m5 || 0) : 0;
        log('Monitor ' + pos.symbol + ' | 5m: ' + priceChange.toFixed(1) + '%');

        if (priceChange >= pos.tp * 100) {
          log('TP hit ' + pos.symbol + ': +' + priceChange.toFixed(1) + '%');
          await exitPos(mint, 'TAKE_PROFIT');
        } else if (priceChange <= -(pos.sl * 100)) {
          log('SL hit ' + pos.symbol + ': ' + priceChange.toFixed(1) + '%');
          await exitPos(mint, 'STOP_LOSS');
        }
      } catch (e) {}
    }
    await new Promise(function(r) { setTimeout(r, 8000); });
  }
}

function connect() {
  const ws = new WebSocket(CONFIG.PUMPFUN_WS);

  ws.on('open', function() {
    log('Connected to pump.fun');
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    log('Subscribed to new token launches');
  });

  ws.on('message', async function(raw) {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.txType === 'create') {
        const mint = msg.mint;
        const symbol = msg.symbol;
        const devBuy = msg.solAmount || 0;
        if (!mint || !symbol) return;
        log('NEW ' + symbol + ' | Dev: ' + devBuy.toFixed(3) + ' SOL');
        if (devBuy < brain.minDevBuy) {
          log('Skip ' + symbol + ' - dev buy too small');
          return;
        }
        await snipe(mint, symbol, devBuy);
      }
    } catch (e) {}
  });

  ws.on('close', function() {
    log('WS closed, reconnecting in 2s...');
    setTimeout(connect, 2000);
  });

  ws.on('error', function(e) {
    log('WS error: ' + e.message);
  });
}

async function cleanupRecentlyTraded() {
  const now = Date.now();
  for (const mint in state.recentlyTraded) {
    if (now - state.recentlyTraded[mint] > 30 * 60 * 1000) {
      delete state.recentlyTraded[mint];
    }
  }
}

async function main() {
  log('PUMP.FUN SNIPER v7');
  log('Engine: Direct send + PumpPortal + Adaptive brain');

  state.wallet = loadWallet();
  state.connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  log('Wallet: ' + state.wallet.publicKey.toString());
  await updateBalance();
  brain.startingBalance = state.solBalance;
  log('Starting balance: ' + state.solBalance.toFixed(4) + ' SOL');
  log('TP: ' + (brain.takeProfit * 100).toFixed(0) + '% | SL: ' + (brain.stopLoss * 100).toFixed(0) + '% | Size: ' + brain.solPerSnipe.toFixed(3) + ' SOL | Min dev buy: ' + brain.minDevBuy + ' SOL');
  log('Running until: ' + new Date(Date.now() + CONFIG.RUNTIME_MS).toISOString());

  connect();
  monitorPositions();

  setInterval(function() {
    const wr = brain.totalTrades > 0 ? ((brain.wins / brain.totalTrades) * 100).toFixed(0) : 0;
    log('STATS | ' + brain.wins + 'W/' + brain.losses + 'L (' + wr + '%) | PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL | Bal: ' + state.solBalance.toFixed(4) + ' SOL | Open: ' + Object.keys(state.positions).length);
  }, 3 * 60 * 1000);

  setInterval(cleanupRecentlyTraded, 30000);

  setTimeout(async function() {
    log('Runtime complete - closing all positions');
    state.running = false;
    for (const mint in state.positions) {
      await exitPos(mint, 'END_OF_RUN');
    }
    await updateBalance();
    const profit = state.solBalance - brain.startingBalance;
    log('FINAL: ' + state.solBalance.toFixed(4) + ' SOL | ' + (profit > 0 ? '+' : '') + profit.toFixed(4) + ' SOL | ' + brain.wins + 'W/' + brain.losses + 'L');
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
