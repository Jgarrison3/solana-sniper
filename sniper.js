require('dotenv').config();
const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');

// Optional deps — graceful degradation if not installed yet
let Connection, PublicKey;
try { ({ Connection, PublicKey } = require('@solana/web3.js')); } catch (_) {}
let TelegramClient, StringSession, NewMessage;
try {
  ({ TelegramClient } = require('telegram'));
  ({ StringSession } = require('telegram/sessions'));
  ({ NewMessage } = require('telegram/events'));
} catch (_) {}

// ─── LOGGING ──────────────────────────────────────────────────────────────────
const LOG_FILE = './sniper.log';
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  PUMPPORTAL_KEY:      process.env.PUMPPORTAL_KEY || '',
  HELIUS_RPC:          process.env.HELIUS_RPC || 'https://api.mainnet-beta.solana.com',
  WALLET_ADDRESS:      process.env.WALLET_ADDRESS || '',

  // Risk limits
  MAX_POSITIONS:          parseInt(process.env.MAX_POSITIONS        || '3'),
  DAILY_LOSS_LIMIT_SOL:   parseFloat(process.env.DAILY_LOSS_LIMIT_SOL || '0.5'),

  // PumpFun token screening
  MIN_SOL_IN_CURVE:       parseFloat(process.env.MIN_SOL_IN_CURVE   || '3'),
  MAX_BONDING_CURVE_PCT:  parseFloat(process.env.MAX_BONDING_CURVE_PCT || '28'),
  MAX_DEV_HOLDING_PCT:    parseFloat(process.env.MAX_DEV_HOLDING_PCT || '8'),
  MIN_UNIQUE_BUYERS:      parseInt(process.env.MIN_UNIQUE_BUYERS    || '6'),
  MIN_BUY_SELL_RATIO:     parseFloat(process.env.MIN_BUY_SELL_RATIO || '2.5'),
  MIN_VOLUME_SOL_WINDOW:  parseFloat(process.env.MIN_VOLUME_SOL_WINDOW || '1.5'),
  OBSERVATION_MS:         parseInt(process.env.OBSERVATION_MS      || '40000'),
  // Telegram (optional secondary source)
  TELEGRAM_API_ID:   parseInt(process.env.TELEGRAM_API_ID || '0'),
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || '',
  TELEGRAM_PHONE:    process.env.TELEGRAM_PHONE || '',
  TELEGRAM_SESSION:  process.env.TELEGRAM_SESSION || '',
  TELEGRAM_GROUPS:  (process.env.TELEGRAM_GROUPS || 'fomocabal').split(',').map(s => s.trim()),
  TELEGRAM_USERS:   (process.env.TELEGRAM_USERS  || 'marvcalledit,moodyelite').split(',').map(s => s.trim()),
};

// ─── BRAIN (adaptive learning) ───────────────────────────────────────────────
const BRAIN_FILE = './brain.json';
const DEFAULTS = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnlSOL: 0,
  recentTrades: [],
  streak: 0,
  bestStreak: 0,
  startingBalance: 0,
  // Tunable trade params
  solPerSnipe:    parseFloat(process.env.SOL_PER_SNIPE  || '0.10'),
  tp1Pct:         75,    // sell 50 % of position at +75 %
  tp2Pct:         100,   // sell rest at +100 % (2X)
  trailArmPct:    55,    // arm trailing stop after +55 %
  trailPct:       22,    // trail 22 % below peak
  stopLossPct:    30,    // hard stop at −30 %
  maxHoldSec:     parseInt(process.env.MAX_HOLD_SEC || '300'),
  // Daily bookkeeping
  dailyPnl:      0,
  lastResetDay:  '',
};

let brain = (() => {
  try {
    if (fs.existsSync(BRAIN_FILE)) {
      const saved = JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf8'));
      const today = new Date().toDateString();
      if (saved.lastResetDay !== today) { saved.dailyPnl = 0; saved.lastResetDay = today; }
      const b = { ...DEFAULTS, ...saved };
      log(`Brain loaded | ${b.totalTrades} trades | ${b.wins}W/${b.losses}L | pnl: ${b.totalPnlSOL >= 0 ? '+' : ''}${b.totalPnlSOL.toFixed(4)} SOL`);
      return b;
    }
  } catch (_) {}
  const b = { ...DEFAULTS, lastResetDay: new Date().toDateString() };
  return b;
})();

