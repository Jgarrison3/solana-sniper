require('dotenv').config();
const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');

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

// ─── RISK TIERS ───────────────────────────────────────────────────────────────
// Bot auto-advances through tiers as win rate + streak improve.
// Higher tiers = larger size, higher TP, looser filters, moonbag enabled.
// Tier drops at most 2 levels per loss burst (shock absorber).
const TIERS = [
  //         name           minWR  minStreak  balPct  maxSOL  tp1%  tp2%  trailArm trailPct  SL%  maxPos  moonbag  fMult  maxHoldSec
  tier(0, 'WARMUP',         0.00,   -99,      0.04,   0.10,   70,  100,    55,      22,      30,    2,    false,   1.00,   300),
  tier(1, 'STANDARD',       0.40,     0,      0.06,   0.18,   75,  110,    55,      22,      30,    2,    false,   1.00,   300),
  tier(2, 'CONFIDENT',      0.55,     2,      0.09,   0.30,   80,  150,    58,      20,      28,    3,    false,   0.90,   360),
  tier(3, 'HOT',            0.63,     4,      0.13,   0.48,   90,  200,    62,      18,      26,    3,    true,    0.85,   420),
  tier(4, 'AGGRESSIVE',     0.70,     6,      0.18,   0.75,  100,  260,    68,      15,      24,    4,    true,    0.80,   480),
  tier(5, 'MAX_RISK',       0.76,     8,      0.24,   1.20,  110,  320,    74,      12,      22,    4,    true,    0.75,   540),
];

function tier(id, name, minWR, minStreak, balPct, maxSOL, tp1Pct, tp2Pct, trailArm, trailPct, slPct, maxPos, moonbag, fMult, maxHoldSec) {
  return { id, name, minWR, minStreak, balPct, maxSOL, tp1Pct, tp2Pct, trailArm, trailPct, slPct, maxPos, moonbag, fMult, maxHoldSec };
}

// ─── YOLO TIERS ───────────────────────────────────────────────────────────────
// Used when YOLO_MODE=true. No partial TP1 (set to 9999%), moonbag always on,
// 40-65% of balance per trade, TP2 targets 250-750%, trail arms only after 2X.
const YOLO_TIERS = [
  //         name      minWR  minStreak  balPct  maxSOL  tp1%   tp2%  trailArm trailPct  SL%  maxPos  moonbag  fMult  maxHoldSec
  tier(0, 'YOLO_A',   0.00,   -99,      0.40,   0.10,   9999,  250,   100,     30,      40,    2,    true,    0.60,   480),
  tier(1, 'YOLO_B',   0.45,     0,      0.45,   0.20,   9999,  300,   100,     28,      38,    2,    true,    0.55,   480),
  tier(2, 'YOLO_C',   0.55,     2,      0.50,   0.35,   9999,  400,   110,     25,      36,    2,    true,    0.50,   540),
  tier(3, 'YOLO_D',   0.62,     4,      0.55,   0.55,   9999,  500,   120,     22,      34,    3,    true,    0.45,   540),
  tier(4, 'YOLO_E',   0.68,     6,      0.60,   0.80,   9999,  600,   130,     18,      32,    3,    true,    0.40,   600),
  tier(5, 'YOLO_F',   0.74,     8,      0.65,   1.20,   9999,  750,   140,     15,      30,    3,    true,    0.35,   600),
];

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const YOLO = process.env.YOLO_MODE === 'true'; // shorthand used throughout

const CONFIG = {
  PUMPPORTAL_KEY:     process.env.PUMPPORTAL_KEY || '',
  HELIUS_RPC:         process.env.HELIUS_RPC || 'https://api.mainnet-beta.solana.com',
  WALLET_ADDRESS:     process.env.WALLET_ADDRESS || '',
  YOLO_MODE:          YOLO,
  DAILY_LOSS_LIMIT:   YOLO ? Infinity : parseFloat(process.env.DAILY_LOSS_LIMIT_SOL || '1.0'),

  // Base filter thresholds — scaled dynamically per tier and by learned values
  // YOLO_MODE uses looser defaults; tier fMult loosens them further at runtime
  MIN_SOL_IN_CURVE:      parseFloat(process.env.MIN_SOL_IN_CURVE      || (YOLO ? '1.5' : '3.0')),
  MAX_BONDING_CURVE_PCT: parseFloat(process.env.MAX_BONDING_CURVE_PCT || (YOLO ? '45'  : '28')),
  MAX_DEV_HOLDING_PCT:   parseFloat(process.env.MAX_DEV_HOLDING_PCT   || (YOLO ? '10'  : '8')),
  MIN_UNIQUE_BUYERS:     parseInt(  process.env.MIN_UNIQUE_BUYERS      || (YOLO ? '3'   : '6')),
  MIN_BUY_SELL_RATIO:    parseFloat(process.env.MIN_BUY_SELL_RATIO     || (YOLO ? '1.5' : '2.5')),
  MIN_VOLUME_SOL:        parseFloat(process.env.MIN_VOLUME_SOL_WINDOW  || (YOLO ? '0.5' : '1.5')),
  OBSERVATION_MS:        parseInt(  process.env.OBSERVATION_MS         || (YOLO ? '15000' : '40000')),

  // Telegram
  TELEGRAM_API_ID:   parseInt( process.env.TELEGRAM_API_ID   || '0'),
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH  || '',
  TELEGRAM_PHONE:    process.env.TELEGRAM_PHONE     || '',
  TELEGRAM_SESSION:  process.env.TELEGRAM_SESSION   || '',
  TELEGRAM_GROUPS:  (process.env.TELEGRAM_GROUPS    || 'fomocabal').split(',').map(s => s.trim()),
  TELEGRAM_USERS:   (process.env.TELEGRAM_USERS     || 'marvcalledit,moodyelite').split(',').map(s => s.trim()),
};

