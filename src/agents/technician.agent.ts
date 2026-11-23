import { fetchMexcKlines } from "../services/mexcClient.service";
import { ScoutCandidate } from "./scout.agent";

export type TradeMode = "INTRADAY" | "SWING";

export interface TechnicalAnalysisResult {
  symbol: string;
  direction: "LONG" | "SKIP";
  tradeMode?: TradeMode;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  tp1Price?: number;
  tp2Price?: number;
  tp3Price?: number;
  riskRewardRatio: number;
  rsi14: number;
  adx14: number;
  isChoppyMarket: boolean;
  ema9: number;
  ema21: number;
  ema50?: number;
  ema21Rising?: boolean;
  stretchAboveEma21Pct?: number;
  atrPct?: number;
  isBullishCandle?: boolean;
  isPullbackReclaim?: boolean;
  tpSnappedToAskWall?: boolean;
  atr14: number;
  supportLevel: number;
  support10Level?: number;
  resistanceLevel: number;
  techScore: number;
  summary: string;
  latencyMs: number;
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

function calcRsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

/**
 * Standard Wilder ADX(14) series calculator.
 * Values < 20 indicate dead sideways/choppy market ("Cash is a position").
 */
export function calcAdxSeries(
  klines: Array<{ high: number; low: number; close: number }>,
  period = 14
): number[] {
  const n = klines.length;
  const out = new Array<number>(n).fill(25);
  if (n < period * 2) return out;

  const tr = new Array<number>(n).fill(0);
  const plusDm = new Array<number>(n).fill(0);
  const minusDm = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const curr = klines[i];
    const prev = klines[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
  }

  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  for (let i = 1; i <= period; i++) {
    smoothTr += tr[i];
    smoothPlus += plusDm[i];
    smoothMinus += minusDm[i];
  }

  const dx = new Array<number>(n).fill(0);
  for (let i = period; i < n; i++) {
    if (i > period) {
      smoothTr = smoothTr - smoothTr / period + tr[i];
      smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
      smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];
    }
    const plusDi = smoothTr > 0 ? (100 * smoothPlus) / smoothTr : 0;
    const minusDi = smoothTr > 0 ? (100 * smoothMinus) / smoothTr : 0;
    const diSum = plusDi + minusDi;
    dx[i] = diSum > 0 ? (100 * Math.abs(plusDi - minusDi)) / diSum : 0;
  }

  const firstAdxIdx = period * 2 - 1;
  let dxSum = 0;
  for (let i = period; i <= firstAdxIdx; i++) {
    dxSum += dx[i];
  }
  let adx = dxSum / period;
  out[firstAdxIdx] = Number(adx.toFixed(2));

  for (let i = firstAdxIdx + 1; i < n; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
    out[i] = Number(adx.toFixed(2));
  }

  return out;
}

export function calcAdx14(
  klines: Array<{ high: number; low: number; close: number }>
): number {
  if (klines.length === 0) return 25;
  const series = calcAdxSeries(klines, 14);
  return series[series.length - 1] ?? 25;
}

function roundPrice(price: number): number {
  if (price >= 100) return Number(price.toFixed(2));
  if (price >= 1) return Number(price.toFixed(4));
  if (price >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(7));
}

/**
 * Stage 6.1 Wall Street Asymmetric Exit Math + Strict SL/TP Mode Synchronizer & Ask-Wall Snapper.
 * - INTRADAY (15M): SL -1.6%..-2.5% | TP1=1.8R (60% close, SL -> -0.2R; -> +0.5R at 2.3R) | TP2=3.0R (40%) | TP3=4.0R
 * - SWING (4H):     SL -2.2%..-3.8% | TP1=2.0R (60% close, SL -> -0.2R; -> +0.5R at 2.3R) | TP2=3.4R (40%) | TP3=4.6R
 * Optionally snaps TP1 or TP2 0.2% below a major resting Ask wall while preserving
 * SL < Entry < TP1 < TP2 < TP3 and R:R >= 2.0.
 */
