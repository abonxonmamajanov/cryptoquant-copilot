import {
  fetchMexcOrderBook,
  fetchMexcRecentTrades,
  MexcOrderBook
} from "./mexcClient.service";

export interface OrderFlowReport {
  symbol: string;
  midPrice: number;
  weightedObiRatio: number; // weightedBidsUsd / weightedAsksUsd
  weightedBidsUsd: number;
  weightedAsksUsd: number;
  takerBuyUsd: number;
  takerSellUsd: number;
  takerBuyPct: number; // 0-100%
  cvdUsd: number; // takerBuyUsd - takerSellUsd
  majorBidWallPrice: number | null;
  majorBidWallUsd: number;
  majorAskWallPrice: number | null;
  majorAskWallUsd: number;
  isSpoofingDetected: boolean;
  spoofReasonUz: string | null;
  spoofChecked: boolean;
  degraded: boolean;
  latencyMs: number;
}

const SPOOF_WAIT_MS = 2500;
const SPOOF_SHRINK_THRESHOLD = 0.6; // >= 60% shrink without price dropping through level

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMidPrice(book: MexcOrderBook): number {
  const bestBid = book.bids[0]?.[0] ?? 0;
  const bestAsk = book.asks[0]?.[0] ?? 0;
  if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;
  return bestBid || bestAsk || 0;
}

function computeDistanceWeight(distPct: number): number {
  if (distPct <= 0.5) return 5;
  if (distPct <= 1.0) return 3;
  if (distPct <= 2.0) return 1;
  return 0;
}

function computeWeightedObi(
  book: MexcOrderBook,
  midPrice: number
): { weightedBidsUsd: number; weightedAsksUsd: number; weightedObiRatio: number } {
  if (midPrice <= 0) {
    return { weightedBidsUsd: 0, weightedAsksUsd: 0, weightedObiRatio: 1 };
  }

  let weightedBids = 0;
  let weightedAsks = 0;
  let rawBids = 0;
  let rawAsks = 0;

  for (const [price, qty] of book.bids) {
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;
    const usd = price * qty;
    rawBids += usd;
    const distPct = Math.abs((midPrice - price) / midPrice) * 100;
    const w = computeDistanceWeight(distPct);
    if (w > 0) weightedBids += usd * w;
  }

  for (const [price, qty] of book.asks) {
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;
    const usd = price * qty;
    rawAsks += usd;
    const distPct = Math.abs((price - midPrice) / midPrice) * 100;
    const w = computeDistanceWeight(distPct);
    if (w > 0) weightedAsks += usd * w;
  }

  // Fallback to unweighted book if extreme spread puts all quotes outside ±2%
  const finalBids = weightedBids > 0 ? weightedBids : rawBids;
  const finalAsks = weightedAsks > 0 ? weightedAsks : rawAsks;
  const ratio = finalAsks > 0 ? Number((finalBids / finalAsks).toFixed(2)) : 1;

  return {
    weightedBidsUsd: Math.round(finalBids),
    weightedAsksUsd: Math.round(finalAsks),
    weightedObiRatio: Number.isFinite(ratio) ? ratio : 1
  };
}

function findMajorBidWall(
  book: MexcOrderBook,
  midPrice: number
): { price: number | null; usd: number } {
  if (midPrice <= 0) return { price: null, usd: 0 };
  const minPrice = midPrice * 0.98; // within -2.0% of mid-price
  let bestPrice: number | null = null;
  let bestUsd = 0;

  for (const [price, qty] of book.bids) {
    if (price < minPrice || price > midPrice) continue;
    const usd = price * qty;
    if (usd > bestUsd) {
      bestUsd = usd;
      bestPrice = price;
    }
  }

  // Fallback to largest bid in top 50 if all bids fell slightly outside -2%
  if (bestPrice === null && book.bids.length > 0) {
    for (const [price, qty] of book.bids.slice(0, 50)) {
      const usd = price * qty;
      if (usd > bestUsd) {
        bestUsd = usd;
        bestPrice = price;
      }
    }
  }

  return { price: bestPrice, usd: Math.round(bestUsd) };
}

function findMajorAskWall(
  book: MexcOrderBook,
  midPrice: number
): { price: number | null; usd: number } {
  if (midPrice <= 0) return { price: null, usd: 0 };
  const minTarget = midPrice * 1.012; // +1.2%
  const maxTarget = midPrice * 1.06; // +6.0%

  let bestPrice: number | null = null;
  let bestUsd = 0;

  for (const [price, qty] of book.asks) {
    if (price >= minTarget && price <= maxTarget) {
      const usd = price * qty;
      if (usd > bestUsd) {
        bestUsd = usd;
        bestPrice = price;
      }
    }
  }

  // Fallback for ultra-dense major books (e.g., BTC where 100 levels span < +1.2%):
  // pick the single largest resting ask wall above mid-price in the 100-level book
  if (bestPrice === null) {
    for (const [price, qty] of book.asks) {
      if (price <= midPrice) continue;
      const usd = price * qty;
      if (usd > bestUsd) {
        bestUsd = usd;
        bestPrice = price;
      }
    }
  }

  return { price: bestPrice, usd: Math.round(bestUsd) };
}

