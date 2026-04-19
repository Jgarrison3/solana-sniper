require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Connection, PublicKey } = require('@solana/web3.js');
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
      log('Brain loaded: ' + b.totalTrades + ' trades | ' + b.wins + 'W/' + b.losses + 'L | Real PnL: ' + (b.totalPnlSOL > 0 ? '+' : '') + b.totalPnlSOL.toFixed(4) + ' SOL');
      return b;
    }
  } catch (e) {}
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnlSOL: 0,
    totalPnlUSD: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    avgHoldTimeWin: 0,
    takeProfit: 1.00,
    stopLoss: 0.40,
    maxHoldSec: 180,
    solPerSnipe: 0.15,
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
  if (totalTrades < 3) return;

  const recent = recentTrades.slice(-6);
  const recentWinRate = recent.length > 0 ? recent.filter(t => t.pnl > 0).length / recent.length : 0.5;

  if (streak >= 3) {
    brain.solPerSnipe = Math.min(0.25, brain.solPerSnipe * 1.15);
    log('Brain: Hot streak - size ' + brain.solPerSnipe.toFixed(3) + ' SOL');
  } else if (streak <= -2) {
    brain.solPerSnipe = Math.max(0.05, brain.solPerSnipe * 0.80);
    log('Brain: Cold - sizing down to ' + brain.solPerSnipe.toFixed(3) + ' SOL');
  }

  if (streak >= 3) {
    brain.takeProfit = Math.min(3.0, brain.takeProfit * 1.2);
  } else if (recentWinRate < 0.3) {
    brain.takeProfit = Math.max(0.40, brain.takeProfit * 0.9);
  }

  if (streak <= -3) {
    brain.stopLoss = Math.max(0.20, brain.stopLoss * 0.85);
  }

  saveBrain();
}

function recordTrade(pnlSOL, pnlPct, holdTime, mint, reason) {
  brain.recentTrades.push({ pnl: pnlSOL, pct: pnlPct, holdTime, mint, reason, time: Date.now() });
  if (brain.recentTrades.length > 50) brain.recentTrades.shift();
  brain.totalTrades++;
  brain.totalPnlSOL += pnlSOL;

  if (pnlSOL > 0) {
    brain.wins++;
    brain.streak = Math.max(0, brain.streak) + 1;
    brain.bestStreak = Math.max(brain.bestStreak, brain.streak);
  } else {
    brain.losses++;
    brain.streak = Math.min(0, brain.streak) - 1;
  }

  saveBrain();
  adapt();
}

const brain = loadBrain();

const state = {
  positions: {},
  trades: [],
  recentlyTraded: {},
  running: true,
  startTime: Date.now(),
};

const CONFIG = {
  TELEGRAM_API_ID: parseInt(process.env.TELEGRAM_API_ID),
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH,
  TELEGRAM_PHONE: process.env.TELEGRAM_PHONE,
  TELEGRAM_SESSION: process.env.TELEGRAM_SESSION || '',
  TARGET_USERNAMES: ['marvcalledit', 'moodyelite'],
  GROUP: 'fomocabal',
  PUMPPORTAL_KEY: process.env.PUMPPORTAL_KEY,
  HELIUS_RPC: process.env.HELIUS_RPC,
  WALLET_ADDRESS: process.env.WALLET_ADDRESS,
  MAX_POSITIONS: 2,
  RUNTIME_MS: 24 * 60 * 60 * 1000,
};

const rpcConnection = new Connection(CONFIG.HELIUS_RPC, 'confirmed');
const walletPubkey = new PublicKey(CONFIG.WALLET_ADDRESS);

async function getRealBalance() {
  try {
    const lamports = await rpcConnection.getBalance(walletPubkey);
    return lamports / 1e9;
  } catch (e) {
    log('Balance check failed: ' + e.message);
    return null;
  }
}

function extractSolanaAddresses(text) {
  const pattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const matches = text.match(pattern) || [];
  return matches.filter(m => m.length >= 32 && m.length <= 44 && !m.includes('.') && !m.includes('/') && m !== 'So11111111111111111111111111111111111111112');
}

