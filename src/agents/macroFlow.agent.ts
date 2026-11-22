import axios from "axios";
import { fetchMexcKlines, fetchMexcOrderBook } from "../services/mexcClient.service";
import { resilientHttpsAgent } from "../services/marketHealth.service";

export type TrendRegime = "BULLISH" | "NEUTRAL" | "BEARISH";

export interface MacroFlowResult {
  symbol: string;
  btcChange1hPct: number;
  btcTrend1h?: TrendRegime;
  btcTrend4h?: TrendRegime;
  btcAbove4hEma50?: boolean;
  above4hEma50?: boolean;
  bidDepthUsd: number;
  askDepthUsd: number;
  bidAskRatio: number;
  spreadPct: number;
  regime: TrendRegime;
  trend1h?: TrendRegime;
  trend4h?: TrendRegime;
  fundingRatePct?: number | null;
  exchanges?: string[];
  macroScore: number;
  summary: string;
  latencyMs: number;
}

interface BtcMacroSnapshot {
  change1hPct: number;
  trend1h: TrendRegime;
  trend4h: TrendRegime;
  above4hEma50: boolean;
  ts: number;
}

let cachedBtcMacro: BtcMacroSnapshot | null = null;
const fundingCache = new Map<string, { ratePct: number | null; ts: number }>();

function calcEma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

async function detectTimeframeTrend(
  symbol: string,
  interval: "1h" | "4h"
): Promise<{ regime: TrendRegime; aboveEma50: boolean }> {
  try {
    const limit = interval === "4h" ? 65 : 40;
    const klines = await fetchMexcKlines(symbol, interval, limit);
    if (klines.length < 10) return { regime: "NEUTRAL", aboveEma50: true };
    const closed = klines.slice(0, klines.length - 1);
    const closes = closed.map((k) => k.close);
    const ema9 = calcEma(closes, 9);
    const ema21 = calcEma(closes, 21);
    const ema50 = calcEma(closes, 50);
    const last = closes[closes.length - 1];
    const aboveEma50 = closes.length >= 45 ? last > ema50 && ema21 >= ema50 * 0.995 : true;

    if (ema9 > ema21 * 1.001 && last >= ema9 * 0.998) return { regime: "BULLISH", aboveEma50 };
    if (ema9 < ema21 * 0.999 && last <= ema9 * 1.002) return { regime: "BEARISH", aboveEma50 };
    return { regime: "NEUTRAL", aboveEma50 };
  } catch {
    return { regime: "NEUTRAL", aboveEma50: true };
  }
}

async function fetchBinanceOrderBookDepth(
  symbol: string
): Promise<{ bidUsd: number; askUsd: number } | null> {
  try {
    const res = await axios.get<{
      bids?: Array<[string, string]>;
      asks?: Array<[string, string]>;
    }>(`https://api.binance.com/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=20`, {
      timeout: 2500,
      httpsAgent: resilientHttpsAgent
    });
    const bids = res.data?.bids ?? [];
    const asks = res.data?.asks ?? [];
    if (bids.length === 0 || asks.length === 0) return null;
    const bidUsd = bids.reduce((sum, [p, q]) => sum + Number(p) * Number(q), 0);
    const askUsd = asks.reduce((sum, [p, q]) => sum + Number(p) * Number(q), 0);
    if (!Number.isFinite(bidUsd) || !Number.isFinite(askUsd)) return null;
    return { bidUsd, askUsd };
  } catch {
    return null;
  }
}

async function getFundingRatePct(symbol: string): Promise<number | null> {
  const now = Date.now();
  const hit = fundingCache.get(symbol);
  if (hit && now - hit.ts < 5 * 60 * 1000) {
    return hit.ratePct;
  }
  try {
    const res = await axios.get<{ lastFundingRate?: string }>(
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,
      { timeout: 3000, httpsAgent: resilientHttpsAgent }
    );
    const raw = Number(res.data?.lastFundingRate);
    const ratePct = Number.isFinite(raw) ? Number((raw * 100).toFixed(4)) : null;
    fundingCache.set(symbol, { ratePct, ts: now });
    return ratePct;
  } catch {
    fundingCache.set(symbol, { ratePct: null, ts: now });
    return null;
  }
}

async function getBtcMacroState(): Promise<BtcMacroSnapshot> {
  const now = Date.now();
  if (cachedBtcMacro && now - cachedBtcMacro.ts < 60_000) {
    return cachedBtcMacro;
  }
  try {
    const [k15, t1h, t4h] = await Promise.all([
      fetchMexcKlines("BTCUSDT", "15m", 6),
      detectTimeframeTrend("BTCUSDT", "1h"),
      detectTimeframeTrend("BTCUSDT", "4h")
    ]);
    // True rolling 60-minute BTC move (avoids 1-minute-old 0.00% hourly candle blind spot)
    let change1hPct = 0;
    if (k15.length >= 5) {
      const latestClose = k15[k15.length - 1].close;
      const hourAgoClose = k15[k15.length - 5].close;
      if (hourAgoClose > 0) {
        change1hPct = Number((((latestClose - hourAgoClose) / hourAgoClose) * 100).toFixed(2));
      }
    }
    cachedBtcMacro = {
      change1hPct,
      trend1h: t1h.regime,
      trend4h: t4h.regime,
      above4hEma50: t4h.aboveEma50,
      ts: now
    };
    return cachedBtcMacro;
  } catch {
    return (
      cachedBtcMacro ?? {
        change1hPct: 0,
        trend1h: "NEUTRAL",
        trend4h: "NEUTRAL",
        above4hEma50: true,
        ts: now
      }
    );
  }
}