export function recomputeLevelsForMode(
  tech: TechnicalAnalysisResult,
  mode: TradeMode,
  majorAskWallPrice?: number | null
): TechnicalAnalysisResult {
  const entryPrice = tech.entryPrice;
  const roundedEntry = roundPrice(entryPrice);
  const atr14 = Math.max(0, tech.atr14);
  const support20 = tech.supportLevel > 0 ? tech.supportLevel : entryPrice * 0.98;
  const support10 =
    typeof tech.support10Level === "number" && tech.support10Level > 0
      ? tech.support10Level
      : support20;

  const mult1 = mode === "SWING" ? 2.0 : 1.8;
  const mult2 = mode === "SWING" ? 3.4 : 3.0;
  const mult3 = mode === "SWING" ? 4.6 : 4.0;

  let stopLossPrice: number;
  let riskPerUnit: number;

  if (mode === "SWING") {
    // Stage 6.1 SWING strict bounds: -2.2% .. -3.8%
    const swingAtrStop = entryPrice - Math.max(atr14 * 2.2, entryPrice * 0.022);
    const maxSwingFloor = entryPrice * 0.962; // strict -3.8% max risk
    const supportStop = support20 * 0.995;
    const rawStop = Math.max(maxSwingFloor, Math.min(swingAtrStop, supportStop));
    stopLossPrice = roundPrice(Math.min(rawStop, entryPrice * 0.978)); // strict -2.2% min risk
    riskPerUnit = Math.max(roundedEntry - stopLossPrice, roundedEntry * 0.008);
  } else {
    // Stage 6.1 INTRADAY strict bounds: -1.6% .. -2.5%
    const atrStop = entryPrice - Math.max(atr14 * 1.8, entryPrice * 0.016);
    const maxIntradayFloor = entryPrice * 0.975; // strict -2.5% max risk
    const supportStop = support10 * 0.996;
    const rawStop = Math.max(maxIntradayFloor, Math.min(atrStop, supportStop));
    stopLossPrice = roundPrice(Math.min(rawStop, entryPrice * 0.984)); // strict -1.6% min risk
    riskPerUnit = Math.max(roundedEntry - stopLossPrice, roundedEntry * 0.008);
  }

  let tp1Price = roundPrice(roundedEntry + riskPerUnit * mult1);
  let tp2Price = roundPrice(
    Math.max(roundedEntry + riskPerUnit * mult2, tp1Price * 1.005)
  );
  const tp3Price = roundPrice(
    Math.max(roundedEntry + riskPerUnit * mult3, tp2Price + riskPerUnit * 0.8, tp2Price * 1.008)
  );

  // Ask-Wall Liquidity Magnet TP Snapping (0.2% below major resting sell wall)
  let tpSnappedToAskWall = false;
  if (
    typeof majorAskWallPrice === "number" &&
    Number.isFinite(majorAskWallPrice) &&
    majorAskWallPrice >= roundedEntry * 1.012
  ) {
    const snapPrice = roundPrice(majorAskWallPrice * 0.998);
    // Prefer snapping TP2 if wall sits slightly below TP2 and R:R stays >= 2.0
    if (snapPrice > tp1Price && snapPrice < tp2Price) {
      const candidateRr = (snapPrice - roundedEntry) / riskPerUnit;
      if (
        candidateRr >= 2.0 &&
        stopLossPrice < roundedEntry &&
        roundedEntry < tp1Price &&
        tp1Price < snapPrice &&
        snapPrice < tp3Price
      ) {
        tp2Price = snapPrice;
        tpSnappedToAskWall = true;
      }
    } else if (snapPrice >= roundedEntry + riskPerUnit * 1.4 && snapPrice < tp1Price) {
      // Otherwise snap TP1 cleanly below a near-term sell wall while keeping TP1 >= 1.4R and TP2 R:R >= 2.0
      const tp2Rr = (tp2Price - roundedEntry) / riskPerUnit;
      if (
        tp2Rr >= 2.0 &&
        stopLossPrice < roundedEntry &&
        roundedEntry < snapPrice &&
        snapPrice < tp2Price &&
        tp2Price < tp3Price
      ) {
        tp1Price = snapPrice;
        tpSnappedToAskWall = true;
      }
    }
  }

  const takeProfitPrice = tp2Price;

  if (
    !(
      stopLossPrice < roundedEntry &&
      roundedEntry < tp1Price &&
      tp1Price < tp2Price &&
      tp2Price < tp3Price
    )
  ) {
    throw new Error(
      `Invalid TP/SL ordering for ${tech.symbol}: SL=${stopLossPrice}, Entry=${roundedEntry}, TP1=${tp1Price}, TP2=${tp2Price}, TP3=${tp3Price}`
    );
  }

  const riskRewardRatio = Number(((takeProfitPrice - roundedEntry) / riskPerUnit).toFixed(2));
  const adxTag = typeof tech.adx14 === "number" ? `, ADX=${tech.adx14}` : "";
  const summary =
    tech.direction === "LONG"
      ? `${mode} EMA9>21>50${tech.isPullbackReclaim ? " (Pullback-Reclaim)" : ""}${tpSnappedToAskWall ? " [Ask-Wall TP]" : ""}, RSI=${tech.rsi14}${adxTag}, R:R=1:${riskRewardRatio}`
      : tech.summary;

  return {
    ...tech,
    tradeMode: mode,
    entryPrice: roundedEntry,
    stopLossPrice,
    takeProfitPrice,
    tp1Price,
    tp2Price,
    tp3Price,
    riskRewardRatio,
    tpSnappedToAskWall,
    summary
  };
}

