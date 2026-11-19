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
  if (klines.length < 50) {
    throw new Error(`Insufficient historical candles for ${symbol}: ${klines.length}`);
  }

  const closes = klines.map((k) => k.close);
  const ema9 = calcEmaSeries(closes, 9);
  const ema21 = calcEmaSeries(closes, 21);

  const trades: BacktestTrade[] = [];
  let i = 25;
  let equity = 100;
  let peak = 100;
  let maxDd = 0;

  while (i < klines.length - 12) {
    const rsi = calcRsiAt(closes, i, 14);
    const avgVol =
      klines.slice(i - 20, i).reduce((sum, k) => sum + k.quoteAssetVolume, 0) / 20;
    const volSpike = avgVol > 0 ? klines[i].quoteAssetVolume / avgVol : 0;

    // Entry condition mirroring Scout + Technician + Critic core logic
    const entrySignal =
      ema9[i] > ema21[i] &&
      closes[i] > ema9[i] &&
      rsi >= 45 &&
      rsi <= 68 &&
      volSpike >= 1.6;

    if (!entrySignal) {
      i++;
      continue;
    }

    const entryPrice = closes[i];
    const recentLow = Math.min(...klines.slice(i - 10, i + 1).map((k) => k.low));
    const stopLoss = Math.min(recentLow * 0.996, entryPrice * 0.986);
    const risk = Math.max(entryPrice - stopLoss, entryPrice * 0.008);
    const takeProfit = entryPrice + risk * 2.2;

    let outcome: "TP_HIT" | "SL_HIT" | "EXPIRED" = "EXPIRED";
    let exitPrice = closes[Math.min(i + 24, klines.length - 1)];
    let exitIdx = Math.min(i + 24, klines.length - 1);

    for (let j = i + 1; j <= Math.min(i + 24, klines.length - 1); j++) {
      if (klines[j].low <= stopLoss) {
        outcome = "SL_HIT";
        exitPrice = stopLoss;
        exitIdx = j;
        break;
      }
      if (klines[j].high >= takeProfit) {
        outcome = "TP_HIT";
        exitPrice = takeProfit;
        exitIdx = j;
        break;
      }
    }

    const pnlPct = Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2));
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

    i = exitIdx + 2; // cooldown bars before next setup
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
