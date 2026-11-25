import {
  fetchMexcKlines15m,
  fetchMexcTickers24h,
  getActiveMexcMirror,
  MexcTicker24h
} from "../services/mexcClient.service";
import { getActiveDirectionFilter } from "../services/subscription.service";
import { isTokenizedStockSymbol } from "../services/rwaStocks.service";

const STABLECOIN_BASES = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "USDD", "USDP", "BUSD",
  "PYUSD", "USDE", "EUR", "EURC", "AEUR", "USD1", "RLUSD", "GUSD",
  "FRAX", "LUSD", "CRVUSD", "USTC", "EURT", "XAUT", "PAXG", "USAT",
  "GOLD", "SILVER", "OIL"
]);

const LEVERAGED_SUFFIXES = ["3L", "3S", "5L", "5S", "2L", "2S", "UP", "DOWN", "BULL", "BEAR"];
const BLOCKED_BASE_SUBSTRINGS = ["GOLD", "PAXG", "XAUT", "USOON"];

const MIN_QUOTE_VOLUME_24H = 3_000_000; // $3M minimum strong 24h liquidity (avoids thin whipsaw traps)
const MAX_CANDIDATES_TO_DEEP_SCAN = 20;
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
  const upper = String(symbol || "").toUpperCase().trim();
  if (!upper.endsWith("USDT")) return true;
  // Strict Stage 7.0 Isolation Wall: exclude MEXC Ondo (*ONUSDT) & xStocks (*XUSDT) from Crypto Scout
  if (isTokenizedStockSymbol(upper)) return true;
  const base = upper.slice(0, -4);
  // Strictly allow clean ASCII alphanumeric crypto tickers only (blocks GOLD(PAXG), OIL(USOON), non-ASCII memes)
  if (!base || !/^[A-Z0-9]{2,15}$/.test(base)) return true;
  if (STABLECOIN_BASES.has(base)) return true;
  for (const blocked of BLOCKED_BASE_SUBSTRINGS) {
    if (base.includes(blocked)) return true;
  }
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

