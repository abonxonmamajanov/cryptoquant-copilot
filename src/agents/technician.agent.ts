import { fetchMexcKlines } from "../services/mexcClient.service";
import { ScoutCandidate } from "./scout.agent";

export interface TechnicalAnalysisResult {
  symbol: string;
  direction: "LONG" | "SKIP";
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  rsi14: number;
  ema9: number;
  ema21: number;
  atr14: number;
  supportLevel: number;
  resistanceLevel: number;
  techScore: number;
  summary: string;
  latencyMs: number;
}

function calcEma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
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

export async function runTechnicianAgent(candidate: ScoutCandidate): Promise<TechnicalAnalysisResult> {
  const started = Date.now();
  const klines = await fetchMexcKlines(candidate.symbol, "15m", 60);
  const closed = klines.length > 2 ? klines.slice(0, klines.length - 1) : klines;
  const closes = closed.map((k) => k.close);

  const entryPrice = candidate.lastPrice;
  const rsi14 = calcRsi(closes, 14);
  const ema9 = calcEma(closes, 9);
  const ema21 = calcEma(closes, 21);

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
  const supportLevel = Math.min(...recent20.map((k) => k.low));
  const resistanceLevel = Math.max(...recent20.map((k) => k.high));

  // Risk & Target levels
  const atrStop = entryPrice - Math.max(atr14 * 1.5, entryPrice * 0.012);
  const supportStop = supportLevel * 0.996;
  const rawStop = Math.max(atrStop, supportStop);
  const stopLossPrice = roundPrice(Math.min(rawStop, entryPrice * 0.988));

  const riskPerUnit = Math.max(entryPrice - stopLossPrice, entryPrice * 0.005);
  const targetByRR = entryPrice + riskPerUnit * 2.4;
  const takeProfitPrice = roundPrice(Math.max(targetByRR, resistanceLevel * 1.01));
  const riskRewardRatio = Number(((takeProfitPrice - entryPrice) / riskPerUnit).toFixed(2));

  // Score (0-100)
  let techScore = 40;
  if (ema9 > ema21) techScore += 20;
  if (entryPrice >= ema9) techScore += 10;
  if (rsi14 >= 42 && rsi14 <= 68) techScore += 20;
  else if (rsi14 > 76) techScore -= 25;
  if (riskRewardRatio >= 2.0) techScore += 10;
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));

  const isBullishTrend = ema9 >= ema21 * 0.997 && rsi14 <= 76 && rsi14 >= 32;
  const direction: "LONG" | "SKIP" = isBullishTrend ? "LONG" : "SKIP";

  const summary =
    direction === "LONG"
      ? `EMA9/21 ijobiy, RSI=${rsi14}, R:R=1:${riskRewardRatio}`
      : `Texnik shart yetarli emas (RSI=${rsi14}, EMA9=${roundPrice(ema9)} vs EMA21=${roundPrice(ema21)})`;

  return {
    symbol: candidate.symbol,
    direction,
    entryPrice: roundPrice(entryPrice),
    stopLossPrice,
    takeProfitPrice,
    riskRewardRatio,
    rsi14,
    ema9: roundPrice(ema9),
    ema21: roundPrice(ema21),
    atr14: roundPrice(atr14),
    supportLevel: roundPrice(supportLevel),
    resistanceLevel: roundPrice(resistanceLevel),
    techScore,
    summary,
    latencyMs: Date.now() - started
  };
}
