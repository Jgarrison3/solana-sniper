require('dotenv').config();
const { Connection, Keypair, VersionedTransaction, PublicKey } = require('@solana/web3.js');
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
    takeProfit: 0.50,
    stopLoss: 0.20,
    maxHoldSec: 300,
    solPerTrade: 0.05,
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

  if (balanceGrowth > 1.3) {
    brain.solPerTrade = Math.min(0.15, brain.solPerTrade * 1.1);
    log('Brain: Scaling up to ' + brain.solPerTrade.toFixed(3) + ' SOL/trade');
  } else if (balanceGrowth < 0.8) {
    brain.solPerTrade = Math.max(0.02, brain.solPerTrade * 0.85);
    log('Brain: Scaling down to ' + brain.solPerTrade.toFixed(3) + ' SOL/trade');
  }

  if (streak >= 3) {
    brain.takeProfit = Math.min(2.0, brain.takeProfit * 1.15);
    log('Brain: Hot streak - TP now ' + (brain.takeProfit * 100).toFixed(0) + '%');
  } else if (recentWinRate < 0.3) {
    brain.takeProfit = Math.max(0.30, brain.takeProfit * 0.9);
    log('Brain: Lowering TP to ' + (brain.takeProfit * 100).toFixed(0) + '%');
  }

  if (streak <= -3) {
    brain.stopLoss = Math.max(0.10, brain.stopLoss * 0.85);
    log('Brain: Tightening SL to ' + (brain.stopLoss * 100).toFixed(0) + '%');
  }

  saveBrain();
}

function recordTrade(pnlSOL, pnlPct, holdTime, symbol, reason) {
  brain.recentTrades.push({ pnl: pnlSOL, pct: pnlPct, holdTime: holdTime, symbol: symbol, reason: reason, time: Date.now() });
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
  priceHistory: {},
  recentlyTraded: {},
  totalSpent: 0,
  startTime: Date.now(),
  running: true,
};

const CONFIG = {
  RPC_URL: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  MAX_POSITIONS: 4,
  RUNTIME_MS: 24 * 60 * 60 * 1000,
  SCAN_INTERVAL_MS: 20000,
  SOL_MINT: 'So11111111111111111111111111111111111111112',
  RAYDIUM_API: 'https://transaction-v1.raydium.io',
};