// Active tier set — swapped to YOLO_TIERS when YOLO_MODE=true
const ACTIVE_TIERS = YOLO ? YOLO_TIERS : TIERS;

// ─── BRAIN ────────────────────────────────────────────────────────────────────
const BRAIN_FILE = './brain.json';
const BRAIN_DEFAULTS = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  totalPnlSOL: 0,
  recentTrades: [],
  streak: 0,
  bestStreak: 0,
  startingBalance: 0,
  currentTier: 0,
  // 24h session tracking
  sessionStartTime: 0,
  sessionPnl: 0,
  sessionMultiplier: 1.0,
  // Learned filter overrides (null = use CONFIG base)
  learnedFilters: { maxBcPct: null, minBuyers: null, minBSR: null, minVolSOL: null },
  // Daily bookkeeping
  dailyPnl: 0,
  lastResetDay: '',
};

let brain = (() => {
  try {
    if (fs.existsSync(BRAIN_FILE)) {
      const saved = JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf8'));
      if (saved.lastResetDay !== new Date().toDateString()) {
        saved.dailyPnl = 0;
        saved.lastResetDay = new Date().toDateString();
      }
      const b = { ...BRAIN_DEFAULTS, ...saved };
      log(`Brain | ${b.totalTrades} trades ${b.wins}W/${b.losses}L | pnl:${b.totalPnlSOL >= 0 ? '+' : ''}${b.totalPnlSOL.toFixed(4)} SOL | tier:${ACTIVE_TIERS[b.currentTier]?.name}`);
      return b;
    }
  } catch (_) {}
  return { ...BRAIN_DEFAULTS, lastResetDay: new Date().toDateString(), sessionStartTime: Date.now() };
})();

function saveBrain() {
  try { fs.writeFileSync(BRAIN_FILE, JSON.stringify(brain, null, 2)); } catch (_) {}
}

function getTier() { return ACTIVE_TIERS[brain.currentTier] || ACTIVE_TIERS[0]; }

function getWinRate(n = 20) {
  const recent = brain.recentTrades.slice(-n);
  return recent.length ? recent.filter(t => t.pnl > 0).length / recent.length : 0.5;
}

// Reassess which tier we belong in after every trade.
function updateTier() {
  if (brain.totalTrades < 3) return;
  const wr = getWinRate(20);
  const streak = brain.streak;

  let newTier = 0;
  for (let i = ACTIVE_TIERS.length - 1; i >= 0; i--) {
    if (wr >= ACTIVE_TIERS[i].minWR && streak >= ACTIVE_TIERS[i].minStreak) { newTier = i; break; }
  }
  // Shock absorber: never drop >2 tiers at once
  newTier = Math.max(newTier, brain.currentTier - 2);

  if (newTier !== brain.currentTier) {
    const dir = newTier > brain.currentTier ? '▲' : '▼';
    brain.currentTier = newTier;
    const t = ACTIVE_TIERS[newTier];
    log(`TIER ${dir} → ${t.name} | wr:${(wr*100).toFixed(0)}% streak:${streak} | size:${(t.balPct*100).toFixed(0)}%bal(≤${t.maxSOL}SOL) tp2:+${t.tp2Pct}% moonbag:${t.moonbag} maxPos:${t.maxPos}`);
  }
}

// After 10+ trades, compute which entry conditions produced wins and shift
// filter thresholds toward those values. This lets the bot self-tune to
// whatever market regime it's in without human intervention.
function learnFilters() {
  if (brain.totalTrades < 10) return;
  const winners = brain.recentTrades.slice(-40).filter(t => t.pnl > 0 && t.ctx);
  if (winners.length < 5) return;

  const avg = (key) => winners.reduce((s, t) => s + (t.ctx[key] || 0), 0) / winners.length;
  const avgBc      = avg('bcPct');
  const avgBuyers  = avg('uniqueBuyers');
  const avgBSR     = avg('bsr');
  const avgVol     = avg('volumeSOL');

  // Allow up to 130% of the average winning value as new ceiling/floor,
  // but keep hard sanity bounds.
  brain.learnedFilters.maxBcPct  = clamp(avgBc    * 1.30, YOLO ? 5  : 8,  YOLO ? 55 : 45);
  brain.learnedFilters.minBuyers = clamp(avgBuyers * 0.70, YOLO ? 2  : 3,  20);
  brain.learnedFilters.minBSR    = clamp(avgBSR   * 0.70, YOLO ? 1.0 : 1.2, 6);
  brain.learnedFilters.minVolSOL = clamp(avgVol   * 0.70, YOLO ? 0.3 : 0.4, 6);

  log(`Filters LEARNED | bc≤${brain.learnedFilters.maxBcPct.toFixed(1)}% buyers≥${brain.learnedFilters.minBuyers.toFixed(1)} bsr≥${brain.learnedFilters.minBSR.toFixed(2)} vol≥${brain.learnedFilters.minVolSOL.toFixed(2)}`);
}