async function trade(action, mint, amount, denominatedInSol) {
  const body = {
    action, mint, amount,
    denominatedInSol: denominatedInSol ? 'true' : 'false',
    slippage: 25,
    priorityFee: 0.003,
    pool: 'auto',
  };
  const url = 'https://pumpportal.fun/api/trade?api-key=' + CONFIG.PUMPPORTAL_KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Bad response: ' + text.slice(0, 100)); }
  if (Array.isArray(data) && data.length > 0) return data[0];
  if (data && data.signature) return data.signature;
  if (typeof data === 'string' && data.length > 20) return data;
  throw new Error('Trade failed: ' + JSON.stringify(data).slice(0, 200));
}

async function snipe(mint, messageText, fromUser) {
  if (state.positions[mint]) return;
  if (state.recentlyTraded[mint]) return;
  if (Object.keys(state.positions).length >= CONFIG.MAX_POSITIONS) { log('Max positions reached'); return; }

  const balanceBefore = await getRealBalance();
  if (balanceBefore === null) { log('Cannot get balance, skipping snipe'); return; }
  if (balanceBefore < brain.solPerSnipe + 0.01) {
    log('Insufficient balance: ' + balanceBefore.toFixed(4) + ' SOL, need ' + (brain.solPerSnipe + 0.01).toFixed(4));
    return;
  }

  const size = brain.solPerSnipe;

  try {
    log('SNIPE from @' + fromUser + ' | ' + mint.slice(0, 8) + ' | Size: ' + size.toFixed(3) + ' SOL | Balance: ' + balanceBefore.toFixed(4) + ' SOL');
    const sig = await trade('buy', mint, size, true);

    // Wait for tx to settle
    await new Promise(r => setTimeout(r, 4000));

    const balanceAfter = await getRealBalance();
    const actualSpent = balanceAfter !== null ? balanceBefore - balanceAfter : size;

    log('BUY executed | Real cost: ' + actualSpent.toFixed(4) + ' SOL | Balance now: ' + (balanceAfter !== null ? balanceAfter.toFixed(4) : '?') + ' SOL | tx: ' + sig);

    state.positions[mint] = {
      mint, entryTime: Date.now(),
      solSpent: actualSpent,
      balanceBeforeBuy: balanceBefore,
      tp: brain.takeProfit,
      sl: brain.stopLoss,
      fromUser,
    };

    state.trades.push({ type: 'BUY', mint, solSpent: actualSpent, sig, fromUser, time: new Date().toISOString() });

    setTimeout(() => {
      if (state.positions[mint]) exitPos(mint, 'TIMEOUT');
    }, brain.maxHoldSec * 1000);

    fs.writeFileSync('./trades.json', JSON.stringify({ trades: state.trades, positions: state.positions, brain }, null, 2));
  } catch (e) {
    log('Snipe failed ' + mint.slice(0, 8) + ': ' + e.message);
  }
}

async function exitPos(mint, reason) {
  const pos = state.positions[mint];
  if (!pos) return;

  try {
    const balanceBeforeSell = await getRealBalance();
    log('SELLING ' + mint.slice(0, 8) + ' | reason: ' + reason);

    const sig = await trade('sell', mint, '100%', false);

    await new Promise(r => setTimeout(r, 4000));

    const balanceAfter = await getRealBalance();
    const holdTime = (Date.now() - pos.entryTime) / 1000;

    // REAL PnL = what we have now vs what we had before buying
    const realPnL = balanceAfter !== null && pos.balanceBeforeBuy ? balanceAfter - pos.balanceBeforeBuy : 0;
    const realPnLPct = pos.solSpent > 0 ? (realPnL / pos.solSpent) * 100 : 0;

    log('SELL done | Balance: ' + (balanceAfter !== null ? balanceAfter.toFixed(4) : '?') + ' SOL | tx: ' + sig);

    state.trades.push({ type: 'SELL', mint, pnl: realPnL, pct: realPnLPct, reason, sig, time: new Date().toISOString() });
    delete state.positions[mint];
    state.recentlyTraded[mint] = Date.now();

    recordTrade(realPnL, realPnLPct, holdTime, mint, reason);

    const result = realPnL > 0 ? '🟢 REAL WIN' : realPnL < 0 ? '🔴 REAL LOSS' : 'FLAT';
    log(result + ' | ' + mint.slice(0, 8) + ' | ' + (realPnL > 0 ? '+' : '') + realPnL.toFixed(4) + ' SOL (' + realPnLPct.toFixed(1) + '%) | ' + holdTime.toFixed(0) + 's');
    log('REAL BRAIN: ' + brain.wins + 'W/' + brain.losses + 'L | Streak: ' + brain.streak + ' | Total Real PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL');

    fs.writeFileSync('./trades.json', JSON.stringify({ trades: state.trades, positions: state.positions, brain }, null, 2));
  } catch (e) {
    log('Sell failed: ' + e.message);
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
        const priceChange5m = pair.priceChange ? (pair.priceChange.m5 || 0) : 0;
        const priceChange1h = pair.priceChange ? (pair.priceChange.h1 || 0) : 0;
        const pnlPct = Math.max(priceChange5m, priceChange1h);
        const lossPct = Math.min(priceChange5m, priceChange1h);

        log('Monitor ' + mint.slice(0, 8) + ' | 5m: ' + priceChange5m.toFixed(1) + '% | 1h: ' + priceChange1h.toFixed(1) + '%');

        if (pnlPct >= pos.tp * 100) {
          await exitPos(mint, 'TAKE_PROFIT');
        } else if (lossPct <= -(pos.sl * 100)) {
          await exitPos(mint, 'STOP_LOSS');
        }
      } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 8000));
  }
}