function saveBrain() {
  try { fs.writeFileSync(BRAIN_FILE, JSON.stringify(brain, null, 2)); } catch (_) {}
}

function adaptBrain() {
  if (brain.totalTrades < 5) return;
  const recent = brain.recentTrades.slice(-10);
  const wr = recent.length ? recent.filter(t => t.pnl > 0).length / recent.length : 0.5;

  // Size: grow on hot streaks, shrink on cold
  if (brain.streak >= 3) {
    brain.solPerSnipe = +Math.min(0.35, brain.solPerSnipe * 1.12).toFixed(4);
    log(`Brain+: streak ${brain.streak} → size ${brain.solPerSnipe} SOL`);
  } else if (brain.streak <= -2) {
    brain.solPerSnipe = +Math.max(0.04, brain.solPerSnipe * 0.80).toFixed(4);
    log(`Brain-: streak ${brain.streak} → size ${brain.solPerSnipe} SOL`);
  }

  // TP: tighten when struggling, loosen when winning
  if (wr >= 0.65 && brain.streak > 0) {
    brain.tp2Pct = Math.min(200, +(brain.tp2Pct * 1.08).toFixed(1));
  } else if (wr < 0.35 && brain.streak < 0) {
    brain.tp2Pct = Math.max(50, +(brain.tp2Pct * 0.90).toFixed(1));
    brain.tp1Pct = Math.max(30, +(brain.tp1Pct * 0.90).toFixed(1));
  }

  saveBrain();
}

function recordTrade({ pnlSOL, pnlPct, holdSec, mint, reason, source }) {
  brain.recentTrades.push({ pnl: pnlSOL, pct: pnlPct, holdSec, mint, reason, source, t: Date.now() });
  if (brain.recentTrades.length > 60) brain.recentTrades.shift();
  brain.totalTrades++;
  brain.totalPnlSOL  = +(brain.totalPnlSOL + pnlSOL).toFixed(6);
  brain.dailyPnl     = +(brain.dailyPnl    + pnlSOL).toFixed(6);
  if (pnlSOL > 0) {
    brain.wins++;
    brain.streak   = Math.max(0, brain.streak) + 1;
    brain.bestStreak = Math.max(brain.bestStreak, brain.streak);
  } else {
    brain.losses++;
    brain.streak = Math.min(0, brain.streak) - 1;
  }
  saveBrain();
  adaptBrain();
}

// ─── GLOBAL STATE ─────────────────────────────────────────────────────────────
const state = {
  positions:      {},   // mint → PositionInfo
  watching:       {},   // mint → WatchInfo  (observation window)
  recentlyTraded: {},   // mint → timestamp  (30-min cooldown)
  allTrades:      [],
  running:        true,
  halted:         false,
};

// ─── RPC / BALANCE ────────────────────────────────────────────────────────────
let rpc = null;
if (Connection && PublicKey && CONFIG.HELIUS_RPC && CONFIG.WALLET_ADDRESS) {
  try {
    rpc = { conn: new Connection(CONFIG.HELIUS_RPC, 'confirmed'), pk: new PublicKey(CONFIG.WALLET_ADDRESS) };
  } catch (_) {}
}

async function getBalance() {
  if (!rpc) return null;
  try { return (await rpc.conn.getBalance(rpc.pk)) / 1e9; } catch (_) { return null; }
}

// ─── TOKEN INFO ───────────────────────────────────────────────────────────────
async function fetchTokenInfo(mint) {
  try {
    const r = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, { timeout: 6000 });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

async function fetchDexPrice(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000,
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.pairs || d.pairs.length === 0) return null;
    // Prefer pump.fun pair if it exists
    const pair = d.pairs.find(p => p.dexId === 'pumpfun') || d.pairs[0];
    return {
      priceUsd:      parseFloat(pair.priceUsd || '0'),
      priceChange5m: pair.priceChange?.m5  || 0,
      priceChange1h: pair.priceChange?.h1  || 0,
      liquidity:     pair.liquidity?.usd   || 0,
      volume5m:      pair.volume?.m5       || 0,
      fdv:           pair.fdv              || 0,
    };
  } catch (_) { return null; }
}

