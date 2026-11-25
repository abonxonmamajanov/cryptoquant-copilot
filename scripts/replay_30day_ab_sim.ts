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
  SignalDirection,
  TechnicalAnalysisResult,
  TradeMode
} from "../src/agents/technician.agent";
import { MacroFlowResult, TrendRegime } from "../src/agents/macroFlow.agent";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";

// =============================================================================
// STAGE 6.2 — 30-DAY STRICT NO-LOOKAHEAD A/B WALK-FORWARD REPLAY
// Model A (Stage 6.1 — Faqat LONG):
//   LONG-only | 60/40 @ 1.8R/3.0R + (-0.2R -> +0.5R trail) | ADX>=20 | 3x SL Circuit Breaker | Conviction Sizing
// Model B (Stage 6.2 — Dual-Direction LONG + Strict 1x SHORT):
//   LONG + 1x SHORT (spot-equivalent hedge, zero liquidation) | Anti-Squeeze Gates (RSI 40-58, HTF Bearish)
//   60/40 @ 1.8R/3.0R + (-0.2R -> +0.5R trail) | ADX>=20 | 3x SL Circuit Breaker | Conviction Sizing
// =============================================================================

const STARTING_BALANCE_USD = 1000;
const BASE_POSITION_SIZE_USD = 100;
const ROUND_TRIP_FRICTION_PCT = 0.25; // 0.10% fee + 0.15% slippage
const WS_TP1_WEIGHT = 0.6; // 60% at TP1, remaining 40% at TP2

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
        headers: { Accept: "application/json", "User-Agent": "CryptoQuant-Copilot/0.62" }
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
): { regime: TrendRegime; aboveEma50: boolean; belowEma50: boolean } {
  let idx = -1;
  for (let i = klines.length - 1; i >= 0; i--) {
    if (klines[i].closeTime <= ts) {
      idx = i;
      break;
    }
  }
  if (idx < 10) return { regime: "NEUTRAL", aboveEma50: true, belowEma50: false };
  const e9 = ema9[idx];
  const e21 = ema21[idx];
  const e50 = ema50[idx];
  const last = klines[idx].close;
  const aboveEma50 = idx >= 45 ? last > e50 && e21 >= e50 * 0.995 : true;
  const belowEma50 = idx >= 45 ? last < e50 && e21 <= e50 * 1.005 : false;

  if (e9 > e21 * 1.001 && last >= e9 * 0.998) return { regime: "BULLISH", aboveEma50, belowEma50 };
  if (e9 < e21 * 0.999 && last <= e9 * 1.002) return { regime: "BEARISH", aboveEma50, belowEma50 };
  return { regime: "NEUTRAL", aboveEma50, belowEma50 };
}

