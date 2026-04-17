require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fetch = require('node-fetch');
const fs = require('fs');
const input = require('input');

const BRAIN_FILE = './brain.json';
const SESSION_FILE = './session.json';

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
      log('Brain loaded: ' + b.totalTrades + ' trades | ' + b.wins + 'W/' + b.losses + 'L | PnL: ' + (b.totalPnlSOL > 0 ? '+' : '') + b.totalPnlSOL.toFixed(4) + ' SOL');
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
    takeProfit: 1.50,
    stopLoss: 0.40,
    maxHoldSec: 300,
    solPerSnipe: 0.10,
    streak: 0,
    bestStreak: 0,
    recentTrades: [],
    callerStats: {},
    startingBalance: 0.25,
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

  // Scale position size based on performance
  if (streak >= 3) {
    brain.solPerSnipe = Math.min(0.25, brain.solPerSnipe * 1.25);
    log('Brain: Hot streak ' + streak + ' - sizing up to ' + brain.solPerSnipe.toFixed(3) + ' SOL');
  } else if (streak <= -2) {
    brain.solPerSnipe = Math.max(0.03, brain.solPerSnipe * 0.75);
    log('Brain: Cold streak ' + streak + ' - sizing down to ' + brain.solPerSnipe.toFixed(3) + ' SOL');
  }

  // Adjust take profit
  if (streak >= 3) {
    brain.takeProfit = Math.min(5.0, brain.takeProfit * 1.3);
    log('Brain: Raising TP to ' + (brain.takeProfit * 100).toFixed(0) + '% - let winners run!');
  } else if (recentWinRate < 0.3) {
    brain.takeProfit = Math.max(0.50, brain.takeProfit * 0.85);
    log('Brain: Lowering TP to ' + (brain.takeProfit * 100).toFixed(0) + '% - take profits faster');
  }

  // Adjust stop loss
  if (streak <= -3) {
    brain.stopLoss = Math.max(0.15, brain.stopLoss * 0.80);
    log('Brain: Tightening SL to ' + (brain.stopLoss * 100).toFixed(0) + '%');
  } else if (streak >= 4) {
    brain.stopLoss = Math.min(0.60, brain.stopLoss * 1.1);
    log('Brain: Loosening SL to ' + (brain.stopLoss * 100).toFixed(0) + '% - more room to breathe');
  }

  // Adjust hold time based on winning trade timing
  if (brain.avgHoldTimeWin > 0) {
    brain.maxHoldSec = Math.round(Math.min(600, Math.max(60, brain.avgHoldTimeWin * 2)));
    log('Brain: Optimal hold time set to ' + brain.maxHoldSec + 's based on win history');
  }

  saveBrain();
}

function recordTrade(pnlSOL, pnlPct, holdTime, mint, reason) {
  brain.recentTrades.push({
    pnl: pnlSOL,
    pct: pnlPct,
    holdTime: holdTime,
    mint: mint,
    reason: reason,
    time: Date.now()
  });
  if (brain.recentTrades.length > 50) brain.recentTrades.shift();

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
  TARGET_USERNAME: 'moodyelite',
  GROUP: 'fomocabal',
  PUMPPORTAL_KEY: process.env.PUMPPORTAL_KEY,
  MAX_POSITIONS: 3,
  RUNTIME_MS: 24 * 60 * 60 * 1000,
};

// Extract Solana contract addresses from message text
function extractSolanaAddresses(text) {
  // Solana addresses are base58, 32-44 chars
  const pattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const matches = text.match(pattern) || [];
  // Filter to likely Solana addresses (not URLs, not too short)
  return matches.filter(function(m) {
    return m.length >= 32 &&
           m.length <= 44 &&
           !m.includes('.') &&
           !m.includes('/') &&
           m !== 'So11111111111111111111111111111111111111112';
  });
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

  const url = 'https://pumpportal.fun/api/trade?api-key=' + CONFIG.PUMPPORTAL_KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  log('Trade API response: ' + text.slice(0, 150));

  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Bad response: ' + text.slice(0, 100)); }

  if (Array.isArray(data) && data.length > 0) return data[0];
  if (data && data.signature) return data.signature;
  if (typeof data === 'string' && data.length > 20) return data;
  throw new Error('Trade failed: ' + JSON.stringify(data).slice(0, 200));
}