// ─── TRADE EXECUTION ──────────────────────────────────────────────────────────
async function executeTrade(action, mint, amount, denominatedInSol = true, slippage = 20, retries = 2) {
  const url = `https://pumpportal.fun/api/trade?api-key=${CONFIG.PUMPPORTAL_KEY}`;
  const body = {
    action,
    mint,
    amount,
    denominatedInSol: denominatedInSol ? 'true' : 'false',
    slippage,
    priorityFee: 0.005,
    pool: 'pump',
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeout: 15000,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error(`Non-JSON: ${text.slice(0, 80)}`); }
      if (Array.isArray(data) && data[0]) return data[0];
      if (data?.signature) return data.signature;
      if (typeof data === 'string' && data.length > 20) return data;
      throw new Error(`Trade API: ${JSON.stringify(data).slice(0, 120)}`);
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
}

// ─── ENTRY FILTER ─────────────────────────────────────────────────────────────
// Returns { pass: bool, reason: string, score: number }
function scoreEntry(watch) {
  const { meta, stats } = watch;
  const reasons = [];
  let score = 0;

  // ── Hard filters (any fail = reject) ────────────────────────────────────────
  const bcPct = meta?.bondingCurveProgress ?? calcBcPct(stats.solInCurve);
  if (bcPct > CONFIG.MAX_BONDING_CURVE_PCT) {
    return { pass: false, reason: `bc_pct=${bcPct.toFixed(1)}%>max` };
  }
  if (stats.solInCurve < CONFIG.MIN_SOL_IN_CURVE) {
    return { pass: false, reason: `sol_in_curve=${stats.solInCurve.toFixed(2)}<min` };
  }
  if ((meta?.devHoldingPct || 0) > CONFIG.MAX_DEV_HOLDING_PCT) {
    return { pass: false, reason: `dev_holding=${meta.devHoldingPct.toFixed(1)}%>max` };
  }
  const cooldown30min = 30 * 60 * 1000;
  if (state.recentlyTraded[watch.mint] && Date.now() - state.recentlyTraded[watch.mint] < cooldown30min) {
    return { pass: false, reason: 'cooldown' };
  }
  if (meta?.complete) {
    return { pass: false, reason: 'already_graduated' };
  }

  // ── Scored filters ───────────────────────────────────────────────────────────
  if (stats.uniqueBuyers >= CONFIG.MIN_UNIQUE_BUYERS) { score += 30; reasons.push(`buyers:${stats.uniqueBuyers}`); }
  else return { pass: false, reason: `buyers=${stats.uniqueBuyers}<min` };

  if (stats.volumeSolWindow >= CONFIG.MIN_VOLUME_SOL_WINDOW) { score += 25; reasons.push(`vol:${stats.volumeSolWindow.toFixed(2)}SOL`); }
  else return { pass: false, reason: `vol=${stats.volumeSolWindow.toFixed(2)}<min` };

  const bsr = stats.sells > 0 ? stats.buys / stats.sells : stats.buys;
  if (bsr >= CONFIG.MIN_BUY_SELL_RATIO) { score += 25; reasons.push(`bsr:${bsr.toFixed(1)}`); }
  else return { pass: false, reason: `bsr=${bsr.toFixed(1)}<min` };

  // Momentum: price went up during observation (required)
  if (stats.priceAtEnd > stats.priceAtStart && stats.priceAtStart > 0) {
    const momentum = ((stats.priceAtEnd - stats.priceAtStart) / stats.priceAtStart) * 100;
    if (momentum > 5) { score += 20; reasons.push(`momentum:+${momentum.toFixed(0)}%`); }
  } else {
    return { pass: false, reason: 'no_upward_momentum' };
  }

  // Bonus: large buys (>0.5 SOL each) are a bullish signal
  if (stats.largeBuys >= 2) { score += 10; reasons.push(`largeBuys:${stats.largeBuys}`); }

  return { pass: true, reason: reasons.join(' | '), score };
}

function calcBcPct(solInCurve) {
  return Math.min(100, (solInCurve / 793) * 100);
}

