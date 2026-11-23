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
  recomputeLevelsForMode,
  TechnicalAnalysisResult,
  TradeMode
} from "../src/agents/technician.agent";
import { MacroFlowResult, TrendRegime } from "../src/agents/macroFlow.agent";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";

// =============================================================================
// STAGE 6.0 — 30-DAY (1-MONTH) STRICT NO-LOOKAHEAD A/B WALK-FORWARD REPLAY
// Model A: Stage 5.9 (RSI 42-66, no Vol>=1x, no BTC 4H RS gate, unsynced SL/TP, no 3-SL 4h CB)
// Model B: Stage 6.0 (RSI 42-60, Vol>=1.0x, BTC 4H RS leader gate, strict SL/TP sync, 3-SL 4h CB)
// =============================================================================

const STARTING_BALANCE_USD = 1000;
const POSITION_SIZE_USD = 100;
const ROUND_TRIP_FRICTION_PCT = 0.25; // 0.10% fee + 0.15% slippage
const TP1_WEIGHT = 0.4;
const TP2_WEIGHT = 0.35;
const TP3_WEIGHT = 0.25;

const REPLAY_DAYS = 30;
const BARS_PER_DAY_1H = 24;
const REPLAY_BARS_1H = REPLAY_DAYS * BARS_PER_DAY_1H; // 720 x 1h bars = exact 30 full days
const WARMUP_BARS_1H = 60; // >= 50 for EMA50 convergence
const FETCH_LIMIT_1H = REPLAY_BARS_1H + WARMUP_BARS_1H; // 780 bars (2 paginated pages)
const FETCH_LIMIT_4H = 240; // 40 days of 4h bars (30d + 10d warmup for EMA50)

const COOLDOWN_BARS_1H = 2; // 2-hour per-symbol cooldown
const SL_FIRST_LOCK_MS = 6 * 60 * 60 * 1000;
const SL_REPEAT_LOCK_MS = 24 * 60 * 60 * 1000;
const WS_CB_THRESHOLD = 3; // 3 consecutive SLs -> 4h pause (Stage 6.0)
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
        headers: { Accept: "application/json", "User-Agent": "CryptoQuant-Copilot/0.6" }
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
  // Stitch 2 pages (MEXC max 500/req; requires startTime + endTime for backward pagination)
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