// Returns the effective filter thresholds for the current tier + learned values.
function getFilters() {
  const m  = getTier().fMult;
  const lf = brain.learnedFilters;
  return {
    maxBcPct:       lf.maxBcPct  ?? CONFIG.MAX_BONDING_CURVE_PCT,
    minBuyers:      Math.max(3,  Math.floor((lf.minBuyers ?? CONFIG.MIN_UNIQUE_BUYERS)  * m)),
    minBSR:         Math.max(1.2, (lf.minBSR    ?? CONFIG.MIN_BUY_SELL_RATIO)  * m),
    minVolSOL:      Math.max(0.4, (lf.minVolSOL ?? CONFIG.MIN_VOLUME_SOL)       * m),
    maxDevPct:      CONFIG.MAX_DEV_HOLDING_PCT * (m < 1 ? 1.15 : 1),
    minSolInCurve:  CONFIG.MIN_SOL_IN_CURVE    * m,
  };
}

// Session multiplier: as we make money this session, we bet proportionally larger.
// Compounds profits back into position size without risking startup capital.
function refreshSessionMultiplier() {
  const pnl = brain.sessionPnl;
  let mult;
  if      (pnl >= 3.0) mult = 1.80;
  else if (pnl >= 2.0) mult = 1.60;
  else if (pnl >= 1.0) mult = 1.40;
  else if (pnl >= 0.5) mult = 1.20;
  else if (pnl >= 0.2) mult = 1.10;
  else if (pnl >= 0)   mult = 1.00;
  else if (pnl >= -0.5) mult = 0.85;
  else                  mult = 0.70;

  if (mult !== brain.sessionMultiplier) {
    brain.sessionMultiplier = mult;
    log(`Session mult → ${mult}x (session pnl: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL)`);
  }
}

// In the final stretch of the 24h window, push the position multiplier higher.
// YOLO_MODE skips the cautious warmup and ramps harder — max 1.5x in final sprint.
function getTimeAggression() {
  if (!brain.sessionStartTime) return 1.0;
  const hrs = (Date.now() - brain.sessionStartTime) / 3_600_000;
  if (YOLO) {
    if (hrs < 0.5) return 1.00;
    if (hrs < 6)   return 1.10;
    if (hrs < 16)  return 1.20;
    return 1.50; // Final sprint: no mercy
  }
  if (hrs < 1)  return 0.85;
  if (hrs < 4)  return 1.00;
  if (hrs < 12) return 1.08;
  if (hrs < 20) return 1.15;
  return 1.25;
}

function recordTrade({ pnlSOL, pnlPct, holdSec, mint, reason, source, ctx }) {
  brain.recentTrades.push({ pnl: pnlSOL, pct: pnlPct, holdSec, mint, reason, source, ctx, t: Date.now() });
  if (brain.recentTrades.length > 100) brain.recentTrades.shift();
  brain.totalTrades++;
  brain.totalPnlSOL = +(brain.totalPnlSOL + pnlSOL).toFixed(6);
  brain.dailyPnl    = +(brain.dailyPnl    + pnlSOL).toFixed(6);
  brain.sessionPnl  = +(brain.sessionPnl  + pnlSOL).toFixed(6);
  if (pnlSOL > 0) {
    brain.wins++;
    brain.streak     = Math.max(0, brain.streak) + 1;
    brain.bestStreak = Math.max(brain.bestStreak, brain.streak);
  } else {
    brain.losses++;
    brain.streak = Math.min(0, brain.streak) - 1;
  }
  updateTier();
  learnFilters();
  refreshSessionMultiplier();
  saveBrain();
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  positions:      {},  // mint → PositionInfo
  moonbags:       {},  // mint → MoonbagInfo (30% remainder after TP2)
  watching:       {},  // mint → WatchInfo   (observation window)
  recentlyTraded: {},  // mint → timestamp
  allTrades:      [],
  running:        true,
  halted:         false,
};

// ─── RPC / BALANCE ────────────────────────────────────────────────────────────
let rpc = null;
if (Connection && PublicKey && CONFIG.HELIUS_RPC && CONFIG.WALLET_ADDRESS) {
  try { rpc = { conn: new Connection(CONFIG.HELIUS_RPC, 'confirmed'), pk: new PublicKey(CONFIG.WALLET_ADDRESS) }; } catch (_) {}
}
async function getBalance() {
  if (!rpc) return null;
  try { return (await rpc.conn.getBalance(rpc.pk)) / 1e9; } catch (_) { return null; }
}

// ─── POSITION SIZING ──────────────────────────────────────────────────────────
function calcSize(balance) {
  const t     = getTier();
  const pct   = t.balPct * brain.sessionMultiplier * getTimeAggression();
  const raw   = balance !== null ? Math.min(t.maxSOL, balance * pct) : t.maxSOL * 0.5;
  return Math.max(0.04, +raw.toFixed(3));
}

// How long before we'll trade the same mint again.
// YOLO_MODE uses a flat 90-second cooldown — capitalize on every opportunity.
function getCooldownMs() {
  if (YOLO) return 90_000;
  const id = brain.currentTier;
  if (id >= 4) return  5 * 60_000;
  if (id >= 2) return 10 * 60_000;
  return 20 * 60_000;
}

// ─── EXTERNAL DATA ────────────────────────────────────────────────────────────
async function fetchTokenMeta(mint) {
  try {
    const r = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, { timeout: 6000 });
    return r.ok ? r.json() : null;
  } catch (_) { return null; }
}

async function fetchDex(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000,
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.pairs?.length) return null;
    const p = d.pairs.find(x => x.dexId === 'pumpfun') || d.pairs[0];
    return {
      priceUsd:  parseFloat(p.priceUsd || '0'),
      ch5m:      p.priceChange?.m5  || 0,
      ch1h:      p.priceChange?.h1  || 0,
      vol5m:     p.volume?.m5       || 0,
      liqUsd:    p.liquidity?.usd   || 0,
    };
  } catch (_) { return null; }
}

