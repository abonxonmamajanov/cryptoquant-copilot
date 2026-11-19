import { fetchMexcKlines, fetchMexcOrderBook } from "../services/mexcClient.service";

export interface MacroFlowResult {
  symbol: string;
  btcChange1hPct: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  bidAskRatio: number;
  spreadPct: number;
  regime: "BULLISH" | "NEUTRAL" | "BEARISH";
  macroScore: number;
  summary: string;
  latencyMs: number;
}

let cachedBtc1h: { pct: number; ts: number } | null = null;

async function getBtcChange1hPct(): Promise<number> {
  const now = Date.now();
  if (cachedBtc1h && now - cachedBtc1h.ts < 60_000) {
    return cachedBtc1h.pct;
  }
  try {
    const klines = await fetchMexcKlines("BTCUSDT", "1h", 3);
    const latest = klines[klines.length - 1];
    const pct = latest && latest.open > 0 ? Number((((latest.close - latest.open) / latest.open) * 100).toFixed(2)) : 0;
    cachedBtc1h = { pct, ts: now };
    return pct;
  } catch {
    return 0;
  }
}

export async function runMacroFlowAgent(symbol: string): Promise<MacroFlowResult> {
  const started = Date.now();
  const [book, btcChange1hPct] = await Promise.all([
    fetchMexcOrderBook(symbol, 20),
    getBtcChange1hPct()
  ]);

  const bidDepthUsd = Math.round(book.bids.reduce((sum, [p, q]) => sum + p * q, 0));
  const askDepthUsd = Math.round(book.asks.reduce((sum, [p, q]) => sum + p * q, 0));
  const bidAskRatio = askDepthUsd > 0 ? Number((bidDepthUsd / askDepthUsd).toFixed(2)) : 1;

  const bestBid = book.bids[0]?.[0] ?? 0;
  const bestAsk = book.asks[0]?.[0] ?? 0;
  const spreadPct = bestBid > 0 && bestAsk > 0 ? Number((((bestAsk - bestBid) / bestBid) * 100).toFixed(3)) : 0;

  let macroScore = 50;
  if (bidAskRatio >= 1.15) macroScore += 20;
  else if (bidAskRatio < 0.75) macroScore -= 20;

  if (spreadPct <= 0.15) macroScore += 15;
  else if (spreadPct > 0.4) macroScore -= 25;

  if (btcChange1hPct >= 0.2) macroScore += 15;
  else if (btcChange1hPct <= -1.2) macroScore -= 30;

  macroScore = Math.max(0, Math.min(100, Math.round(macroScore)));

  let regime: "BULLISH" | "NEUTRAL" | "BEARISH" = "NEUTRAL";
  if (btcChange1hPct <= -1.2 || macroScore < 40) regime = "BEARISH";
  else if (macroScore >= 65) regime = "BULLISH";

  const summary = `BTC 1s: ${btcChange1hPct >= 0 ? "+" : ""}${btcChange1hPct}%, Bid/Ask: ${bidAskRatio}x, Spread: ${spreadPct}%`;

  return {
    symbol,
    btcChange1hPct,
    bidDepthUsd,
    askDepthUsd,
    bidAskRatio,
    spreadPct,
    regime,
    macroScore,
    summary,
    latencyMs: Date.now() - started
  };
}
