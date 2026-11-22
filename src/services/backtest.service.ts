import { fetchMexcKlines } from "./mexcClient.service";
import { isFilteredOutSymbol } from "../agents/scout.agent";

export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  outcome: "TP_HIT" | "SL_HIT" | "EXPIRED";
  pnlPct: number;
}

export interface BacktestResult {
  symbol: string;
  interval: "15m";
  candlesAnalyzed: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netPnlPct: number;
  maxDrawdownPct: number;
  trades: BacktestTrade[];
  generatedAt: string;
}

function calcEmaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[i] : values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function calcRsiAt(closes: number[], endIdx: number, period = 14): number {
  if (endIdx < period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export async function runHistoricalBacktest(
  rawSymbol: string,
  limit = 240
): Promise<BacktestResult> {
  const symbol = rawSymbol.toUpperCase().trim();
  if (isFilteredOutSymbol(symbol)) {
    throw new Error(`Symbol ${symbol} is filtered out (stablecoin, leveraged token, or non-USDT).`);
  }

  const safeLimit = Math.max(80, Math.min(500, limit));
  const klines = await fetchMexcKlines(symbol, "15m", safeLimit);
  if (klines.length < 60) {
    throw new Error(`Insufficient historical candles for ${symbol}: ${klines.length}`);
  }

  const closes = klines.map((k) => k.close);
  const ema9 = calcEmaSeries(closes, 9);
  const ema21 = calcEmaSeries(closes, 21);
  const ema50 = calcEmaSeries(closes, 50);

  // ATR(14) series
  const trs: number[] = [0];
  for (let idx = 1; idx < klines.length; idx++) {
    const c = klines[idx];
    const pc = klines[idx - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }

  const trades: BacktestTrade[] = [];
  let i = 52;
  let equity = 100;
  let peak = 100;
  let maxDd = 0;

  while (i < klines.length - 8) {
    const bar = klines[i];
    const prev = klines[i - 1];
    const rsi = calcRsiAt(closes, i, 14);
    const stretchPct = ema21[i] > 0 ? ((bar.close - ema21[i]) / ema21[i]) * 100 : 0;

    // Stage 5.9 Entry: Full bullish ribbon (EMA9 > EMA21 > EMA50), rising EMA21, pullback touch near EMA9/21 + green reclaim
    const ribbonBullish = ema9[i] > ema21[i] && ema21[i] > ema50[i] && ema21[i] > ema21[i - 3];
    const dipLow = Math.min(bar.low, prev.low);
    const touchedZone = dipLow <= ema9[i] * 1.004 && dipLow >= ema50[i] * 0.995;
    const greenReclaim = bar.close > ema9[i] && bar.close > bar.open;
    const entrySignal =
      ribbonBullish &&
      touchedZone &&
      greenReclaim &&
      rsi >= 42 &&
      rsi <= 64 &&
      stretchPct >= 0 &&
      stretchPct <= 2.2;

    if (!entrySignal) {
      i++;
      continue;
    }

    const entryPrice = bar.close;
    let atrSum = 0;
    for (let k = i - 13; k <= i; k++) atrSum += trs[k];
    const atr14 = atrSum / 14;
    const recentLow = Math.min(...klines.slice(i - 9, i + 1).map((k) => k.low));
    const atrStop = entryPrice - Math.max(atr14 * 1.8, entryPrice * 0.015);
    const supStop = recentLow * 0.996;
    const stopLoss = Math.min(Math.max(entryPrice * 0.97, Math.min(atrStop, supStop)), entryPrice * 0.985);
    const risk = Math.max(entryPrice - stopLoss, entryPrice * 0.008);
    const tp1 = entryPrice + risk * 1.2;
    const tp2 = entryPrice + risk * 2.2;
    const tp3 = entryPrice + risk * 3.3;

    let activeSl = stopLoss;
    let tp1Hit = false;
    let tp2Hit = false;
    let outcome: "TP_HIT" | "SL_HIT" | "EXPIRED" = "EXPIRED";
    let exitIdx = Math.min(i + 48, klines.length - 1);
    let exitPrice = closes[exitIdx];
    let realizedPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    const tp1Pct = ((tp1 - entryPrice) / entryPrice) * 100;
    const tp2Pct = ((tp2 - entryPrice) / entryPrice) * 100;
    const tp3Pct = ((tp3 - entryPrice) / entryPrice) * 100;

    for (let j = i + 1; j <= Math.min(i + 48, klines.length - 1); j++) {
      const candle = klines[j];
      if (candle.low <= activeSl) {
        exitIdx = j;
        exitPrice = activeSl;
        if (tp2Hit) {
          outcome = "TP_HIT";
          realizedPnlPct = 0.4 * tp1Pct + 0.35 * tp2Pct + 0.25 * tp1Pct;
        } else if (tp1Hit) {
          outcome = "TP_HIT";
          realizedPnlPct = 0.4 * tp1Pct;
        } else {
          outcome = "SL_HIT";
          realizedPnlPct = ((activeSl - entryPrice) / entryPrice) * 100;
        }
        break;
      }
      if (candle.high >= tp3) {
        exitIdx = j;
        exitPrice = tp3;
        outcome = "TP_HIT";
        realizedPnlPct = 0.4 * tp1Pct + 0.35 * tp2Pct + 0.25 * tp3Pct;
        break;
      }
      if (!tp2Hit && candle.high >= tp2) {
        tp1Hit = true;
        tp2Hit = true;
        activeSl = tp1;
      } else if (!tp1Hit && candle.high >= tp1) {
        tp1Hit = true;
        activeSl = entryPrice;
      }
    }

    if (outcome === "EXPIRED") {
      const remPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      if (tp2Hit) realizedPnlPct = 0.4 * tp1Pct + 0.35 * tp2Pct + 0.25 * remPct;
      else if (tp1Hit) realizedPnlPct = 0.4 * tp1Pct + 0.6 * remPct;
      else realizedPnlPct = remPct;
    }

    const pnlPct = Number(realizedPnlPct.toFixed(2));
    trades.push({
      entryIndex: i,
      exitIndex: exitIdx,
      entryPrice,
      exitPrice,
      outcome,
      pnlPct
    });

    equity = equity * (1 + pnlPct / 100);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;

    i = exitIdx + (outcome === "SL_HIT" ? 8 : 4); // longer cooldown after SL
  }

  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const losses = trades.filter((t) => t.pnlPct <= 0).length;
  const winRatePct = trades.length > 0 ? Number(((wins / trades.length) * 100).toFixed(1)) : 0;
  const netPnlPct = Number((equity - 100).toFixed(2));

  return {
    symbol,
    interval: "15m",
    candlesAnalyzed: klines.length,
    totalTrades: trades.length,
    wins,
    losses,
    winRatePct,
    netPnlPct,
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    trades: trades.slice(-20),
    generatedAt: new Date().toISOString()
  };
}