function buildTechAt(d: Coin30dData, i: number, model: "STAGE_5_9" | "STAGE_6_0"): TechnicalAnalysisResult | null {
  const bar = d.k1h[i];
  const prev = d.k1h[i - 1];
  const entryPrice = bar.close;
  const roundedEntry = roundPrice(entryPrice);
  const rsi14 = d.rsi14[i];
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
  const maxRsiTech = model === "STAGE_6_0" ? 60 : 66;
  const tradeMode: TradeMode =
    ema9 > ema21 * 1.003 && ema21 > ema50 && rsi14 >= 44 && rsi14 <= (model === "STAGE_6_0" ? 60 : 64) && atrPct >= 0.4
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
  if (rsi14 >= 44 && rsi14 <= (model === "STAGE_6_0" ? 60 : 64)) techScore += 20;
  else if (rsi14 >= 42 && rsi14 < 44) techScore += 12;
  else if (rsi14 > 60 && rsi14 <= 66) techScore += model === "STAGE_6_0" ? 2 : 4;
  else techScore -= 18;
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
    rsi14 <= maxRsiTech &&
    stretchAboveEma21Pct <= 2.4;

  // Compute initial SL/TP (Model A uses Stage 5.9 bounds -1.5%..-3.0% intraday; Model B uses Stage 6.0 sync)
  let sl: number;
  let mult1: number;
  let mult2: number;
  let mult3: number;
  if (tradeMode === "SWING") {
    const swingAtrStop = entryPrice - Math.max(atr14 * 2.2, entryPrice * 0.02);
    const rawStop = Math.max(entryPrice * 0.958, Math.min(swingAtrStop, supportLevel * 0.995));
    sl = roundPrice(Math.min(rawStop, entryPrice * 0.98));
    mult1 = 1.4;
    mult2 = 2.5;
    mult3 = 3.8;
  } else {
    const intradayFloor = model === "STAGE_6_0" ? entryPrice * 0.974 : entryPrice * 0.97;
    const atrStop = entryPrice - Math.max(atr14 * 1.8, entryPrice * 0.015);
    const rawStop = Math.max(intradayFloor, Math.min(atrStop, support10 * 0.996));
    sl = roundPrice(Math.min(rawStop, entryPrice * 0.985));
    mult1 = 1.2;
    mult2 = 2.2;
    mult3 = 3.3;
  }

  const risk = Math.max(roundedEntry - sl, roundedEntry * 0.008);
  const tp1 = roundPrice(roundedEntry + risk * mult1);
  const tp2 = roundPrice(Math.max(roundedEntry + risk * Math.max(mult2, 2.2), tp1 * 1.005));
  const tp3 = roundPrice(Math.max(roundedEntry + risk * mult3, tp2 + risk, tp2 * 1.008));
  if (!(sl < roundedEntry && roundedEntry < tp1 && tp1 < tp2 && tp2 < tp3)) return null;

  return {
    symbol: d.symbol,
    direction: isBullishTrend ? "LONG" : "SKIP",
    tradeMode,
    entryPrice: roundedEntry,
    stopLossPrice: sl,
    takeProfitPrice: tp2,
    tp1Price: tp1,
    tp2Price: tp2,
    tp3Price: tp3,
    riskRewardRatio: Number(((tp2 - roundedEntry) / risk).toFixed(2)),
    rsi14,
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

  let macroScore = 50 + 16 + 10; // Top-20 liquid book neutral proxy (bidAsk 1.15x, spread 0.05%)
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

// Old Stage 5.9 Critic logic (for true A/B comparison against live Stage 6.0 runCriticRiskAgent)
function evaluateStage59Critic(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult
): { verdict: "APPROVE" | "REJECT"; tradeMode: TradeMode } {
  if (tech.direction !== "LONG" || tech.riskRewardRatio < 2.0) return { verdict: "REJECT", tradeMode: "INTRADAY" };
  if (macro.trend1h === "BEARISH" || macro.trend4h === "BEARISH") return { verdict: "REJECT", tradeMode: "INTRADAY" };
  if (macro.btcChange1hPct <= -0.6) return { verdict: "REJECT", tradeMode: "INTRADAY" };
  if (macro.btcTrend1h === "BEARISH" && macro.btcTrend4h === "BEARISH") return { verdict: "REJECT", tradeMode: "INTRADAY" };
  if (scout.priceChange24hPct > 20) return { verdict: "REJECT", tradeMode: "INTRADAY" };
  if (tech.rsi14 > 66 || tech.rsi14 < 42) return { verdict: "REJECT", tradeMode: "INTRADAY" };
  const stretch = tech.stretchAboveEma21Pct ?? 0;
  if (stretch > 2.5) return { verdict: "REJECT", tradeMode: "INTRADAY" };
  if (tech.isPullbackReclaim === false) return { verdict: "REJECT", tradeMode: "INTRADAY" };
  if ((tech.atrPct ?? 0) > 3.2) return { verdict: "REJECT", tradeMode: "INTRADAY" };

  let starPenalty = 0;
  if (macro.btcTrend4h === "BEARISH") starPenalty += 1;
  if (stretch > 1.8) starPenalty += 1;
  const conf = Math.max(
    0,
    Math.min(
      100,
      Math.round(scout.scoutScore * 0.2 + tech.techScore * 0.44 + macro.macroScore * 0.26 + 8 - Math.min(starPenalty * 2, 8))
    )
  );
  if (conf < 65) return { verdict: "REJECT", tradeMode: "INTRADAY" };

  let baseStars = conf >= 78 ? 5 : conf >= 68 ? 4 : 3;
  if (macro.trend1h === "BULLISH" && macro.trend4h === "BULLISH") baseStars = Math.min(5, baseStars + 1);
  const stars = Math.max(1, Math.min(5, baseStars - Math.min(starPenalty, 2)));
  const tradeMode: TradeMode =
    macro.trend1h === "BULLISH" &&
    macro.trend4h === "BULLISH" &&
    macro.btcTrend4h !== "BEARISH" &&
    macro.above4hEma50 !== false &&
    stars >= 4
      ? "SWING"
      : "INTRADAY";
  return { verdict: "APPROVE", tradeMode };
}

type Outcome30d =
  | "TP3_HIT"
  | "TP2_TRAIL_WIN"
  | "BREAKEVEN_PROFIT"
  | "SL_HIT"
  | "EXPIRED_WIN"
  | "EXPIRED_LOSS";

interface ClosedTrade30d {
  symbol: string;
  entryTs: number;
  exitTs: number;
  outcome: Outcome30d;
  netUsd: number;
  frictionUsd: number;
  slDistPct: number;
}

interface ModelSummary {
  label: string;
  totalTrades: number;
  avgPerDay: number;
  tp1PlusCount: number;
  winRatePct: number;
  beCount: number;
  bePct: number;
  slCount: number;
  slPct: number;
  finalBalanceUsd: number;
  netUsd: number;
  netPct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalFrictionUsd: number;
  cbTriggerCount: number;
  cbBlockedSignals: number;
  trades: ClosedTrade30d[];
}

function runModelReplay(
  datasets: Coin30dData[],
  btc: Coin30dData,
  startIdx: number,
  model: "STAGE_5_9" | "STAGE_6_0"
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
    remW: number;
    tp1Hit: boolean;
    tp2Hit: boolean;
    realizedUsd: number;
    frictionUsd: number;
    barsHeld: number;
  }

  const closeLeg = (pos: OpenPos, w: number, price: number) => {
    const cw = Math.min(w, pos.remW);
    if (cw <= 0) return;
    const notional = POSITION_SIZE_USD * cw;
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

  // Stage 6.0 Wall Street Circuit Breaker (3 consecutive SLs -> 4h pause)
  let consecutiveLosses = 0;
  let wsCbPausedUntil = 0;
  let cbTriggerCount = 0;
  let cbBlockedSignals = 0;

  const totalBars = btc.k1h.length;

  for (let t = startIdx; t < totalBars; t++) {
    const ts = btc.k1h[t].closeTime;
    const isFinalBar = t === totalBars - 1;

    if (wsCbPausedUntil > 0 && ts >= wsCbPausedUntil) {
      wsCbPausedUntil = 0;
      consecutiveLosses = 0;
    }

    // 1. Update open positions (worst-case SL-first rule inside same candle)
    for (let p = open.length - 1; p >= 0; p--) {
      const pos = open[p];
      const bi = datasets[pos.dIdx].timeToIdx.get(ts);
      if (bi === undefined) continue;
      const bar = datasets[pos.dIdx].k1h[bi];
      pos.barsHeld += 1;

      let out: Outcome30d | null = null;
      if (bar.low <= pos.activeSl) {
        closeLeg(pos, pos.remW, pos.activeSl);
        if (pos.tp2Hit) out = "TP2_TRAIL_WIN";
        else if (pos.tp1Hit) out = "BREAKEVEN_PROFIT";
        else out = "SL_HIT";
      } else {
        if (!pos.tp1Hit && bar.high >= pos.tp1) {
          closeLeg(pos, TP1_WEIGHT, pos.tp1);
          pos.tp1Hit = true;
          pos.activeSl = pos.entryPrice;
        }
        if (!pos.tp2Hit && bar.high >= pos.tp2) {
          closeLeg(pos, TP2_WEIGHT, pos.tp2);
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

          if (model === "STAGE_6_0") {
            consecutiveLosses += 1;
            if (consecutiveLosses >= WS_CB_THRESHOLD) {
              if (wsCbPausedUntil <= ts) cbTriggerCount += 1;
              wsCbPausedUntil = ts + WS_CB_PAUSE_MS;
            }
          }
        } else if (out === "TP3_HIT" || out === "TP2_TRAIL_WIN" || out === "EXPIRED_WIN") {
          if (model === "STAGE_6_0") {
            consecutiveLosses = 0;
            wsCbPausedUntil = 0;
          }
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

      let approved = false;
      let finalMode: TradeMode = rawTech.tradeMode ?? "INTRADAY";
      let finalTech = rawTech;

      if (model === "STAGE_5_9") {
        const res = evaluateStage59Critic(item.scout, rawTech, macro);
        approved = res.verdict === "APPROVE";
        finalMode = res.tradeMode;
        // Stage 5.9 did NOT resync SL/TP when Critic downgraded SWING -> INTRADAY
      } else {
        const res = runCriticRiskAgent(item.scout, rawTech, macro);
        approved = res.verdict === "APPROVE";
        finalMode = res.tradeMode ?? "INTRADAY";
        // Stage 6.0 STRICT SL/TP Mode Synchronization!
        finalTech = recomputeLevelsForMode(rawTech, finalMode);
      }

      if (!approved) continue;

      if (model === "STAGE_6_0" && ts < wsCbPausedUntil) {
        cbBlockedSignals += 1;
        continue;
      }
      if (open.some((op) => op.symbol === d.symbol)) continue;
      if ((symSlBlockedUntil.get(d.symbol) ?? 0) > ts) continue;
      const lastB = lastDispatchBar.get(d.symbol);
      if (lastB !== undefined && t - lastB < COOLDOWN_BARS_1H) continue;
      const atRisk = open.filter((op) => !op.tp1Hit).length;
      if (atRisk >= MAX_AT_RISK_ACTIVE || open.length >= MAX_TOTAL_ACTIVE) continue;

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
        remW: 1.0,
        tp1Hit: false,
        tp2Hit: false,
        realizedUsd: 0,
        frictionUsd: 0,
        barsHeld: 0
      });
      lastDispatchBar.set(d.symbol, t);
    }
  }

  const n = closed.length;
  const days = Math.max(1, (totalBars - startIdx) / BARS_PER_DAY_1H);
  const tp1PlusCount = closed.filter(
    (c) =>
      c.outcome === "TP3_HIT" ||
      c.outcome === "TP2_TRAIL_WIN" ||
      c.outcome === "BREAKEVEN_PROFIT" ||
      c.outcome === "EXPIRED_WIN"
  ).length;
  const beCount = closed.filter((c) => c.outcome === "BREAKEVEN_PROFIT").length;
  const slCount = closed.filter((c) => c.outcome === "SL_HIT" || c.outcome === "EXPIRED_LOSS").length;
  const grossWin = closed.filter((c) => c.netUsd > 0).reduce((s, c) => s + c.netUsd, 0);
  const grossLoss = closed.filter((c) => c.netUsd < 0).reduce((s, c) => s + Math.abs(c.netUsd), 0);
  const pf = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0;
  const netUsd = Number((balanceUsd - STARTING_BALANCE_USD).toFixed(2));
  const netPct = Number(((netUsd / STARTING_BALANCE_USD) * 100).toFixed(2));
  const totalFrictionUsd = Number(closed.reduce((s, c) => s + c.frictionUsd, 0).toFixed(2));

  return {
    label: model === "STAGE_5_9" ? "Stage 5.9 (Eski)" : "Stage 6.0 (Yangi)",
    totalTrades: n,
    avgPerDay: Number((n / days).toFixed(2)),
    tp1PlusCount,
    winRatePct: n > 0 ? Number(((tp1PlusCount / n) * 100).toFixed(1)) : 0,
    beCount,
    bePct: n > 0 ? Number(((beCount / n) * 100).toFixed(1)) : 0,
    slCount,
    slPct: n > 0 ? Number(((slCount / n) * 100).toFixed(1)) : 0,
    finalBalanceUsd: Number(balanceUsd.toFixed(2)),
    netUsd,
    netPct,
    profitFactor: pf,
    maxDrawdownPct: Number(maxDdPct.toFixed(2)),
    totalFrictionUsd,
    cbTriggerCount,
    cbBlockedSignals,
    trades: closed
  };
}

async function main() {
  console.log("===============================================================================");
  console.log("  CRYPTOQUANT-COPILOT — 30 KUNLIK (1 OYLIK) A/B WALK-FORWARD REPLAY AUDITI");
  console.log("===============================================================================");
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
  console.log("  [2/3] 30 kunlik 1H (~780 sham, 2 sahifa) + 4H (240 sham) yuklanmoqda...");

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

  const modelA = runModelReplay(datasets, btc, startIdx, "STAGE_5_9");
  const modelB = runModelReplay(datasets, btc, startIdx, "STAGE_6_0");

  const delta = (a: number, b: number, suffix = "") => {
    const d = Number((b - a).toFixed(2));
    return `${d >= 0 ? "+" : ""}${d}${suffix}`;
  };

  console.log("===============================================================================");
  console.log("  1) 30 KUNLIK A/B SOLISHTIRUV JADVALI (0.25% KOMISSIYA + SLIPPAGE BILAN)");
  console.log("===============================================================================");
  console.log("  Ko'rsatkich               | Stage 5.9 (Eski) | Stage 6.0 (Yangi) | Farq (Delta)");
  console.log("  --------------------------+------------------+-------------------+----------------");
  console.log(`  Jami signallar            | ${String(modelA.totalTrades + " ta (" + modelA.avgPerDay + "/kun)").padEnd(16)} | ${String(modelB.totalTrades + " ta (" + modelB.avgPerDay + "/kun)").padEnd(17)} | ${delta(modelA.totalTrades, modelB.totalTrades, " ta")}`);
  console.log(`  Win Rate (TP1+)           | ${String(modelA.winRatePct + "%").padEnd(16)} | ${String(modelB.winRatePct + "%").padEnd(17)} | ${delta(modelA.winRatePct, modelB.winRatePct, "%")}`);
  console.log(`  Breakeven ulushi          | ${String(modelA.bePct + "% (" + modelA.beCount + ")").padEnd(16)} | ${String(modelB.bePct + "% (" + modelB.beCount + ")").padEnd(17)} | ${delta(modelA.bePct, modelB.bePct, "%")}`);
  console.log(`  SL / Zarar ulushi         | ${String(modelA.slPct + "% (" + modelA.slCount + ")").padEnd(16)} | ${String(modelB.slPct + "% (" + modelB.slCount + ")").padEnd(17)} | ${delta(modelA.slPct, modelB.slPct, "%")}`);
  console.log(`  Yakuniy balans ($1,000 →) | ${("$" + modelA.finalBalanceUsd.toFixed(2)).padEnd(16)} | ${("$" + modelB.finalBalanceUsd.toFixed(2)).padEnd(17)} | ${delta(modelA.finalBalanceUsd, modelB.finalBalanceUsd, "$")}`);
  console.log(`  Sof foyda / zarar (%)     | ${((modelA.netPct >= 0 ? "+" : "") + modelA.netPct + "%").padEnd(16)} | ${((modelB.netPct >= 0 ? "+" : "") + modelB.netPct + "%").padEnd(17)} | ${delta(modelA.netPct, modelB.netPct, "%")}`);
  console.log(`  Profit Factor             | ${String(modelA.profitFactor).padEnd(16)} | ${String(modelB.profitFactor).padEnd(17)} | ${delta(modelA.profitFactor, modelB.profitFactor)}`);
  console.log(`  Max Drawdown              | ${("-" + modelA.maxDrawdownPct + "%").padEnd(16)} | ${("-" + modelB.maxDrawdownPct + "%").padEnd(17)} | ${delta(-modelA.maxDrawdownPct, -modelB.maxDrawdownPct, "%")}`);
  console.log(`  Komissiya + Slippage      | ${("-$" + modelA.totalFrictionUsd.toFixed(2)).padEnd(16)} | ${("-$" + modelB.totalFrictionUsd.toFixed(2)).padEnd(17)} | ${delta(-modelA.totalFrictionUsd, -modelB.totalFrictionUsd, "$")}`);
  console.log(`  Circuit Breaker himoyasi  | ${"0 marta (yo'q)".padEnd(16)} | ${String(modelB.cbTriggerCount + " marta (" + modelB.cbBlockedSignals + " blok)").padEnd(17)} | Faol 🛡️`);

  // ---------------------------------------------------------------------------
  // 2) HAFTAMA-HAFTA NATIJA (1-hafta -> 4-hafta) — STAGE 6.0 (YANGI)
  // ---------------------------------------------------------------------------
  console.log("\n===============================================================================");
  console.log("  2) STAGE 6.0 — HAFTAMA-HAFTA TAFSILOT (1-HAFTA → 4-HAFTA)");
  console.log("===============================================================================");
  console.log("  Hafta | Oraliq (UTC)            | Signallar | TP1+ | BE | SL | Haftalik PnL ($) | Portfel (%)");
  console.log("  ------+-------------------------+-----------+------+----+----+------------------+------------");
  const totalSpanMs = Math.max(1, endTs - startTs);
  const weekSpanMs = totalSpanMs / 4;
  for (let w = 0; w < 4; w++) {
    const wStart = startTs + w * weekSpanMs;
    const wEnd = w === 3 ? endTs + 1 : startTs + (w + 1) * weekSpanMs;
    const wt = modelB.trades.filter((tr) => tr.entryTs >= wStart && tr.entryTs < wEnd);
    const tp = wt.filter((x) => x.outcome === "TP3_HIT" || x.outcome === "TP2_TRAIL_WIN" || x.outcome === "EXPIRED_WIN").length;
    const be = wt.filter((x) => x.outcome === "BREAKEVEN_PROFIT").length;
    const sl = wt.filter((x) => x.outcome === "SL_HIT" || x.outcome === "EXPIRED_LOSS").length;
    const wNet = Number(wt.reduce((s, x) => s + x.netUsd, 0).toFixed(2));
    const wPct = Number(((wNet / STARTING_BALANCE_USD) * 100).toFixed(2));
    const rangeStr = `${new Date(wStart).toISOString().slice(5, 10)} → ${new Date(wEnd - 1).toISOString().slice(5, 10)}`;
    console.log(
      `  ${String(w + 1).padStart(5)} | ${rangeStr.padEnd(23)} | ${String(wt.length).padStart(9)} | ${String(tp + be).padStart(4)} | ${String(be).padStart(2)} | ${String(sl).padStart(2)} | ${((wNet >= 0 ? "+" : "") + "$" + wNet.toFixed(2)).padStart(16)} | ${((wPct >= 0 ? "+" : "") + wPct.toFixed(2) + "%").padStart(10)}`
    );
  }
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error("[FAIL] 30-Day A/B Replay Error:", err);
  process.exit(1);
});