// ─── SNIPE (BUY) ──────────────────────────────────────────────────────────────
async function snipe(mint, source, entryCtx = {}) {
  if (state.halted)                                     { log(`HALTED – skipping ${mint.slice(0,8)}`); return; }
  if (state.positions[mint])                            return;
  if (state.watching[mint])                             return;
  if (state.recentlyTraded[mint] && Date.now() - state.recentlyTraded[mint] < 30 * 60 * 1000) return;
  if (Object.keys(state.positions).length >= CONFIG.MAX_POSITIONS) { log(`Max positions hit`); return; }

  const balBefore = await getBalance();
  const size = brain.solPerSnipe;
  if (balBefore !== null && balBefore < size + 0.015) {
    log(`Low balance: ${balBefore.toFixed(4)} SOL < ${(size + 0.015).toFixed(3)}`);
    return;
  }

  log(`SNIPE [${source}] ${mint.slice(0,8)} | ${size.toFixed(3)} SOL | bc%:${(entryCtx.bcPct||0).toFixed(1)} buyers:${entryCtx.uniqueBuyers||'?'}`);
  try {
    const sig = await executeTrade('buy', mint, size, true);
    await sleep(3500);
    const balAfter = await getBalance();
    const spent = (balBefore !== null && balAfter !== null) ? balBefore - balAfter : size;

    log(`BUY ✓ | spent:${spent.toFixed(4)} SOL | bal:${balAfter?.toFixed(4) ?? '?'} | sig:${sig.slice(0,20)}…`);
    state.positions[mint] = {
      mint,
      entryTime:  Date.now(),
      totalSpent: spent,
      balBefore,
      // Price tracking (set by position monitor from WebSocket or DexScreener)
      entryPrice:  entryCtx.price || 0,
      peakPrice:   entryCtx.price || 0,
      peakPct:     0,
      trailArmed:  false,
      tp1Hit:      false,
      source,
      ctx: entryCtx,
    };
    state.allTrades.push({ type: 'BUY', mint, sol: spent, sig, source, t: Date.now() });
    persistState();

    // Hard time stop
    setTimeout(() => { if (state.positions[mint]) exitPosition(mint, 'TIMEOUT'); },
               brain.maxHoldSec * 1000);
  } catch (e) {
    log(`Snipe failed ${mint.slice(0,8)}: ${e.message}`);
  }
}

// ─── EXIT POSITION ────────────────────────────────────────────────────────────
async function exitPosition(mint, reason, portion = '100%') {
  const pos = state.positions[mint];
  if (!pos) return;

  const isFull = portion === '100%';
  log(`EXIT ${mint.slice(0,8)} | reason:${reason} | portion:${portion}`);
  try {
    const balBefore = await getBalance();
    const sig = await executeTrade('sell', mint, portion, false, 25);
    await sleep(3500);
    const balAfter = await getBalance();
    const holdSec = (Date.now() - pos.entryTime) / 1000;

    if (isFull) {
      const pnlSOL = (balBefore !== null && pos.balBefore !== null)
        ? balAfter - pos.balBefore
        : 0;
      const pnlPct = pos.totalSpent > 0 ? (pnlSOL / pos.totalSpent) * 100 : 0;

      log(`SELL ✓ | bal:${balAfter?.toFixed(4) ?? '?'} | pnl:${pnlSOL >= 0 ? '+' : ''}${pnlSOL.toFixed(4)} SOL (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%) | hold:${holdSec.toFixed(0)}s`);
      log(`${pnlSOL > 0.001 ? '[WIN]' : pnlSOL < -0.001 ? '[LOSS]' : '[FLAT]'} ${brain.wins}W/${brain.losses}L | streak:${brain.streak} | totalPnl:${brain.totalPnlSOL >= 0 ? '+' : ''}${brain.totalPnlSOL.toFixed(4)} SOL`);

      state.allTrades.push({ type: 'SELL', mint, pnl: pnlSOL, pct: pnlPct, reason, sig, t: Date.now() });
      delete state.positions[mint];
      state.recentlyTraded[mint] = Date.now();
      recordTrade({ pnlSOL, pnlPct, holdSec, mint, reason, source: pos.source });

      if (brain.dailyPnl <= -CONFIG.DAILY_LOSS_LIMIT_SOL) {
        state.halted = true;
        log(`*** HALTED: daily loss limit (${brain.dailyPnl.toFixed(4)} SOL today). Will resume tomorrow. ***`);
      }
    } else {
      // Partial exit: update basis so final PnL calc is correct
      pos.balBefore = balAfter;
      pos.totalSpent *= 0.5; // rough adjustment for remaining half
      pos.tp1Hit = true;
      log(`PARTIAL SELL ✓ | new basis:${balAfter?.toFixed(4) ?? '?'} | hold:${holdSec.toFixed(0)}s`);
    }
    persistState();
  } catch (e) {
    log(`Exit failed ${mint.slice(0,8)}: ${e.message}`);
    // On sell failure, still remove from positions to avoid stuck state
    if (isFull) {
      delete state.positions[mint];
      state.recentlyTraded[mint] = Date.now();
    }
  }
}