function computePreRankScore(ticker: MexcTicker24h, dirFilter: "BOTH" | "LONG" | "SHORT"): number {
  const chg = ticker.priceChangePercent;
  const liqWeight = Math.log10(Math.max(ticker.quoteVolume, 10));

  const scoreDirectionalMove = (directionalChg: number): number => {
    if (directionalChg >= 0.5 && directionalChg <= 12) {
      return 20 + (10 - Math.abs(directionalChg - 4.5));
    } else if (directionalChg >= -2 && directionalChg < 0.5) {
      return 12 + (directionalChg + 2) * 2.5;
    } else if (directionalChg > 12 && directionalChg <= 18) {
      return 9;
    } else if (directionalChg > 18) {
      return Math.max(0.5, 4 - (directionalChg - 18) * 0.35);
    } else if (directionalChg >= -6) {
      return 4;
    }
    return 0.5;
  };

  let moveScore = 0;
  if (dirFilter === "LONG") {
    moveScore = scoreDirectionalMove(chg);
  } else if (dirFilter === "SHORT") {
    moveScore = scoreDirectionalMove(-chg);
  } else {
    moveScore = Math.max(scoreDirectionalMove(chg), scoreDirectionalMove(-chg));
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
  const dirFilter = getActiveDirectionFilter();

  const eligible: MexcTicker24h[] = [];
  let filteredOutCount = 0;

  for (const t of usdtTickers) {
    if (isFilteredOutSymbol(t.symbol) || t.quoteVolume < MIN_QUOTE_VOLUME_24H) {
      filteredOutCount++;
      continue;
    }
    eligible.push(t);
  }

  // Stage 6.2 Dual-Direction pre-ranking: liquid controlled uptrends (+0.5..+12%) & controlled downtrends (-12..-0.5%)
  const preRanked = [...eligible]
    .sort((a, b) => computePreRankScore(b, dirFilter) - computePreRankScore(a, dirFilter))
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
      const isBearCandidate = priceChange24hPct < -0.5;
      const dirChg = isBearCandidate ? -priceChange24hPct : priceChange24hPct;
      const dirMom = isBearCandidate ? -momentum15mPct : momentum15mPct;

      // Stage 6.2 Dual-Direction Quant Discipline Scout Score (0-100)
      let volPoints = 0;
      if (volumeSpikeRatio15m >= 1.1 && volumeSpikeRatio15m <= 3.5) {
        volPoints = clamp(24 + (volumeSpikeRatio15m - 1.1) * 5.5, 24, 36);
      } else if (volumeSpikeRatio15m > 3.5 && volumeSpikeRatio15m <= 5.5) {
        volPoints = 22;
      } else if (volumeSpikeRatio15m > 5.5) {
        volPoints = clamp(16 - (volumeSpikeRatio15m - 5.5) * 2.0, 4, 16);
      } else {
        volPoints = clamp(volumeSpikeRatio15m * 18, 6, 20);
      }

      let breakoutPoints = 0;
      if (dirChg >= 0.5 && dirChg <= 12) {
        breakoutPoints = 26;
      } else if (dirChg >= -2 && dirChg < 0.5) {
        breakoutPoints = 16;
      } else if (dirChg > 12 && dirChg <= 18) {
        breakoutPoints = 8;
      } else if (dirChg > 18) {
        // Penalize late overextended FOMO pumps or panic waterfalls
        breakoutPoints = -20 - Math.min(18, (dirChg - 18) * 0.9);
      } else {
        breakoutPoints = 2;
      }

      let momPoints = 0;
      if (dirMom >= 0.1 && dirMom <= 1.8) {
        momPoints = clamp(12 + dirMom * 4.5, 12, 20);
      } else if (dirMom > 1.8 && dirMom <= 3.2) {
        momPoints = 10;
      } else if (dirMom > 3.2) {
        momPoints = 2;
      } else if (dirMom >= -0.8) {
        momPoints = 6;
      } else {
        momPoints = 0;
      }

      const liqPoints =
        ticker.quoteVolume >= MIN_QUOTE_VOLUME_24H
          ? clamp(10 + (Math.log10(ticker.quoteVolume) - 6.47) * 5.5, 10, 18)
          : 0;

      const scoutScore = Math.round(clamp(volPoints + breakoutPoints + momPoints + liqPoints, 0, 100));

      const reasons: string[] = [];
      if (priceChange24hPct >= 0.5 && priceChange24hPct <= 12) {
        reasons.push(`Sog'lom LONG trend zonasi (+${priceChange24hPct}%)`);
      } else if (priceChange24hPct <= -0.5 && priceChange24hPct >= -12) {
        reasons.push(`Nazoratli SHORT trend zonasi (${priceChange24hPct}%)`);
      } else if (Math.abs(priceChange24hPct) > 18) {
        reasons.push(`Haddan tashqari cho'zilgan 24s harakat (${priceChange24hPct}%)`);
      }
      if (volumeSpikeRatio15m >= 1.1 && volumeSpikeRatio15m <= 3.5) {
        reasons.push(`Barqaror 15m hajm ${volumeSpikeRatio15m}x`);
      } else if (volumeSpikeRatio15m > 5.5) {
        reasons.push(`Haddan tashqari hajm sakrashi ${volumeSpikeRatio15m}x (ehtiyot)`);
      }
      if (dirMom >= 0.1 && dirMom <= 1.8) {
        reasons.push(`15m nazoratli impuls ${momentum15mPct >= 0 ? "+" : ""}${momentum15mPct}%`);
      }
      if (ticker.quoteVolume >= MIN_QUOTE_VOLUME_24H) {
        reasons.push(`Kuchli likvidlik ($${(ticker.quoteVolume / 1_000_000).toFixed(1)}M)`);
      }
      if (reasons.length === 0) reasons.push("Yuqori likvidli faol juftlik");

      const isHealthySetup =
        dirChg >= 0.5 &&
        dirChg <= 12 &&
        volumeSpikeRatio15m >= 1.1 &&
        volumeSpikeRatio15m <= 5.0 &&
        dirMom > 0;
      const isAnomaly = isHealthySetup || (scoutScore >= 64 && Math.abs(priceChange24hPct) <= 18);

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
