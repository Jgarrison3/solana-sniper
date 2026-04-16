require('dotenv').config();
const WebSocket = require('ws');
const fetch = require('node-fetch');
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
  solBalance: 0,
  positions: {},
  trades: [],
  recentlyTraded: {},
  totalSpent: 0,
  startTime: Date.now(),
  running: true,
};

const CONFIG = {
  API_KEY: process.env.PUMPPORTAL_KEY,
  MAX_POSITIONS: 5,
  MAX_TOTAL_SOL: 0.45,
  PUMPFUN_WS: 'wss://pumpportal.fun/api/data',
  RUNTIME_MS: 24 * 60 * 60 * 1000,
  TRADE_URL: 'https://pumpportal.fun/api/trade',
};

async function getBalance() {
  try {
    const res = await fetch('https://pumpportal.fun/api/trade?api-key=' + CONFIG.API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'buy',
        mint: 'So11111111111111111111111111111111111111112',
        amount: 0,
        denominatedInSol: 'true',
        slippage: 1,
        priorityFee: 0,
        pool: 'pump'
      }),
    });
  } catch (e) {}

  // Use DexScreener to check portfolio value instead
  return state.solBalance;
}

async function trade(action, mint, amount, denominatedInSol) {
  const body = {
    action: action,
    mint: mint,
    amount: amount,
    denominatedInSol: denominatedInSol ? 'true' : 'false',
    slippage: 50,
    priorityFee: 0.005,
    pool: 'pump',
  };

  const url = CONFIG.TRADE_URL + '?api-key=' + CONFIG.API_KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  if (!data.signature) throw new Error('No signature in response: ' + JSON.stringify(data));
  return data.signature;
}

async function snipe(mint, symbol, devBuy) {
  if (state.positions[mint]) return;
  if (state.recentlyTraded[mint]) return;
  if (Object.keys(state.positions).length >= CONFIG.MAX_POSITIONS) return;
  if (state.totalSpent >= CONFIG.MAX_TOTAL_SOL) { log('Spend cap hit'); return; }

  const size = Math.max(0.02, Math.min(brain.solPerSnipe, 0.49 * 0.08));

  try {
    log('SNIPE ' + symbol + ' | Dev: ' + devBuy.toFixed(3) + ' SOL | Size: ' + size.toFixed(3) + ' SOL | TP: ' + (brain.takeProfit * 100).toFixed(0) + '% | SL: ' + (brain.stopLoss * 100).toFixed(0) + '%');

    const sig = await trade('buy', mint, size, true);
    log('BUY confirmed ' + symbol + ' | tx: ' + sig);

    state.positions[mint] = {
      symbol: symbol,
      mint: mint,
      entryTime: Date.now(),
      solSpent: size,
      devBuy: devBuy,
      tp: brain.takeProfit,
      sl: brain.stopLoss,
      maxHold: brain.maxHoldSec,
    };

    state.totalSpent += size;
    state.trades.push({ type: 'BUY', symbol: symbol, mint: mint, solSpent: size, sig: sig, time: new Date().toISOString() });
    log('Position open: ' + Object.keys(state.positions).length + ' total | Spent: ' + state.totalSpent.toFixed(3) + ' SOL');

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
    const sig = await trade('sell', mint, '100%', false);
    const holdTime = (Date.now() - pos.entryTime) / 1000;

    log('SELL confirmed ' + pos.symbol + ' | tx: ' + sig + ' | held: ' + holdTime.toFixed(0) + 's');

    state.trades.push({ type: 'SELL', symbol: pos.symbol, mint: mint, reason: reason, sig: sig, time: new Date().toISOString() });
    delete state.positions[mint];
    state.recentlyTraded[mint] = Date.now();

    // We use a simple estimate for PnL since Lightning API handles everything
    const estimatedPnl = reason === 'TAKE_PROFIT' ? pos.solSpent * brain.takeProfit : reason === 'STOP_LOSS' ? -(pos.solSpent * brain.stopLoss) : 0;
    const estimatedPct = (estimatedPnl / pos.solSpent) * 100;

    recordTrade(estimatedPnl, estimatedPct, holdTime, pos.devBuy, reason);

    const result = estimatedPnl > 0 ? 'WIN' : estimatedPnl < 0 ? 'LOSS' : 'TIMEOUT';
    log(result + ' ' + pos.symbol + ' | est: ' + (estimatedPnl > 0 ? '+' : '') + estimatedPnl.toFixed(4) + ' SOL | ' + holdTime.toFixed(0) + 's | ' + reason);
    log('Brain: ' + brain.wins + 'W/' + brain.losses + 'L | Streak: ' + brain.streak);
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
  log('PUMP.FUN LIGHTNING SNIPER v8');
  log('Engine: PumpPortal Lightning API - no tx building needed!');

  if (!CONFIG.API_KEY) {
    log('ERROR: PUMPPORTAL_KEY not set in environment variables');
    process.exit(1);
  }

  log('API Key: ' + CONFIG.API_KEY.slice(0, 20) + '...');
  log('TP: ' + (brain.takeProfit * 100).toFixed(0) + '% | SL: ' + (brain.stopLoss * 100).toFixed(0) + '% | Size: ' + brain.solPerSnipe.toFixed(3) + ' SOL | Min dev buy: ' + brain.minDevBuy + ' SOL');
  log('Running until: ' + new Date(Date.now() + CONFIG.RUNTIME_MS).toISOString());
  log('Spend cap: ' + CONFIG.MAX_TOTAL_SOL + ' SOL | Max positions: ' + CONFIG.MAX_POSITIONS);

  connect();
  monitorPositions();

  setInterval(function() {
    const wr = brain.totalTrades > 0 ? ((brain.wins / brain.totalTrades) * 100).toFixed(0) : 0;
    log('STATS | ' + brain.wins + 'W/' + brain.losses + 'L (' + wr + '%) | Streak: ' + brain.streak + ' | Open positions: ' + Object.keys(state.positions).length + ' | Spent: ' + state.totalSpent.toFixed(3) + ' SOL');
  }, 3 * 60 * 1000);

  setInterval(cleanupRecentlyTraded, 30000);

  setTimeout(async function() {
    log('Runtime complete - closing all positions');
    state.running = false;
    for (const mint in state.positions) {
      await exitPos(mint, 'END_OF_RUN');
    }
    log('FINAL: ' + brain.wins + 'W/' + brain.losses + 'L | Brain PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL');
    process.exit(0);
  }, CONFIG.RUNTIME_MS);
}

process.on('SIGINT', async function() {
  state.running = false;
  for (const mint in state.positions) {
    await exitPos(mint, 'MANUAL_STOP');
  }
  log('Stopped.');
  process.exit(0);
});

main().catch(function(e) {
  log('Fatal: ' + e.message);
  process.exit(1);
});