// ─── POSITION MONITOR ────────────────────────────────────────────────────────
// Runs every 5 s. Uses DexScreener for price; WebSocket events supplement this.
async function positionMonitorLoop() {
  while (state.running) {
    for (const mint of Object.keys(state.positions)) {
      await checkPosition(mint);
    }
    await sleep(5000);
  }
}

async function checkPosition(mint) {
  const pos = state.positions[mint];
  if (!pos) return;

  // Try DexScreener first; fall back to bonding-curve price from watch stats
  let changePct = 0;
  const dex = await fetchDexPrice(mint);
  if (dex) {
    // Best estimate: use the max of 5m / 1h price change as proxy for our gain
    // (We entered early so our gain ≥ the 5m candle in most cases)
    const raw = Math.max(dex.priceChange5m, dex.priceChange1h);
    const rawLow = Math.min(dex.priceChange5m, dex.priceChange1h);
    changePct = raw;

    // Detect volume collapse — early exit signal
    if (dex.volume5m < 50 && pos.peakPct > 20) {
      log(`Volume collapse on ${mint.slice(0,8)} (vol5m=$${dex.volume5m.toFixed(0)}) — exiting`);
      await exitPosition(mint, 'VOL_COLLAPSE');
      return;
    }

    log(`Monitor ${mint.slice(0,8)} | 5m:${dex.priceChange5m.toFixed(1)}% 1h:${dex.priceChange1h.toFixed(1)}% | peak:${pos.peakPct.toFixed(1)}%`);
  } else if (pos.wsPrice) {
    // WebSocket-derived price (updated by pumpfun feed)
    if (pos.entryPrice > 0) {
      changePct = ((pos.wsPrice - pos.entryPrice) / pos.entryPrice) * 100;
    }
  }

  // Update peak
  if (changePct > pos.peakPct) {
    pos.peakPct = changePct;
    if (pos.entryPrice > 0 && dex?.priceUsd) {
      pos.peakPrice = dex.priceUsd;
    }
  }

  // ── Partial TP1: sell 50 % at brain.tp1Pct gain ───────────────────────────
  if (!pos.tp1Hit && changePct >= brain.tp1Pct) {
    log(`TP1 hit ${mint.slice(0,8)} at +${changePct.toFixed(1)}% — selling 50 %`);
    await exitPosition(mint, 'TP1_PARTIAL', '50%');
    return;
  }

  // ── Hard TP2: sell 100 % at brain.tp2Pct gain ─────────────────────────────
  if (changePct >= brain.tp2Pct) {
    log(`TP2 hit ${mint.slice(0,8)} at +${changePct.toFixed(1)}% — full exit`);
    await exitPosition(mint, 'TAKE_PROFIT');
    return;
  }

  // ── Trailing stop ─────────────────────────────────────────────────────────
  if (!pos.trailArmed && pos.peakPct >= brain.trailArmPct) {
    pos.trailArmed = true;
    log(`Trail ARMED on ${mint.slice(0,8)} (peak:${pos.peakPct.toFixed(1)}%)`);
  }
  if (pos.trailArmed) {
    const dropFromPeak = pos.peakPct - changePct;
    if (dropFromPeak >= brain.trailPct) {
      log(`Trail STOP ${mint.slice(0,8)} | peak:${pos.peakPct.toFixed(1)}% drop:${dropFromPeak.toFixed(1)}%`);
      await exitPosition(mint, 'TRAIL_STOP');
      return;
    }
  }

  // ── Hard stop-loss ────────────────────────────────────────────────────────
  if (changePct <= -brain.stopLossPct) {
    log(`Stop LOSS ${mint.slice(0,8)} at ${changePct.toFixed(1)}%`);
    await exitPosition(mint, 'STOP_LOSS');
    return;
  }
}