function buildScoutAt(d: Coin30dData, i: number, model: "STAGE_6_1" | "STAGE_6_2"): ScoutCandidate {
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

  let longBreakoutPoints = 2;
  if (priceChange24hPct >= 0.5 && priceChange24hPct <= 12) longBreakoutPoints = 26;
  else if (priceChange24hPct >= -2 && priceChange24hPct < 0.5) longBreakoutPoints = 16;
  else if (priceChange24hPct > 12 && priceChange24hPct <= 18) longBreakoutPoints = 8;
  else if (priceChange24hPct > 18) longBreakoutPoints = -20 - Math.min(18, (priceChange24hPct - 18) * 0.9);

  let longMomPoints = 0;
  if (momentum15mPct >= 0.1 && momentum15mPct <= 1.8) longMomPoints = clamp(12 + momentum15mPct * 4.5, 12, 20);
  else if (momentum15mPct > 1.8 && momentum15mPct <= 3.2) longMomPoints = 10;
  else if (momentum15mPct > 3.2) longMomPoints = 2;
  else if (momentum15mPct >= -0.8) longMomPoints = 6;

  const liqPoints =
    quoteVolume24hUsd >= 3_000_000
      ? clamp(10 + (Math.log10(quoteVolume24hUsd) - 6.47) * 5.5, 10, 18)
      : 0;

  const longScore = Math.round(clamp(volPoints + longBreakoutPoints + longMomPoints + liqPoints, 0, 100));

  let scoutScore = longScore;
  if (model === "STAGE_6_2") {
    let shortBreakoutPoints = 2;
    if (priceChange24hPct <= -0.5 && priceChange24hPct >= -12) shortBreakoutPoints = 26;
    else if (priceChange24hPct > -0.5 && priceChange24hPct <= 2) shortBreakoutPoints = 16;
    else if (priceChange24hPct < -12 && priceChange24hPct >= -18) shortBreakoutPoints = 8;
    else if (priceChange24hPct < -18) shortBreakoutPoints = -20 - Math.min(18, (Math.abs(priceChange24hPct) - 18) * 0.9);

    let shortMomPoints = 0;
    if (momentum15mPct <= -0.1 && momentum15mPct >= -1.8) {
      shortMomPoints = clamp(12 + Math.abs(momentum15mPct) * 4.5, 12, 20);
    } else if (momentum15mPct < -1.8 && momentum15mPct >= -3.2) shortMomPoints = 10;
    else if (momentum15mPct < -3.2) shortMomPoints = 2;
    else if (momentum15mPct <= 0.8) shortMomPoints = 6;

    const shortScore = Math.round(clamp(volPoints + shortBreakoutPoints + shortMomPoints + liqPoints, 0, 100));
    scoutScore = Math.max(longScore, shortScore);
  }

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

function buildTechAt(d: Coin30dData, i: number, model: "STAGE_6_1" | "STAGE_6_2"): TechnicalAnalysisResult | null {
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
  const ema21Falling = ema21 < d.ema21[Math.max(0, i - 3)];
  const atr14 = d.atr14[i];

  let supportLevel = Infinity;
  let resistanceLevel = -Infinity;
  for (let j = Math.max(0, i - 19); j <= i; j++) {
    if (d.k1h[j].low < supportLevel) supportLevel = d.k1h[j].low;
    if (d.k1h[j].high > resistanceLevel) resistanceLevel = d.k1h[j].high;
  }
  let support10 = Infinity;
  let resistance10 = -Infinity;
  for (let j = Math.max(0, i - 9); j <= i; j++) {
    if (d.k1h[j].low < support10) support10 = d.k1h[j].low;
    if (d.k1h[j].high > resistance10) resistance10 = d.k1h[j].high;
  }

  const atrPct = entryPrice > 0 ? Number(((atr14 / entryPrice) * 100).toFixed(2)) : 0;
  const stretchAboveEma21Pct =
    ema21 > 0 ? Number((((entryPrice - ema21) / ema21) * 100).toFixed(2)) : 0;
  const stretchBelowEma21Pct =
    ema21 > 0 ? Number((((ema21 - entryPrice) / ema21) * 100).toFixed(2)) : 0;
  const distAboveSupportPct = supportLevel > 0 ? ((entryPrice - supportLevel) / supportLevel) * 100 : 0;
  const distBelowResistancePct =
    resistanceLevel > 0 ? ((resistanceLevel - entryPrice) / resistanceLevel) * 100 : 0;
  const distToEma9Pct = ema9 > 0 ? Math.abs((entryPrice - ema9) / ema9) * 100 : 0;

  // LONG Pullback-Reclaim check
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

  // SHORT Rally-Rejection check
  const recentRallyHigh = Math.max(bar.high, prev.high);
  const touchedBearEmaZone = recentRallyHigh >= ema9 * 0.996 && recentRallyHigh <= ema50 * 1.005;
  const rejectedBelowEma9 = bar.close < ema9 && bar.close < bar.open;
  const isRallyRejection =
    ema9 < ema21 &&
    ema21 < ema50 &&
    ema21Falling &&
    touchedBearEmaZone &&
    rejectedBelowEma9 &&
    stretchBelowEma21Pct >= 0 &&
    stretchBelowEma21Pct <= 2.2;

  const isBullishTrend =
    ema9 > ema21 &&
    ema21 > ema50 &&
    ema21Rising &&
    entryPrice >= ema9 * 0.998 &&
    rsi14 >= 42 &&
    rsi14 <= 60 &&
    stretchAboveEma21Pct <= 2.4 &&
    !isChoppyMarket;

  const isBearishTrend =
    model === "STAGE_6_2" &&
    ema9 < ema21 &&
    ema21 < ema50 &&
    ema21Falling &&
    entryPrice <= ema9 * 1.002 &&
    rsi14 >= 40 &&
    rsi14 <= 58 &&
    stretchBelowEma21Pct <= 2.4 &&
    !isChoppyMarket;

  const direction: SignalDirection = isBullishTrend
    ? "LONG"
    : isBearishTrend
      ? "SHORT"
      : "SKIP";

  const qualifiesLongSwing =
    ema9 > ema21 * 1.003 && ema21 > ema50 && rsi14 >= 44 && rsi14 <= 60 && atrPct >= 0.4;
  const qualifiesShortSwing =
    ema9 < ema21 * 0.997 && ema21 < ema50 && rsi14 >= 40 && rsi14 <= 56 && atrPct >= 0.4;

  const tradeMode: TradeMode =
    direction === "SHORT"
      ? qualifiesShortSwing
        ? "SWING"
        : "INTRADAY"
      : qualifiesLongSwing
        ? "SWING"
        : "INTRADAY";

  let techScore = 25;
  if (direction === "SHORT") {
    if (ema9 < ema21) techScore += 14;
    if (ema21 < ema50) techScore += 12;
    if (ema21Falling) techScore += 6;
    if (isRallyRejection) techScore += 16;
    if (rsi14 >= 42 && rsi14 <= 56) techScore += 20;
    else if (rsi14 >= 40 && rsi14 < 42) techScore += 12;
    else if (rsi14 > 56 && rsi14 <= 58) techScore += 10;
    else techScore -= 18;
    if (adx14 >= 25) techScore += 4;
    else if (isChoppyMarket) techScore -= 12;
    if (distToEma9Pct <= 1.2 && stretchBelowEma21Pct <= 2.2) techScore += 8;
    else if (stretchBelowEma21Pct > 2.2) techScore -= 16;
    if (distBelowResistancePct <= 3.5) techScore += 4;
    techScore += 6;
  } else {
    if (ema9 > ema21) techScore += 14;
    if (ema21 > ema50) techScore += 12;
    if (ema21Rising) techScore += 6;
    if (isPullbackReclaim) techScore += 16;
    if (rsi14 >= 44 && rsi14 <= 60) techScore += 20;
    else if (rsi14 >= 42 && rsi14 < 44) techScore += 12;
    else if (rsi14 > 60 && rsi14 <= 65) techScore += 2;
    else techScore -= 18;
    if (adx14 >= 25) techScore += 4;
    else if (isChoppyMarket) techScore -= 12;
    if (distToEma9Pct <= 1.2 && stretchAboveEma21Pct <= 2.2) techScore += 8;
    else if (stretchAboveEma21Pct > 2.2) techScore -= 16;
    if (distAboveSupportPct <= 3.5) techScore += 4;
    techScore += 6;
  }
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));

  const base: TechnicalAnalysisResult = {
    symbol: d.symbol,
    direction,
    tradeMode,
    entryPrice: roundedEntry,
    stopLossPrice: 0,
    takeProfitPrice: 0,
    riskRewardRatio: 3.0,
    rsi14,
    adx14,
    isChoppyMarket,
    ema9: roundPrice(ema9),
    ema21: roundPrice(ema21),
    ema50: roundPrice(ema50),
    ema21Rising,
    ema21Falling,
    stretchAboveEma21Pct,
    stretchBelowEma21Pct,
    atrPct,
    isBullishCandle: bar.close > bar.open,
    isBearishCandle: bar.close < bar.open,
    isPullbackReclaim,
    isRallyRejection,
    atr14: roundPrice(atr14),
    supportLevel: roundPrice(supportLevel),
    support10Level: roundPrice(support10),
    resistanceLevel: roundPrice(resistanceLevel),
    resistance10Level: roundPrice(resistance10),
    techScore,
    summary: "",
    latencyMs: 0
  };

  try {
    return recomputeLevelsForMode(base, tradeMode);
  } catch {
    return null;
  }
}