async function snipe(mint, messageText) {
  if (state.positions[mint]) { log('Already in position for ' + mint.slice(0, 8)); return; }
  if (state.recentlyTraded[mint]) { log('Recently traded ' + mint.slice(0, 8) + ' - skipping'); return; }
  if (Object.keys(state.positions).length >= CONFIG.MAX_POSITIONS) { log('Max positions reached'); return; }

  const size = brain.solPerSnipe;

  try {
    log('MOODY CALLED IT! Sniping ' + mint.slice(0, 8) + '... | Size: ' + size.toFixed(3) + ' SOL | TP: ' + (brain.takeProfit * 100).toFixed(0) + '% | SL: ' + (brain.stopLoss * 100).toFixed(0) + '%');
    log('Message: ' + messageText.slice(0, 100));

    const sig = await trade('buy', mint, size, true);
    log('BUY confirmed! | tx: ' + sig + ' | mint: ' + mint);

    state.positions[mint] = {
      mint: mint,
      entryTime: Date.now(),
      solSpent: size,
      tp: brain.takeProfit,
      sl: brain.stopLoss,
      maxHold: brain.maxHoldSec,
      message: messageText.slice(0, 200),
    };

    state.trades.push({
      type: 'BUY',
      mint: mint,
      solSpent: size,
      sig: sig,
      message: messageText.slice(0, 200),
      time: new Date().toISOString()
    });

    log('Position open! Total positions: ' + Object.keys(state.positions).length);

    // Auto exit after max hold time
    setTimeout(function() {
      if (state.positions[mint]) {
        log('Max hold time reached for ' + mint.slice(0, 8) + ' - exiting');
        exitPos(mint, 'TIMEOUT');
      }
    }, brain.maxHoldSec * 1000);

    saveState();
  } catch (e) {
    log('Snipe failed for ' + mint.slice(0, 8) + ': ' + e.message);
  }
}

async function exitPos(mint, reason) {
  const pos = state.positions[mint];
  if (!pos) return;

  try {
    log('SELLING ' + mint.slice(0, 8) + ' | reason: ' + reason);
    const sig = await trade('sell', mint, '100%', false);
    const holdTime = (Date.now() - pos.entryTime) / 1000;

    log('SELL confirmed | tx: ' + sig + ' | held: ' + holdTime.toFixed(0) + 's');

    const estimatedPnl = reason === 'TAKE_PROFIT' ? pos.solSpent * brain.takeProfit :
                         reason === 'STOP_LOSS' ? -(pos.solSpent * brain.stopLoss) : 0;
    const estimatedPct = (estimatedPnl / pos.solSpent) * 100;

    state.trades.push({
      type: 'SELL',
      mint: mint,
      pnl: estimatedPnl,
      pct: estimatedPct,
      reason: reason,
      sig: sig,
      time: new Date().toISOString()
    });

    delete state.positions[mint];
    state.recentlyTraded[mint] = Date.now();
    recordTrade(estimatedPnl, estimatedPct, holdTime, mint, reason);

    const result = estimatedPnl > 0 ? 'WIN' : estimatedPnl < 0 ? 'LOSS' : 'TIMEOUT';
    log(result + ' | ' + mint.slice(0, 8) + ' | ' + (estimatedPnl > 0 ? '+' : '') + estimatedPnl.toFixed(4) + ' SOL (' + estimatedPct.toFixed(1) + '%) | ' + holdTime.toFixed(0) + 's | ' + reason);
    log('Brain: ' + brain.wins + 'W/' + brain.losses + 'L | Streak: ' + brain.streak + ' | Total PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL');

    saveState();
  } catch (e) {
    log('Sell failed for ' + mint.slice(0, 8) + ': ' + e.message);
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

        log('Monitor ' + mint.slice(0, 8) + ' | 5m: ' + priceChange5m.toFixed(1) + '% | 1h: ' + priceChange1h.toFixed(1) + '%');

        // Use 5m change for quick moves, 1h for bigger picture
        const pnlPct = Math.max(priceChange5m, priceChange1h);
        const lossPct = Math.min(priceChange5m, priceChange1h);

        if (pnlPct >= pos.tp * 100) {
          log('TP HIT! ' + mint.slice(0, 8) + ': +' + pnlPct.toFixed(1) + '%');
          await exitPos(mint, 'TAKE_PROFIT');
        } else if (lossPct <= -(pos.sl * 100)) {
          log('SL hit ' + mint.slice(0, 8) + ': ' + lossPct.toFixed(1) + '%');
          await exitPos(mint, 'STOP_LOSS');
        }
      } catch (e) {}
    }
    await new Promise(function(r) { setTimeout(r, 10000); });
  }
}