// ─── PUMPFUN WEBSOCKET ────────────────────────────────────────────────────────
// Listens for new token launches and early trade flow to find high-momentum entries.
function startPumpFunWebSocket() {
  const WS_URL = 'wss://pumpportal.fun/api/data';
  let ws, reconnectDelay = 2000;

  function connect() {
    log(`PumpFun WS: connecting…`);
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      reconnectDelay = 2000;
      log(`PumpFun WS: connected`);
      // Subscribe to all new token launches
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    });

    ws.on('message', async (raw) => {
      let evt;
      try { evt = JSON.parse(raw); } catch (_) { return; }
      if (!evt || !evt.mint) return;

      const mint = evt.mint;

      // ── New token event ──────────────────────────────────────────────────────
      if (evt.txType === 'create') {
        if (state.positions[mint] || state.watching[mint] || state.recentlyTraded[mint]) return;

        const devWallet = evt.traderPublicKey;
        const solInCurve = (evt.vSolInBondingCurve || 0) / 1e9;
        const initBuySOL = (evt.initialBuy || 0) / 1e9;
        const price = calcPrice(evt.vSolInBondingCurve, evt.vTokensInBondingCurve);

        // Quick pre-filter before observation window
        if (solInCurve < 0.5) return; // Too thin at launch
        if (initBuySOL > 5) return;   // Dev sniped their own token aggressively

        log(`NEW TOKEN ${mint.slice(0,8)} | dev:${devWallet.slice(0,8)} | initBuy:${initBuySOL.toFixed(3)} SOL`);

        // Start observation window
        state.watching[mint] = {
          mint,
          devWallet,
          startTime: Date.now(),
          stats: {
            buys: 0, sells: 0,
            volumeSolWindow: 0,
            uniqueBuyers: new Set(),
            largeBuys: 0,
            priceAtStart: price,
            priceAtEnd: price,
            solInCurve,
          },
          meta: {
            bondingCurveProgress: calcBcPct(solInCurve),
            devHoldingPct: initBuySOL > 0 ? (initBuySOL / (solInCurve + 0.001)) * 100 : 0,
            complete: false,
          },
        };

        // Subscribe to this token's trades
        ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));

        // After observation window, evaluate entry
        setTimeout(() => evaluateWatchedToken(mint), CONFIG.OBSERVATION_MS);
      }

      // ── Trade event on a watched token ──────────────────────────────────────
      if ((evt.txType === 'buy' || evt.txType === 'sell') && state.watching[mint]) {
        const watch = state.watching[mint];
        const solAmt = (evt.solAmount || 0) / 1e9;
        const price = calcPrice(evt.vSolInBondingCurve, evt.vTokensInBondingCurve);
        const solInCurve = (evt.vSolInBondingCurve || 0) / 1e9;

        watch.stats.solInCurve = solInCurve;
        watch.stats.priceAtEnd = price;
        watch.meta.bondingCurveProgress = calcBcPct(solInCurve);

        if (evt.txType === 'buy') {
          watch.stats.buys++;
          watch.stats.volumeSolWindow += solAmt;
          watch.stats.uniqueBuyers.add(evt.traderPublicKey);
          if (solAmt >= 0.5) watch.stats.largeBuys++;
          // Dev buy after launch = bad sign
          if (evt.traderPublicKey === watch.devWallet && solAmt > 0.3) {
            watch.meta.devHoldingPct = Math.min(100, watch.meta.devHoldingPct + 5);
          }
        } else {
          watch.stats.sells++;
          // If dev is selling during observation window → abort
          if (evt.traderPublicKey === watch.devWallet) {
            log(`Dev DUMP on ${mint.slice(0,8)} — dropping`);
            delete state.watching[mint];
          }
        }

        // Convert Set to count for serialization
        watch.stats.uniqueBuyersCount = watch.stats.uniqueBuyers.size;
      }

      // ── Trade event on an open POSITION ─────────────────────────────────────
      if ((evt.txType === 'buy' || evt.txType === 'sell') && state.positions[mint]) {
        const pos = state.positions[mint];
        const price = calcPrice(evt.vSolInBondingCurve, evt.vTokensInBondingCurve);
        if (price > 0) pos.wsPrice = price;

        // Detect whale dump: large sell that drops price ≥ 30 % fast
        if (evt.txType === 'sell') {
          const solAmt = (evt.solAmount || 0) / 1e9;
          if (solAmt > 1.0 && pos.peakPct > 10) {
            const newPct = pos.entryPrice > 0 ? ((price - pos.entryPrice) / pos.entryPrice) * 100 : 0;
            if (newPct < pos.peakPct - 25) {
              log(`Whale dump detected ${mint.slice(0,8)} (${solAmt.toFixed(2)} SOL sell) — emergency exit`);
              exitPosition(mint, 'WHALE_DUMP');
            }
          }
        }
      }
    });

    ws.on('close', () => {
      log(`PumpFun WS: disconnected — reconnecting in ${reconnectDelay}ms`);
      setTimeout(() => { reconnectDelay = Math.min(30000, reconnectDelay * 2); connect(); }, reconnectDelay);
    });

    ws.on('error', (e) => log(`PumpFun WS error: ${e.message}`));
  }

  connect();
}