// Top Solana meme/trending tokens to watch
const WATCHLIST = [
  { symbol: 'WIF',    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  { symbol: 'BONK',   mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { symbol: 'POPCAT', mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
  { symbol: 'MEW',    mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5' },
  { symbol: 'MYRO',   mint: 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4' },
  { symbol: 'BOME',   mint: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82' },
  { symbol: 'SLERF',  mint: '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3' },
  { symbol: 'PONKE',  mint: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK31CR6Ta' },
];

function loadWallet() {
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY missing');
  return Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
}

async function updateBalance() {
  const lamps = await state.connection.getBalance(state.wallet.publicKey);
  state.solBalance = lamps / 1e9;
  return state.solBalance;
}

async function raydiumSwap(inputMint, outputMint, amountLamports) {
  // Step 1: Get quote from Raydium
  const quoteUrl = CONFIG.RAYDIUM_API + '/compute/swap-base-in?inputMint=' + inputMint + '&outputMint=' + outputMint + '&amount=' + amountLamports + '&slippageBps=200&txVersion=V0';
  const quoteRes = await fetch(quoteUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!quoteRes.ok) throw new Error('Raydium quote error: ' + quoteRes.status);
  const quote = await quoteRes.json();
  if (!quote.success) throw new Error('Raydium quote failed: ' + JSON.stringify(quote));

  // Step 2: Get priority fee
  const feeRes = await fetch(CONFIG.RAYDIUM_API + '/compute/base-fee', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const feeData = await feeRes.json();
  const priorityFee = feeData.data ? feeData.data.default.h : 25000;

  // Step 3: Build transaction
  const txRes = await fetch(CONFIG.RAYDIUM_API + '/transaction/swap-base-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({
      computeUnitPriceMicroLamports: String(priorityFee),
      swapResponse: quote,
      txVersion: 'V0',
      wallet: state.wallet.publicKey.toBase58(),
      wrapSol: inputMint === CONFIG.SOL_MINT,
      unwrapSol: outputMint === CONFIG.SOL_MINT,
    }),
  });
  if (!txRes.ok) throw new Error('Raydium tx build error: ' + txRes.status);
  const txData = await txRes.json();
  if (!txData.success || !txData.data) throw new Error('Raydium tx build failed');

  // Step 4: Sign and send
  const txBuf = Buffer.from(txData.data[0].transaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([state.wallet]);
  const sig = await state.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await state.connection.confirmTransaction(sig, 'confirmed');
  return { sig, outAmount: parseInt(quote.data.outputAmount) };
}

async function getPrice(mint) {
  try {
    const url = 'https://api.dexscreener.com/latest/dex/tokens/' + mint;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) return null;
    const pair = data.pairs.sort(function(a, b) { return (b.liquidity ? b.liquidity.usd : 0) - (a.liquidity ? a.liquidity.usd : 0); })[0];
    return {
      price: parseFloat(pair.priceUsd || 0),
      priceChange5m: pair.priceChange ? (pair.priceChange.m5 || 0) : 0,
      priceChange1h: pair.priceChange ? (pair.priceChange.h1 || 0) : 0,
      volume5m: pair.volume ? (pair.volume.m5 || 0) : 0,
    };
  } catch (e) { return null; }
}

async function enterTrade(token, priceData) {
  const { symbol, mint } = token;
  if (state.positions[mint]) return;
  if (state.recentlyTraded[mint]) return;
  if (Object.keys(state.positions).length >= CONFIG.MAX_POSITIONS) return;

  const size = Math.max(0.02, Math.min(brain.solPerTrade, state.solBalance * 0.10));
  const lamports = Math.floor(size * 1e9);

  try {
    log('BUY ' + symbol + ' | 5m: +' + priceData.priceChange5m.toFixed(1) + '% | 1h: ' + priceData.priceChange1h.toFixed(1) + '% | Size: ' + size.toFixed(3) + ' SOL');
    const { sig, outAmount } = await raydiumSwap(CONFIG.SOL_MINT, mint, lamports);

    state.positions[mint] = {
      symbol: symbol,
      mint: mint,
      entryTime: Date.now(),
      entryPrice: priceData.price,
      solSpent: size,
      tokenAmount: outAmount,
      tp: brain.takeProfit,
      sl: brain.stopLoss,
      maxHold: brain.maxHoldSec,
    };

    state.totalSpent += size;
    await updateBalance();
    state.trades.push({ type: 'BUY', symbol: symbol, mint: mint, solSpent: size, entryPrice: priceData.price, sig: sig, time: new Date().toISOString() });
    log('BUY confirmed ' + symbol + ' @ $' + priceData.price.toFixed(6) + ' | tx: ' + sig + ' | Bal: ' + state.solBalance.toFixed(4) + ' SOL');

    setTimeout(function() {
      if (state.positions[mint]) exitTrade(mint, 'TIMEOUT');
    }, brain.maxHoldSec * 1000);

  } catch (e) {
    log('Buy failed ' + symbol + ': ' + e.message);
  }
}

async function exitTrade(mint, reason) {
  const pos = state.positions[mint];
  if (!pos) return;
  try {
    log('SELL ' + pos.symbol + ' | reason: ' + reason);
    const { sig } = await raydiumSwap(mint, CONFIG.SOL_MINT, pos.tokenAmount);
    const holdTime = (Date.now() - pos.entryTime) / 1000;
    const prevBal = state.solBalance;
    await updateBalance();
    const pnl = state.solBalance - prevBal + pos.solSpent;
    const pct = (pnl / pos.solSpent) * 100;

    state.trades.push({ type: 'SELL', symbol: pos.symbol, mint: mint, pnl: pnl, pct: pct, reason: reason, sig: sig, time: new Date().toISOString() });
    delete state.positions[mint];
    state.recentlyTraded[mint] = Date.now();
    recordTrade(pnl, pct, holdTime, pos.symbol, reason);

    const result = pnl > 0 ? 'WIN' : 'LOSS';
    log(result + ' ' + pos.symbol + ' | ' + (pnl > 0 ? '+' : '') + pnl.toFixed(4) + ' SOL (' + pct.toFixed(1) + '%) | ' + holdTime.toFixed(0) + 's | ' + reason);
    log('Brain: ' + brain.wins + 'W/' + brain.losses + 'L | Total PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL | Streak: ' + brain.streak + ' | Bal: ' + state.solBalance.toFixed(4) + ' SOL');
    fs.writeFileSync('./trades.json', JSON.stringify({ trades: state.trades, brain: brain }, null, 2));
  } catch (e) {
    log('Sell failed ' + pos.symbol + ': ' + e.message);
  }
}

async function scan() {
  log('Scanning ' + WATCHLIST.length + ' tokens...');
  for (const token of WATCHLIST) {
    try {
      const priceData = await getPrice(token.mint);
      if (!priceData || !priceData.price) continue;

      const { symbol, mint } = token;
      log(symbol + ' | 5m: ' + priceData.priceChange5m.toFixed(1) + '% | 1h: ' + priceData.priceChange1h.toFixed(1) + '% | Vol5m: $' + priceData.volume5m.toFixed(0));

      if (state.positions[mint]) {
        const pos = state.positions[mint];
        const pnlPct = ((priceData.price - pos.entryPrice) / pos.entryPrice) * 100;
        if (pnlPct >= pos.tp * 100) {
          log('TP hit ' + symbol + ': +' + pnlPct.toFixed(1) + '%');
          await exitTrade(mint, 'TAKE_PROFIT');
        } else if (pnlPct <= -(pos.sl * 100)) {
          log('SL hit ' + symbol + ': ' + pnlPct.toFixed(1) + '%');
          await exitTrade(mint, 'STOP_LOSS');
        }
        continue;
      }

      if (state.recentlyTraded[mint]) continue;

      const momentum5m = priceData.priceChange5m >= 3;
      const momentum1h = priceData.priceChange1h >= 5;
      const goodVolume = priceData.volume5m >= 50000;

      if (momentum5m && momentum1h && goodVolume) {
        log('SIGNAL ' + symbol + ' | 5m: +' + priceData.priceChange5m.toFixed(1) + '% | 1h: +' + priceData.priceChange1h.toFixed(1) + '%');
        await enterTrade(token, priceData);
      }

    } catch (e) {
      log('Error scanning ' + token.symbol + ': ' + e.message);
    }
  }
}

async function cleanupRecentlyTraded() {
  const now = Date.now();
  for (const mint in state.recentlyTraded) {
    if (now - state.recentlyTraded[mint] > 20 * 60 * 1000) {
      delete state.recentlyTraded[mint];
    }
  }
}

async function mainLoop() {
  while (state.running) {
    await scan();
    await cleanupRecentlyTraded();
    await new Promise(function(r) { setTimeout(r, CONFIG.SCAN_INTERVAL_MS); });
  }
}

async function main() {
  log('SOLANA MOMENTUM TRADER v5');
  log('Strategy: Momentum trading on established Solana tokens via Raydium');
  log('Tokens: WIF, BONK, POPCAT, MEW, MYRO, BOME, SLERF, PONKE');

  state.wallet = loadWallet();
  state.connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  log('Wallet: ' + state.wallet.publicKey.toString());
  await updateBalance();
  brain.startingBalance = state.solBalance;
  log('Starting balance: ' + state.solBalance.toFixed(4) + ' SOL');
  log('TP: ' + (brain.takeProfit * 100).toFixed(0) + '% | SL: ' + (brain.stopLoss * 100).toFixed(0) + '% | Size: ' + brain.solPerTrade.toFixed(3) + ' SOL/trade');
  log('Running until: ' + new Date(Date.now() + CONFIG.RUNTIME_MS).toISOString());

  mainLoop();

  setInterval(function() {
    const wr = brain.totalTrades > 0 ? ((brain.wins / brain.totalTrades) * 100).toFixed(0) : 0;
    log('STATS | ' + brain.wins + 'W/' + brain.losses + 'L (' + wr + '%) | PnL: ' + (brain.totalPnlSOL > 0 ? '+' : '') + brain.totalPnlSOL.toFixed(4) + ' SOL | Bal: ' + state.solBalance.toFixed(4) + ' SOL | Open: ' + Object.keys(state.positions).length);
  }, 3 * 60 * 1000);

  setTimeout(async function() {
    log('24h complete - closing all positions');
    state.running = false;
    for (const mint in state.positions) {
      await exitTrade(mint, 'END_OF_RUN');
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
    await exitTrade(mint, 'MANUAL_STOP');
  }
  const profit = state.solBalance - brain.startingBalance;
  log('Stopped: ' + state.solBalance.toFixed(4) + ' SOL | ' + (profit > 0 ? '+' : '') + profit.toFixed(4) + ' SOL');
  process.exit(0);
});

main().catch(function(e) {
  log('Fatal: ' + e.message);
  process.exit(1);
});