export async function runMacroFlowAgent(symbol: string): Promise<MacroFlowResult> {
  const started = Date.now();
  const [book, binanceBook, btcMacro, trend1hInfo, trend4hInfo, fundingRatePct] = await Promise.all([
    fetchMexcOrderBook(symbol, 20),
    fetchBinanceOrderBookDepth(symbol),
    getBtcMacroState(),
    detectTimeframeTrend(symbol, "1h"),
    detectTimeframeTrend(symbol, "4h"),
    getFundingRatePct(symbol)
  ]);

  const trend1h = trend1hInfo.regime;
  const trend4h = trend4hInfo.regime;
  const above4hEma50 = trend4hInfo.aboveEma50;
  const btcChange1hPct = btcMacro.change1hPct;

  const mexcBidUsd = book.bids.reduce((sum, [p, q]) => sum + p * q, 0);
  const mexcAskUsd = book.asks.reduce((sum, [p, q]) => sum + p * q, 0);

  const exchanges: string[] = ["MEXC"];
  let totalBidUsd = mexcBidUsd;
  let totalAskUsd = mexcAskUsd;
  if (binanceBook) {
    exchanges.push("Binance");
    totalBidUsd += binanceBook.bidUsd;
    totalAskUsd += binanceBook.askUsd;
  }

  const bidDepthUsd = Math.round(totalBidUsd);
  const askDepthUsd = Math.round(totalAskUsd);
  const bidAskRatio = askDepthUsd > 0 ? Number((bidDepthUsd / askDepthUsd).toFixed(2)) : 1;

  const bestBid = book.bids[0]?.[0] ?? 0;
  const bestAsk = book.asks[0]?.[0] ?? 0;
  const spreadPct =
    bestBid > 0 && bestAsk > 0 ? Number((((bestAsk - bestBid) / bestBid) * 100).toFixed(3)) : 0;

  let macroScore = 50;
  if (bidAskRatio >= 1.15) macroScore += 16;
  else if (bidAskRatio < 0.75) macroScore -= 20;

  if (spreadPct <= 0.15) macroScore += 10;
  else if (spreadPct > 0.35) macroScore -= 20;

  if (btcChange1hPct >= 0.2) macroScore += 10;
  else if (btcChange1hPct <= -0.6) macroScore -= 22;

  if (btcMacro.trend1h === "BEARISH" && btcMacro.trend4h === "BEARISH") {
    macroScore -= 18;
  } else if (btcMacro.trend1h === "BULLISH" && btcMacro.trend4h === "BULLISH") {
    macroScore += 8;
  }

  if (trend1h === "BULLISH") macroScore += 7;
  else if (trend1h === "BEARISH") macroScore -= 12;

  if (trend4h === "BULLISH") macroScore += 7;
  else if (trend4h === "BEARISH") macroScore -= 12;

  if (above4hEma50) macroScore += 4;

  macroScore = Math.max(0, Math.min(100, Math.round(macroScore)));

  let regime: TrendRegime = "NEUTRAL";
  if (
    btcChange1hPct <= -0.6 ||
    (btcMacro.trend1h === "BEARISH" && btcMacro.trend4h === "BEARISH") ||
    trend1h === "BEARISH" ||
    trend4h === "BEARISH" ||
    macroScore < 42
  ) {
    regime = "BEARISH";
  } else if (macroScore >= 65) {
    regime = "BULLISH";
  }

  const summary = `BTC 1s: ${btcChange1hPct >= 0 ? "+" : ""}${btcChange1hPct}% (${btcMacro.trend1h}/${btcMacro.trend4h}), 1H/4H: ${trend1h}/${trend4h}, Bid/Ask: ${bidAskRatio}x (${exchanges.join("+")}), Spread: ${spreadPct}%`;

  return {
    symbol,
    btcChange1hPct,
    btcTrend1h: btcMacro.trend1h,
    btcTrend4h: btcMacro.trend4h,
    btcAbove4hEma50: btcMacro.above4hEma50,
    above4hEma50,
    bidDepthUsd,
    askDepthUsd,
    bidAskRatio,
    spreadPct,
    regime,
    trend1h,
    trend4h,
    fundingRatePct,
    exchanges,
    macroScore,
    summary,
    latencyMs: Date.now() - started
  };
}