async function evaluateWatchedToken(mint) {
  const watch = state.watching[mint];
  if (!watch) return;

  // Normalize Set to count
  if (watch.stats.uniqueBuyers instanceof Set) {
    watch.stats.uniqueBuyers = watch.stats.uniqueBuyers.size;
  } else {
    watch.stats.uniqueBuyers = watch.stats.uniqueBuyersCount || watch.stats.uniqueBuyers || 0;
  }

  // Enrich with pump.fun API data (dev holdings etc.)
  const info = await fetchTokenInfo(mint);
  if (info) {
    watch.meta.complete       = !!info.complete;
    if (info.dev_buy) {
      const totalSupply = 1_000_000_000;
      watch.meta.devHoldingPct = (info.dev_buy / totalSupply) * 100;
    }
  }

  const result = scoreEntry(watch);
  log(`EVAL ${mint.slice(0,8)} | score:${result.score} | ${result.pass ? 'PASS' : 'FAIL'} | ${result.reason}`);

  if (result.pass) {
    await snipe(mint, 'PUMPFUN_WS', {
      price:         watch.stats.priceAtEnd,
      bcPct:         watch.meta.bondingCurveProgress,
      uniqueBuyers:  watch.stats.uniqueBuyers,
      score:         result.score,
    });
  }
  delete state.watching[mint];
}

// ─── TELEGRAM SOURCE (optional) ───────────────────────────────────────────────
async function startTelegram() {
  if (!TelegramClient) { log('Telegram: library not installed, skipping'); return; }
  if (!CONFIG.TELEGRAM_API_ID || !CONFIG.TELEGRAM_API_HASH || !CONFIG.TELEGRAM_SESSION) {
    log('Telegram: credentials not configured, skipping');
    return;
  }

  try {
    const session = new StringSession(CONFIG.TELEGRAM_SESSION);
    const client  = new TelegramClient(session, CONFIG.TELEGRAM_API_ID, CONFIG.TELEGRAM_API_HASH, {
      connectionRetries: 5,
    });
    await client.start({
      phoneNumber: async () => CONFIG.TELEGRAM_PHONE,
      phoneCode:   async () => { throw new Error('Need TELEGRAM_SESSION env var — run auth once'); },
      onError:     (e) => log(`Telegram error: ${e.message}`),
    });
    log(`Telegram connected | watching groups: ${CONFIG.TELEGRAM_GROUPS.join(', ')}`);

    client.addEventHandler(async (event) => {
      try {
        const msg    = event.message;
        if (!msg?.text) return;
        const sender = await msg.getSender();
        if (!sender) return;
        const uname  = (sender.username || '').toLowerCase();
        if (!CONFIG.TELEGRAM_USERS.includes(uname)) return;

        const text = msg.text;
        log(`TG @${uname}: ${text.slice(0, 120)}`);

        const addrs = extractAddresses(text);
        if (addrs.length === 0) return;

        for (const mint of addrs) {
          log(`TG CA: ${mint.slice(0,8)} from @${uname}`);
          // Trusted callers skip the observation window — snipe immediately
          await snipe(mint, `TG:${uname}`, {});
        }
      } catch (e) {
        log(`TG handler error: ${e.message}`);
      }
    }, new NewMessage({ chats: CONFIG.TELEGRAM_GROUPS }));
  } catch (e) {
    log(`Telegram startup failed: ${e.message}`);
  }
}