function saveState() {
  fs.writeFileSync('./trades.json', JSON.stringify({
    trades: state.trades,
    positions: state.positions,
    brain: brain
  }, null, 2));
}

async function main() {
  log('FOMO ELITE CABAL SNIPER');
  log('Watching: @moodyelite in t.me/fomocabal');
  log('Brain: TP ' + (brain.takeProfit * 100).toFixed(0) + '% | SL ' + (brain.stopLoss * 100).toFixed(0) + '% | Size ' + brain.solPerSnipe.toFixed(3) + ' SOL');

  if (!CONFIG.PUMPPORTAL_KEY) { log('ERROR: PUMPPORTAL_KEY missing'); process.exit(1); }
  if (!CONFIG.TELEGRAM_API_ID) { log('ERROR: TELEGRAM_API_ID missing'); process.exit(1); }

  // Connect to Telegram
  const session = new StringSession(CONFIG.TELEGRAM_SESSION);
  const client = new TelegramClient(session, CONFIG.TELEGRAM_API_ID, CONFIG.TELEGRAM_API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async function() { return CONFIG.TELEGRAM_PHONE; },
    password: async function() { return await input.text('2FA password (if enabled): '); },
    phoneCode: async function() { return await input.text('Enter Telegram code: '); },
    onError: function(err) { log('Telegram error: ' + err.message); },
  });

  log('Telegram connected!');

  // Save session string so we don't need to re-auth
  const sessionStr = client.session.save();
  log('Session: ' + sessionStr);
  log('SAVE THIS SESSION STRING AS TELEGRAM_SESSION IN RAILWAY VARIABLES!');

  // Listen for messages
  client.addEventHandler(async function(event) {
    try {
      const msg = event.message;
      if (!msg || !msg.text) return;

      // Get sender info
      const sender = await msg.getSender();
      if (!sender) return;

      const username = sender.username ? sender.username.toLowerCase() : '';
      const firstName = sender.firstName || '';

      // Only act on messages from @moodyelite
      if (username !== CONFIG.TARGET_USERNAME) return;

      log('MESSAGE FROM MOODY: ' + msg.text.slice(0, 200));

      // Extract contract addresses
      const addresses = extractSolanaAddresses(msg.text);
      if (addresses.length === 0) {
        log('No contract address found in message');
        return;
      }

      log('Found ' + addresses.length + ' address(es): ' + addresses.join(', '));

      // Snipe each address found
      for (const addr of addresses) {
        await snipe(addr, msg.text);
      }

    } catch (e) {
      log('Message handler error: ' + e.message);
    }
  }, new NewMessage({ chats: [CONFIG.GROUP] }));

  log('Listening for calls from @moodyelite in FOMO ELITE CABAL...');
  log('Ready to snipe! Waiting for Moody to call something... 🐺');

  // Start position monitor
  monitorPositions();

  // Stats every 5 minutes
  setInterval(function() {
    const wr = brain.totalTrades > 0 ? ((brain.wins / brain.totalTrades) * 100).toFixed(0) : 0;
    log('STATS | ' + brain.wins + 'W/' + brain.losses + 'L (' + wr + '%) | PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL | Streak: ' + brain.streak + ' | Open: ' + Object.keys(state.positions).length);
  }, 5 * 60 * 1000);

  // Keep alive
  await new Promise(function() {});
}

process.on('SIGINT', async function() {
  state.running = false;
  log('Shutting down - closing all positions...');
  for (const mint in state.positions) {
    await exitPos(mint, 'MANUAL_STOP');
  }
  saveState();
  process.exit(0);
});

main().catch(function(e) {
  log('Fatal: ' + e.message);
  process.exit(1);
});