export async function runTechnicianAgent(
  candidate: ScoutCandidate,
  modeHint?: TradeMode
): Promise<TechnicalAnalysisResult> {
  const started = Date.now();
  const klines = await fetchMexcKlines(candidate.symbol, "15m", 80);
  const closed = klines.length > 2 ? klines.slice(0, klines.length - 1) : klines;
  const closes = closed.map((k) => k.close);

  const entryPrice = candidate.lastPrice;
  const rsi14 = calcRsi(closes, 14);
  const adx14 = calcAdx14(closed);
  const isChoppyMarket = adx14 < 20;
  const ema9Series = calcEmaSeries(closes, 9);
  const ema21Series = calcEmaSeries(closes, 21);
  const ema50Series = calcEmaSeries(closes, 50);

  const lastIdx = Math.max(0, closes.length - 1);
  const ema9 = ema9Series[lastIdx] ?? entryPrice;
  const ema21 = ema21Series[lastIdx] ?? entryPrice;
  const ema50 = ema50Series[lastIdx] ?? ema21;
  const ema21Prev3 = ema21Series[Math.max(0, lastIdx - 3)] ?? ema21;
  const ema21Rising = ema21 > ema21Prev3;

  // ATR(14)
  const trs: number[] = [];
  for (let i = 1; i < closed.length; i++) {
    const curr = closed[i];
    const prevClose = closed[i - 1].close;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prevClose),
      Math.abs(curr.low - prevClose)
    );
    trs.push(tr);
  }
  const recentTrs = trs.slice(-14);
  const atr14 = recentTrs.reduce((a, b) => a + b, 0) / Math.max(recentTrs.length, 1);

  const recent20 = closed.slice(-20);
  const recent10 = closed.slice(-10);
  const supportLevel = Math.min(...recent20.map((k) => k.low));
  const support10 = Math.min(...recent10.map((k) => k.low));
  const resistanceLevel = Math.max(...recent20.map((k) => k.high));

  const atrPct = entryPrice > 0 ? Number(((atr14 / entryPrice) * 100).toFixed(2)) : 0;
  const tradeMode: TradeMode =
    modeHint ??
    (ema9 > ema21 * 1.003 && ema21 > ema50 && rsi14 >= 44 && rsi14 <= 60 && atrPct >= 0.4
      ? "SWING"
      : "INTRADAY");

  // Stage 6.1 Pullback-Reclaim, ADX(14) & EMA50 Ribbon Structure Diagnostics
  const lastBar = closed[lastIdx];
  const prevBar = closed[Math.max(0, lastIdx - 1)];
  const stretchAboveEma21Pct =
    ema21 > 0 ? Number((((entryPrice - ema21) / ema21) * 100).toFixed(2)) : 0;
  const distAboveSupportPct = supportLevel > 0 ? ((entryPrice - supportLevel) / supportLevel) * 100 : 0;
  const distToEma9Pct = ema9 > 0 ? Math.abs((entryPrice - ema9) / ema9) * 100 : 0;

  const isBullishCandle = Boolean(lastBar && lastBar.close > lastBar.open);
  const recentDipLow = Math.min(lastBar?.low ?? entryPrice, prevBar?.low ?? entryPrice);
  const touchedEmaZone = recentDipLow <= ema9 * 1.004 && recentDipLow >= ema50 * 0.995;
  const reclaimedAboveEma9 =
    Boolean(lastBar && lastBar.close > ema9 && lastBar.close > lastBar.open) &&
    entryPrice >= ema9 * 0.998;
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

  // Stage 6.0/6.1 Precision RSI sweet spot (42..60)
  if (rsi14 >= 44 && rsi14 <= 60) techScore += 20;
  else if (rsi14 >= 42 && rsi14 < 44) techScore += 12;
  else if (rsi14 > 60 && rsi14 <= 65) techScore += 2;
  else if (rsi14 > 65 || rsi14 < 38) techScore -= 18;

  // Stage 6.1 ADX trend strength adjustment
  if (adx14 >= 25) techScore += 4;
  else if (isChoppyMarket) techScore -= 12;

  if (distToEma9Pct <= 1.2 && stretchAboveEma21Pct <= 2.2) techScore += 8;
  else if (stretchAboveEma21Pct > 2.2) techScore -= 16;

  if (distAboveSupportPct <= 3.5) techScore += 4;
  techScore += 6; // base asymmetric R:R >= 3.0 bonus
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));

  // Strict LONG qualification: full bullish ribbon (EMA9 > EMA21 > EMA50), rising EMA21, reclaiming EMA9, RSI 42..60
  const isBullishTrend =
    ema9 > ema21 &&
    ema21 > ema50 &&
    ema21Rising &&
    entryPrice >= ema9 * 0.998 &&
    rsi14 >= 42 &&
    rsi14 <= 60 &&
    stretchAboveEma21Pct <= 2.4;
  const direction: "LONG" | "SKIP" = isBullishTrend ? "LONG" : "SKIP";

  const baseResult: TechnicalAnalysisResult = {
    symbol: candidate.symbol,
    direction,
    tradeMode,
    entryPrice: roundPrice(entryPrice),
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
    stretchAboveEma21Pct,
    atrPct,
    isBullishCandle,
    isPullbackReclaim,
    tpSnappedToAskWall: false,
    atr14: roundPrice(atr14),
    supportLevel: roundPrice(supportLevel),
    support10Level: roundPrice(support10),
    resistanceLevel: roundPrice(resistanceLevel),
    techScore,
    summary: `Texnik tuzilma zaif (RSI=${rsi14}, ADX=${adx14}, EMA9=${roundPrice(ema9)} / EMA21=${roundPrice(ema21)} / EMA50=${roundPrice(ema50)})`,
    latencyMs: Date.now() - started
  };

  return recomputeLevelsForMode(baseResult, tradeMode);
}
