import {
  fetchMexcKlines15m,
  fetchMexcTickers24h,
  getActiveMexcMirror,
  MexcTicker24h
} from "../services/mexcClient.service";

const STABLECOIN_BASES = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "USDD", "USDP", "BUSD",
  "PYUSD", "USDE", "EUR", "EURC", "AEUR", "USD1", "RLUSD", "GUSD",
  "FRAX", "LUSD", "CRVUSD", "USTC", "EURT", "XAUT", "PAXG"
]);

const LEVERAGED_SUFFIXES = ["3L", "3S", "5L", "5S", "2L", "2S", "UP", "DOWN", "BULL", "BEAR"];

const MIN_QUOTE_VOLUME_24H = 2_000_000; // $2M minimum strong 24h liquidity
const MAX_CANDIDATES_TO_DEEP_SCAN = 15;
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes per symbol

const alertCooldownMap = new Map<string, number>();

export interface ScoutCandidate {
  symbol: string;
  exchange: "MEXC";
  lastPrice: number;
  priceChange24hPct: number;
  quoteVolume24hUsd: number;
  volumeSpikeRatio15m: number;
  momentum15mPct: number;
  scoutScore: number;
  isAnomaly: boolean;
  isNewAlert: boolean;
  reasons: string[];
  detectedAt: string;
}

export interface ScoutScanSnapshot {
  scannedAt: string;
  durationMs: number;
  activeMirror: string;
  totalUsdtPairs: number;
  filteredOutCount: number;
  liquidEligibleCount: number;
  deepScannedCount: number;
  anomaliesDetected: number;
  candidates: ScoutCandidate[];
}

