import axios from "axios";
import { resilientHttpsAgent } from "../src/services/marketHealth.service";
import {
  fetchMexcKlines,
  fetchMexcTickers24h,
  getActiveMexcMirror,
  MexcKline,
  MexcTicker24h
} from "../src/services/mexcClient.service";
import { isFilteredOutSymbol, ScoutCandidate } from "../src/agents/scout.agent";
import { TechnicalAnalysisResult, TradeMode } from "../src/agents/technician.agent";
import { MacroFlowResult, TrendRegime } from "../src/agents/macroFlow.agent";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";

// =============================================================================
// STAGE 5.9 — 7-DAY LIVE-LIKE WALK-FORWARD REPLAY SIMULATOR (READ-ONLY AUDIT)
// Strictly NO look-ahead bias: at candle i, only candles 0..i and closed HTF
// candles with closeTime <= k15[i].closeTime are visible.
// =============================================================================

const STARTING_BALANCE_USD = 1000;
const POSITION_SIZE_USD = 100;
const FEE_PCT = 0.1; // 0.10% exchange fee
const SLIPPAGE_PCT = 0.15; // 0.15% execution slippage
const ROUND_TRIP_FRICTION_PCT = FEE_PCT + SLIPPAGE_PCT; // 0.25% total per closed leg

const TP1_WEIGHT = 0.4;
const TP2_WEIGHT = 0.35;
const TP3_WEIGHT = 0.25;

const REPLAY_DAYS = 7;
const BARS_PER_DAY_15M = 96;
const REPLAY_BARS_15M = REPLAY_DAYS * BARS_PER_DAY_15M; // 672 bars = exact 7 full days
const WARMUP_BARS_15M = 56; // >= 50 for EMA50 convergence
const FETCH_LIMIT_15M = REPLAY_BARS_15M + WARMUP_BARS_15M; // 728 bars (fallback 700 if mirror caps)

const COOLDOWN_BARS_15M = 8; // 2 hours (8 x 15m) per-symbol anti-spam cooldown
const SL_FIRST_LOCK_MS = 6 * 60 * 60 * 1000; // Stage 5.9: 6h backoff after 1st SL
const SL_REPEAT_LOCK_MS = 24 * 60 * 60 * 1000; // Stage 5.9: 24h lock after >=2 SLs in 24h
const CB_WINDOW_MS = 2 * 60 * 60 * 1000; // Stage 5.9: 2h rolling SL window
const CB_THRESHOLD = 3; // Stage 5.9: 3+ SLs in 2h -> 2h global pause
const CB_PAUSE_MS = 2 * 60 * 60 * 1000;
const MAX_AT_RISK_ACTIVE = 4; // Stage 5.9 cap
const MAX_TOTAL_ACTIVE = 6; // Stage 5.9 cap
const MAX_HOLD_INTRADAY_BARS = 96; // 24h
const MAX_HOLD_SWING_BARS = 480; // 5 days

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function roundPrice(price: number): number {
  if (price >= 100) return Number(price.toFixed(2));
  if (price >= 1) return Number(price.toFixed(4));
  if (price >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(7));
}

function calcEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values[0];
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[i] : values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function calcWilderRsiSeries(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(50);
  if (closes.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  }
  return out;
}

function calcAtrSeries(klines: MexcKline[], period = 14): number[] {
  const trs: number[] = [0];
  for (let i = 1; i < klines.length; i++) {
    const curr = klines[i];
    const prevClose = klines[i - 1].close;
    trs.push(
      Math.max(curr.high - curr.low, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose))
    );
  }
  const out = new Array<number>(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += trs[j];
    out[i] = sum / period;
  }
  return out;
}

