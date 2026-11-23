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
import {
  calcAdxSeries,
  recomputeLevelsForMode,
  TechnicalAnalysisResult,
  TradeMode
} from "../src/agents/technician.agent";
import { MacroFlowResult, TrendRegime } from "../src/agents/macroFlow.agent";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";

// =============================================================================
// STAGE 6.1 — 30-DAY (1-MONTH) STRICT NO-LOOKAHEAD A/B WALK-FORWARD REPLAY
// Model A (Stage 6.0): 40/35/25 @ 1.2R/2.2R/3.3R + instant 0R BE, no ADX filter, fixed $100
// Model B (Stage 6.1): 60/40 @ 1.8R/3.0R + (-0.2R soft SL -> +0.5R at 2.3R), ADX>=20 chop filter,
//                      Star-Rating Conviction Sizing (3★=$50, 4★=$100, 5★=$150)
// =============================================================================

const STARTING_BALANCE_USD = 1000;
const BASE_POSITION_SIZE_USD = 100;
const ROUND_TRIP_FRICTION_PCT = 0.25; // 0.10% fee + 0.15% slippage

// Stage 6.0 weights
const S60_TP1_W = 0.4;
const S60_TP2_W = 0.35;

// Stage 6.1 Wall Street weights
const S61_TP1_W = 0.6;

const REPLAY_DAYS = 30;
const BARS_PER_DAY_1H = 24;
const REPLAY_BARS_1H = REPLAY_DAYS * BARS_PER_DAY_1H; // 720 x 1h bars = exact 30 full days
const WARMUP_BARS_1H = 60; // >= 50 for EMA50 + Wilder ADX(14) convergence
const FETCH_LIMIT_1H = REPLAY_BARS_1H + WARMUP_BARS_1H; // 780 bars (2 paginated pages)
const FETCH_LIMIT_4H = 240; // 40 days of 4h bars

const COOLDOWN_BARS_1H = 2; // 2-hour per-symbol cooldown
const SL_FIRST_LOCK_MS = 6 * 60 * 60 * 1000;
const SL_REPEAT_LOCK_MS = 24 * 60 * 60 * 1000;
const WS_CB_THRESHOLD = 3; // 3 consecutive SLs -> 4h pause
const WS_CB_PAUSE_MS = 4 * 60 * 60 * 1000;
const MAX_AT_RISK_ACTIVE = 4;
const MAX_TOTAL_ACTIVE = 6;
const MAX_HOLD_INTRADAY_1H = 24; // 24h
const MAX_HOLD_SWING_1H = 120; // 5 days

const MEXC_MIRRORS = ["https://api.mexc.io", "https://api.mexc.co", "https://api.mexc.com"];

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
    const c = klines[i];
    const pc = klines[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  const out = new Array<number>(klines.length).fill(0);
  for (let i = period; i < klines.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += trs[j];
    out[i] = s / period;
  }
  return out;
}

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
        headers: { Accept: "application/json", "User-Agent": "CryptoQuant-Copilot/0.61" }
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

