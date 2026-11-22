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
  ema9: number;
  ema21: number;
  ema50?: number;
  ema21Rising?: boolean;
  stretchAboveEma21Pct?: number;
  atrPct?: number;
  isBullishCandle?: boolean;
  isPullbackReclaim?: boolean;
  atr14: number;
  supportLevel: number;
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

function roundPrice(price: number): number {
  if (price >= 100) return Number(price.toFixed(2));
  if (price >= 1) return Number(price.toFixed(4));
  if (price >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(7));
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
    (ema9 > ema21 * 1.003 && ema21 > ema50 && rsi14 >= 44 && rsi14 <= 64 && atrPct >= 0.4
      ? "SWING"
      : "INTRADAY");

  const roundedEntry = roundPrice(entryPrice);
  const mult1 = tradeMode === "SWING" ? 1.4 : 1.2;
  const mult2 = tradeMode === "SWING" ? 2.5 : 2.2;
  const mult3 = tradeMode === "SWING" ? 3.8 : 3.3;

  let stopLossPrice: number;
  let riskPerUnit: number;

  if (tradeMode === "SWING") {
    const swingAtrStop = entryPrice - Math.max(atr14 * 2.2, entryPrice * 0.02);
    const maxSwingFloor = entryPrice * 0.958; // max -4.2%
    const supportStop = supportLevel * 0.995;
    // Volatility-respecting wider stop bounded by maxSwingFloor and -2.0% ceiling
    const rawStop = Math.max(maxSwingFloor, Math.min(swingAtrStop, supportStop));
    stopLossPrice = roundPrice(Math.min(rawStop, entryPrice * 0.98));
    riskPerUnit = Math.max(roundedEntry - stopLossPrice, roundedEntry * 0.008);
  } else {
    // Stage 5.9 fix: use Math.min(atrStop, supportStop) bounded by -3.0% floor and -1.5% ceiling
    // (previously Math.max collapsed almost every intraday stop onto -1.20% noise)
    const atrStop = entryPrice - Math.max(atr14 * 1.8, entryPrice * 0.015);
    const maxIntradayFloor = entryPrice * 0.97; // max -3.0%
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

  if (
    !(
      stopLossPrice < roundedEntry &&
      roundedEntry < tp1Price &&
      tp1Price < tp2Price &&
      tp2Price < tp3Price
    )
  ) {
    throw new Error(
      `Invalid TP/SL ordering for ${candidate.symbol}: SL=${stopLossPrice}, Entry=${roundedEntry}, TP1=${tp1Price}, TP2=${tp2Price}, TP3=${tp3Price}`
    );
  }

  const riskRewardRatio = Number(((takeProfitPrice - roundedEntry) / riskPerUnit).toFixed(2));

  // Stage 5.9 Pullback-Reclaim & EMA50 Ribbon Structure Diagnostics
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

  // Reward healthy RSI sweet spot (44..64)
  if (rsi14 >= 44 && rsi14 <= 64) techScore += 18;
  else if (rsi14 >= 40 && rsi14 < 44) techScore += 8;
  else if (rsi14 > 64 && rsi14 <= 68) techScore += 4;
  else if (rsi14 > 70 || rsi14 < 38) techScore -= 18;

  // Reward price close to EMA9/Support and penalize >2.2% stretch above EMA21
  if (distToEma9Pct <= 1.2 && stretchAboveEma21Pct <= 2.2) techScore += 8;
  else if (stretchAboveEma21Pct > 2.2) techScore -= 16;

  if (distAboveSupportPct <= 3.5) techScore += 4;
  if (riskRewardRatio >= 2.2) techScore += 6;
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));

  // Strict LONG qualification: full bullish ribbon (EMA9 > EMA21 > EMA50), rising EMA21, price reclaiming EMA9, non-overheated RSI
  const isBullishTrend =
    ema9 > ema21 &&
    ema21 > ema50 &&
    ema21Rising &&
    entryPrice >= ema9 * 0.998 &&
    rsi14 >= 42 &&
    rsi14 <= 66 &&
    stretchAboveEma21Pct <= 2.4;
  const direction: "LONG" | "SKIP" = isBullishTrend ? "LONG" : "SKIP";

  const summary =
    direction === "LONG"
      ? `${tradeMode} EMA9>21>50${isPullbackReclaim ? " (Pullback-Reclaim)" : ""}, RSI=${rsi14}, R:R=1:${riskRewardRatio}`
      : `Texnik tuzilma zaif (RSI=${rsi14}, EMA9=${roundPrice(ema9)} / EMA21=${roundPrice(ema21)} / EMA50=${roundPrice(ema50)})`;

  return {
    symbol: candidate.symbol,
    direction,
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
    summary,
    latencyMs: Date.now() - started
  };
}
