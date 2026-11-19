import axios from "axios";
import { env } from "../config/env";
import { resilientHttpsAgent } from "./marketHealth.service";

export interface FearGreedData {
  value: number; // 0-100
  classification: string; // e.g., "Extreme Fear", "Greed"
  fetchedAt: string;
}

export interface FundamentalReport {
  symbol: string;
  mexcTradingAllowed: boolean;
  isStRisk: boolean;
  marketCapUsd: number | null;
  fdvToMcapRatio: number | null;
  fearGreed: FearGreedData | null;
  hardBlockReason: string | null;
  softWarnings: string[];
  fundamentalScore: number; // 0-100
  badgeUz: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const ERROR_BACKOFF_MS = 10 * 60 * 1000;

let cachedFng: { data: FearGreedData | null; ts: number } | null = null;
let cachedMexcSymbols: { map: Map<string, { status: string; isSpot: boolean; isSt: boolean }>; ts: number } | null = null;
const cgCoinCache = new Map<string, { mcap: number | null; fdvRatio: number | null; ts: number }>();

export async function fetchFearAndGreed(): Promise<FearGreedData | null> {
  const now = Date.now();
  if (cachedFng) {
    const ttl = cachedFng.data ? SIX_HOURS_MS : ERROR_BACKOFF_MS;
    if (now - cachedFng.ts < ttl) {
      return cachedFng.data;
    }
  }
  try {
    const res = await axios.get<{ data?: Array<{ value: string; value_classification: string }> }>(
      "https://api.alternative.me/fng/?limit=1",
      { timeout: 6000, httpsAgent: resilientHttpsAgent }
    );
    const first = res.data?.data?.[0];
    if (first) {
      const data: FearGreedData = {
        value: Number(first.value) || 50,
        classification: first.value_classification || "Neutral",
        fetchedAt: new Date(now).toISOString()
      };
      cachedFng = { data, ts: now };
      return data;
    }
  } catch {
    // Graceful degradation
  }
  cachedFng = { data: cachedFng?.data ?? null, ts: now };
  return cachedFng.data;
}

async function getMexcSymbolStatus(symbol: string): Promise<{ status: string; isSpot: boolean; isSt: boolean } | null> {
  const now = Date.now();
  const ttl = cachedMexcSymbols && cachedMexcSymbols.map.size > 0 ? TWELVE_HOURS_MS : ERROR_BACKOFF_MS;
  if (!cachedMexcSymbols || now - cachedMexcSymbols.ts >= ttl) {
    const mirrors = ["https://api.mexc.com", "https://api.mexc.io", "https://api.mexc.co"];
    let loaded = false;
    for (const base of mirrors) {
      try {
        const res = await axios.get<{ symbols?: Array<Record<string, unknown>> }>(
          `${base}/api/v3/exchangeInfo`,
          { timeout: 12000, httpsAgent: resilientHttpsAgent }
        );
        const map = new Map<string, { status: string; isSpot: boolean; isSt: boolean }>();
        for (const s of res.data?.symbols || []) {
          const sym = String(s.symbol || "");
          const status = String(s.status || "1");
          const isSpot = s.isSpotTradingAllowed !== false;
          const stTag = Boolean(s.st) || String(s.fullName || "").toUpperCase().includes("(ST)");
          if (sym) map.set(sym, { status, isSpot, isSt: stTag });
        }
        if (map.size > 0) {
          cachedMexcSymbols = { map, ts: now };
          loaded = true;
          break;
        }
      } catch {
        // Try next mirror
      }
    }
    if (!loaded && !cachedMexcSymbols) {
      cachedMexcSymbols = { map: new Map(), ts: now };
    }
  }
  return cachedMexcSymbols?.map.get(symbol) ?? null;
}

async function getCoinGeckoFundamentals24h(baseTicker: string): Promise<{ mcap: number | null; fdvRatio: number | null }> {
  const key = baseTicker.toUpperCase();
  const now = Date.now();
  const hit = cgCoinCache.get(key);
  if (hit && now - hit.ts < ONE_DAY_MS) {
    return { mcap: hit.mcap, fdvRatio: hit.fdvRatio };
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": "CryptoQuant-Copilot/0.5"
    };
    if (env.COINGECKO_API_KEY && env.COINGECKO_API_KEY !== "pending") {
      headers["x-cg-demo-api-key"] = env.COINGECKO_API_KEY;
    }
    const res = await axios.get<Array<Record<string, number | string | null>>>(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${encodeURIComponent(key.toLowerCase())}&per_page=1`,
      { timeout: 6000, headers, httpsAgent: resilientHttpsAgent }
    );
    const coin = res.data?.[0];
    const mcap = typeof coin?.market_cap === "number" ? coin.market_cap : null;
    const fdv = typeof coin?.fully_diluted_valuation === "number" ? coin.fully_diluted_valuation : null;
    const fdvRatio = mcap && fdv && mcap > 0 ? Number((fdv / mcap).toFixed(2)) : null;

    cgCoinCache.set(key, { mcap, fdvRatio, ts: now });
    return { mcap, fdvRatio };
  } catch {
    cgCoinCache.set(key, { mcap: null, fdvRatio: null, ts: now });
    return { mcap: null, fdvRatio: null };
  }
}

export async function runFundamentalShield(rawSymbol: string): Promise<FundamentalReport> {
  const symbol = rawSymbol.toUpperCase().trim();
  const base = symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;

  const [fng, mexcInfo, cg] = await Promise.all([
    fetchFearAndGreed(),
    getMexcSymbolStatus(symbol),
    getCoinGeckoFundamentals24h(base)
  ]);

  let hardBlockReason: string | null = null;
  const softWarnings: string[] = [];
  let score = 80;

  const mexcTradingAllowed = mexcInfo ? mexcInfo.isSpot && mexcInfo.status === "1" : true;
  const isStRisk = mexcInfo ? mexcInfo.isSt : false;

  if (!mexcTradingAllowed || isStRisk) {
    hardBlockReason = isStRisk
      ? "MEXC ST (Delisting riski) belgisi aniqlandi"
      : "MEXC Spot savdosi vaqtincha yopiq";
    score = 0;
  }

  if (cg.mcap !== null && cg.mcap < 10_000_000) {
    softWarnings.push(`Micro-cap ($${(cg.mcap / 1_000_000).toFixed(1)}M) — yuqori manipulyatsiya riski`);
    score -= 18;
  }
  if (cg.fdvRatio !== null && cg.fdvRatio > 8) {
    softWarnings.push(`Yuqori FDV/MCap (${cg.fdvRatio}x) — token unlock bosimi`);
    score -= 12;
  }
  if (fng && fng.value >= 76) {
    softWarnings.push(`Bozor haddan tashqari qizigan (Fear & Greed: ${fng.value} — ${fng.classification})`);
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));
  const badgeUz = hardBlockReason
    ? `🚫 XAVFLI (${hardBlockReason})`
    : softWarnings.length === 0
      ? "✅ Sog'lom"
      : `⚠️ Ehtiyot (${softWarnings[0]})`;

  return {
    symbol,
    mexcTradingAllowed,
    isStRisk,
    marketCapUsd: cg.mcap,
    fdvToMcapRatio: cg.fdvRatio,
    fearGreed: fng,
    hardBlockReason,
    softWarnings,
    fundamentalScore: score,
    badgeUz
  };
}