async function fetchFull30dKlines1h(symbol: string): Promise<MexcKline[]> {
  const newest = await fetchKlinesPage(symbol, "60m", 500);
  if (newest.length === 0) return [];
  const neededOlder = Math.max(0, FETCH_LIMIT_1H - newest.length + 12);
  if (neededOlder <= 0) return newest;

  const endTime = newest[0].openTime - 1;
  const startTime = newest[0].openTime - neededOlder * 60 * 60 * 1000;
  const older = await fetchKlinesPage(symbol, "60m", Math.min(500, neededOlder + 10), startTime, endTime);
  const byOpen = new Map<number, MexcKline>();
  for (const k of older) byOpen.set(k.openTime, k);
  for (const k of newest) byOpen.set(k.openTime, k);
  return Array.from(byOpen.values()).sort((a, b) => a.openTime - b.openTime);
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

interface HtfPack {
  klines: MexcKline[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
}

interface Coin30dData {
  symbol: string;
  ticker24hVol: number;
  k1h: MexcKline[];
  ema9: number[];
  ema21: number[];
  ema50: number[];
  rsi14: number[];
  adx14: number[];
  atr14: number[];
  h4: HtfPack;
  timeToIdx: Map<number, number>;
}

function getClosedTrendAt(
  klines: MexcKline[],
  ema9: number[],
  ema21: number[],
  ema50: number[],
  ts: number
): { regime: TrendRegime; aboveEma50: boolean } {
  let idx = -1;
  for (let i = klines.length - 1; i >= 0; i--) {
    if (klines[i].closeTime <= ts) {
      idx = i;
      break;
    }
  }
  if (idx < 10) return { regime: "NEUTRAL", aboveEma50: true };
  const e9 = ema9[idx];
  const e21 = ema21[idx];
  const e50 = ema50[idx];
  const last = klines[idx].close;
  const aboveEma50 = idx >= 45 ? last > e50 && e21 >= e50 * 0.995 : true;

  if (e9 > e21 * 1.001 && last >= e9 * 0.998) return { regime: "BULLISH", aboveEma50 };
  if (e9 < e21 * 0.999 && last <= e9 * 1.002) return { regime: "BEARISH", aboveEma50 };
  return { regime: "NEUTRAL", aboveEma50 };
}

function buildScoutAt(d: Coin30dData, i: number): ScoutCandidate {
  const bar = d.k1h[i];
  const entry = bar.close;
  const prev24Idx = Math.max(0, i - BARS_PER_DAY_1H);
  const open24h = d.k1h[prev24Idx].close;
  const priceChange24hPct =
    open24h > 0 ? Number((((entry - open24h) / open24h) * 100).toFixed(2)) : 0;

  let qVol24 = 0;
  for (let j = prev24Idx; j <= i; j++) qVol24 += d.k1h[j].quoteAssetVolume;
  const quoteVolume24hUsd = Math.round(qVol24 || d.ticker24hVol);

  let sumV = 0;
  const vStart = Math.max(0, i - 20);
  const vCount = Math.max(1, i - vStart);
  for (let j = vStart; j < i; j++) sumV += d.k1h[j].quoteAssetVolume;
  const avgV = sumV / vCount;
  const volumeSpikeRatio15m = avgV > 0 ? Number((bar.quoteAssetVolume / avgV).toFixed(2)) : 1;
  const momentum15mPct =
    bar.open > 0 ? Number((((bar.close - bar.open) / bar.open) * 100).toFixed(2)) : 0;

  let volPoints = 0;
  if (volumeSpikeRatio15m >= 1.1 && volumeSpikeRatio15m <= 3.5) {
    volPoints = clamp(24 + (volumeSpikeRatio15m - 1.1) * 5.5, 24, 36);
  } else if (volumeSpikeRatio15m > 3.5 && volumeSpikeRatio15m <= 5.5) volPoints = 22;
  else if (volumeSpikeRatio15m > 5.5) volPoints = clamp(16 - (volumeSpikeRatio15m - 5.5) * 2.0, 4, 16);
  else volPoints = clamp(volumeSpikeRatio15m * 18, 6, 20);

  let breakoutPoints = 2;
  if (priceChange24hPct >= 0.5 && priceChange24hPct <= 12) breakoutPoints = 26;
  else if (priceChange24hPct >= -2 && priceChange24hPct < 0.5) breakoutPoints = 16;
  else if (priceChange24hPct > 12 && priceChange24hPct <= 18) breakoutPoints = 8;
  else if (priceChange24hPct > 18) breakoutPoints = -20 - Math.min(18, (priceChange24hPct - 18) * 0.9);

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

  return {
    symbol: d.symbol,
    exchange: "MEXC",
    lastPrice: entry,
    priceChange24hPct,
    quoteVolume24hUsd,
    volumeSpikeRatio15m,
    momentum15mPct,
    scoutScore,
    isAnomaly: scoutScore >= 60,
    isNewAlert: true,
    reasons: [],
    detectedAt: new Date(bar.closeTime).toISOString()
  };
}

// Old Stage 6.0 SL/TP synchronizer (40/35/25 @ 1.2R/2.2R/3.3R Intraday, 1.4R/2.5R/3.8R Swing)
function recomputeStage60Levels(tech: TechnicalAnalysisResult, mode: TradeMode): TechnicalAnalysisResult {
  const entry = tech.entryPrice;
  const roundedEntry = roundPrice(entry);
  const atr14 = Math.max(0, tech.atr14);
  const support20 = tech.supportLevel > 0 ? tech.supportLevel : entry * 0.98;
  const support10 = tech.support10Level && tech.support10Level > 0 ? tech.support10Level : support20;

  let sl: number;
  const mult1 = mode === "SWING" ? 1.4 : 1.2;
  const mult2 = mode === "SWING" ? 2.5 : 2.2;
  const mult3 = mode === "SWING" ? 3.8 : 3.3;

  if (mode === "SWING") {
    const swingAtrStop = entry - Math.max(atr14 * 2.2, entry * 0.02);
    const rawStop = Math.max(entry * 0.958, Math.min(swingAtrStop, support20 * 0.995));
    sl = roundPrice(Math.min(rawStop, entry * 0.98));
  } else {
    const atrStop = entry - Math.max(atr14 * 1.8, entry * 0.015);
    const rawStop = Math.max(entry * 0.974, Math.min(atrStop, support10 * 0.996));
    sl = roundPrice(Math.min(rawStop, entry * 0.985));
  }

  const risk = Math.max(roundedEntry - sl, roundedEntry * 0.008);
  const tp1 = roundPrice(roundedEntry + risk * mult1);
  const tp2 = roundPrice(Math.max(roundedEntry + risk * Math.max(mult2, 2.2), tp1 * 1.005));
  const tp3 = roundPrice(Math.max(roundedEntry + risk * mult3, tp2 + risk, tp2 * 1.008));

  return {
    ...tech,
    tradeMode: mode,
    entryPrice: roundedEntry,
    stopLossPrice: sl,
    takeProfitPrice: tp2,
    tp1Price: tp1,
    tp2Price: tp2,
    tp3Price: tp3,
    riskRewardRatio: Number(((tp2 - roundedEntry) / risk).toFixed(2))
  };
}

function buildTechAt(d: Coin30dData, i: number, model: "STAGE_6_0" | "STAGE_6_1"): TechnicalAnalysisResult | null {
  const bar = d.k1h[i];
  const prev = d.k1h[i - 1];
  const entryPrice = bar.close;
  const roundedEntry = roundPrice(entryPrice);
  const rsi14 = d.rsi14[i];
  const adx14 = d.adx14[i];
  const isChoppyMarket = adx14 < 20;
  const ema9 = d.ema9[i];
  const ema21 = d.ema21[i];
  const ema50 = d.ema50[i];
  const ema21Rising = ema21 > d.ema21[Math.max(0, i - 3)];
  const atr14 = d.atr14[i];

  let supportLevel = Infinity;
  let resistanceLevel = -Infinity;
  for (let j = Math.max(0, i - 19); j <= i; j++) {
    if (d.k1h[j].low < supportLevel) supportLevel = d.k1h[j].low;
    if (d.k1h[j].high > resistanceLevel) resistanceLevel = d.k1h[j].high;
  }
  let support10 = Infinity;
  for (let j = Math.max(0, i - 9); j <= i; j++) {
    if (d.k1h[j].low < support10) support10 = d.k1h[j].low;
  }

  const atrPct = entryPrice > 0 ? Number(((atr14 / entryPrice) * 100).toFixed(2)) : 0;
  const tradeMode: TradeMode =
    ema9 > ema21 * 1.003 && ema21 > ema50 && rsi14 >= 44 && rsi14 <= 60 && atrPct >= 0.4
      ? "SWING"
      : "INTRADAY";

  const stretchAboveEma21Pct =
    ema21 > 0 ? Number((((entryPrice - ema21) / ema21) * 100).toFixed(2)) : 0;
  const distAboveSupportPct = supportLevel > 0 ? ((entryPrice - supportLevel) / supportLevel) * 100 : 0;
  const distToEma9Pct = ema9 > 0 ? Math.abs((entryPrice - ema9) / ema9) * 100 : 0;

  const recentDipLow = Math.min(bar.low, prev.low);
  const touchedEmaZone = recentDipLow <= ema9 * 1.004 && recentDipLow >= ema50 * 0.995;
  const reclaimedAboveEma9 = bar.close > ema9 && bar.close > bar.open;
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
  if (rsi14 >= 44 && rsi14 <= 60) techScore += 20;
  else if (rsi14 >= 42 && rsi14 < 44) techScore += 12;
  else if (rsi14 > 60 && rsi14 <= 65) techScore += 2;
  else techScore -= 18;
  if (model === "STAGE_6_1") {
    if (adx14 >= 25) techScore += 4;
    else if (isChoppyMarket) techScore -= 12;
  }
  if (distToEma9Pct <= 1.2 && stretchAboveEma21Pct <= 2.2) techScore += 8;
  else if (stretchAboveEma21Pct > 2.2) techScore -= 16;
  if (distAboveSupportPct <= 3.5) techScore += 4;
  techScore += 6;
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));

  const isBullishTrend =
    ema9 > ema21 &&
    ema21 > ema50 &&
    ema21Rising &&
    entryPrice >= ema9 * 0.998 &&
    rsi14 >= 42 &&
    rsi14 <= 60 &&
    stretchAboveEma21Pct <= 2.4;

  const base: TechnicalAnalysisResult = {
    symbol: d.symbol,
    direction: isBullishTrend ? "LONG" : "SKIP",
    tradeMode,
    entryPrice: roundedEntry,
    stopLossPrice: 0,
    takeProfitPrice: 0,
    riskRewardRatio: model === "STAGE_6_1" ? 3.0 : 2.2,
    rsi14,
    adx14: model === "STAGE_6_1" ? adx14 : 25, // Stage 6.0 had NO ADX chop filter
    isChoppyMarket: model === "STAGE_6_1" ? isChoppyMarket : false,
    ema9: roundPrice(ema9),
    ema21: roundPrice(ema21),
    ema50: roundPrice(ema50),
    ema21Rising,
    stretchAboveEma21Pct,
    atrPct,
    isBullishCandle: bar.close > bar.open,
    isPullbackReclaim,
    atr14: roundPrice(atr14),
    supportLevel: roundPrice(supportLevel),
    support10Level: roundPrice(support10),
    resistanceLevel: roundPrice(resistanceLevel),
    techScore,
    summary: "",
    latencyMs: 0
  };

  try {
    return model === "STAGE_6_1"
      ? recomputeLevelsForMode(base, tradeMode)
      : recomputeStage60Levels(base, tradeMode);
  } catch {
    return null;
  }
}