export function isFilteredOutSymbol(symbol: string): boolean {
  if (!symbol.endsWith("USDT")) return true;
  const base = symbol.slice(0, -4);
  if (!base || STABLECOIN_BASES.has(base)) return true;
  for (const suffix of LEVERAGED_SUFFIXES) {
    if (base.length > suffix.length + 1 && base.endsWith(suffix)) {
      return true;
    }
  }
  return false;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computePreRankScore(ticker: MexcTicker24h): number {
  const chg = ticker.priceChangePercent;
  const liqWeight = Math.log10(Math.max(ticker.quoteVolume, 10));
  let moveScore = 0;

  if (chg >= 1.5 && chg <= 14) {
    // Sweet spot: early accumulation & fresh breakout
    moveScore = 18 + (12 - Math.abs(chg - 6.5));
  } else if (chg >= 0 && chg < 1.5) {
    // Pre-breakout quiet accumulation
    moveScore = 10 + chg * 4;
  } else if (chg > 14 && chg <= 22) {
    // Mid-trend continuation
    moveScore = 10;
  } else if (chg > 22) {
    // Penalize late overextended FOMO pumps
    moveScore = Math.max(0.5, 5 - (chg - 22) * 0.35);
  } else if (chg >= -5) {
    moveScore = 5;
  } else {
    moveScore = 1;
  }

  return moveScore * liqWeight;
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

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runScoutScan(preloadedTickers?: MexcTicker24h[]): Promise<ScoutScanSnapshot> {
  const started = Date.now();
  const allTickers = preloadedTickers ?? (await fetchMexcTickers24h());
  const usdtTickers = allTickers.filter((t) => t.symbol.endsWith("USDT"));

  const eligible: MexcTicker24h[] = [];
  let filteredOutCount = 0;

  for (const t of usdtTickers) {
    if (isFilteredOutSymbol(t.symbol) || t.quoteVolume < MIN_QUOTE_VOLUME_24H) {
      filteredOutCount++;
      continue;
    }
    eligible.push(t);
  }

  // Pre-rank favoring early accumulation & fresh breakouts (+1.5%..+14%) with >= $2M liquidity
  const preRanked = [...eligible]
    .sort((a, b) => computePreRankScore(b) - computePreRankScore(a))
    .slice(0, MAX_CANDIDATES_TO_DEEP_SCAN);

  const now = Date.now();

  const evaluated = await mapWithConcurrency(preRanked, 4, async (ticker): Promise<ScoutCandidate | null> => {
    try {
      const klines = await fetchMexcKlines15m(ticker.symbol, 22);
      if (klines.length < 10) return null;

      const latest = klines[klines.length - 2];
      const history = klines.slice(0, klines.length - 2);
      const avgQuoteVol =
        history.reduce((sum, k) => sum + k.quoteAssetVolume, 0) / Math.max(history.length, 1);

      const volumeSpikeRatio15m =
        avgQuoteVol > 0 ? Number((latest.quoteAssetVolume / avgQuoteVol).toFixed(2)) : 0;

      const momentum15mPct =
        latest.open > 0
          ? Number((((latest.close - latest.open) / latest.open) * 100).toFixed(2))
          : 0;

      const priceChange24hPct = Number(ticker.priceChangePercent.toFixed(2));

      // Compute Stage 5.7 Early-Breakout Scout Score (0-100)
      let volPoints = 0;
      if (volumeSpikeRatio15m >= 1.6 && volumeSpikeRatio15m <= 5.0) {
        volPoints = clamp(24 + (volumeSpikeRatio15m - 1.6) * 5.2, 24, 42);
      } else if (volumeSpikeRatio15m > 5.0) {
        volPoints = clamp(34 - (volumeSpikeRatio15m - 5.0) * 1.8, 16, 34);
      } else {
        volPoints = clamp((volumeSpikeRatio15m - 1) * 28, 0, 20);
      }

      let breakoutPoints = 0;
      if (priceChange24hPct >= 1.5 && priceChange24hPct <= 14) {
        breakoutPoints = 24;
      } else if (priceChange24hPct >= 0 && priceChange24hPct < 1.5) {
        breakoutPoints = 14;
      } else if (priceChange24hPct > 14 && priceChange24hPct <= 22) {
        breakoutPoints = 8;
      } else if (priceChange24hPct > 22) {
        // Penalize late overextended FOMO pumps
        breakoutPoints = -18 - Math.min(16, (priceChange24hPct - 22) * 0.8);
      } else {
        breakoutPoints = 3;
      }

      let momPoints = 0;
      if (momentum15mPct >= 0.3 && momentum15mPct <= 3.5) {
        momPoints = clamp(8 + momentum15mPct * 4.2, 8, 18);
      } else if (momentum15mPct > 3.5) {
        momPoints = 9;
      } else {
        momPoints = clamp(Math.abs(momentum15mPct) * 2.5, 0, 6);
      }

      const liqPoints =
        ticker.quoteVolume >= MIN_QUOTE_VOLUME_24H
          ? clamp(8 + (Math.log10(ticker.quoteVolume) - 6.3) * 6.5, 8, 16)
          : 0;

      const scoutScore = Math.round(clamp(volPoints + breakoutPoints + momPoints + liqPoints, 0, 100));

      const reasons: string[] = [];
      if (priceChange24hPct >= 1.5 && priceChange24hPct <= 14) {
        reasons.push(`Erta breakout zonasi (+${priceChange24hPct}%)`);
      } else if (priceChange24hPct > 22) {
        reasons.push(`Kechki FOMO o'sishi (+${priceChange24hPct}%)`);
      }
      if (volumeSpikeRatio15m >= 1.6 && volumeSpikeRatio15m <= 5.0) {
        reasons.push(`Yangi 15m hajm kengayishi ${volumeSpikeRatio15m}x`);
      } else if (volumeSpikeRatio15m > 5.0) {
        reasons.push(`Kuchli 15m hajm sakrashi ${volumeSpikeRatio15m}x`);
      }
      if (momentum15mPct >= 0.5) {
        reasons.push(`15m impuls +${momentum15mPct}%`);
      }
      if (ticker.quoteVolume >= MIN_QUOTE_VOLUME_24H) {
        reasons.push(`Kuchli likvidlik ($${(ticker.quoteVolume / 1_000_000).toFixed(1)}M)`);
      }
      if (reasons.length === 0) reasons.push("Yuqori likvidli faol juftlik");

      const isEarlyBreakout =
        priceChange24hPct >= 1.5 && priceChange24hPct <= 14 && volumeSpikeRatio15m >= 1.6;
      const isAnomaly =
        isEarlyBreakout ||
        (volumeSpikeRatio15m >= 1.6 && priceChange24hPct <= 22) ||
        scoutScore >= 60;

      let isNewAlert = false;
      if (isAnomaly) {
        const prevAlertTs = alertCooldownMap.get(ticker.symbol) || 0;
        if (now - prevAlertTs >= COOLDOWN_MS) {
          alertCooldownMap.set(ticker.symbol, now);
          isNewAlert = true;
        }
      }

      return {
        symbol: ticker.symbol,
        exchange: "MEXC",
        lastPrice: ticker.lastPrice,
        priceChange24hPct,
        quoteVolume24hUsd: Math.round(ticker.quoteVolume),
        volumeSpikeRatio15m,
        momentum15mPct,
        scoutScore,
        isAnomaly,
        isNewAlert,
        reasons,
        detectedAt: new Date(now).toISOString()
      };
    } catch {
      return null;
    }
  });

  const candidates = evaluated
    .filter((c): c is ScoutCandidate => c !== null)
    .sort((a, b) => b.scoutScore - a.scoutScore);

  return {
    scannedAt: new Date(now).toISOString(),
    durationMs: Date.now() - started,
    activeMirror: getActiveMexcMirror(),
    totalUsdtPairs: usdtTickers.length,
    filteredOutCount,
    liquidEligibleCount: eligible.length,
    deepScannedCount: candidates.length,
    anomaliesDetected: candidates.filter((c) => c.isAnomaly).length,
    candidates
  };
}