interface HtfPack {
  klines: MexcKline[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
}

interface CoinReplayData {
  symbol: string;
  ticker24hVol: number;
  k15: MexcKline[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
  rsi14: number[];
  atr14: number[];
  h1: HtfPack;
  h4: HtfPack;
  timeToIdx: Map<number, number>;
}

function buildHtfPack(klines: MexcKline[]): HtfPack {
  const closes = klines.map((k) => k.close);
  return {
    klines,
    ema9: calcEmaSeries(closes, 9),
    ema21: calcEmaSeries(closes, 21),
    ema50: calcEmaSeries(closes, 50)
  };
}

function getClosedHtfTrendAt(pack: HtfPack, ts: number): { regime: TrendRegime; aboveEma50: boolean } {
  // Strictly closed HTF candles only (closeTime <= ts) — ZERO look-ahead bias
  let idx = -1;
  for (let i = pack.klines.length - 1; i >= 0; i--) {
    if (pack.klines[i].closeTime <= ts) {
      idx = i;
      break;
    }
  }
  if (idx < 10) return { regime: "NEUTRAL", aboveEma50: true };
  const e9 = pack.ema9[idx];
  const e21 = pack.ema21[idx];
  const e50 = pack.ema50[idx];
  const last = pack.klines[idx].close;
  const aboveEma50 = idx >= 45 ? last > e50 && e21 >= e50 * 0.995 : true;

  if (e9 > e21 * 1.001 && last >= e9 * 0.998) return { regime: "BULLISH", aboveEma50 };
  if (e9 < e21 * 0.999 && last <= e9 * 1.002) return { regime: "BEARISH", aboveEma50 };
  return { regime: "NEUTRAL", aboveEma50 };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// Mirrors src/agents/scout.agent.ts scoring at bar i (strictly 0..i)
function buildScoutCandidateAt(d: CoinReplayData, i: number): ScoutCandidate {
  const bar = d.k15[i];
  const entryPrice = bar.close;
  const lookback24hIdx = Math.max(0, i - BARS_PER_DAY_15M);
  const open24h = d.k15[lookback24hIdx].close;
  const priceChange24hPct =
    open24h > 0 ? Number((((entryPrice - open24h) / open24h) * 100).toFixed(2)) : 0;

  let rollingQuoteVol24h = 0;
  for (let j = lookback24hIdx; j <= i; j++) rollingQuoteVol24h += d.k15[j].quoteAssetVolume;
  const quoteVolume24hUsd = Math.round(rollingQuoteVol24h || d.ticker24hVol);

  let histVolSum = 0;
  const volLookbackStart = Math.max(0, i - 20);
  const volLookbackCount = Math.max(1, i - volLookbackStart);
  for (let j = volLookbackStart; j < i; j++) histVolSum += d.k15[j].quoteAssetVolume;
  const avgQuoteVol = histVolSum / volLookbackCount;
  const volumeSpikeRatio15m =
    avgQuoteVol > 0 ? Number((bar.quoteAssetVolume / avgQuoteVol).toFixed(2)) : 1;

  const momentum15mPct =
    bar.open > 0 ? Number((((bar.close - bar.open) / bar.open) * 100).toFixed(2)) : 0;

  let volPoints = 0;
  if (volumeSpikeRatio15m >= 1.1 && volumeSpikeRatio15m <= 3.5) {
    volPoints = clamp(24 + (volumeSpikeRatio15m - 1.1) * 5.5, 24, 36);
  } else if (volumeSpikeRatio15m > 3.5 && volumeSpikeRatio15m <= 5.5) {
    volPoints = 22;
  } else if (volumeSpikeRatio15m > 5.5) {
    volPoints = clamp(16 - (volumeSpikeRatio15m - 5.5) * 2.0, 4, 16);
  } else {
    volPoints = clamp(volumeSpikeRatio15m * 18, 6, 20);
  }

  let breakoutPoints = 0;
  if (priceChange24hPct >= 0.5 && priceChange24hPct <= 12) breakoutPoints = 26;
  else if (priceChange24hPct >= -2 && priceChange24hPct < 0.5) breakoutPoints = 16;
  else if (priceChange24hPct > 12 && priceChange24hPct <= 18) breakoutPoints = 8;
  else if (priceChange24hPct > 18) breakoutPoints = -20 - Math.min(18, (priceChange24hPct - 18) * 0.9);
  else breakoutPoints = 2;

  let momPoints = 0;
  if (momentum15mPct >= 0.1 && momentum15mPct <= 1.8) momPoints = clamp(12 + momentum15mPct * 4.5, 12, 20);
  else if (momentum15mPct > 1.8 && momentum15mPct <= 3.2) momPoints = 10;
  else if (momentum15mPct > 3.2) momPoints = 2;
  else if (momentum15mPct >= -0.8) momPoints = 6;

  const liqPoints =
    quoteVolume24hUsd >= 3_000_000
      ? clamp(10 + (Math.log10(quoteVolume24hUsd) - 6.47) * 5.5, 10, 18)
      : 0;

  const scoutScore = Math.round(clamp(volPoints + breakoutPoints + momPoints + liqPoints, 0, 100));
  const isHealthySetup =
    priceChange24hPct >= 0.5 &&
    priceChange24hPct <= 12 &&
    volumeSpikeRatio15m >= 1.1 &&
    volumeSpikeRatio15m <= 5.0 &&
    momentum15mPct > 0;

  return {
    symbol: d.symbol,
    exchange: "MEXC",
    lastPrice: entryPrice,
    priceChange24hPct,
    quoteVolume24hUsd,
    volumeSpikeRatio15m,
    momentum15mPct,
    scoutScore,
    isAnomaly: isHealthySetup || (scoutScore >= 64 && priceChange24hPct <= 18),
    isNewAlert: true,
    reasons: [],
    detectedAt: new Date(bar.closeTime).toISOString()
  };
}

// Mirrors src/agents/technician.agent.ts EXACTLY at bar i (strictly 0..i)
function buildTechnicianAt(d: CoinReplayData, i: number): TechnicalAnalysisResult | null {
  const lastBar = d.k15[i];
  const prevBar = d.k15[i - 1];
  const entryPrice = lastBar.close;
  const rsi14 = d.rsi14[i];
  const ema9 = d.ema9[i];
  const ema21 = d.ema21[i];
  const ema50 = d.ema50[i];
  const ema21Prev3 = d.ema21[Math.max(0, i - 3)];
  const ema21Rising = ema21 > ema21Prev3;
  const atr14 = d.atr14[i];

  let supportLevel = Infinity;
  let resistanceLevel = -Infinity;
  for (let j = Math.max(0, i - 19); j <= i; j++) {
    if (d.k15[j].low < supportLevel) supportLevel = d.k15[j].low;
    if (d.k15[j].high > resistanceLevel) resistanceLevel = d.k15[j].high;
  }
  let support10 = Infinity;
  for (let j = Math.max(0, i - 9); j <= i; j++) {
    if (d.k15[j].low < support10) support10 = d.k15[j].low;
  }

  const atrPct = entryPrice > 0 ? Number(((atr14 / entryPrice) * 100).toFixed(2)) : 0;
  const tradeMode: TradeMode =
    ema9 > ema21 * 1.003 && ema21 > ema50 && rsi14 >= 44 && rsi14 <= 64 && atrPct >= 0.4
      ? "SWING"
      : "INTRADAY";

  const roundedEntry = roundPrice(entryPrice);
  const mult1 = tradeMode === "SWING" ? 1.4 : 1.2;
  const mult2 = tradeMode === "SWING" ? 2.5 : 2.2;
  const mult3 = tradeMode === "SWING" ? 3.8 : 3.3;

  let stopLossPrice: number;
  let riskPerUnit: number;

  if (tradeMode === "SWING") {
    const swingAtrStop = entryPrice - Math.max(atr14 * 2.2, entryPrice * 0.02);
    const maxSwingFloor = entryPrice * 0.958;
    const supportStop = supportLevel * 0.995;
    const rawStop = Math.max(maxSwingFloor, Math.min(swingAtrStop, supportStop));
    stopLossPrice = roundPrice(Math.min(rawStop, entryPrice * 0.98));
    riskPerUnit = Math.max(roundedEntry - stopLossPrice, roundedEntry * 0.008);
  } else {
    const atrStop = entryPrice - Math.max(atr14 * 1.8, entryPrice * 0.015);
    const maxIntradayFloor = entryPrice * 0.97;
    const supportStop = support10 * 0.996;
    const rawStop = Math.max(maxIntradayFloor, Math.min(atrStop, supportStop));
    stopLossPrice = roundPrice(Math.min(rawStop, entryPrice * 0.985));
    riskPerUnit = Math.max(roundedEntry - stopLossPrice, roundedEntry * 0.008);
  }

  const tp1Price = roundPrice(roundedEntry + riskPerUnit * mult1);
  const tp2Price = roundPrice(
    Math.max(roundedEntry + riskPerUnit * Math.max(mult2, 2.2), tp1Price * 1.005)
  );
  const tp3Price = roundPrice(
    Math.max(roundedEntry + riskPerUnit * mult3, tp2Price + riskPerUnit * 1.0, tp2Price * 1.008)
  );
  const takeProfitPrice = tp2Price;

  if (!(stopLossPrice < roundedEntry && roundedEntry < tp1Price && tp1Price < tp2Price && tp2Price < tp3Price)) {
    return null;
  }

  const riskRewardRatio = Number(((takeProfitPrice - roundedEntry) / riskPerUnit).toFixed(2));
  const stretchAboveEma21Pct =
    ema21 > 0 ? Number((((entryPrice - ema21) / ema21) * 100).toFixed(2)) : 0;
  const distAboveSupportPct = supportLevel > 0 ? ((entryPrice - supportLevel) / supportLevel) * 100 : 0;
  const distToEma9Pct = ema9 > 0 ? Math.abs((entryPrice - ema9) / ema9) * 100 : 0;

  const isBullishCandle = lastBar.close > lastBar.open;
  const recentDipLow = Math.min(lastBar.low, prevBar.low);
  const touchedEmaZone = recentDipLow <= ema9 * 1.004 && recentDipLow >= ema50 * 0.995;
  const reclaimedAboveEma9 = lastBar.close > ema9 && lastBar.close > lastBar.open && entryPrice >= ema9 * 0.998;
  const isPullbackReclaim =
    ema9 > ema21 &&
    ema21 > ema50 &&
    ema21Rising &&
    touchedEmaZone &&
    reclaimedAboveEma9 &&
    stretchAboveEma21Pct >= 0 &&
    stretchAboveEma21Pct <= 2.2;

  let techScore = 25;
  if (ema9 > ema21) techScore += 14;
  if (ema21 > ema50) techScore += 12;
  if (ema21Rising) techScore += 6;
  if (isPullbackReclaim) techScore += 16;

  if (rsi14 >= 44 && rsi14 <= 64) techScore += 18;
  else if (rsi14 >= 40 && rsi14 < 44) techScore += 8;
  else if (rsi14 > 64 && rsi14 <= 68) techScore += 4;
  else if (rsi14 > 70 || rsi14 < 38) techScore -= 18;

  if (distToEma9Pct <= 1.2 && stretchAboveEma21Pct <= 2.2) techScore += 8;
  else if (stretchAboveEma21Pct > 2.2) techScore -= 16;

  if (distAboveSupportPct <= 3.5) techScore += 4;
  if (riskRewardRatio >= 2.2) techScore += 6;
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));