function buildMacroAt(d: Coin30dData, btc: Coin30dData, ts: number, btcIdx: number): MacroFlowResult {
  const t1h = getClosedTrendAt(d.k1h, d.ema9, d.ema21, d.ema50, ts);
  const t4h = getClosedTrendAt(d.h4.klines, d.h4.ema9, d.h4.ema21, d.h4.ema50, ts);
  const btc1h = getClosedTrendAt(btc.k1h, btc.ema9, btc.ema21, btc.ema50, ts);
  const btc4h = getClosedTrendAt(btc.h4.klines, btc.h4.ema9, btc.h4.ema21, btc.h4.ema50, ts);

  const btcChange1hPct =
    btcIdx >= 1 && btc.k1h[btcIdx - 1].close > 0
      ? Number((((btc.k1h[btcIdx].close - btc.k1h[btcIdx - 1].close) / btc.k1h[btcIdx - 1].close) * 100).toFixed(2))
      : 0;

  let macroScore = 50 + 16 + 10;
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
    bidAskRatio: 1.15,
    spreadPct: 0.05,
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

type Outcome30d =
  | "TP3_HIT"
  | "TP2_FULL_WIN"
  | "TP2_TRAIL_WIN"
  | "TP1_TRAIL_WIN"
  | "TP1_SOFT_WIN"
  | "BREAKEVEN_PROFIT"
  | "SL_HIT"
  | "EXPIRED_WIN"
  | "EXPIRED_LOSS";

interface ClosedTrade30d {
  symbol: string;
  entryTs: number;
  exitTs: number;
  outcome: Outcome30d;
  sizeUsd: number;
  stars: number;
  netUsd: number;
  frictionUsd: number;
  slDistPct: number;
}

interface ModelSummary {
  label: string;
  totalTrades: number;
  avgPerDay: number;
  winCount: number;
  winRatePct: number;
  lossCount: number;
  lossRatePct: number;
  avgWinUsd: number;
  avgLossUsd: number;
  payoffRatio: number;
  finalBalanceUsd: number;
  netUsd: number;
  netPct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalFrictionUsd: number;
  cbTriggerCount: number;
  cbBlockedSignals: number;
  adxBlockedCount: number;
  trades: ClosedTrade30d[];
}

function runModelReplay(
  datasets: Coin30dData[],
  btc: Coin30dData,
  startIdx: number,
  model: "STAGE_6_0" | "STAGE_6_1"
): ModelSummary {
  let balanceUsd = STARTING_BALANCE_USD;
  let peakBalance = STARTING_BALANCE_USD;
  let maxDdPct = 0;

  interface OpenPos {
    symbol: string;
    dIdx: number;
    tradeMode: TradeMode;
    entryTs: number;
    entryPrice: number;
    initialSl: number;
    activeSl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    sizeUsd: number;
    stars: number;
    remW: number;
    tp1Hit: boolean;
    tp2Hit: boolean;
    trailStep2: boolean;
    realizedUsd: number;
    frictionUsd: number;
    barsHeld: number;
  }

  const closeLeg = (pos: OpenPos, w: number, price: number) => {
    const cw = Math.min(w, pos.remW);
    if (cw <= 0) return;
    const notional = pos.sizeUsd * cw;
    const grossPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
    const fric = notional * (ROUND_TRIP_FRICTION_PCT / 100);
    pos.realizedUsd += notional * (grossPct / 100) - fric;
    pos.frictionUsd += fric;
    pos.remW = Number((pos.remW - cw).toFixed(6));
  };

  const open: OpenPos[] = [];
  const closed: ClosedTrade30d[] = [];
  const lastDispatchBar = new Map<string, number>();
  const symSlHist = new Map<string, number[]>();
  const symSlBlockedUntil = new Map<string, number>();

  let consecutiveLosses = 0;
  let wsCbPausedUntil = 0;
  let cbTriggerCount = 0;
  let cbBlockedSignals = 0;
  let adxBlockedCount = 0;

  const totalBars = btc.k1h.length;

  for (let t = startIdx; t < totalBars; t++) {
    const ts = btc.k1h[t].closeTime;
    const isFinalBar = t === totalBars - 1;

    if (wsCbPausedUntil > 0 && ts >= wsCbPausedUntil) {
      wsCbPausedUntil = 0;
      consecutiveLosses = 0;
    }

    // 1. Update open positions (conservative worst-case SL-first rule inside same candle)
    for (let p = open.length - 1; p >= 0; p--) {
      const pos = open[p];
      const bi = datasets[pos.dIdx].timeToIdx.get(ts);
      if (bi === undefined) continue;
      const bar = datasets[pos.dIdx].k1h[bi];
      pos.barsHeld += 1;

      const risk = Math.max(pos.entryPrice - pos.initialSl, pos.entryPrice * 0.008);
      let out: Outcome30d | null = null;

      if (model === "STAGE_6_0") {
        // Old Stage 6.0: 40/35/25 + instant 0R BE at TP1
        if (bar.low <= pos.activeSl) {
          closeLeg(pos, pos.remW, pos.activeSl);
          if (pos.tp2Hit) out = "TP2_TRAIL_WIN";
          else if (pos.tp1Hit) out = "BREAKEVEN_PROFIT";
          else out = "SL_HIT";
        } else {
          if (!pos.tp1Hit && bar.high >= pos.tp1) {
            closeLeg(pos, S60_TP1_W, pos.tp1);
            pos.tp1Hit = true;
            pos.activeSl = pos.entryPrice;
          }
          if (!pos.tp2Hit && bar.high >= pos.tp2) {
            closeLeg(pos, S60_TP2_W, pos.tp2);
            pos.tp1Hit = true;
            pos.tp2Hit = true;
            pos.activeSl = pos.tp1;
          }
          if (bar.high >= pos.tp3 && pos.remW > 0) {
            closeLeg(pos, pos.remW, pos.tp3);
            out = "TP3_HIT";
          }
          if (!out) {
            const maxHold = pos.tradeMode === "SWING" ? MAX_HOLD_SWING_1H : MAX_HOLD_INTRADAY_1H;
            if (pos.barsHeld >= maxHold || isFinalBar) {
              closeLeg(pos, pos.remW, bar.close);
              out = pos.realizedUsd >= 0 ? "EXPIRED_WIN" : "EXPIRED_LOSS";
            }
          }
        }
      } else {
        // New Stage 6.1 Wall Street Exit Math:
        // 60% at TP1 (1.8R/2.0R) -> move remaining 40% SL to -0.2R (soft protection, NOT 0R!)
        // Once price crosses 2.3R -> upgrade remaining 40% SL to +0.5R
        // Remaining 40% closes at TP2 (3.0R/3.4R)
        if (bar.low <= pos.activeSl) {
          closeLeg(pos, pos.remW, pos.activeSl);
          if (pos.trailStep2) out = "TP1_TRAIL_WIN";
          else if (pos.tp1Hit) out = "TP1_SOFT_WIN";
          else out = "SL_HIT";
        } else {
          if (!pos.tp1Hit && bar.high >= pos.tp1) {
            closeLeg(pos, S61_TP1_W, pos.tp1);
            pos.tp1Hit = true;
            pos.activeSl = roundPrice(pos.entryPrice - risk * 0.2); // -0.2R soft protection
          }
          if (pos.tp1Hit && !pos.trailStep2 && bar.high >= pos.entryPrice + risk * 2.3) {
            pos.trailStep2 = true;
            pos.activeSl = roundPrice(pos.entryPrice + risk * 0.5); // +0.5R profit lock
          }
          if (bar.high >= pos.tp2 && pos.remW > 0) {
            closeLeg(pos, pos.remW, pos.tp2);
            pos.tp1Hit = true;
            pos.tp2Hit = true;
            out = "TP2_FULL_WIN";
          }
          if (!out) {
            const maxHold = pos.tradeMode === "SWING" ? MAX_HOLD_SWING_1H : MAX_HOLD_INTRADAY_1H;
            if (pos.barsHeld >= maxHold || isFinalBar) {
              closeLeg(pos, pos.remW, bar.close);
              out = pos.realizedUsd >= 0 ? "EXPIRED_WIN" : "EXPIRED_LOSS";
            }
          }
        }
      }

      if (out) {
        const netUsd = Number(pos.realizedUsd.toFixed(4));
        balanceUsd = Number((balanceUsd + netUsd).toFixed(4));
        if (balanceUsd > peakBalance) peakBalance = balanceUsd;
        const dd = peakBalance > 0 ? ((peakBalance - balanceUsd) / peakBalance) * 100 : 0;
        if (dd > maxDdPct) maxDdPct = dd;

        closed.push({
          symbol: pos.symbol,
          entryTs: pos.entryTs,
          exitTs: ts,
          outcome: out,
          sizeUsd: pos.sizeUsd,
          stars: pos.stars,
          netUsd,
          frictionUsd: Number(pos.frictionUsd.toFixed(4)),
          slDistPct: Number((((pos.entryPrice - pos.initialSl) / pos.entryPrice) * 100).toFixed(2))
        });

        if (out === "SL_HIT") {
          const arr = (symSlHist.get(pos.symbol) ?? []).filter((x) => ts - x <= 24 * 3600 * 1000);
          arr.push(ts);
          symSlHist.set(pos.symbol, arr);
          const lockMs = arr.length >= 2 ? SL_REPEAT_LOCK_MS : SL_FIRST_LOCK_MS;
          symSlBlockedUntil.set(pos.symbol, Math.max(symSlBlockedUntil.get(pos.symbol) ?? 0, ts + lockMs));

          consecutiveLosses += 1;
          if (consecutiveLosses >= WS_CB_THRESHOLD) {
            if (wsCbPausedUntil <= ts) cbTriggerCount += 1;
            wsCbPausedUntil = ts + WS_CB_PAUSE_MS;
          }
        } else if (netUsd > 0 && out !== "BREAKEVEN_PROFIT") {
          consecutiveLosses = 0;
          wsCbPausedUntil = 0;
        }

        open.splice(p, 1);
      }
    }

    if (isFinalBar) continue;

    // 2. Scan Top-20 candidates (evaluate top 8 by Scout score)
    const scored: Array<{ dIdx: number; barIdx: number; scout: ScoutCandidate }> = [];
    for (let dIdx = 0; dIdx < datasets.length; dIdx++) {
      const bi = datasets[dIdx].timeToIdx.get(ts);
      if (bi === undefined || bi < WARMUP_BARS_1H) continue;
      scored.push({ dIdx, barIdx: bi, scout: buildScoutAt(datasets[dIdx], bi) });
    }
    scored.sort((a, b) => b.scout.scoutScore - a.scout.scoutScore);

    for (const item of scored.slice(0, 8)) {
      const d = datasets[item.dIdx];
      const rawTech = buildTechAt(d, item.barIdx, model);
      if (!rawTech) continue;
      const macro = buildMacroAt(d, btc, ts, t);

      const res = runCriticRiskAgent(item.scout, rawTech, macro);
      if (res.verdict !== "APPROVE") {
        if (
          model === "STAGE_6_1" &&
          res.reasons.length === 1 &&
          res.reasons[0].includes("ADX < 20")
        ) {
          adxBlockedCount += 1;
        }
        continue;
      }

      const finalMode = res.tradeMode ?? "INTRADAY";
      const finalTech =
        model === "STAGE_6_1"
          ? recomputeLevelsForMode(rawTech, finalMode)
          : recomputeStage60Levels(rawTech, finalMode);

      if (ts < wsCbPausedUntil) {
        cbBlockedSignals += 1;
        continue;
      }
      if (open.some((op) => op.symbol === d.symbol)) continue;
      if ((symSlBlockedUntil.get(d.symbol) ?? 0) > ts) continue;
      const lastB = lastDispatchBar.get(d.symbol);
      if (lastB !== undefined && t - lastB < COOLDOWN_BARS_1H) continue;
      const atRisk = open.filter((op) => !op.tp1Hit).length;
      if (atRisk >= MAX_AT_RISK_ACTIVE || open.length >= MAX_TOTAL_ACTIVE) continue;

      const sizeMult = model === "STAGE_6_1" ? res.suggestedSizeMultiplier : 1.0;
      const sizeUsd = Number((BASE_POSITION_SIZE_USD * sizeMult).toFixed(2));

      open.push({
        symbol: d.symbol,
        dIdx: item.dIdx,
        tradeMode: finalMode,
        entryTs: ts,
        entryPrice: finalTech.entryPrice,
        initialSl: finalTech.stopLossPrice,
        activeSl: finalTech.stopLossPrice,
        tp1: finalTech.tp1Price ?? finalTech.takeProfitPrice,
        tp2: finalTech.tp2Price ?? finalTech.takeProfitPrice,
        tp3: finalTech.tp3Price ?? finalTech.takeProfitPrice,
        sizeUsd,
        stars: res.longTermStars?.count ?? 4,
        remW: 1.0,
        tp1Hit: false,
        tp2Hit: false,
        trailStep2: false,
        realizedUsd: 0,
        frictionUsd: 0,
        barsHeld: 0
      });
      lastDispatchBar.set(d.symbol, t);
    }
  }

  const n = closed.length;
  const days = Math.max(1, (totalBars - startIdx) / BARS_PER_DAY_1H);
  const winners = closed.filter((c) => c.netUsd > 0);
  const losers = closed.filter((c) => c.netUsd <= 0);
  const grossWin = winners.reduce((s, c) => s + c.netUsd, 0);
  const grossLoss = losers.reduce((s, c) => s + Math.abs(c.netUsd), 0);
  const avgWinUsd = winners.length > 0 ? Number((grossWin / winners.length).toFixed(2)) : 0;
  const avgLossUsd = losers.length > 0 ? Number((grossLoss / losers.length).toFixed(2)) : 0;
  const payoffRatio = avgLossUsd > 0 ? Number((avgWinUsd / avgLossUsd).toFixed(2)) : avgWinUsd > 0 ? 99 : 0;
  const pf = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0;
  const netUsd = Number((balanceUsd - STARTING_BALANCE_USD).toFixed(2));
  const netPct = Number(((netUsd / STARTING_BALANCE_USD) * 100).toFixed(2));
  const totalFrictionUsd = Number(closed.reduce((s, c) => s + c.frictionUsd, 0).toFixed(2));

  return {
    label: model === "STAGE_6_0" ? "Stage 6.0 (Eski)" : "Stage 6.1 (Yangi)",
    totalTrades: n,
    avgPerDay: Number((n / days).toFixed(2)),
    winCount: winners.length,
    winRatePct: n > 0 ? Number(((winners.length / n) * 100).toFixed(1)) : 0,
    lossCount: losers.length,
    lossRatePct: n > 0 ? Number(((losers.length / n) * 100).toFixed(1)) : 0,
    avgWinUsd,
    avgLossUsd,
    payoffRatio,
    finalBalanceUsd: Number(balanceUsd.toFixed(2)),
    netUsd,
    netPct,
    profitFactor: pf,
    maxDrawdownPct: Number(maxDdPct.toFixed(2)),
    totalFrictionUsd,
    cbTriggerCount,
    cbBlockedSignals,
    adxBlockedCount,
    trades: closed
  };
}

async function main() {
  console.log("====================================================================================");
  console.log("  CRYPTOQUANT-COPILOT — STAGE 6.0 vs STAGE 6.1 (30 KUNLIK A/B WALK-FORWARD REPLAY)");
  console.log("====================================================================================");
  console.log("  [1/3] MEXC Top-20 eng likvid USDT juftliklari yuklanmoqda...");

  const allTickers: MexcTicker24h[] = await fetchMexcTickers24h();
  const eligible = allTickers
    .filter((t) => !isFilteredOutSymbol(t.symbol) && t.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  const selected = eligible.slice(0, 20);
  if (!selected.some((t) => t.symbol === "BTCUSDT")) {
    const btcT = allTickers.find((t) => t.symbol === "BTCUSDT");
    if (btcT) selected.push(btcT);
  }

  console.log(`  Faol mirror: ${getActiveMexcMirror()} | Koinlar (${selected.length}): ${selected.map((x) => x.symbol.replace("USDT", "")).join(", ")}`);
  console.log("  [2/3] 30 kunlik 1H (~780 sham) + 4H (240 sham) + Wilder ADX(14) yuklanmoqda...");

  const rawLoaded = await mapWithConcurrency(selected, 4, async (t): Promise<Coin30dData | null> => {
    try {
      const [k1hRaw, k4hRaw] = await Promise.all([
        fetchFull30dKlines1h(t.symbol),
        fetchMexcKlines(t.symbol, "4h", FETCH_LIMIT_4H)
      ]);
      if (k1hRaw.length < 400 || k4hRaw.length < 100) return null;
      const k1h = k1hRaw.slice(0, k1hRaw.length - 1);
      const k4h = k4hRaw.slice(0, k4hRaw.length - 1);
      const c1 = k1h.map((k) => k.close);
      const c4 = k4h.map((k) => k.close);
      const timeToIdx = new Map<number, number>();
      k1h.forEach((k, idx) => timeToIdx.set(k.closeTime, idx));

      return {
        symbol: t.symbol,
        ticker24hVol: t.quoteVolume,
        k1h,
        ema9: calcEmaSeries(c1, 9),
        ema21: calcEmaSeries(c1, 21),
        ema50: calcEmaSeries(c1, 50),
        rsi14: calcWilderRsiSeries(c1, 14),
        adx14: calcAdxSeries(k1h, 14),
        atr14: calcAtrSeries(k1h, 14),
        h4: {
          klines: k4h,
          ema9: calcEmaSeries(c4, 9),
          ema21: calcEmaSeries(c4, 21),
          ema50: calcEmaSeries(c4, 50)
        },
        timeToIdx
      };
    } catch {
      return null;
    }
  });

  const datasets = rawLoaded.filter((d): d is Coin30dData => d !== null);
  const btc = datasets.find((d) => d.symbol === "BTCUSDT");
  if (!btc) throw new Error("BTCUSDT 30 kunlik ma'lumoti yuklanmadi.");

  const startIdx = Math.max(WARMUP_BARS_1H, btc.k1h.length - REPLAY_BARS_1H);
  const replayBars = btc.k1h.length - startIdx;
  const replayDays = Number((replayBars / BARS_PER_DAY_1H).toFixed(1));
  const startTs = btc.k1h[startIdx].closeTime;
  const endTs = btc.k1h[btc.k1h.length - 1].closeTime;
  const btcStart = btc.k1h[startIdx].close;
  const btcEnd = btc.k1h[btc.k1h.length - 1].close;
  const btcChg = Number((((btcEnd - btcStart) / btcStart) * 100).toFixed(2));
  const btcLow = Math.min(...btc.k1h.slice(startIdx).map((k) => k.low));
  const btcHigh = Math.max(...btc.k1h.slice(startIdx).map((k) => k.high));

  console.log(
    `  [3/3] ${datasets.length} ta koin yuklandi | Davr: ${new Date(startTs).toISOString().slice(0, 10)} → ${new Date(endTs).toISOString().slice(0, 10)} (${replayBars} ta 1H sham = ${replayDays} kun)`
  );
  console.log(
    `  BTC 30 kunlik harakati: $${btcStart} → $${btcEnd} (${btcChg >= 0 ? "+" : ""}${btcChg}%) | Min: $${btcLow} / Max: $${btcHigh}\n`
  );

  const modelA = runModelReplay(datasets, btc, startIdx, "STAGE_6_0");
  const modelB = runModelReplay(datasets, btc, startIdx, "STAGE_6_1");

  const delta = (a: number, b: number, suffix = "") => {
    const d = Number((b - a).toFixed(2));
    return `${d >= 0 ? "+" : ""}${d}${suffix}`;
  };

  console.log("====================================================================================");
  console.log("  1) STAGE 6.0 vs STAGE 6.1 — 30 KUNLIK A/B SCORECARD (0.25% FRICTION BILAN)");
  console.log("====================================================================================");
  console.log("  Ko'rsatkich               | Stage 6.0 (Eski)   | Stage 6.1 (Yangi)  | Farq (Delta)");
  console.log("  --------------------------+--------------------+--------------------+----------------");
  console.log(`  Jami signallar            | ${String(modelA.totalTrades + " ta (" + modelA.avgPerDay + "/kun)").padEnd(18)} | ${String(modelB.totalTrades + " ta (" + modelB.avgPerDay + "/kun)").padEnd(18)} | ${delta(modelA.totalTrades, modelB.totalTrades, " ta")}`);
  console.log(`  Win Rate (Foydali %)      | ${String(modelA.winRatePct + "% (" + modelA.winCount + "W/" + modelA.lossCount + "L)").padEnd(18)} | ${String(modelB.winRatePct + "% (" + modelB.winCount + "W/" + modelB.lossCount + "L)").padEnd(18)} | ${delta(modelA.winRatePct, modelB.winRatePct, "%")}`);
  console.log(`  O'rtacha Foyda / Zarar    | ${("+$" + modelA.avgWinUsd.toFixed(2) + " / -$" + modelA.avgLossUsd.toFixed(2)).padEnd(18)} | ${("+$" + modelB.avgWinUsd.toFixed(2) + " / -$" + modelB.avgLossUsd.toFixed(2)).padEnd(18)} | Payoff ${modelB.payoffRatio}x (${delta(modelA.payoffRatio, modelB.payoffRatio, "x")})`);
  console.log(`  Yakuniy balans ($1,000 →) | ${("$" + modelA.finalBalanceUsd.toFixed(2)).padEnd(18)} | ${("$" + modelB.finalBalanceUsd.toFixed(2)).padEnd(18)} | ${delta(modelA.finalBalanceUsd, modelB.finalBalanceUsd, "$")}`);
  console.log(`  Sof foyda / zarar (%)     | ${((modelA.netPct >= 0 ? "+" : "") + modelA.netPct + "%").padEnd(18)} | ${((modelB.netPct >= 0 ? "+" : "") + modelB.netPct + "%").padEnd(18)} | ${delta(modelA.netPct, modelB.netPct, "%")}`);
  console.log(`  Profit Factor             | ${String(modelA.profitFactor).padEnd(18)} | ${String(modelB.profitFactor).padEnd(18)} | ${delta(modelA.profitFactor, modelB.profitFactor)}`);
  console.log(`  Max Drawdown              | ${("-" + modelA.maxDrawdownPct + "%").padEnd(18)} | ${("-" + modelB.maxDrawdownPct + "%").padEnd(18)} | ${delta(-modelA.maxDrawdownPct, -modelB.maxDrawdownPct, "%")}`);
  console.log(`  Komissiya + Slippage      | ${("-$" + modelA.totalFrictionUsd.toFixed(2)).padEnd(18)} | ${("-$" + modelB.totalFrictionUsd.toFixed(2)).padEnd(18)} | ${delta(-modelA.totalFrictionUsd, -modelB.totalFrictionUsd, "$")}`);
  console.log(`  ADX<20 Chop bloklari      | ${"0 ta (yo'q)".padEnd(18)} | ${String(modelB.adxBlockedCount + " ta bloklandi").padEnd(18)} | Faol 🛡️`);
  console.log(`  Circuit Breaker himoyasi  | ${String(modelA.cbTriggerCount + " marta (" + modelA.cbBlockedSignals + " blok)").padEnd(18)} | ${String(modelB.cbTriggerCount + " marta (" + modelB.cbBlockedSignals + " blok)").padEnd(18)} | Faol 🛡️`);

  // ---------------------------------------------------------------------------
  // 2) HAFTAMA-HAFTA NATIJA (1-hafta -> 4-hafta) — STAGE 6.1 (vs STAGE 6.0)
  // ---------------------------------------------------------------------------
  console.log("\n====================================================================================");
  console.log("  2) STAGE 6.1 — HAFTAMA-HAFTA TAFSILOT (1-HAFTA → 4-HAFTA)");
  console.log("====================================================================================");
  console.log("  Hafta | Oraliq (UTC)            | Signallar | Win | Loss | Stage 6.1 PnL    | Stage 6.0 PnL");
  console.log("  ------+-------------------------+-----------+-----+------+------------------+----------------");
  const totalSpanMs = Math.max(1, endTs - startTs);
  const weekSpanMs = totalSpanMs / 4;
  for (let w = 0; w < 4; w++) {
    const wStart = startTs + w * weekSpanMs;
    const wEnd = w === 3 ? endTs + 1 : startTs + (w + 1) * weekSpanMs;
    const wtB = modelB.trades.filter((tr) => tr.entryTs >= wStart && tr.entryTs < wEnd);
    const wtA = modelA.trades.filter((tr) => tr.entryTs >= wStart && tr.entryTs < wEnd);
    const winsB = wtB.filter((x) => x.netUsd > 0).length;
    const lossB = wtB.length - winsB;
    const netB = Number(wtB.reduce((s, x) => s + x.netUsd, 0).toFixed(2));
    const netA = Number(wtA.reduce((s, x) => s + x.netUsd, 0).toFixed(2));
    const fmtUsd = (v: number) => `${v >= 0 ? "+$" : "-$"}${Math.abs(v).toFixed(2)}`;
    const rangeStr = `${new Date(wStart).toISOString().slice(5, 10)} → ${new Date(wEnd - 1).toISOString().slice(5, 10)}`;
    console.log(
      `  ${String(w + 1).padStart(5)} | ${rangeStr.padEnd(23)} | ${String(wtB.length).padStart(9)} | ${String(winsB).padStart(3)} | ${String(lossB).padStart(4)} | ${fmtUsd(netB).padStart(16)} | ${fmtUsd(netA).padStart(14)}`
    );
  }

  // Conviction sizing & outcome breakdown
  const s3 = modelB.trades.filter((x) => x.stars <= 3);
  const s4 = modelB.trades.filter((x) => x.stars === 4);
  const s5 = modelB.trades.filter((x) => x.stars >= 5);
  const tp2Wins = modelB.trades.filter((x) => x.outcome === "TP2_FULL_WIN").length;
  const tp1Wins = modelB.trades.filter((x) => x.outcome === "TP1_TRAIL_WIN" || x.outcome === "TP1_SOFT_WIN").length;
  const expWins = modelB.trades.filter((x) => x.outcome === "EXPIRED_WIN").length;
  const slHits = modelB.trades.filter((x) => x.outcome === "SL_HIT").length;
  const expLoss = modelB.trades.filter((x) => x.outcome === "EXPIRED_LOSS").length;
  console.log("  ----------------------------------------------------------------------------------");
  console.log(
    `  Conviction Sizing (Stage 6.1): 3★ (0.5x=$50): ${s3.length} ta | 4★ (1.0x=$100): ${s4.length} ta | 5★ (1.5x=$150): ${s5.length} ta`
  );
  console.log(
    `  Stage 6.1 Yopilish turlari: TP2=${tp2Wins} | TP1(60%)=${tp1Wins} | ExpiredWin=${expWins} | SL=${slHits} | ExpiredLoss=${expLoss}`
  );
  console.log("====================================================================================");
}

main().catch((err) => {
  console.error("[FAIL] 30-Day A/B Replay Error:", err);
  process.exit(1);
});