function buildMacroAt(
  d: Coin30dData,
  btc: Coin30dData,
  ts: number,
  btcIdx: number,
  dirHint: SignalDirection
): MacroFlowResult {
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

  // Symmetric historical book proxy (L2 depth isn't stored in historical OHLCV)
  const isShort = dirHint === "SHORT";
  const bidDepthUsd = isShort ? 217_000 : 250_000;
  const askDepthUsd = isShort ? 250_000 : 217_000;
  const bidAskRatio = isShort ? 0.87 : 1.15;

  return {
    symbol: d.symbol,
    btcChange1hPct,
    btcTrend1h: btc1h.regime,
    btcTrend4h: btc4h.regime,
    btcAbove4hEma50: btc4h.aboveEma50,
    above4hEma50: isShort ? !t4h.belowEma50 : t4h.aboveEma50,
    below4hEma50: t4h.belowEma50,
    bidDepthUsd,
    askDepthUsd,
    bidAskRatio,
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
  | "TP2_FULL_WIN"
  | "TP1_TRAIL_WIN"
  | "TP1_SOFT_WIN"
  | "SL_HIT"
  | "EXPIRED_WIN"
  | "EXPIRED_LOSS";

interface ClosedTrade30d {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryTs: number;
  exitTs: number;
  outcome: Outcome30d;
  sizeUsd: number;
  stars: number;
  netUsd: number;
  frictionUsd: number;
  slDistPct: number;
}

interface DirectionStats {
  count: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  avgWinUsd: number;
  avgLossUsd: number;
  payoffRatio: number;
  netUsd: number;
  profitFactor: number;
  frictionUsd: number;
}

interface ModelSummary {
  label: string;
  totalTrades: number;
  longCount: number;
  shortCount: number;
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
  longStats: DirectionStats;
  shortStats: DirectionStats;
  trades: ClosedTrade30d[];
}

function summarizeSubTrades(list: ClosedTrade30d[]): DirectionStats {
  const n = list.length;
  const winners = list.filter((c) => c.netUsd > 0);
  const losers = list.filter((c) => c.netUsd <= 0);
  const grossWin = winners.reduce((s, c) => s + c.netUsd, 0);
  const grossLoss = losers.reduce((s, c) => s + Math.abs(c.netUsd), 0);
  const avgWinUsd = winners.length > 0 ? Number((grossWin / winners.length).toFixed(2)) : 0;
  const avgLossUsd = losers.length > 0 ? Number((grossLoss / losers.length).toFixed(2)) : 0;
  const payoffRatio = avgLossUsd > 0 ? Number((avgWinUsd / avgLossUsd).toFixed(2)) : avgWinUsd > 0 ? 99 : 0;
  const profitFactor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0;
  const netUsd = Number(list.reduce((s, c) => s + c.netUsd, 0).toFixed(2));
  const frictionUsd = Number(list.reduce((s, c) => s + c.frictionUsd, 0).toFixed(2));

  return {
    count: n,
    winCount: winners.length,
    lossCount: losers.length,
    winRatePct: n > 0 ? Number(((winners.length / n) * 100).toFixed(1)) : 0,
    avgWinUsd,
    avgLossUsd,
    payoffRatio,
    netUsd,
    profitFactor,
    frictionUsd
  };
}

function runModelReplay(
  datasets: Coin30dData[],
  btc: Coin30dData,
  startIdx: number,
  model: "STAGE_6_1" | "STAGE_6_2"
): ModelSummary {
  let balanceUsd = STARTING_BALANCE_USD;
  let peakBalance = STARTING_BALANCE_USD;
  let maxDdPct = 0;

  interface OpenPos {
    symbol: string;
    direction: "LONG" | "SHORT";
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
    // Strict 1x Spot / 1x Hedge PnL math
    const grossPct =
      pos.direction === "SHORT"
        ? ((pos.entryPrice - price) / pos.entryPrice) * 100
        : ((price - pos.entryPrice) / pos.entryPrice) * 100;
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

      const isShort = pos.direction === "SHORT";
      const risk = Math.max(Math.abs(pos.entryPrice - pos.initialSl), pos.entryPrice * 0.008);
      let out: Outcome30d | null = null;

      if (isShort) {
        // Strict 1x SHORT Wall Street 60/40 Exit Math:
        // Worst-case SL check first (bar.high >= activeSl)
        if (bar.high >= pos.activeSl) {
          closeLeg(pos, pos.remW, pos.activeSl);
          if (pos.trailStep2) out = "TP1_TRAIL_WIN";
          else if (pos.tp1Hit) out = "TP1_SOFT_WIN";
          else out = "SL_HIT";
        } else {
          if (!pos.tp1Hit && bar.low <= pos.tp1) {
            closeLeg(pos, WS_TP1_WEIGHT, pos.tp1);
            pos.tp1Hit = true;
            pos.activeSl = roundPrice(pos.entryPrice + risk * 0.2); // -0.2R soft protection above entry
          }
          if (pos.tp1Hit && !pos.trailStep2 && bar.low <= pos.entryPrice - risk * 2.3) {
            pos.trailStep2 = true;
            pos.activeSl = roundPrice(pos.entryPrice - risk * 0.5); // +0.5R profit lock below entry
          }
          if (bar.low <= pos.tp2 && pos.remW > 0) {
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
      } else {
        // LONG Wall Street 60/40 Exit Math:
        // Worst-case SL check first (bar.low <= activeSl)
        if (bar.low <= pos.activeSl) {
          closeLeg(pos, pos.remW, pos.activeSl);
          if (pos.trailStep2) out = "TP1_TRAIL_WIN";
          else if (pos.tp1Hit) out = "TP1_SOFT_WIN";
          else out = "SL_HIT";
        } else {
          if (!pos.tp1Hit && bar.high >= pos.tp1) {
            closeLeg(pos, WS_TP1_WEIGHT, pos.tp1);
            pos.tp1Hit = true;
            pos.activeSl = roundPrice(pos.entryPrice - risk * 0.2); // -0.2R soft protection below entry
          }
          if (pos.tp1Hit && !pos.trailStep2 && bar.high >= pos.entryPrice + risk * 2.3) {
            pos.trailStep2 = true;
            pos.activeSl = roundPrice(pos.entryPrice + risk * 0.5); // +0.5R profit lock above entry
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
          direction: pos.direction,
          entryTs: pos.entryTs,
          exitTs: ts,
          outcome: out,
          sizeUsd: pos.sizeUsd,
          stars: pos.stars,
          netUsd,
          frictionUsd: Number(pos.frictionUsd.toFixed(4)),
          slDistPct: Number(((Math.abs(pos.entryPrice - pos.initialSl) / pos.entryPrice) * 100).toFixed(2))
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
        } else if (netUsd > 0) {
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
      scored.push({ dIdx, barIdx: bi, scout: buildScoutAt(datasets[dIdx], bi, model) });
    }
    scored.sort((a, b) => b.scout.scoutScore - a.scout.scoutScore);

    for (const item of scored.slice(0, 8)) {
      const d = datasets[item.dIdx];
      if (d.adx14[item.barIdx] < 20) {
        adxBlockedCount += 1;
      }
      const rawTech = buildTechAt(d, item.barIdx, model);
      if (!rawTech || rawTech.direction === "SKIP") continue;
      const macro = buildMacroAt(d, btc, ts, t, rawTech.direction);

      const res = runCriticRiskAgent(item.scout, rawTech, macro);
      if (res.verdict !== "APPROVE") {
        continue;
      }

      const finalMode = res.tradeMode ?? "INTRADAY";
      const finalTech = recomputeLevelsForMode(rawTech, finalMode);

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

      const sizeMult = res.suggestedSizeMultiplier;
      const sizeUsd = Number((BASE_POSITION_SIZE_USD * sizeMult).toFixed(2));

      open.push({
        symbol: d.symbol,
        direction: finalTech.direction === "SHORT" ? "SHORT" : "LONG",
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

  const allStats = summarizeSubTrades(closed);
  const longTrades = closed.filter((c) => c.direction === "LONG");
  const shortTrades = closed.filter((c) => c.direction === "SHORT");
  const longStats = summarizeSubTrades(longTrades);
  const shortStats = summarizeSubTrades(shortTrades);
  const days = Math.max(1, (totalBars - startIdx) / BARS_PER_DAY_1H);
  const netUsd = Number((balanceUsd - STARTING_BALANCE_USD).toFixed(2));
  const netPct = Number(((netUsd / STARTING_BALANCE_USD) * 100).toFixed(2));

  return {
    label: model === "STAGE_6_1" ? "Stage 6.1 (Faqat LONG)" : "Stage 6.2 (LONG + SHORT 1x)",
    totalTrades: allStats.count,
    longCount: longStats.count,
    shortCount: shortStats.count,
    avgPerDay: Number((allStats.count / days).toFixed(2)),
    winCount: allStats.winCount,
    winRatePct: allStats.winRatePct,
    lossCount: allStats.lossCount,
    lossRatePct: allStats.count > 0 ? Number(((allStats.lossCount / allStats.count) * 100).toFixed(1)) : 0,
    avgWinUsd: allStats.avgWinUsd,
    avgLossUsd: allStats.avgLossUsd,
    payoffRatio: allStats.payoffRatio,
    finalBalanceUsd: Number(balanceUsd.toFixed(2)),
    netUsd,
    netPct,
    profitFactor: allStats.profitFactor,
    maxDrawdownPct: Number(maxDdPct.toFixed(2)),
    totalFrictionUsd: allStats.frictionUsd,
    cbTriggerCount,
    cbBlockedSignals,
    adxBlockedCount,
    longStats,
    shortStats,
    trades: closed
  };
}

async function main() {
  console.log("==========================================================================================");
  console.log("  CRYPTOQUANT-COPILOT — STAGE 6.1 (LONG-ONLY) vs STAGE 6.2 (LONG + STRICT 1x SHORT)");
  console.log("  30 KUNLIK REAL NO-LOOKAHEAD WALK-FORWARD A/B REPLAY (0.25% FRICTION BILAN)");
  console.log("==========================================================================================");
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

  console.log(
    `  Faol mirror: ${getActiveMexcMirror()} | Koinlar (${selected.length}): ${selected.map((x) => x.symbol.replace("USDT", "")).join(", ")}`
  );
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

  const modelA = runModelReplay(datasets, btc, startIdx, "STAGE_6_1");
  const modelB = runModelReplay(datasets, btc, startIdx, "STAGE_6_2");

  const delta = (a: number, b: number, suffix = "") => {
    const d = Number((b - a).toFixed(2));
    return `${d >= 0 ? "+" : ""}${d}${suffix}`;
  };
  const fmtUsd = (v: number) => `${v >= 0 ? "+$" : "-$"}${Math.abs(v).toFixed(2)}`;

  // ---------------------------------------------------------------------------
  // 1) STAGE 6.1 (FAQAT LONG) vs STAGE 6.2 (LONG + SHORT 1x) SCORECARD
  // ---------------------------------------------------------------------------
  console.log("==========================================================================================");
  console.log("  1) 30 KUNLIK A/B SCORECARD: STAGE 6.1 (Faqat LONG) vs STAGE 6.2 (LONG + SHORT 1x)");
  console.log("==========================================================================================");
  console.log("  Ko'rsatkich               | Stage 6.1 (LONG)     | Stage 6.2 (LONG+SHORT) | Farq (Delta)");
  console.log("  --------------------------+----------------------+------------------------+----------------");
  console.log(
    `  Jami signallar            | ${String(`${modelA.totalTrades} (${modelA.longCount}L / 0S)`).padEnd(20)} | ${String(`${modelB.totalTrades} (${modelB.longCount}L / ${modelB.shortCount}S)`).padEnd(22)} | ${delta(modelA.totalTrades, modelB.totalTrades, " ta")}`
  );
  console.log(
    `  O'rtacha kunlik oqim      | ${String(modelA.avgPerDay + " ta/kun").padEnd(20)} | ${String(modelB.avgPerDay + " ta/kun").padEnd(22)} | ${delta(modelA.avgPerDay, modelB.avgPerDay, "/kun")}`
  );
  console.log(
    `  Win Rate (Foydali %)      | ${String(`${modelA.winRatePct}% (${modelA.winCount}W/${modelA.lossCount}L)`).padEnd(20)} | ${String(`${modelB.winRatePct}% (${modelB.winCount}W/${modelB.lossCount}L)`).padEnd(22)} | ${delta(modelA.winRatePct, modelB.winRatePct, "%")}`
  );
  console.log(
    `  O'rtacha Foyda / Zarar    | ${(`+$${modelA.avgWinUsd.toFixed(2)} / -$${modelA.avgLossUsd.toFixed(2)}`).padEnd(20)} | ${(`+$${modelB.avgWinUsd.toFixed(2)} / -$${modelB.avgLossUsd.toFixed(2)}`).padEnd(22)} | Payoff ${modelB.payoffRatio}x`
  );
  console.log(
    `  Yakuniy balans ($1,000 →) | ${("$" + modelA.finalBalanceUsd.toFixed(2)).padEnd(20)} | ${("$" + modelB.finalBalanceUsd.toFixed(2)).padEnd(22)} | ${delta(modelA.finalBalanceUsd, modelB.finalBalanceUsd, "$")}`
  );
  console.log(
    `  Sof foyda / zarar (%)     | ${((modelA.netPct >= 0 ? "+" : "") + modelA.netPct + "%").padEnd(20)} | ${((modelB.netPct >= 0 ? "+" : "") + modelB.netPct + "%").padEnd(22)} | ${delta(modelA.netPct, modelB.netPct, "%")}`
  );
  console.log(
    `  Profit Factor             | ${String(modelA.profitFactor).padEnd(20)} | ${String(modelB.profitFactor).padEnd(22)} | ${delta(modelA.profitFactor, modelB.profitFactor)}`
  );
  console.log(
    `  Max Drawdown              | ${("-" + modelA.maxDrawdownPct + "%").padEnd(20)} | ${("-" + modelB.maxDrawdownPct + "%").padEnd(22)} | ${delta(-modelA.maxDrawdownPct, -modelB.maxDrawdownPct, "%")}`
  );
  console.log(
    `  Komissiya + Slippage      | ${("-$" + modelA.totalFrictionUsd.toFixed(2)).padEnd(20)} | ${("-$" + modelB.totalFrictionUsd.toFixed(2)).padEnd(22)} | ${delta(-modelA.totalFrictionUsd, -modelB.totalFrictionUsd, "$")}`
  );
  console.log(
    `  Circuit Breaker himoyasi  | ${String(`${modelA.cbTriggerCount}x (${modelA.cbBlockedSignals} blok)`).padEnd(20)} | ${String(`${modelB.cbTriggerCount}x (${modelB.cbBlockedSignals} blok)`).padEnd(22)} | Faol 🛡️`
  );

  // ---------------------------------------------------------------------------
  // 2) STAGE 6.2 ALOHIDA YO'NALISH TAHLILI: LONG vs SHORT (1x)
  // ---------------------------------------------------------------------------
  const ls = modelB.longStats;
  const ss = modelB.shortStats;
  console.log("\n==========================================================================================");
  console.log("  2) STAGE 6.2 YO'NALISHLAR BO'YICHA ALOHIDA STATISTIKA: 🟢 LONG vs 🔴 SHORT (1x)");
  console.log("==========================================================================================");
  console.log("  Ko'rsatkich               | 🟢 LONG (Spot)       | 🔴 SHORT (1x Hedge)    | Izoh");
  console.log("  --------------------------+----------------------+------------------------+----------------");
  console.log(
    `  Savdolar soni             | ${String(ls.count + " ta").padEnd(20)} | ${String(ss.count + " ta").padEnd(22)} | Jami ${modelB.totalTrades} ta`
  );
  console.log(
    `  Win Rate (W / L)          | ${String(`${ls.winRatePct}% (${ls.winCount}W/${ls.lossCount}L)`).padEnd(20)} | ${String(`${ss.winRatePct}% (${ss.winCount}W/${ss.lossCount}L)`).padEnd(22)} | Asimmetrik 60/40`
  );
  console.log(
    `  O'rtacha Foyda / Zarar    | ${(`+$${ls.avgWinUsd.toFixed(2)} / -$${ls.avgLossUsd.toFixed(2)}`).padEnd(20)} | ${(`+$${ss.avgWinUsd.toFixed(2)} / -$${ss.avgLossUsd.toFixed(2)}`).padEnd(22)} | ${ls.payoffRatio}x / ${ss.payoffRatio}x`
  );
  console.log(
    `  Sof PnL ($)               | ${fmtUsd(ls.netUsd).padEnd(20)} | ${fmtUsd(ss.netUsd).padEnd(22)} | Jami ${fmtUsd(modelB.netUsd)}`
  );
  console.log(
    `  Profit Factor             | ${String(ls.profitFactor).padEnd(20)} | ${String(ss.profitFactor).padEnd(22)} | 1x Nol Likvidatsiya`
  );
  console.log(
    `  Komissiya + Slippage      | ${("-$" + ls.frictionUsd.toFixed(2)).padEnd(20)} | ${("-$" + ss.frictionUsd.toFixed(2)).padEnd(22)} | 0.25% round-trip`
  );

  // ---------------------------------------------------------------------------
  // 3) HAFTAMA-HAFTA NATIJA (1-hafta -> 4-hafta)
  // ---------------------------------------------------------------------------
  console.log("\n==========================================================================================");
  console.log("  3) HAFTAMA-HAFTA TAFSILOT (1-HAFTA → 4-HAFTA): STAGE 6.2 vs STAGE 6.1");
  console.log("==========================================================================================");
  console.log("  Hafta | Oraliq (UTC)  | 6.2 Signallar (L/S) | W/L   | Stage 6.2 PnL  | Stage 6.1 PnL");
  console.log("  ------+---------------+---------------------+-------+----------------+--------------");
  const totalSpanMs = Math.max(1, endTs - startTs);
  const weekSpanMs = totalSpanMs / 4;
  for (let w = 0; w < 4; w++) {
    const wStart = startTs + w * weekSpanMs;
    const wEnd = w === 3 ? endTs + 1 : startTs + (w + 1) * weekSpanMs;
    const wtB = modelB.trades.filter((tr) => tr.entryTs >= wStart && tr.entryTs < wEnd);
    const wtA = modelA.trades.filter((tr) => tr.entryTs >= wStart && tr.entryTs < wEnd);
    const wLong = wtB.filter((x) => x.direction === "LONG").length;
    const wShort = wtB.filter((x) => x.direction === "SHORT").length;
    const winsB = wtB.filter((x) => x.netUsd > 0).length;
    const lossB = wtB.length - winsB;
    const netB = Number(wtB.reduce((s, x) => s + x.netUsd, 0).toFixed(2));
    const netA = Number(wtA.reduce((s, x) => s + x.netUsd, 0).toFixed(2));
    const rangeStr = `${new Date(wStart).toISOString().slice(5, 10)}→${new Date(wEnd - 1).toISOString().slice(5, 10)}`;
    console.log(
      `  ${String(w + 1).padStart(5)} | ${rangeStr.padEnd(13)} | ${`${wtB.length} ta (${wLong}L/${wShort}S)`.padEnd(19)} | ${`${winsB}/${lossB}`.padEnd(5)} | ${fmtUsd(netB).padStart(14)} | ${fmtUsd(netA).padStart(12)}`
    );
  }

  const s3 = modelB.trades.filter((x) => x.stars <= 3);
  const s4 = modelB.trades.filter((x) => x.stars === 4);
  const s5 = modelB.trades.filter((x) => x.stars >= 5);
  const tp2Wins = modelB.trades.filter((x) => x.outcome === "TP2_FULL_WIN").length;
  const tp1Wins = modelB.trades.filter((x) => x.outcome === "TP1_TRAIL_WIN" || x.outcome === "TP1_SOFT_WIN").length;
  const expWins = modelB.trades.filter((x) => x.outcome === "EXPIRED_WIN").length;
  const slHits = modelB.trades.filter((x) => x.outcome === "SL_HIT").length;
  const expLoss = modelB.trades.filter((x) => x.outcome === "EXPIRED_LOSS").length;
  console.log("  ----------------------------------------------------------------------------------------");
  console.log(
    `  Conviction Sizing (Stage 6.2): 3★ ($50): ${s3.length} ta | 4★ ($100): ${s4.length} ta | 5★ ($150): ${s5.length} ta`
  );
  console.log(
    `  Stage 6.2 Yopilish turlari: TP2=${tp2Wins} | TP1(60%)=${tp1Wins} | ExpiredWin=${expWins} | SL=${slHits} | ExpiredLoss=${expLoss}`
  );
  console.log("==========================================================================================");
}

main().catch((err) => {
  console.error("[FAIL] 30-Day Stage 6.2 A/B Replay Error:", err);
  process.exit(1);
});