async function main() {
  log('FOMO CABAL SNIPER v10 - REAL BALANCE TRACKING');
  log('Watching: @marvcalledit AND @moodyelite in t.me/fomocabal');
  log('Brain: TP ' + (brain.takeProfit * 100).toFixed(0) + '% | SL ' + (brain.stopLoss * 100).toFixed(0) + '% | Size ' + brain.solPerSnipe.toFixed(3) + ' SOL');

  if (!CONFIG.PUMPPORTAL_KEY) { log('ERROR: PUMPPORTAL_KEY missing'); process.exit(1); }
  if (!CONFIG.HELIUS_RPC) { log('ERROR: HELIUS_RPC missing'); process.exit(1); }
  if (!CONFIG.WALLET_ADDRESS) { log('ERROR: WALLET_ADDRESS missing'); process.exit(1); }

  const startBal = await getRealBalance();
  log('Starting wallet balance: ' + (startBal !== null ? startBal.toFixed(4) : '?') + ' SOL');
  if (!brain.startingBalance) { brain.startingBalance = startBal; saveBrain(); }

  const session = new StringSession(CONFIG.TELEGRAM_SESSION);
  const client = new TelegramClient(session, CONFIG.TELEGRAM_API_ID, CONFIG.TELEGRAM_API_HASH, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => CONFIG.TELEGRAM_PHONE,
    phoneCode: async () => { throw new Error('Need fresh session'); },
    onError: (err) => log('Telegram error: ' + err.message),
  });

  log('Telegram connected!');

  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg || !msg.text) return;
      const sender = await msg.getSender();
      if (!sender) return;
      const username = sender.username ? sender.username.toLowerCase() : '';
      if (!CONFIG.TARGET_USERNAMES.includes(username)) return;

      log('MESSAGE FROM @' + username + ': ' + msg.text.slice(0, 150));

      const addresses = extractSolanaAddresses(msg.text);
      if (addresses.length === 0) {
        log('No CA in message');
        return;
      }

      log('Found CA(s): ' + addresses.join(', '));
      for (const addr of addresses) {
        await snipe(addr, msg.text, username);
      }
    } catch (e) {
      log('Handler error: ' + e.message);
    }
  }, new NewMessage({ chats: [CONFIG.GROUP] }));

  log('Ready to snipe with REAL tracking! 🐺');

  monitorPositions();

  setInterval(async () => {
    const bal = await getRealBalance();
    const wr = brain.totalTrades > 0 ? ((brain.wins / brain.totalTrades) * 100).toFixed(0) : 0;
    log('STATS | Wallet: ' + (bal !== null ? bal.toFixed(4) : '?') + ' SOL | ' + brain.wins + 'W/' + brain.losses + 'L (' + wr + '%) | Real PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL | Open: ' + Object.keys(state.positions).length);
  }, 5 * 60 * 1000);

  await new Promise(() => {});
}

process.on('SIGINT', async () => {
  state.running = false;
  for (const mint in state.positions) {
    await exitPos(mint, 'MANUAL_STOP');
  }
  process.exit(0);
});

main().catch((e) => {
  log('Fatal: ' + e.message);
  process.exit(1);
});