  const isBullishTrend =
    ema9 > ema21 &&
    ema21 > ema50 &&
    ema21Rising &&
    entryPrice >= ema9 * 0.998 &&
    rsi14 >= 42 &&
    rsi14 <= 66 &&
    stretchAboveEma21Pct <= 2.4;

  return {
    symbol: d.symbol,
    direction: isBullishTrend ? "LONG" : "SKIP",
    tradeMode,
    entryPrice: roundedEntry,
    stopLossPrice,
    takeProfitPrice,
    tp1Price,
    tp2Price,
    tp3Price,
    riskRewardRatio,
    rsi14,
    ema9: roundPrice(ema9),
    ema21: roundPrice(ema21),
    ema50: roundPrice(ema50),
    ema21Rising,
    stretchAboveEma21Pct,
    atrPct,
    isBullishCandle,
    isPullbackReclaim,
    atr14: roundPrice(atr14),
    supportLevel: roundPrice(supportLevel),
    resistanceLevel: roundPrice(resistanceLevel),
    techScore,
    summary: "",
    latencyMs: 0
  };
}

// Mirrors src/agents/macroFlow.agent.ts at timestamp ts (strictly closed HTF candles <= ts)
function buildMacroAt(d: CoinReplayData, btc: CoinReplayData, ts: number, btcIdx15: number): MacroFlowResult {
  const t1h = getClosedHtfTrendAt(d.h1, ts);
  const t4h = getClosedHtfTrendAt(d.h4, ts);
  const btc1h = getClosedHtfTrendAt(btc.h1, ts);
  const btc4h = getClosedHtfTrendAt(btc.h4, ts);

  let btcChange1hPct = 0;
  if (btcIdx15 >= 4) {
    const latestClose = btc.k15[btcIdx15].close;
    const hourAgoClose = btc.k15[btcIdx15 - 4].close;
    if (hourAgoClose > 0) {
      btcChange1hPct = Number((((latestClose - hourAgoClose) / hourAgoClose) * 100).toFixed(2));
    }
  }

  // Neutral institutional order-book proxy for Top-20 highest-liquidity pairs (klines lack historical L2 depth)
  const bidAskRatio = 1.15;
  const spreadPct = 0.05;

  let macroScore = 50;
  if (bidAskRatio >= 1.15) macroScore += 16;
  if (spreadPct <= 0.15) macroScore += 10;

  if (btcChange1hPct >= 0.2) macroScore += 10;
  else if (btcChange1hPct <= -0.6) macroScore -= 22;

  if (btc1h.regime === "BEARISH" && btc4h.regime === "BEARISH") macroScore -= 18;
  else if (btc1h.regime === "BULLISH" && btc4h.regime === "BULLISH") macroScore += 8;

  if (t1h.regime === "BULLISH") macroScore += 7;
  else if (t1h.regime === "BEARISH") macroScore -= 12;

  if (t4h.regime === "BULLISH") macroScore += 7;
  else if (t4h.regime === "BEARISH") macroScore -= 12;

  if (t4h.aboveEma50) macroScore += 4;
  macroScore = Math.max(0, Math.min(100, Math.round(macroScore)));

  let regime: TrendRegime = "NEUTRAL";
  if (
    btcChange1hPct <= -0.6 ||
    (btc1h.regime === "BEARISH" && btc4h.regime === "BEARISH") ||
    t1h.regime === "BEARISH" ||
    t4h.regime === "BEARISH" ||
    macroScore < 42
  ) {
    regime = "BEARISH";
  } else if (macroScore >= 65) {
    regime = "BULLISH";
  }

  return {
    symbol: d.symbol,
    btcChange1hPct,
    btcTrend1h: btc1h.regime,
    btcTrend4h: btc4h.regime,
    btcAbove4hEma50: btc4h.aboveEma50,
    above4hEma50: t4h.aboveEma50,
    bidDepthUsd: 250_000,
    askDepthUsd: 217_000,
    bidAskRatio,
    spreadPct,
    regime,
    trend1h: t1h.regime,
    trend4h: t4h.regime,
    fundingRatePct: null,
    exchanges: ["MEXC"],
    macroScore,
    summary: "",
    latencyMs: 0
  };
}

type ReplayOutcome =
  | "TP3_HIT"
  | "TP2_TRAIL_WIN"
  | "BREAKEVEN_PROFIT"
  | "SL_HIT"
  | "EXPIRED_WIN"
  | "EXPIRED_LOSS";

interface OpenReplayPosition {
  symbol: string;
  dIdx: number;
  tradeMode: TradeMode;
  entryTs: number;
  entryBarIdxGlobal: number;
  entryPrice: number;
  initialSl: number;
  activeSl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  remainingWeight: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  realizedNetUsd: number;
  totalFrictionUsd: number;
  barsHeld: number;
  // Entry context for Post-Mortem diagnostics
  entryRsi: number;
  entryBtc1hPct: number;
  entryBtcTrend4h: TrendRegime;
  entryVolSpike: number;
  entryAtrPct: number;
  entryStretchPct: number;
  entryTrend1h: TrendRegime;
  entryTrend4h: TrendRegime;
  entryUtcHour: number;
}

interface ClosedReplayTrade {
  symbol: string;
  tradeMode: TradeMode;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  initialSl: number;
  slDistPct: number;
  outcome: ReplayOutcome;
  netUsd: number;
  netPct: number;
  frictionUsd: number;
  barsHeld: number;
  entryRsi: number;
  entryBtc1hPct: number;
  entryBtcTrend4h: TrendRegime;
  entryVolSpike: number;
  entryAtrPct: number;
  entryStretchPct: number;
  entryTrend1h: TrendRegime;
  entryTrend4h: TrendRegime;
  entryUtcHour: number;
}

function closeLeg(
  pos: OpenReplayPosition,
  weight: number,
  exitPrice: number
): void {
  const clampedW = Math.min(weight, pos.remainingWeight);
  if (clampedW <= 0) return;
  const legNotional = POSITION_SIZE_USD * clampedW;
  const grossPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
  const frictionUsd = legNotional * (ROUND_TRIP_FRICTION_PCT / 100);
  const netLegUsd = legNotional * (grossPct / 100) - frictionUsd;
  pos.realizedNetUsd += netLegUsd;
  pos.totalFrictionUsd += frictionUsd;
  pos.remainingWeight = Number((pos.remainingWeight - clampedW).toFixed(6));
}

function formatDateKey(ts: number): string {
  // Tashkent UTC+5 date key for Uzbek user clarity
  const uzt = new Date(ts + 5 * 60 * 60 * 1000);
  return uzt.toISOString().slice(0, 10);
}

const MEXC_MIRRORS = ["https://api.mexc.io", "https://api.mexc.co", "https://api.mexc.com"];

async function fetchKlinesPage(
  symbol: string,
  interval: "15m" | "60m" | "4h",
  limit: number,
  startTime?: number,
  endTime?: number
): Promise<MexcKline[]> {
  const active = getActiveMexcMirror();
  const mirrors = [active, ...MEXC_MIRRORS.filter((m) => m !== active)];
  const qs =
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}` +
    (startTime ? `&startTime=${startTime}` : "") +
    (endTime ? `&endTime=${endTime}` : "");
  let lastErr: unknown = null;
  for (const base of mirrors) {
    try {
      const res = await axios.get<Array<Array<string | number>>>(`${base}${qs}`, {
        timeout: 12000,
        httpsAgent: resilientHttpsAgent,
        headers: { Accept: "application/json", "User-Agent": "CryptoQuant-Copilot/0.5" }
      });
      return (res.data || []).map((k) => ({
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: Number(k[6]),
        quoteAssetVolume: Number(k[7])
      }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed klines page for ${symbol}`);
}

