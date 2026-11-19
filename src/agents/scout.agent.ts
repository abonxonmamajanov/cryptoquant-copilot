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

const MIN_QUOTE_VOLUME_24H = 1_000_000; // $1M minimum 24h liquidity
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

  // Pre-rank by activity: positive momentum + strong 24h liquidity
  const preRanked = [...eligible]
    .sort((a, b) => {
      const scoreA = Math.abs(a.priceChangePercent) * Math.log10(Math.max(a.quoteVolume, 10));
      const scoreB = Math.abs(b.priceChangePercent) * Math.log10(Math.max(b.quoteVolume, 10));
      return scoreB - scoreA;
    })
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

      // Compute Scout Score (0-100)
      const volPoints = clamp((volumeSpikeRatio15m - 1) * 20, 0, 50);
      const momPoints = clamp(Math.abs(momentum15mPct) * 10, 0, 30);
      const liqPoints = clamp((Math.log10(ticker.quoteVolume) - 6) * 10, 0, 20);
      const scoutScore = Math.round(clamp(volPoints + momPoints + liqPoints, 0, 100));

      const reasons: string[] = [];
      if (volumeSpikeRatio15m >= 2.0) reasons.push(`15m hajm sakrashi ${volumeSpikeRatio15m}x`);
      if (Math.abs(momentum15mPct) >= 1.2) reasons.push(`15m impuls ${momentum15mPct > 0 ? "+" : ""}${momentum15mPct}%`);
      if (Math.abs(priceChange24hPct) >= 5.0) reasons.push(`24s harakat ${priceChange24hPct > 0 ? "+" : ""}${priceChange24hPct}%`);
      if (reasons.length === 0) reasons.push("Yuqori likvidli faol juftlik");

      const isAnomaly = volumeSpikeRatio15m >= 1.8 || Math.abs(momentum15mPct) >= 1.5 || scoutScore >= 55;

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