function extractAddresses(text) {
  const matches = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || [];
  return matches.filter(m =>
    m.length >= 32 && m.length <= 44 &&
    !m.includes('.') && !m.includes('/') &&
    m !== 'So11111111111111111111111111111111111111112' &&
    m !== '11111111111111111111111111111111'
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function calcPrice(vSol, vTokens) {
  if (!vSol || !vTokens || vTokens === 0) return 0;
  return vSol / vTokens;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function persistState() {
  try {
    fs.writeFileSync('./trades.json', JSON.stringify({
      positions: state.positions,
      allTrades: state.allTrades.slice(-200),
      brain,
      halted: state.halted,
    }, null, 2));
  } catch (_) {}
}

// ─── STATS REPORTER ───────────────────────────────────────────────────────────
async function statsLoop() {
  while (state.running) {
    await sleep(5 * 60 * 1000);
    const bal = await getBalance();
    const wr  = brain.totalTrades > 0 ? ((brain.wins / brain.totalTrades) * 100).toFixed(0) : '0';
    log([
      'STATS',
      `bal:${bal?.toFixed(4) ?? '?'} SOL`,
      `${brain.wins}W/${brain.losses}L (${wr}%)`,
      `streak:${brain.streak}`,
      `dailyPnl:${brain.dailyPnl >= 0 ? '+' : ''}${brain.dailyPnl.toFixed(4)} SOL`,
      `totalPnl:${brain.totalPnlSOL >= 0 ? '+' : ''}${brain.totalPnlSOL.toFixed(4)} SOL`,
      `open:${Object.keys(state.positions).length}`,
      `watching:${Object.keys(state.watching).length}`,
    ].join(' | '));
  }
}

// ─── STARTUP CHECKS ───────────────────────────────────────────────────────────
function preflightCheck() {
  const missing = [];
  if (!CONFIG.PUMPPORTAL_KEY)  missing.push('PUMPPORTAL_KEY');
  if (!CONFIG.WALLET_ADDRESS)  missing.push('WALLET_ADDRESS');
  if (missing.length) {
    log(`ERROR: missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  preflightCheck();

  log('═══════════════════════════════════════════════════════════════');
  log(' SOLANA MEME SNIPER — PumpFun WS + Telegram + Adaptive Brain   ');
  log('═══════════════════════════════════════════════════════════════');
  log(`Strategy: TP1 +${brain.tp1Pct}% (50%) | TP2 +${brain.tp2Pct}% (100%) | Trail arm +${brain.trailArmPct}% trail ${brain.trailPct}% | SL -${brain.stopLossPct}%`);
  log(`Position: ${brain.solPerSnipe} SOL | MaxPos: ${CONFIG.MAX_POSITIONS} | Hold ≤ ${brain.maxHoldSec}s | DailyLimit: ${CONFIG.DAILY_LOSS_LIMIT_SOL} SOL`);
  log(`Filters: minSOL:${CONFIG.MIN_SOL_IN_CURVE} BC≤${CONFIG.MAX_BONDING_CURVE_PCT}% dev≤${CONFIG.MAX_DEV_HOLDING_PCT}% buyers≥${CONFIG.MIN_UNIQUE_BUYERS} bsr≥${CONFIG.MIN_BUY_SELL_RATIO}`);

  const bal = await getBalance();
  log(`Wallet balance: ${bal?.toFixed(4) ?? 'unknown'} SOL`);
  if (!brain.startingBalance && bal) { brain.startingBalance = bal; saveBrain(); }

  // Start all components
  startPumpFunWebSocket();
  await startTelegram();
  positionMonitorLoop();
  statsLoop();

  log('Ready. Monitoring PumpFun for runners...');
  await new Promise(() => {}); // run forever
}

process.on('SIGINT', async () => {
  log('Shutting down — closing all positions…');
  state.running = false;
  for (const mint of Object.keys(state.positions)) {
    await exitPosition(mint, 'MANUAL_STOP');
  }
  persistState();
  process.exit(0);
});

main().catch(e => { log(`FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