// ─── TRADE EXECUTION ──────────────────────────────────────────────────────────
async function exec(action, mint, amount, denominatedInSol = true, slippage = 20, retries = 2) {
  const url  = `https://pumpportal.fun/api/trade?api-key=${CONFIG.PUMPPORTAL_KEY}`;
  const body = { action, mint, amount, denominatedInSol: denominatedInSol ? 'true' : 'false', slippage, priorityFee: 0.005, pool: 'pump' };
  for (let i = 0; i <= retries; i++) {
    try {
      const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 15000 });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error(`Non-JSON: ${text.slice(0, 80)}`); }
      if (Array.isArray(data) && data[0]) return data[0];
      if (data?.signature) return data.signature;
      if (typeof data === 'string' && data.length > 20) return data;
      throw new Error(`API: ${JSON.stringify(data).slice(0, 100)}`);
    } catch (e) {
      if (i === retries) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// ─── ENTRY SCORING ────────────────────────────────────────────────────────────
function scoreEntry(watch) {
  const { meta, stats } = watch;
  const f  = getFilters();
  const buyers = stats.uniqueBuyers instanceof Set ? stats.uniqueBuyers.size : (stats.uniqueBuyers || 0);
  const bcPct  = meta?.bondingCurveProgress ?? calcBcPct(stats.solInCurve);
  const bsr    = stats.sells > 0 ? stats.buys / stats.sells : stats.buys;

  // Hard gates — one failure = no trade
  if (meta?.complete)                          return fail(`graduated`);
  if (bcPct > f.maxBcPct)                      return fail(`bc=${bcPct.toFixed(1)}%>max(${f.maxBcPct.toFixed(1)}%)`);
  if (stats.solInCurve < f.minSolInCurve)      return fail(`sol=${stats.solInCurve.toFixed(2)}<min`);
  if ((meta?.devHoldingPct || 0) > f.maxDevPct) return fail(`dev=${(meta?.devHoldingPct||0).toFixed(1)}%>max`);
  if (isOnCooldown(watch.mint))                return fail(`cooldown`);
  if (buyers < f.minBuyers)                    return fail(`buyers=${buyers}<min(${f.minBuyers})`);
  if (stats.volumeSolWindow < f.minVolSOL)     return fail(`vol=${stats.volumeSolWindow.toFixed(2)}<min(${f.minVolSOL.toFixed(2)})`);
  if (bsr < f.minBSR)                          return fail(`bsr=${bsr.toFixed(1)}<min(${f.minBSR.toFixed(2)})`);
  if (stats.priceAtEnd <= stats.priceAtStart || stats.priceAtStart === 0) return fail(`no_momentum`);

  const momentumPct = ((stats.priceAtEnd - stats.priceAtStart) / stats.priceAtStart) * 100;
  if (momentumPct < 5)                         return fail(`momentum_weak(${momentumPct.toFixed(1)}%)`);

  // Score signal strength (used for logging / future ML)
  let score = 60; // base for passing all hard gates
  if (bsr >= f.minBSR * 1.8)      score += 15;
  if (buyers >= f.minBuyers * 1.5) score += 10;
  if (stats.largeBuys >= 3)        score += 10;
  if (momentumPct >= 20)           score += 10;
  if (bcPct <= 10)                 score +=  5; // very early

  return {
    pass: true, score,
    reason: `bc:${bcPct.toFixed(1)}% buyers:${buyers} bsr:${bsr.toFixed(1)} vol:${stats.volumeSolWindow.toFixed(2)} mom:+${momentumPct.toFixed(0)}%`,
    ctx: { bcPct, uniqueBuyers: buyers, bsr, volumeSOL: stats.volumeSolWindow, price: stats.priceAtEnd },
  };
}

function fail(reason) { return { pass: false, reason }; }

function isOnCooldown(mint) {
  return state.recentlyTraded[mint] && Date.now() - state.recentlyTraded[mint] < getCooldownMs();
}

// ─── SNIPE ────────────────────────────────────────────────────────────────────
async function snipe(mint, source, ctx = {}) {
  if (state.halted)                          { log(`HALTED – skip ${mint.slice(0,8)}`); return; }
  if (state.positions[mint] || state.watching[mint] || state.moonbags[mint]) return;
  if (isOnCooldown(mint))                    return;

  const t = getTier();
  if (Object.keys(state.positions).length >= t.maxPos) { log(`Max pos (${t.maxPos}) [${t.name}]`); return; }

  const balBefore = await getBalance();
  const size      = calcSize(balBefore);

  if (balBefore !== null && balBefore < size + 0.015) {
    log(`Low bal: ${balBefore.toFixed(4)} SOL`);
    return;
  }

  log(`SNIPE [${source}] [${t.name}] ${mint.slice(0,8)} | ${size.toFixed(3)} SOL | bc:${(ctx.bcPct||0).toFixed(1)}% buyers:${ctx.uniqueBuyers||'?'} score:${ctx.score||'?'}`);
  try {
    const sig      = await exec('buy', mint, size, true);
    await sleep(3500);
    const balAfter = await getBalance();
    const spent    = (balBefore !== null && balAfter !== null) ? balBefore - balAfter : size;

    log(`BUY ✓ | spent:${spent.toFixed(4)} SOL | bal:${balAfter?.toFixed(4) ?? '?'} | ${sig.slice(0,20)}…`);
    state.positions[mint] = {
      mint,
      entryTime:  Date.now(),
      totalSpent: spent,
      balBefore,
      peakPct:    0,
      trailArmed: false,
      tp1Hit:     false,
      source,
      ctx,
      tierId: brain.currentTier,
    };
    state.allTrades.push({ type: 'BUY', mint, sol: spent, sig, source, tier: t.name, t: Date.now() });
    persistState();

    setTimeout(() => { if (state.positions[mint]) exitPosition(mint, 'TIMEOUT'); }, t.maxHoldSec * 1000);
  } catch (e) {
    log(`Snipe fail ${mint.slice(0,8)}: ${e.message}`);
  }
}

// ─── EXIT POSITION ────────────────────────────────────────────────────────────
async function exitPosition(mint, reason, portion = '100%') {
  const pos = state.positions[mint];
  if (!pos) return;

  const t      = TIERS[pos.tierId] || getTier();
  const isFull = portion === '100%';

  // On TP2 hit at a moonbag tier, sell 70% now and let 30% ride.
  // Only applies when we're hitting a genuine TP2, not a stop/timeout.
  const shouldMoonbag = isFull && t.moonbag && !state.moonbags[mint] &&
    ['TAKE_PROFIT', 'TP2'].includes(reason);

  const sellPct = shouldMoonbag ? '70%' : portion;
  log(`EXIT ${mint.slice(0,8)} | ${reason} | ${sellPct} | [${t.name}]`);

  try {
    const sig      = await exec('sell', mint, sellPct, false, 25);
    await sleep(3500);
    const balAfter = await getBalance();
    const holdSec  = (Date.now() - pos.entryTime) / 1000;

    if (shouldMoonbag) {
      // Record the partial 70% exit as the "main" trade
      const pnlSOL = balAfter !== null && pos.balBefore !== null ? balAfter - pos.balBefore : 0;
      const pnlPct = pos.totalSpent > 0 ? (pnlSOL / pos.totalSpent) * 100 : 0;
      log(`TP2 70% sold | pnl so far: ${pnlSOL >= 0 ? '+' : ''}${pnlSOL.toFixed(4)} SOL (${pnlPct.toFixed(1)}%) | MOONBAG 30% riding…`);

      state.allTrades.push({ type: 'SELL_70', mint, pnl: pnlSOL, pct: pnlPct, reason, sig, t: Date.now() });
      recordTrade({ pnlSOL, pnlPct, holdSec, mint, reason, source: pos.source, ctx: pos.ctx });
      delete state.positions[mint];

      // Activate moonbag — 30% remains on-chain; monitor with loose trailing stop
      state.moonbags[mint] = {
        mint,
        balAfter70: balAfter,   // basis for moonbag PnL
        peakPct:  pos.peakPct,
        source:   pos.source,
        ctx:      pos.ctx,
        tierId:   pos.tierId,
        activatedAt: Date.now(),
        expiresAt:   Date.now() + 5 * 60_000, // 5 more minutes max
      };
      log(`MOONBAG activated ${mint.slice(0,8)} | 30% riding | expires 5 min`);
    } else if (isFull) {
      const pnlSOL = balAfter !== null && pos.balBefore !== null ? balAfter - pos.balBefore : 0;
      const pnlPct = pos.totalSpent > 0 ? (pnlSOL / pos.totalSpent) * 100 : 0;
      log(`SELL ✓ | ${pnlSOL >= 0 ? '+' : ''}${pnlSOL.toFixed(4)} SOL (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%) | hold:${holdSec.toFixed(0)}s`);
      log(`${pnlSOL > 0.001 ? '[WIN]' : pnlSOL < -0.001 ? '[LOSS]' : '[FLAT]'} ${brain.wins}W/${brain.losses}L streak:${brain.streak} | ${brain.totalPnlSOL >= 0 ? '+' : ''}${brain.totalPnlSOL.toFixed(4)} SOL total`);
      state.allTrades.push({ type: 'SELL', mint, pnl: pnlSOL, pct: pnlPct, reason, sig, t: Date.now() });
      delete state.positions[mint];
      state.recentlyTraded[mint] = Date.now();
      recordTrade({ pnlSOL, pnlPct, holdSec, mint, reason, source: pos.source, ctx: pos.ctx });
      if (!YOLO && brain.dailyPnl <= -CONFIG.DAILY_LOSS_LIMIT) {
        state.halted = true;
        log(`*** HALTED: daily loss limit hit (${brain.dailyPnl.toFixed(4)} SOL) ***`);
      }
    } else {
      // Partial TP1: 50% sold, update basis
      log(`TP1 partial ✓ | new basis bal:${balAfter?.toFixed(4) ?? '?'} | hold:${holdSec.toFixed(0)}s`);
      pos.balBefore  = balAfter;
      pos.totalSpent = +(pos.totalSpent * 0.5).toFixed(6);
      pos.tp1Hit     = true;
    }
    persistState();
  } catch (e) {
    log(`Exit fail ${mint.slice(0,8)}: ${e.message}`);
    if (isFull) { delete state.positions[mint]; state.recentlyTraded[mint] = Date.now(); }
  }
}

// ─── MOONBAG MONITOR ─────────────────────────────────────────────────────────
async function checkMoonbag(mint) {
  const mb = state.moonbags[mint];
  if (!mb) return;

  if (Date.now() > mb.expiresAt) {
    return closeMoonbag(mint, 'MOONBAG_EXPIRED');
  }

  const dex = await fetchDex(mint);
  if (!dex) return;

  const changePct = Math.max(dex.ch5m, dex.ch1h);
  if (changePct > mb.peakPct) mb.peakPct = changePct;

  // Moonbag trail: 35% drop from its own peak (looser than main position)
  const dropFromPeak = mb.peakPct - changePct;
  if (dropFromPeak >= 35) {
    return closeMoonbag(mint, 'MOONBAG_TRAIL');
  }
}

async function closeMoonbag(mint, reason) {
  const mb = state.moonbags[mint];
  if (!mb) return;
  log(`MOONBAG EXIT ${mint.slice(0,8)} | ${reason} | peak was +${mb.peakPct.toFixed(1)}%`);
  try {
    const sig      = await exec('sell', mint, '100%', false, 30);
    await sleep(3500);
    const balAfter = await getBalance();
    const bonusPnl = (balAfter !== null && mb.balAfter70 !== null) ? balAfter - mb.balAfter70 : 0;
    log(`MOONBAG ✓ | bonus: ${bonusPnl >= 0 ? '+' : ''}${bonusPnl.toFixed(4)} SOL | sig:${sig.slice(0,20)}…`);
    // Moonbag bonus goes straight into session/daily PnL without a full trade record
    brain.totalPnlSOL = +(brain.totalPnlSOL + bonusPnl).toFixed(6);
    brain.dailyPnl    = +(brain.dailyPnl    + bonusPnl).toFixed(6);
    brain.sessionPnl  = +(brain.sessionPnl  + bonusPnl).toFixed(6);
    saveBrain();
    state.allTrades.push({ type: 'MOONBAG', mint, pnl: bonusPnl, reason, sig, t: Date.now() });
  } catch (e) {
    log(`Moonbag exit fail ${mint.slice(0,8)}: ${e.message}`);
  }
  delete state.moonbags[mint];
  state.recentlyTraded[mint] = Date.now();
  persistState();
}

// ─── POSITION MONITOR LOOP ────────────────────────────────────────────────────
async function monitorLoop() {
  while (state.running) {
    for (const mint of Object.keys(state.positions)) await checkPosition(mint);
    for (const mint of Object.keys(state.moonbags))  await checkMoonbag(mint);
    await sleep(5000);
  }
}

async function checkPosition(mint) {
  const pos = state.positions[mint];
  if (!pos) return;
  const t = TIERS[pos.tierId] || getTier();

  const dex = await fetchDex(mint);
  let changePct = 0;

  if (dex) {
    changePct = Math.max(dex.ch5m, dex.ch1h);
    // Volume collapse: if volume dies while we're up, exit before the dump
    if (dex.vol5m < 50 && pos.peakPct > 15) {
      log(`Vol collapse ${mint.slice(0,8)} (vol5m=$${dex.vol5m.toFixed(0)}) — exit`);
      return exitPosition(mint, 'VOL_COLLAPSE');
    }
    log(`Monitor ${mint.slice(0,8)} | 5m:${dex.ch5m.toFixed(1)}% 1h:${dex.ch1h.toFixed(1)}% | peak:${pos.peakPct.toFixed(1)}% [${t.name}]`);
  } else if (pos.wsPrice && pos.entryPrice > 0) {
    changePct = ((pos.wsPrice - pos.entryPrice) / pos.entryPrice) * 100;
  }

  if (changePct > pos.peakPct) pos.peakPct = changePct;

  // TP1: sell 50% at tier's tp1Pct to lock partial profit
  if (!pos.tp1Hit && changePct >= t.tp1Pct) {
    log(`TP1 ${mint.slice(0,8)} +${changePct.toFixed(1)}% — selling 50%`);
    return exitPosition(mint, 'TP1', '50%');
  }
  // TP2: sell 100% (or 70% if moonbag) at tier's tp2Pct
  if (changePct >= t.tp2Pct) {
    log(`TP2 ${mint.slice(0,8)} +${changePct.toFixed(1)}%`);
    return exitPosition(mint, 'TAKE_PROFIT');
  }
  // Trailing stop: arm after trailArm%, trail trailPct% below peak
  if (!pos.trailArmed && pos.peakPct >= t.trailArm) {
    pos.trailArmed = true;
    log(`Trail ARMED ${mint.slice(0,8)} peak:${pos.peakPct.toFixed(1)}%`);
  }
  if (pos.trailArmed && pos.peakPct - changePct >= t.trailPct) {
    log(`Trail STOP ${mint.slice(0,8)} peak:${pos.peakPct.toFixed(1)}% now:${changePct.toFixed(1)}%`);
    return exitPosition(mint, 'TRAIL_STOP');
  }
  // Hard stop-loss
  if (changePct <= -t.slPct) {
    log(`SL ${mint.slice(0,8)} ${changePct.toFixed(1)}%`);
    return exitPosition(mint, 'STOP_LOSS');
  }
}

// ─── PUMPFUN WEBSOCKET ────────────────────────────────────────────────────────
function startPumpFunWS() {
  const URL = 'wss://pumpportal.fun/api/data';
  let ws, delay = 2000;

  function connect() {
    log(`PumpFun WS: connecting…`);
    ws = new WebSocket(URL);

    ws.on('open', () => {
      delay = 2000;
      log(`PumpFun WS: connected — subscribing to new tokens`);
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    });

    ws.on('message', async (raw) => {
      let evt;
      try { evt = JSON.parse(raw); } catch (_) { return; }
      if (!evt?.mint) return;

      const mint = evt.mint;

      // ── New token created ────────────────────────────────────────────────────
      if (evt.txType === 'create') {
        if (state.positions[mint] || state.watching[mint] || state.recentlyTraded[mint]) return;
        const solInCurve = (evt.vSolInBondingCurve || 0) / 1e9;
        const initBuy    = (evt.initialBuy         || 0) / 1e9;
        if (solInCurve < 0.5) return;
        if (initBuy > 5)      return; // dev sniped hard = suspicious

        const price = bcPrice(evt.vSolInBondingCurve, evt.vTokensInBondingCurve);
        log(`NEW ${mint.slice(0,8)} | initBuy:${initBuy.toFixed(3)} SOL | price:${price.toExponential(3)}`);

        state.watching[mint] = {
          mint,
          devWallet: evt.traderPublicKey,
          startTime: Date.now(),
          stats: {
            buys: 0, sells: 0,
            volumeSolWindow: 0,
            uniqueBuyers: new Set(),
            largeBuys: 0,
            priceAtStart: price,
            priceAtEnd:   price,
            solInCurve,
          },
          meta: {
            bondingCurveProgress: calcBcPct(solInCurve),
            devHoldingPct: solInCurve > 0 ? (initBuy / solInCurve) * 100 : 0,
            complete: false,
          },
        };
        ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
        setTimeout(() => evaluateWatch(mint), CONFIG.OBSERVATION_MS);
      }

      // ── Trade on watched token ───────────────────────────────────────────────
      if ((evt.txType === 'buy' || evt.txType === 'sell') && state.watching[mint]) {
        const w       = state.watching[mint];
        const solAmt  = (evt.solAmount || 0) / 1e9;
        const price   = bcPrice(evt.vSolInBondingCurve, evt.vTokensInBondingCurve);
        const sol     = (evt.vSolInBondingCurve || 0) / 1e9;

        w.stats.solInCurve   = sol;
        w.stats.priceAtEnd   = price;
        w.meta.bondingCurveProgress = calcBcPct(sol);

        if (evt.txType === 'buy') {
          w.stats.buys++;
          w.stats.volumeSolWindow += solAmt;
          w.stats.uniqueBuyers.add(evt.traderPublicKey);
          if (solAmt >= 0.5) w.stats.largeBuys++;
        } else {
          w.stats.sells++;
          // Dev dumping during observation = abort immediately
          if (evt.traderPublicKey === w.devWallet) {
            log(`Dev SELL during obs ${mint.slice(0,8)} — aborting`);
            delete state.watching[mint];
          }
        }
      }

      // ── Trade on open position (WebSocket price update + whale detector) ─────
      if ((evt.txType === 'buy' || evt.txType === 'sell') && state.positions[mint]) {
        const pos   = state.positions[mint];
        const price = bcPrice(evt.vSolInBondingCurve, evt.vTokensInBondingCurve);
        if (price > 0) pos.wsPrice = price;

        // Whale dump: large sell causes >25% drop from our peak
        if (evt.txType === 'sell') {
          const solAmt = (evt.solAmount || 0) / 1e9;
          if (solAmt > 1.0 && pos.peakPct > 10 && pos.entryPrice > 0) {
            const nowPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
            if (nowPct < pos.peakPct - 25) {
              log(`WHALE DUMP ${mint.slice(0,8)} | ${solAmt.toFixed(2)} SOL sell | emergency exit`);
              exitPosition(mint, 'WHALE_DUMP');
            }
          }
        }
      }
    });

    ws.on('close', () => {
      log(`PumpFun WS: closed — retry in ${delay}ms`);
      setTimeout(() => { delay = Math.min(30000, delay * 2); connect(); }, delay);
    });
    ws.on('error', e => log(`PumpFun WS error: ${e.message}`));
  }

  connect();
}

async function evaluateWatch(mint) {
  const w = state.watching[mint];
  if (!w) return;

  // Normalize Set → count
  w.stats.uniqueBuyers = w.stats.uniqueBuyers instanceof Set
    ? w.stats.uniqueBuyers.size : (w.stats.uniqueBuyers || 0);

  // Pull latest dev holding data from pump.fun API
  const meta = await fetchTokenMeta(mint);
  if (meta) {
    w.meta.complete = !!meta.complete;
    if (meta.dev_buy) w.meta.devHoldingPct = (meta.dev_buy / 1_000_000_000) * 100;
  }

  const result = scoreEntry(w);
  log(`EVAL ${mint.slice(0,8)} | ${result.pass ? 'PASS' : 'FAIL'} score:${result.score ?? '-'} | ${result.reason}`);

  if (result.pass) {
    await snipe(mint, 'PUMPFUN_WS', { ...result.ctx, score: result.score });
  }
  delete state.watching[mint];
}

// ─── TELEGRAM SOURCE ─────────────────────────────────────────────────────────
async function startTelegram() {
  if (!TelegramClient || !CONFIG.TELEGRAM_API_ID || !CONFIG.TELEGRAM_SESSION) {
    log('Telegram: skipping (not configured)');
    return;
  }
  try {
    const client = new TelegramClient(new StringSession(CONFIG.TELEGRAM_SESSION),
      CONFIG.TELEGRAM_API_ID, CONFIG.TELEGRAM_API_HASH, { connectionRetries: 5 });
    await client.start({
      phoneNumber: async () => CONFIG.TELEGRAM_PHONE,
      phoneCode:   async () => { throw new Error('Set TELEGRAM_SESSION in .env'); },
      onError:     e => log(`TG error: ${e.message}`),
    });
    log(`Telegram OK | groups: ${CONFIG.TELEGRAM_GROUPS.join(',')}`);

    client.addEventHandler(async (event) => {
      try {
        const msg    = event.message;
        if (!msg?.text) return;
        const sender = await msg.getSender();
        const uname  = (sender?.username || '').toLowerCase();
        if (!CONFIG.TELEGRAM_USERS.includes(uname)) return;
        log(`TG @${uname}: ${msg.text.slice(0, 100)}`);
        for (const mint of extractAddresses(msg.text)) {
          // Trusted callers skip the observation window
          log(`TG CA ${mint.slice(0,8)} from @${uname} — instant snipe`);
          await snipe(mint, `TG:${uname}`, {});
        }
      } catch (e) { log(`TG handler: ${e.message}`); }
    }, new NewMessage({ chats: CONFIG.TELEGRAM_GROUPS }));
  } catch (e) {
    log(`Telegram startup failed: ${e.message}`);
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function calcBcPct(solInCurve) { return Math.min(100, (solInCurve / 793) * 100); }
function bcPrice(vSol, vTokens) { return (!vSol || !vTokens) ? 0 : vSol / vTokens; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function extractAddresses(text) {
  return (text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || []).filter(m =>
    !m.includes('.') && !m.includes('/') &&
    m !== 'So11111111111111111111111111111111111111112' &&
    m !== '11111111111111111111111111111111'
  );
}
function persistState() {
  try {
    fs.writeFileSync('./trades.json', JSON.stringify({
      positions: state.positions, moonbags: state.moonbags,
      allTrades: state.allTrades.slice(-300), brain, halted: state.halted,
    }, null, 2));
  } catch (_) {}
}

// ─── STATS LOOP ───────────────────────────────────────────────────────────────
async function statsLoop() {
  while (state.running) {
    await sleep(5 * 60_000);
    const bal  = await getBalance();
    const wr   = brain.totalTrades > 0 ? ((brain.wins / brain.totalTrades) * 100).toFixed(0) : '-';
    const hrs  = brain.sessionStartTime ? ((Date.now() - brain.sessionStartTime) / 3_600_000).toFixed(1) : '?';
    const agg  = getTimeAggression();
    log([
      `STATS [${hrs}h in]`,
      `bal:${bal?.toFixed(4) ?? '?'} SOL`,
      `${brain.wins}W/${brain.losses}L(${wr}%)`,
      `streak:${brain.streak}`,
      `tier:${getTier().name}`,
      `sessMult:${brain.sessionMultiplier}x`,
      `timeAgg:${agg.toFixed(2)}x`,
      `sessionPnl:${brain.sessionPnl >= 0 ? '+' : ''}${brain.sessionPnl.toFixed(4)} SOL`,
      `totalPnl:${brain.totalPnlSOL >= 0 ? '+' : ''}${brain.totalPnlSOL.toFixed(4)} SOL`,
      `open:${Object.keys(state.positions).length} moonbags:${Object.keys(state.moonbags).length}`,
    ].join(' | '));
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const missing = ['PUMPPORTAL_KEY', 'WALLET_ADDRESS'].filter(k => !CONFIG[k]);
  if (missing.length) { log(`ERROR: missing ${missing.join(', ')}`); process.exit(1); }

  // Reset session tracking on each start
  brain.sessionStartTime  = Date.now();
  brain.sessionPnl        = 0;
  brain.sessionMultiplier = 1.0;

  // YOLO mode: skip warmup, start at tier 3 (HOT/YOLO_D) immediately
  if (YOLO && brain.totalTrades === 0) {
    brain.currentTier = 3;
    log(`YOLO_MODE: starting at tier ${ACTIVE_TIERS[3].name}`);
  }
  saveBrain();

  if (YOLO) {
    log('╔══════════════════════════════════════════════════════════════════╗');
    log('║   SOLANA MEME SNIPER — YOLO MODE — SEND IT                      ║');
    log('╚══════════════════════════════════════════════════════════════════╝');
    log(`No loss limit | 40-65% of balance per trade | Moonbag on every win`);
    log(`Observation: ${CONFIG.OBSERVATION_MS/1000}s | Cooldown: 90s | TP2 targets: 250-750%`);
    log(`Time aggression: 1.0x now → 1.5x in final 4h sprint`);
  } else {
    log('═══════════════════════════════════════════════════════════════════');
    log('  SOLANA MEME SNIPER v3 — Adaptive Tiers · Moonbag · 24h Sprint   ');
    log('═══════════════════════════════════════════════════════════════════');
    log(`Session: multiplier adapts with PnL | time aggression ramps to 1.25x in final 4h`);
  }
  const t = getTier();
  log(`Tier: ${t.name} | size: ${(t.balPct*100).toFixed(0)}% of bal (≤${t.maxSOL} SOL) | TP1:+${t.tp1Pct === 9999 ? 'OFF' : t.tp1Pct+'%'} TP2:+${t.tp2Pct}% SL:-${t.slPct}% | moonbag:${t.moonbag}`);
  log(`Filters: bc≤${CONFIG.MAX_BONDING_CURVE_PCT}% sol≥${CONFIG.MIN_SOL_IN_CURVE} dev≤${CONFIG.MAX_DEV_HOLDING_PCT}% buyers≥${CONFIG.MIN_UNIQUE_BUYERS} bsr≥${CONFIG.MIN_BUY_SELL_RATIO}`);

  const bal = await getBalance();
  log(`Wallet: ${bal?.toFixed(4) ?? 'unknown'} SOL`);
  if (!brain.startingBalance && bal) { brain.startingBalance = bal; saveBrain(); }

  startPumpFunWS();
  await startTelegram();
  monitorLoop();
  statsLoop();

  log('Ready. Hunting runners on PumpFun…');
  await new Promise(() => {});
}

process.on('SIGINT', async () => {
  state.running = false;
  log('Shutting down — closing positions…');
  for (const mint of Object.keys(state.positions)) await exitPosition(mint, 'MANUAL_STOP');
  for (const mint of Object.keys(state.moonbags))  await closeMoonbag(mint, 'MANUAL_STOP');
  persistState();
  process.exit(0);
});

main().catch(e => { log(`FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