function measureBidLiquidityNearLevel(book: MexcOrderBook, targetPrice: number): number {
  const tolerance = targetPrice * 0.0008; // ±0.08% tick cluster
  let sumUsd = 0;
  for (const [price, qty] of book.bids) {
    if (Math.abs(price - targetPrice) <= tolerance) {
      sumUsd += price * qty;
    }
  }
  return sumUsd;
}

export async function runOrderFlowAnalysis(
  rawSymbol: string,
  enableSpoofCheck = true
): Promise<OrderFlowReport> {
  const symbol = rawSymbol.toUpperCase().trim();
  const started = Date.now();

  try {
    // 1. Fetch 100-level Order Book Snapshot 1 + 500 Real Executed Trades in parallel
    const [book1, trades] = await Promise.all([
      fetchMexcOrderBook(symbol, 100),
      fetchMexcRecentTrades(symbol, 500).catch(() => [])
    ]);

    const midPrice = getMidPrice(book1);
    const { weightedBidsUsd, weightedAsksUsd, weightedObiRatio } = computeWeightedObi(book1, midPrice);
    const majorBid = findMajorBidWall(book1, midPrice);
    const majorAsk = findMajorAskWall(book1, midPrice);

    // 2. Real Executed Taker Buy/Sell CVD
    // isBuyerMaker === false -> aggressive Taker Buy (market buyer lifted the ask)
    // isBuyerMaker === true  -> aggressive Taker Sell (market seller hit the bid)
    let takerBuyUsd = 0;
    let takerSellUsd = 0;
    for (const tr of trades) {
      const usd = tr.quoteQty > 0 ? tr.quoteQty : tr.price * tr.qty;
      if (!Number.isFinite(usd) || usd <= 0) continue;
      if (!tr.isBuyerMaker) takerBuyUsd += usd;
      else takerSellUsd += usd;
    }
    const totalTakerUsd = takerBuyUsd + takerSellUsd;
    const takerBuyPct =
      totalTakerUsd > 0 ? Number(((takerBuyUsd / totalTakerUsd) * 100).toFixed(1)) : 50;
    const cvdUsd = Math.round(takerBuyUsd - takerSellUsd);

    // 3. Anti-Spoofing Wall Check (Snapshot 2 after 2.5s)
    let isSpoofingDetected = false;
    let spoofReasonUz: string | null = null;
    let spoofChecked = false;

    if (enableSpoofCheck && majorBid.price !== null && majorBid.usd > 0) {
      try {
        await sleep(SPOOF_WAIT_MS);
        const book2 = await fetchMexcOrderBook(symbol, 50);
        const midPrice2 = getMidPrice(book2);
        spoofChecked = true;

        // Only flag spoofing if price did NOT drop through the bid wall (wall wasn't legitimately filled)
        if (midPrice2 > majorBid.price) {
          const remainingWallUsd = measureBidLiquidityNearLevel(book2, majorBid.price);
          const shrinkRatio = majorBid.usd > 0 ? 1 - remainingWallUsd / majorBid.usd : 0;
          if (shrinkRatio >= SPOOF_SHRINK_THRESHOLD) {
            isSpoofingDetected = true;
            spoofReasonUz = `Soxta xaridor devori (Spoofing) aniqlandi (@ ${majorBid.price}, -${Math.round(shrinkRatio * 100)}% yo'qoldi)`;
          }
        }
      } catch {
        // Graceful degradation if Snapshot 2 times out
        spoofChecked = false;
      }
    }

    return {
      symbol,
      midPrice,
      weightedObiRatio,
      weightedBidsUsd,
      weightedAsksUsd,
      takerBuyUsd: Math.round(takerBuyUsd),
      takerSellUsd: Math.round(takerSellUsd),
      takerBuyPct,
      cvdUsd,
      majorBidWallPrice: majorBid.price,
      majorBidWallUsd: majorBid.usd,
      majorAskWallPrice: majorAsk.price,
      majorAskWallUsd: majorAsk.usd,
      isSpoofingDetected,
      spoofReasonUz,
      spoofChecked,
      degraded: false,
      latencyMs: Date.now() - started
    };
  } catch {
    // Graceful fallback if MEXC endpoints time out
    return {
      symbol,
      midPrice: 0,
      weightedObiRatio: 1,
      weightedBidsUsd: 0,
      weightedAsksUsd: 0,
      takerBuyUsd: 0,
      takerSellUsd: 0,
      takerBuyPct: 50,
      cvdUsd: 0,
      majorBidWallPrice: null,
      majorBidWallUsd: 0,
      majorAskWallPrice: null,
      majorAskWallUsd: 0,
      isSpoofingDetected: false,
      spoofReasonUz: null,
      spoofChecked: false,
      degraded: true,
      latencyMs: Date.now() - started
    };
  }
}