async function fetchFull7dKlines15m(symbol: string): Promise<MexcKline[]> {
  // MEXC caps single klines call at 500 bars and requires BOTH startTime & endTime to paginate backward
  const newest = await fetchKlinesPage(symbol, "15m", 500);
  if (newest.length === 0) return [];
  const neededOlder = Math.max(0, FETCH_LIMIT_15M - newest.length + 12);
  if (neededOlder <= 0) return newest;

  const endTime = newest[0].openTime - 1;
  const startTime = newest[0].openTime - neededOlder * 15 * 60 * 1000;
  const older = await fetchKlinesPage(symbol, "15m", Math.min(500, neededOlder + 10), startTime, endTime);
  const byOpen = new Map<number, MexcKline>();
  for (const k of older) byOpen.set(k.openTime, k);
  for (const k of newest) byOpen.set(k.openTime, k);
  return Array.from(byOpen.values()).sort((a, b) => a.openTime - b.openTime);
}

async function main() {
  console.log("===============================================================================");
  console.log("  CRYPTOQUANT-COPILOT STAGE 5.9 — 7 KUNLIK WALK-FORWARD REPLAY SIMULYATORI");
  console.log("===============================================================================");
  console.log("  [1/3] MEXC 24s likvid juftliklari yuklanmoqda (mirror fallback)...");

  const allTickers: MexcTicker24h[] = await fetchMexcTickers24h();
  const eligible = allTickers
    .filter((t) => !isFilteredOutSymbol(t.symbol) && t.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  const selectedTickers = eligible.slice(0, 20);
  if (!selectedTickers.some((t) => t.symbol === "BTCUSDT")) {
    const btcTicker = allTickers.find((t) => t.symbol === "BTCUSDT");
    if (btcTicker) selectedTickers.push(btcTicker);
  }

  console.log(
    `  Faol mirror: ${getActiveMexcMirror()} | Top-${selectedTickers.length} eng likvid juftlik tanlandi.`
  );
  console.log(
    `  Juftliklar: ${selectedTickers.map((t) => t.symbol.replace("USDT", "")).join(", ")}`
  );
  console.log("  [2/3] To'liq 7 kunlik 15m (~730 sham, 2 sahifa), 1h (220 sham) va 4h (120 sham) yuklanmoqda...");

  const loadedRaw = await mapWithConcurrency(selectedTickers, 4, async (t): Promise<CoinReplayData | null> => {
    try {
      const [k15, k1h, k4h] = await Promise.all([
        fetchFull7dKlines15m(t.symbol),
        fetchMexcKlines(t.symbol, "1h", 220),
        fetchMexcKlines(t.symbol, "4h", 120)
      ]);
      if (k15.length < 600 || k1h.length < 150 || k4h.length < 50) return null;
      // Drop the last potentially unclosed live bar for deterministic replay
      const closed15 = k15.slice(0, k15.length - 1);
      const closes15 = closed15.map((k) => k.close);
      const timeToIdx = new Map<number, number>();
      closed15.forEach((k, idx) => timeToIdx.set(k.closeTime, idx));

      return {
        symbol: t.symbol,
        ticker24hVol: t.quoteVolume,
        k15: closed15,
        ema9: calcEmaSeries(closes15, 9),
        ema21: calcEmaSeries(closes15, 21),
        ema50: calcEmaSeries(closes15, 50),
        rsi14: calcWilderRsiSeries(closes15, 14),
        atr14: calcAtrSeries(closed15, 14),
        h1: buildHtfPack(k1h.slice(0, k1h.length - 1)),
        h4: buildHtfPack(k4h.slice(0, k4h.length - 1)),
        timeToIdx
      };
    } catch {
      return null;
    }
  });

  const datasets = loadedRaw.filter((d): d is CoinReplayData => d !== null);
  const btc = datasets.find((d) => d.symbol === "BTCUSDT");
  if (!btc) {
    throw new Error("BTCUSDT benchmark klines yuklanmadi.");
  }

  const totalBtcBars = btc.k15.length;
  const startGlobalIdx = Math.max(WARMUP_BARS_15M, totalBtcBars - REPLAY_BARS_15M);
  const actualReplayBars = totalBtcBars - startGlobalIdx;
  const actualReplayDays = Number((actualReplayBars / BARS_PER_DAY_15M).toFixed(2));

  const startTs = btc.k15[startGlobalIdx].closeTime;
  const endTs = btc.k15[totalBtcBars - 1].closeTime;
  const btcStartPrice = btc.k15[startGlobalIdx].close;
  const btcEndPrice = btc.k15[totalBtcBars - 1].close;
  const btcPeriodChgPct = Number((((btcEndPrice - btcStartPrice) / btcStartPrice) * 100).toFixed(2));
  const btcPeriodLow = Math.min(...btc.k15.slice(startGlobalIdx).map((k) => k.low));
  const btcPeriodHigh = Math.max(...btc.k15.slice(startGlobalIdx).map((k) => k.high));

  console.log(
    `  [3/3] ${datasets.length} ta koin yuklandi | Davr: ${new Date(startTs).toISOString().slice(0, 16)}Z → ${new Date(endTs).toISOString().slice(0, 16)}Z (${actualReplayBars} sham = ${actualReplayDays} kun)`
  );
  console.log(
    `  BTC davr harakati: $${btcStartPrice} → $${btcEndPrice} (${btcPeriodChgPct >= 0 ? "+" : ""}${btcPeriodChgPct}%) | Min: $${btcPeriodLow} / Max: $${btcPeriodHigh}\n`
  );

  // Walk-forward replay state
  let balanceUsd = STARTING_BALANCE_USD;
  let peakBalanceUsd = STARTING_BALANCE_USD;
  let maxDrawdownPct = 0;

  const openPositions: OpenReplayPosition[] = [];
  const closedTrades: ClosedReplayTrade[] = [];

  const lastDispatchBarBySymbol = new Map<string, number>();
  const symbolSlBlockedUntil = new Map<string, number>();
  const symbolSlHistory = new Map<string, number[]>();
  const globalSlTimestamps: number[] = [];
  let globalCbPausedUntil = 0;

  // Guard counters for audit visibility
  let criticApprovedTotal = 0;
  let blockedByCooldown = 0;
  let blockedBySlBackoff = 0;
  let blockedByCircuitBreaker = 0;
  let blockedByMaxCap = 0;
  let blockedByDuplicate = 0;

  for (let t = startGlobalIdx; t < totalBtcBars; t++) {
    const ts = btc.k15[t].closeTime;
    const isFinalBar = t === totalBtcBars - 1;

    // -------------------------------------------------------------------------
    // STEP A: EVALUATE ALL OPEN POSITIONS ON CANDLE t (WORST-CASE SL FIRST!)
    // -------------------------------------------------------------------------
    for (let p = openPositions.length - 1; p >= 0; p--) {
      const pos = openPositions[p];
      const barIdx = datasets[pos.dIdx].timeToIdx.get(ts);
      if (barIdx === undefined) continue;
      const bar = datasets[pos.dIdx].k15[barIdx];
      pos.barsHeld += 1;

      let closedOutcome: ReplayOutcome | null = null;

      // Conservative worst-case rule: if low <= activeSL inside candle, SL executes FIRST before any TP in same candle!
      if (bar.low <= pos.activeSl) {
        closeLeg(pos, pos.remainingWeight, pos.activeSl);
        if (pos.tp2Hit) {
          closedOutcome = "TP2_TRAIL_WIN";
        } else if (pos.tp1Hit) {
          closedOutcome = "BREAKEVEN_PROFIT";
        } else {
          closedOutcome = "SL_HIT";
        }
      } else {
        // Check TP1 / TP2 / TP3 milestones sequentially
        if (!pos.tp1Hit && bar.high >= pos.tp1) {
          closeLeg(pos, TP1_WEIGHT, pos.tp1);
          pos.tp1Hit = true;
          pos.activeSl = pos.entryPrice; // Move SL to Breakeven
        }
        if (!pos.tp2Hit && bar.high >= pos.tp2) {
          closeLeg(pos, TP2_WEIGHT, pos.tp2);
          pos.tp1Hit = true;
          pos.tp2Hit = true;
          pos.activeSl = pos.tp1; // Trail SL up to TP1
        }
        if (bar.high >= pos.tp3 && pos.remainingWeight > 0) {
          closeLeg(pos, pos.remainingWeight, pos.tp3);
          closedOutcome = "TP3_HIT";
        }

        // Check max hold expiry or end of 7-day replay window
        if (!closedOutcome) {
          const maxHold = pos.tradeMode === "SWING" ? MAX_HOLD_SWING_BARS : MAX_HOLD_INTRADAY_BARS;
          if (pos.barsHeld >= maxHold || isFinalBar) {
            closeLeg(pos, pos.remainingWeight, bar.close);
            closedOutcome = pos.realizedNetUsd >= 0 ? "EXPIRED_WIN" : "EXPIRED_LOSS";
          }
        }
      }

      if (closedOutcome) {
        const netUsd = Number(pos.realizedNetUsd.toFixed(4));
        const netPct = Number(((netUsd / POSITION_SIZE_USD) * 100).toFixed(2));
        const slDistPct = Number((((pos.entryPrice - pos.initialSl) / pos.entryPrice) * 100).toFixed(2));

        balanceUsd = Number((balanceUsd + netUsd).toFixed(4));
        if (balanceUsd > peakBalanceUsd) peakBalanceUsd = balanceUsd;
        const ddPct = peakBalanceUsd > 0 ? ((peakBalanceUsd - balanceUsd) / peakBalanceUsd) * 100 : 0;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

        closedTrades.push({
          symbol: pos.symbol,
          tradeMode: pos.tradeMode,
          entryTs: pos.entryTs,
          exitTs: ts,
          entryPrice: pos.entryPrice,
          initialSl: pos.initialSl,
          slDistPct,
          outcome: closedOutcome,
          netUsd,
          netPct,
          frictionUsd: Number(pos.totalFrictionUsd.toFixed(4)),
          barsHeld: pos.barsHeld,
          entryRsi: pos.entryRsi,
          entryBtc1hPct: pos.entryBtc1hPct,
          entryBtcTrend4h: pos.entryBtcTrend4h,
          entryVolSpike: pos.entryVolSpike,
          entryAtrPct: pos.entryAtrPct,
          entryStretchPct: pos.entryStretchPct,
          entryTrend1h: pos.entryTrend1h,
          entryTrend4h: pos.entryTrend4h,
          entryUtcHour: pos.entryUtcHour
        });

        // Feed Stage 5.9 Adaptive SL Backoff & Global SL Circuit Breaker
        if (closedOutcome === "SL_HIT") {
          const hist = (symbolSlHistory.get(pos.symbol) ?? []).filter(
            (x) => ts - x <= 24 * 60 * 60 * 1000
          );
          hist.push(ts);
          symbolSlHistory.set(pos.symbol, hist);
          const lockMs = hist.length >= 2 ? SL_REPEAT_LOCK_MS : SL_FIRST_LOCK_MS;
          symbolSlBlockedUntil.set(pos.symbol, Math.max(symbolSlBlockedUntil.get(pos.symbol) ?? 0, ts + lockMs));

          globalSlTimestamps.push(ts);
          while (globalSlTimestamps.length > 0 && ts - globalSlTimestamps[0] > CB_WINDOW_MS) {
            globalSlTimestamps.shift();
          }
          if (globalSlTimestamps.length >= CB_THRESHOLD) {
            globalCbPausedUntil = Math.max(globalCbPausedUntil, ts + CB_PAUSE_MS);
          }
        }

        openPositions.splice(p, 1);
      }
    }

    if (isFinalBar) continue;

    // -------------------------------------------------------------------------
    // STEP B: SCAN TOP-20 COINS WITH EXACT STAGE 5.9 PIPELINE AT BAR t
    // -------------------------------------------------------------------------
    // Pre-rank candidates by Scout score (top 8 evaluated per pipeline cycle, matching MAX_SYMBOLS_TO_EVALUATE = 8)
    const scoredCandidates: Array<{ dIdx: number; barIdx: number; scout: ScoutCandidate }> = [];
    for (let dIdx = 0; dIdx < datasets.length; dIdx++) {
      const barIdx = datasets[dIdx].timeToIdx.get(ts);
      if (barIdx === undefined || barIdx < WARMUP_BARS_15M) continue;
      const scout = buildScoutCandidateAt(datasets[dIdx], barIdx);
      scoredCandidates.push({ dIdx, barIdx, scout });
    }
    scoredCandidates.sort((a, b) => b.scout.scoutScore - a.scout.scoutScore);
    const topEvaluated = scoredCandidates.slice(0, 8);

    for (const item of topEvaluated) {
      const d = datasets[item.dIdx];
      const tech = buildTechnicianAt(d, item.barIdx);
      if (!tech) continue;
      const macro = buildMacroAt(d, btc, ts, t);
      const critic = runCriticRiskAgent(item.scout, tech, macro);

      if (critic.verdict !== "APPROVE") continue;
      criticApprovedTotal++;

      // Apply exact Stage 5.9 dispatch guards
      if (openPositions.some((op) => op.symbol === d.symbol)) {
        blockedByDuplicate++;
        continue;
      }
      if (ts < globalCbPausedUntil) {
        blockedByCircuitBreaker++;
        continue;
      }
      if ((symbolSlBlockedUntil.get(d.symbol) ?? 0) > ts) {
        blockedBySlBackoff++;
        continue;
      }
      const lastBar = lastDispatchBarBySymbol.get(d.symbol);
      if (lastBar !== undefined && t - lastBar < COOLDOWN_BARS_15M) {
        blockedByCooldown++;
        continue;
      }
      const atRiskCount = openPositions.filter((op) => !op.tp1Hit).length;
      if (atRiskCount >= MAX_AT_RISK_ACTIVE || openPositions.length >= MAX_TOTAL_ACTIVE) {
        blockedByMaxCap++;
        continue;
      }

      // Open live-like simulated trade at candle close price
      const finalTradeMode: TradeMode = critic.tradeMode ?? tech.tradeMode ?? "INTRADAY";
      openPositions.push({
        symbol: d.symbol,
        dIdx: item.dIdx,
        tradeMode: finalTradeMode,
        entryTs: ts,
        entryBarIdxGlobal: t,
        entryPrice: tech.entryPrice,
        initialSl: tech.stopLossPrice,
        activeSl: tech.stopLossPrice,
        tp1: tech.tp1Price ?? tech.takeProfitPrice,
        tp2: tech.tp2Price ?? tech.takeProfitPrice,
        tp3: tech.tp3Price ?? tech.takeProfitPrice,
        remainingWeight: 1.0,
        tp1Hit: false,
        tp2Hit: false,
        realizedNetUsd: 0,
        totalFrictionUsd: 0,
        barsHeld: 0,
        entryRsi: tech.rsi14,
        entryBtc1hPct: macro.btcChange1hPct,
        entryBtcTrend4h: macro.btcTrend4h ?? "NEUTRAL",
        entryVolSpike: item.scout.volumeSpikeRatio15m,
        entryAtrPct: tech.atrPct ?? 0,
        entryStretchPct: tech.stretchAboveEma21Pct ?? 0,
        entryTrend1h: macro.trend1h ?? "NEUTRAL",
        entryTrend4h: macro.trend4h ?? "NEUTRAL",
        entryUtcHour: new Date(ts).getUTCHours()
      });
      lastDispatchBarBySymbol.set(d.symbol, t);
    }
  }

  // ===========================================================================
  // COMPUTE & PRINT UZBEK 7-DAY LIVE REPLAY SCORECARD
  // ===========================================================================
  const totalTrades = closedTrades.length;
  const avgPerDay = actualReplayDays > 0 ? Number((totalTrades / actualReplayDays).toFixed(2)) : 0;

  const tp3Count = closedTrades.filter((x) => x.outcome === "TP3_HIT").length;
  const tp2TrailCount = closedTrades.filter((x) => x.outcome === "TP2_TRAIL_WIN").length;
  const beProfitCount = closedTrades.filter((x) => x.outcome === "BREAKEVEN_PROFIT").length;
  const expWinCount = closedTrades.filter((x) => x.outcome === "EXPIRED_WIN").length;
  const expLossCount = closedTrades.filter((x) => x.outcome === "EXPIRED_LOSS").length;
  const slCount = closedTrades.filter((x) => x.outcome === "SL_HIT").length;

  const tp1PlusWins = closedTrades.filter(
    (x) =>
      x.outcome === "TP3_HIT" ||
      x.outcome === "TP2_TRAIL_WIN" ||
      x.outcome === "BREAKEVEN_PROFIT" ||
      x.outcome === "EXPIRED_WIN"
  ).length;
  const positiveTrades = closedTrades.filter((x) => x.netUsd > 0).length;
  const winRatePct = totalTrades > 0 ? Number(((tp1PlusWins / totalTrades) * 100).toFixed(1)) : 0;
  const netPositiveRatePct = totalTrades > 0 ? Number(((positiveTrades / totalTrades) * 100).toFixed(1)) : 0;

  const totalNetUsd = Number((balanceUsd - STARTING_BALANCE_USD).toFixed(2));
  const totalNetPct = Number(((totalNetUsd / STARTING_BALANCE_USD) * 100).toFixed(2));
  const totalSignalNetPct = Number(closedTrades.reduce((s, x) => s + x.netPct, 0).toFixed(2));
  const totalFrictionUsd = Number(closedTrades.reduce((s, x) => s + x.frictionUsd, 0).toFixed(2));

  const grossProfitUsd = closedTrades.filter((x) => x.netUsd > 0).reduce((s, x) => s + x.netUsd, 0);
  const grossLossUsd = closedTrades.filter((x) => x.netUsd < 0).reduce((s, x) => s + Math.abs(x.netUsd), 0);
  const profitFactor =
    grossLossUsd > 0 ? Number((grossProfitUsd / grossLossUsd).toFixed(2)) : grossProfitUsd > 0 ? 99 : 0;

  console.log("===============================================================================");
  console.log("  1) UMUMIY 7 KUNLIK NATIJA (0.10% KOMISSIYA + 0.15% SLIPPAGE = 0.25% BILAN)");
  console.log("===============================================================================");
  console.log(
    `  Boshlang'ich balans : $${STARTING_BALANCE_USD.toFixed(2)} → Yakuniy balans: $${balanceUsd.toFixed(2)}`
  );
  console.log(
    `  Sof foyda (Portfel) : ${totalNetUsd >= 0 ? "+" : ""}$${totalNetUsd.toFixed(2)} (${totalNetPct >= 0 ? "+" : ""}${totalNetPct}%) | Signallar yig'indisi: ${totalSignalNetPct >= 0 ? "+" : ""}${totalSignalNetPct}%`
  );
  console.log(
    `  Jami signallar      : ${totalTrades} ta (kuniga o'rtacha ${avgPerDay} ta | $100 / savdo)`
  );
  console.log(
    `  TP1+ Win Rate       : ${winRatePct}% (${tp1PlusWins}/${totalTrades}) | Sof musbat: ${netPositiveRatePct}% (${positiveTrades}/${totalTrades})`
  );
  console.log(
    `  Taqsimot            : TP3=${tp3Count} | TP2_Trail=${tp2TrailCount} | BE_Profit=${beProfitCount} | Exp+=${expWinCount} | Exp-=${expLossCount} | SL=${slCount}`
  );
  console.log(
    `  Profit Factor       : ${profitFactor} | Max Drawdown: -${maxDrawdownPct.toFixed(2)}%`
  );
  console.log(
    `  Jami komissiya/slip : -$${totalFrictionUsd.toFixed(2)} ($${(totalTrades * 0.25).toFixed(2)} nazariy 0.25%/savdo)`
  );
  console.log(
    `  Risk himoya bloki   : Critic tasdiqlagan ${criticApprovedTotal} ta → Cooldown: ${blockedByCooldown} | SL-Backoff: ${blockedBySlBackoff} | CircuitBreaker: ${blockedByCircuitBreaker} | Cap-4: ${blockedByMaxCap} | Dublikat: ${blockedByDuplicate}`
  );

  // ---------------------------------------------------------------------------
  // 2) KUNMA-KUN JADVAL (1-kun -> 7-kun)
  // ---------------------------------------------------------------------------
  const dayBuckets = new Map<
    string,
    { count: number; tp: number; be: number; sl: number; netUsd: number; netSignalPct: number }
  >();
  // Pre-seed all dates in the 7-day window so quiet/protected days are visible too!
  for (let t = startGlobalIdx; t < totalBtcBars; t += 16) {
    const key = formatDateKey(btc.k15[t].closeTime);
    if (!dayBuckets.has(key)) {
      dayBuckets.set(key, { count: 0, tp: 0, be: 0, sl: 0, netUsd: 0, netSignalPct: 0 });
    }
  }
  const endKey = formatDateKey(endTs);
  if (!dayBuckets.has(endKey)) {
    dayBuckets.set(endKey, { count: 0, tp: 0, be: 0, sl: 0, netUsd: 0, netSignalPct: 0 });
  }

  for (const tr of closedTrades) {
    const key = formatDateKey(tr.entryTs);
    const b = dayBuckets.get(key) ?? { count: 0, tp: 0, be: 0, sl: 0, netUsd: 0, netSignalPct: 0 };
    b.count += 1;
    if (tr.outcome === "TP3_HIT" || tr.outcome === "TP2_TRAIL_WIN" || tr.outcome === "EXPIRED_WIN") {
      b.tp += 1;
    } else if (tr.outcome === "BREAKEVEN_PROFIT") {
      b.be += 1;
    } else {
      b.sl += 1;
    }
    b.netUsd = Number((b.netUsd + tr.netUsd).toFixed(2));
    b.netSignalPct = Number((b.netSignalPct + tr.netPct).toFixed(2));
    dayBuckets.set(key, b);
  }

  console.log("\n===============================================================================");
  console.log("  2) KUNMA-KUN JADVAL (TOSHKENT VAQTI BO'YICHA)");
  console.log("===============================================================================");
  console.log("  Kun | Sana       | Signallar | TP | BE | SL | Kunlik PnL ($) | Portfel (%) | Signal (%)");
  console.log("  ----+------------+-----------+----+----+----+----------------+-------------+-----------");
  const sortedDays = Array.from(dayBuckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  sortedDays.forEach(([date, d], idx) => {
    const portPct = Number(((d.netUsd / STARTING_BALANCE_USD) * 100).toFixed(2));
    const usdStr = `${d.netUsd >= 0 ? "+" : ""}$${d.netUsd.toFixed(2)}`.padStart(14);
    const portStr = `${portPct >= 0 ? "+" : ""}${portPct.toFixed(2)}%`.padStart(11);
    const sigStr = `${d.netSignalPct >= 0 ? "+" : ""}${d.netSignalPct.toFixed(2)}%`.padStart(10);
    console.log(
      `  ${String(idx + 1).padStart(3)} | ${date} | ${String(d.count).padStart(9)} | ${String(d.tp).padStart(2)} | ${String(d.be).padStart(2)} | ${String(d.sl).padStart(2)} | ${usdStr} | ${portStr} | ${sigStr}`
    );
  });

  // ---------------------------------------------------------------------------
  // 3) ENG YAXSHI 5 TA VA ENG YOMON 5 TA KOIN
  // ---------------------------------------------------------------------------
  const coinStats = new Map<
    string,
    { symbol: string; trades: number; tp: number; be: number; sl: number; netUsd: number; netPct: number }
  >();
  for (const tr of closedTrades) {
    const c = coinStats.get(tr.symbol) ?? {
      symbol: tr.symbol,
      trades: 0,
      tp: 0,
      be: 0,
      sl: 0,
      netUsd: 0,
      netPct: 0
    };
    c.trades += 1;
    if (tr.outcome === "TP3_HIT" || tr.outcome === "TP2_TRAIL_WIN" || tr.outcome === "EXPIRED_WIN") c.tp += 1;
    else if (tr.outcome === "BREAKEVEN_PROFIT") c.be += 1;
    else c.sl += 1;
    c.netUsd = Number((c.netUsd + tr.netUsd).toFixed(2));
    c.netPct = Number((c.netPct + tr.netPct).toFixed(2));
    coinStats.set(tr.symbol, c);
  }
  const rankedCoins = Array.from(coinStats.values()).sort((a, b) => b.netUsd - a.netUsd);

  console.log("\n===============================================================================");
  console.log("  3) ENG YAXSHI 5 TA VA ENG YOMON 5 TA KOIN");
  console.log("===============================================================================");
  console.log("  [ENG YAXSHI 5 TA KOIN]");
  for (const c of rankedCoins.slice(0, 5)) {
    console.log(
      `    • ${c.symbol.padEnd(12)} | Savdo: ${String(c.trades).padStart(2)} | TP:${c.tp} BE:${c.be} SL:${c.sl} | Sof: ${c.netUsd >= 0 ? "+" : ""}$${c.netUsd.toFixed(2)} (${c.netPct >= 0 ? "+" : ""}${c.netPct.toFixed(2)}%)`
    );
  }
  console.log("  [ENG YOMON 5 TA KOIN]");
  const worst5 = [...rankedCoins].reverse().slice(0, 5);
  for (const c of worst5) {
    console.log(
      `    • ${c.symbol.padEnd(12)} | Savdo: ${String(c.trades).padStart(2)} | TP:${c.tp} BE:${c.be} SL:${c.sl} | Sof: ${c.netUsd >= 0 ? "+" : ""}$${c.netUsd.toFixed(2)} (${c.netPct >= 0 ? "+" : ""}${c.netPct.toFixed(2)}%)`
    );
  }

  // ---------------------------------------------------------------------------
  // 4) SL SABABLARI (POST-MORTEM) & INDIVIDUAL TRADES LOG
  // ---------------------------------------------------------------------------
  const slTrades = closedTrades.filter((x) => x.outcome === "SL_HIT" || x.outcome === "EXPIRED_LOSS");
  const btcRedSl = slTrades.filter((x) => x.entryBtc1hPct < 0).length;
  const btc4hBearSl = slTrades.filter((x) => x.entryBtcTrend4h === "BEARISH").length;
  const highRsiSl = slTrades.filter((x) => x.entryRsi > 60).length;
  const lowVolSl = slTrades.filter((x) => x.entryVolSpike < 1.0).length;
  const highAtrSl = slTrades.filter((x) => x.entryAtrPct >= 1.2).length;
  const nonBull1hSl = slTrades.filter((x) => x.entryTrend1h !== "BULLISH").length;
  const nonBull4hSl = slTrades.filter((x) => x.entryTrend4h !== "BULLISH").length;
  const asiaSessionSl = slTrades.filter((x) => x.entryUtcHour >= 0 && x.entryUtcHour < 7).length;
  const londonNySl = slTrades.filter((x) => x.entryUtcHour >= 7 && x.entryUtcHour < 21).length;

  console.log("\n===============================================================================");
  console.log("  4) SL SABABLARI (POST-MORTEM DIAGNOSTIKA)");
  console.log("===============================================================================");
  console.log(`  Jami zararli yopilishlar (SL + Exp-): ${slTrades.length} ta (toza SL: ${slCount} ta)`);
  if (slTrades.length > 0) {
    console.log(`    • BTC 1s manfiy (<0%) bo'lgan paytda kirish     : ${btcRedSl}/${slTrades.length} (${((btcRedSl / slTrades.length) * 100).toFixed(0)}%)`);
    console.log(`    • BTC 4H BEARISH trendda kirish                : ${btc4hBearSl}/${slTrades.length} (${((btc4hBearSl / slTrades.length) * 100).toFixed(0)}%)`);
    console.log(`    • Koin 4H trendi BULLISH emas (NEUTRAL) paytda : ${nonBull4hSl}/${slTrades.length} (${((nonBull4hSl / slTrades.length) * 100).toFixed(0)}%)`);
    console.log(`    • Koin 1H trendi BULLISH emas (NEUTRAL) paytda : ${nonBull1hSl}/${slTrades.length} (${((nonBull1hSl / slTrades.length) * 100).toFixed(0)}%)`);
    console.log(`    • RSI > 60 (yuqori impuls chegarasi) paytida   : ${highRsiSl}/${slTrades.length} (${((highRsiSl / slTrades.length) * 100).toFixed(0)}%)`);
    console.log(`    • Kichik 15m hajm (VolSpike < 1.0x) paytida    : ${lowVolSl}/${slTrades.length} (${((lowVolSl / slTrades.length) * 100).toFixed(0)}%)`);
    console.log(`    • Yuqori 15m volatillik (ATR >= 1.2%) paytida  : ${highAtrSl}/${slTrades.length} (${((highAtrSl / slTrades.length) * 100).toFixed(0)}%)`);
    console.log(`    • Sessiya kesimi                               : Osiyo(00-07 UTC)=${asiaSessionSl} | London/NY(07-21 UTC)=${londonNySl}`);
  }

  console.log("\n===============================================================================");
  console.log("  BARCHA SIMULYATSIYA SAVDOLARI TAFSILOTI");
  console.log("===============================================================================");
  for (const tr of closedTrades) {
    const dt = new Date(tr.entryTs + 5 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
    console.log(
      `  ${dt} | ${tr.symbol.padEnd(10)} | ${tr.tradeMode.padEnd(8)} | ${tr.outcome.padEnd(16)} | SL:-${tr.slDistPct.toFixed(2)}% | RSI:${tr.entryRsi.toFixed(1).padStart(4)} | Vol:${tr.entryVolSpike.toFixed(2)}x | BTC1h:${(tr.entryBtc1hPct >= 0 ? "+" : "") + tr.entryBtc1hPct.toFixed(2)}% | 1H/4H:${tr.entryTrend1h[0]}/${tr.entryTrend4h[0]} | Net: ${tr.netUsd >= 0 ? "+" : ""}$${tr.netUsd.toFixed(2)}`
    );
  }
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error("[FAIL] 7-Day Replay Simulator Error:", err);
  process.exit(1);
});
