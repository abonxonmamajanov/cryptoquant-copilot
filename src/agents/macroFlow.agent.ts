import axios from "axios";
import { fetchMexcKlines, fetchMexcOrderBook } from "../services/mexcClient.service";
import { resilientHttpsAgent } from "../services/marketHealth.service";

export type TrendRegime = "BULLISH" | "NEUTRAL" | "BEARISH";

export interface MacroFlowResult {
  symbol: string;
  btcChange1hPct: number;
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

let cachedBtc1h: { pct: number; ts: number } | null = null;
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

async function detectTimeframeTrend(symbol: string, interval: "1h" | "4h"): Promise<TrendRegime> {
  try {
    const klines = await fetchMexcKlines(symbol, interval, 30);
    if (klines.length < 10) return "NEUTRAL";
    const closed = klines.slice(0, klines.length - 1);
    const closes = closed.map((k) => k.close);
    const ema9 = calcEma(closes, 9);
    const ema21 = calcEma(closes, 21);
    const last = closes[closes.length - 1];

    if (ema9 > ema21 * 1.001 && last >= ema9 * 0.998) return "BULLISH";
    if (ema9 < ema21 * 0.999 && last <= ema9 * 1.002) return "BEARISH";
    return "NEUTRAL";
  } catch {
    return "NEUTRAL";
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

async function getBtcChange1hPct(): Promise<number> {
  const now = Date.now();
  if (cachedBtc1h && now - cachedBtc1h.ts < 60_000) {
    return cachedBtc1h.pct;
  }
  try {
    const klines = await fetchMexcKlines("BTCUSDT", "1h", 3);
    const latest = klines[klines.length - 1];
    const pct =
      latest && latest.open > 0
        ? Number((((latest.close - latest.open) / latest.open) * 100).toFixed(2))
        : 0;
    cachedBtc1h = { pct, ts: now };
    return pct;
  } catch {
    return 0;
  }
}

export async function runMacroFlowAgent(symbol: string): Promise<MacroFlowResult> {
  const started = Date.now();
  const [book, binanceBook, btcChange1hPct, trend1h, trend4h, fundingRatePct] = await Promise.all([
    fetchMexcOrderBook(symbol, 20),
    fetchBinanceOrderBookDepth(symbol),
    getBtcChange1hPct(),
    detectTimeframeTrend(symbol, "1h"),
    detectTimeframeTrend(symbol, "4h"),
    getFundingRatePct(symbol)
  ]);

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
  if (bidAskRatio >= 1.15) macroScore += 18;
  else if (bidAskRatio < 0.75) macroScore -= 18;

  if (spreadPct <= 0.15) macroScore += 12;
  else if (spreadPct > 0.4) macroScore -= 20;

  if (btcChange1hPct >= 0.2) macroScore += 12;
  else if (btcChange1hPct <= -1.2) macroScore -= 25;

  if (trend1h === "BULLISH") macroScore += 6;
  else if (trend1h === "BEARISH") macroScore -= 8;

  if (trend4h === "BULLISH") macroScore += 6;
  else if (trend4h === "BEARISH") macroScore -= 8;

  macroScore = Math.max(0, Math.min(100, Math.round(macroScore)));

  let regime: TrendRegime = "NEUTRAL";
  if (btcChange1hPct <= -1.2 || (trend1h === "BEARISH" && trend4h === "BEARISH") || macroScore < 40) {
    regime = "BEARISH";
  } else if (macroScore >= 65) {
    regime = "BULLISH";
  }

  const summary = `BTC 1s: ${btcChange1hPct >= 0 ? "+" : ""}${btcChange1hPct}%, 1H/4H: ${trend1h}/${trend4h}, Bid/Ask: ${bidAskRatio}x (${exchanges.join("+")}), Spread: ${spreadPct}%`;

  return {
    symbol,
    btcChange1hPct,
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
