import fs from "fs";
import path from "path";
import axios from "axios";
import { env } from "../config/env";
import { resilientHttpsAgent } from "./marketHealth.service";
import {
  fetchMexcKlines,
  fetchMexcOrderBook,
  fetchMexcTicker24h,
  getActiveMexcMirror,
  getCachedMexcTickers24h,
  MexcKline,
  MexcTicker24h
} from "./mexcClient.service";
import { calcAdx14, TradeMode } from "../agents/technician.agent";
import { TrendRegime } from "../agents/macroFlow.agent";
import { generate15mChartPng } from "./chartGenerator.service";
import { pushActivityLog } from "./activityLog.service";

// =============================================================================
// STAGE 7.0 — ISOLATED TOKENIZED STOCKS ENGINE (MEXC ONDO & xSTOCKS RWA)
// 100% isolated from Stage 6.2 Crypto Core (0% impact on crypto params/SL/TP)
// =============================================================================

export type RwaProvider = "Ondo" | "xStocks";
export type RwaDirection = "LONG" | "SHORT";

/**
 * Safeguard #1a: Hard-exclude 3x leveraged ETFs, inverse ETFs, T-Bills/cash,
 * commodity wrappers, and speculative wrappers.
 */
export const BLACKLIST_TICKERS = new Set<string>([
  "SOXL",
  "SOXS",
  "TQQQ",
  "SQQQ",
  "UVXY",
  "SPXU",
  "BIL",
  "SGOV",
  "SHV",
  "USFR",
  "UNG",
  "SLV",
  "GLD",
  "IAU",
  "SPCX"
]);

/**
 * Known genuine Crypto Spot pairs on MEXC ending in *ONUSDT or *XUSDT
 * so they are NEVER confused with tokenized stocks or blocked from Crypto Scout.
 */
const CRYPTO_NOT_RWA_SYMBOLS = new Set<string>([
  "TONUSDT",
  "TRXUSDT",
  "AVAXUSDT",
  "AUCTIONUSDT",
  "ATOMUSDT",
  "MOONUSDT",
  "BONUSDT",
  "LIONUSDT",
  "KRONUSDT",
  "NEONUSDT",
  "TRONUSDT",
  "AXONUSDT",
  "ICONUSDT",
  "AIONUSDT",
  "ZIONUSDT",
  "LEONUSDT",
  "RONUSDT",
  "MONUSDT",
  "EONUSDT",
  "PONUSDT",
  "CONUSDT",
  "SONUSDT",
  "WONUSDT",
  "BICONUSDT",
  "DRAGONUSDT",
  "FALCONUSDT",
  "GMXUSDT",
  "SNXUSDT",
  "STXUSDT",
  "IMXUSDT",
  "DYDXUSDT",
  "FLUXUSDT",
  "CFXUSDT",
  "IOTXUSDT",
  "CVXUSDT",
  "MDXUSDT",
  "BNXUSDT",
  "VGXUSDT",
  "FLXUSDT",
  "POLYXUSDT",
  "BEAMXUSDT",
  "PUNDIXUSDT",
  "WEMIXUSDT",
  "INDEXUSDT",
  "NATIXUSDT",
  "PHNIXUSDT",
  "SOLVEXUSDT",
  "WMTXUSDT",
  "TXUSDT",
  "MXUSDT",
  "OXUSDT",
  "UXUSDT",
  "RXUSDT",
  "NXUSDT",
  "FXUSDT",
  "PXUSDT",
  "ZXUSDT",
  "XUSDT",
  "ONUSDT",
  "ONDOUSDT",
  "MANTRAUSDT",
  "OMUSDT",
  "RADIONUSDT",
  "ORIONUSDT",
  "FUSIONUSDT",
  "VISIONUSDT",
  "ACTIONUSDT",
  "NATIONUSDT",
  "MOTIONUSDT",
  "POTIONUSDT",
  "PORTIONUSDT",
  "EDITIONUSDT",
  "RIBBONUSDT",
  "CARBONUSDT",
  "PROTONUSDT",
  "PHOTONUSDT",
  "NEUTRONUSDT",
  "BOSONUSDT",
  "MUONUSDT",
  "GLUONUSDT",
  "KRYPTONUSDT",
  "ARGONUSDT",
  "XENONUSDT",
  "RADONUSDT",
  "BORONUSDT",
  "SILICONUSDT",
  "TITANUSDT",
  "OBERONUSDT",
  "CHARONUSDT",
  "TRITONUSDT",
  "SOLONUSDT",
  "EPSILONUSDT",
  "OMICRONUSDT",
  "APEXUSDT",
  "VRTXUSDT",
  "MPLXUSDT",
  "SPXUSDT",
  "UXLINKUSDT",
  "STRXUSDT",
  "ZCXUSDT",
  "LCXUSDT",
  "ICXUSDT",
  "WRXUSDT",
  "ADXUSDT",
  "OAXUSDT",
  "TROYUSDT",
  "STMXUSDT",
  "STORMXUSDT",
  "VLXUSDT",
  "TELXUSDT",
  "VOXELUSDT",
  "COMPLEXUSDT",
  "CONVEXUSDT",
  "SYNTHETIXUSDT",
  "HELIXUSDT",
  "MATRIXUSDT",
  "PHOENIXUSDT",
  "ONYXUSDT",
  "LYXUSDT",
  "MYXUSDT",
  "NYXUSDT",
  "PYXUSDT",
  "SYXUSDT",
  "ZYXUSDT",
  "SONICUSDT",
  "CYBERUSDT",
  "ELONUSDT",
  "AEONUSDT",
  "BONEUSDT"
]);

export interface ParsedRwaSymbol {
  symbol: string;
  canonicalTicker: string;
  provider: RwaProvider;
  isBlacklisted: boolean;
}

export interface RwaStockTicker {
  symbol: string;
  canonicalTicker: string;
  provider: RwaProvider;
  lastPrice: number;
  priceChange24hPct: number;
  quoteVolume24hUsd: number;
}

export interface UsMarketStatus {
  isOpenForAutoSignals: boolean;
  sessionLabelUz: string;
  utcNowIso: string;
}

export interface UsIndexBenchmark {
  spyTrend4h: TrendRegime;
  qqqTrend4h: TrendRegime;
  usIndexRegime: TrendRegime;
  spyPrice: number | null;
  qqqPrice: number | null;
  updatedAt: string;
}

export interface RwaStockAnalysisItem {
  canonicalTicker: string;
  mexcSymbol: string;
  provider: RwaProvider;
  direction: RwaDirection;
  tradeMode: TradeMode;
  verdict: "APPROVE" | "REJECT";
  confidenceScore: number;
  lastPrice: number;
  priceChange24hPct: number;
  quoteVolume24hUsd: number;
  realStockPrice: number | null;
  pegPremiumPct: number | null;
  spreadPct: number;
  depthHalfPctUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  riskRewardRatio: number;
  rsi14: number;
  adx14: number;
  ema9: number;
  ema21: number;
  trend1h: TrendRegime;
  trend4h: TrendRegime;
  usIndexRegime: TrendRegime;
  marketStatus: UsMarketStatus;
  reasons: string[];
  tradingViewUrl: string;
  caption: string;
  analyzedAt: string;
}

export interface RwaStockAnalysisResult extends RwaStockAnalysisItem {
  chartPng: Buffer;
}

export interface RwaScanSnapshot {
  scannedAt: string;
  durationMs: number;
  activeMirror: string;
  rwaEnabled: boolean;
  marketStatus: UsMarketStatus;
  benchmark: UsIndexBenchmark;
  totalUniverseCount: number;
  deepScannedCount: number;
  approvedCount: number;
  dispatchedCount: number;
  stocks: RwaStockAnalysisItem[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const RWA_SETTINGS_FILE = path.join(DATA_DIR, "rwa_settings.json");

const MIN_RWA_VOLUME_USD = 100_000;
const MAX_RWA_SPREAD_PCT = 0.25;
const MIN_RWA_DEPTH_HALF_PCT_USD = 2500;
const MAX_PEG_DIFF_PCT = 0.8;
const RWA_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours anti-spam per stock
const YAHOO_CACHE_MS = 5 * 60 * 1000; // 5 minutes per ticker
const BENCHMARK_CACHE_MS = 5 * 60 * 1000; // 5 minutes for SPY/QQQ 4H
const MAX_YAHOO_CACHE_SIZE = 200;

let rwaEnabled = loadInitialRwaEnabled();
let latestRwaSnapshot: RwaScanSnapshot | null = null;
let cachedBenchmark: { fetchedAt: number; data: UsIndexBenchmark } | null = null;

const yahooQuoteCache = new Map<string, { fetchedAt: number; price: number | null }>();
const rwaAlertCooldownMap = new Map<string, number>();

function loadInitialRwaEnabled(): boolean {
  try {
    if (fs.existsSync(RWA_SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RWA_SETTINGS_FILE, "utf-8")) as {
        rwaEnabled?: boolean;
      };
      if (typeof parsed.rwaEnabled === "boolean") {
        return parsed.rwaEnabled;
      }
    }
  } catch {
    // Fallback to env var
  }
  const rawEnv = String(process.env.RWA_ENABLED ?? env.RWA_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  return rawEnv !== "false" && rawEnv !== "0" && rawEnv !== "off";
}

function saveRwaEnabledSetting(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      RWA_SETTINGS_FILE,
      JSON.stringify({ rwaEnabled, updatedAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );
  } catch {
    // Non-fatal
  }
}

export function isRwaEnabled(): boolean {
  return rwaEnabled;
}

export function setRwaEnabled(enabled: boolean): boolean {
  rwaEnabled = Boolean(enabled);
  saveRwaEnabledSetting();
  if (latestRwaSnapshot) {
    latestRwaSnapshot = { ...latestRwaSnapshot, rwaEnabled };
  }
  return rwaEnabled;
}

export function toggleRwaEnabled(): boolean {
  return setRwaEnabled(!rwaEnabled);
}

export function getLatestRwaSnapshot(): RwaScanSnapshot | null {
  return latestRwaSnapshot;
}

export function buildRwaTradingViewUrl(canonicalTicker: string): string {
  const clean = canonicalTicker.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(clean)}&interval=15`;
}

function roundPrice(price: number): number {
  if (price >= 100) return Number(price.toFixed(2));
  if (price >= 1) return Number(price.toFixed(4));
  if (price >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(7));
}

function calcEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values[0];
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[i] : values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function calcRsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

function calcAtr(klines: MexcKline[], period = 14): number {
  if (klines.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const curr = klines[i];
    const prevClose = klines[i - 1].close;
    trs.push(
      Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prevClose),
        Math.abs(curr.low - prevClose)
      )
    );
  }
  const slice = trs.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function detectTrendFromKlines(klines: MexcKline[]): TrendRegime {
  const closed = klines.length > 2 ? klines.slice(0, -1) : klines;
  if (closed.length < 15) return "NEUTRAL";
  const closes = closed.map((k) => k.close);
  const ema9 = calcEmaSeries(closes, 9);
  const ema21 = calcEmaSeries(closes, 21);
  const lastIdx = closes.length - 1;
  const e9 = ema9[lastIdx];
  const e21 = ema21[lastIdx];
  const last = closes[lastIdx];
  if (e9 > e21 * 1.0005 && last >= e9 * 0.998) return "BULLISH";
  if (e9 < e21 * 0.9995 && last <= e9 * 1.002) return "BEARISH";
  return "NEUTRAL";
}

// =============================================================================
// SAFEGUARD #1: PARSING, BLACKLIST & PROVIDER DEDUPLICATION
// =============================================================================

export function parseRwaSymbol(symbol: string): ParsedRwaSymbol | null {
  const upper = String(symbol || "").toUpperCase().trim();
  if (!upper.endsWith("USDT")) return null;
  if (CRYPTO_NOT_RWA_SYMBOLS.has(upper)) return null;

  const base = upper.slice(0, -4);
  if (!base || !/^[A-Z]{2,8}$/.test(base)) return null;

  // Check Ondo (*ONUSDT) BEFORE xStocks (*XUSDT) so NFLXONUSDT -> NFLX (Ondo)
  if (base.endsWith("ON") && base.length >= 3) {
    const canonicalTicker = base.slice(0, -2);
    if (/^[A-Z]{1,5}$/.test(canonicalTicker)) {
      return {
        symbol: upper,
        canonicalTicker,
        provider: "Ondo",
        isBlacklisted: BLACKLIST_TICKERS.has(canonicalTicker)
      };
    }
  }

  if (base.endsWith("X") && base.length >= 3) {
    const canonicalTicker = base.slice(0, -1);
    if (/^[A-Z]{2,5}$/.test(canonicalTicker)) {
      return {
        symbol: upper,
        canonicalTicker,
        provider: "xStocks",
        isBlacklisted: BLACKLIST_TICKERS.has(canonicalTicker)
      };
    }
  }

  return null;
}

/**
 * Used by Crypto Scout (isFilteredOutSymbol) to guarantee 100% isolation:
 * tokenized stocks NEVER mix into crypto signals.
 */
export function isTokenizedStockSymbol(symbol: string): boolean {
  return parseRwaSymbol(symbol) !== null;
}

export function deduplicateRwaTickers(
  tickers: MexcTicker24h[],
  minQuoteVolumeUsd = MIN_RWA_VOLUME_USD
): RwaStockTicker[] {
  const byCanonical = new Map<string, RwaStockTicker>();

  for (const t of tickers) {
    const parsed = parseRwaSymbol(t.symbol);
    if (!parsed || parsed.isBlacklisted) continue;
    if (!Number.isFinite(t.lastPrice) || t.lastPrice < 0.5) continue;
    if (!Number.isFinite(t.quoteVolume) || t.quoteVolume < minQuoteVolumeUsd) continue;

    // Extra price guard for *XUSDT (xStocks on MEXC are major US stocks >= $5)
    if (parsed.provider === "xStocks" && t.lastPrice < 5) continue;

    const item: RwaStockTicker = {
      symbol: parsed.symbol,
      canonicalTicker: parsed.canonicalTicker,
      provider: parsed.provider,
      lastPrice: t.lastPrice,
      priceChange24hPct: Number(t.priceChangePercent.toFixed(2)),
      quoteVolume24hUsd: Math.round(t.quoteVolume)
    };

    const existing = byCanonical.get(parsed.canonicalTicker);
    if (!existing) {
      byCanonical.set(parsed.canonicalTicker, item);
      continue;
    }

    // Higher 24h USD volume wins; Ondo wins exact ties
    if (
      item.quoteVolume24hUsd > existing.quoteVolume24hUsd ||
      (item.quoteVolume24hUsd === existing.quoteVolume24hUsd &&
        item.provider === "Ondo" &&
        existing.provider !== "Ondo")
    ) {
      byCanonical.set(parsed.canonicalTicker, item);
    }
  }

  return Array.from(byCanonical.values()).sort(
    (a, b) => b.quoteVolume24hUsd - a.quoteVolume24hUsd
  );
}

// =============================================================================
// SAFEGUARD #2: US STOCK MARKET HOURS GUARD (MON-FRI 09:30 - 20:30 UTC)
// =============================================================================

export function getUsStockMarketStatus(now = new Date()): UsMarketStatus {
  const utcDay = now.getUTCDay(); // 0=Sun, 1=Mon ... 5=Fri, 6=Sat
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isWeekday = utcDay >= 1 && utcDay <= 5;

  // 09:30 UTC (570m) -> 13:30 UTC (810m) = US Pre-Market
  // 13:30 UTC (810m) -> 20:30 UTC (1230m) = US Regular Session (stops 30m before close for gap protection)
  if (isWeekday && utcMinutes >= 570 && utcMinutes < 810) {
    return {
      isOpenForAutoSignals: true,
      sessionLabelUz: "🌅 AQSh Pre-Market",
      utcNowIso: now.toISOString()
    };
  }
  if (isWeekday && utcMinutes >= 810 && utcMinutes <= 1230) {
    return {
      isOpenForAutoSignals: true,
      sessionLabelUz: "🇺🇸 AQSh Bozor Ochiq",
      utcNowIso: now.toISOString()
    };
  }

  return {
    isOpenForAutoSignals: false,
    sessionLabelUz: "🌙 AQSh Bozor Yopiq (Gap himoyasi)",
    utcNowIso: now.toISOString()
  };
}

// =============================================================================
// SAFEGUARD #3: REAL NASDAQ / NYSE PEG CHECK (YAHOO FINANCE PUBLIC API)
// =============================================================================

export async function fetchRealStockQuote(canonicalTicker: string): Promise<number | null> {
  const ticker = canonicalTicker.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!ticker) return null;

  const now = Date.now();
  const cached = yahooQuoteCache.get(ticker);
  if (cached && now - cached.fetchedAt <= YAHOO_CACHE_MS) {
    return cached.price;
  }

  const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
  let price: number | null = null;

  for (const host of hosts) {
    try {
      const res = await axios.get<{
        chart?: {
          result?: Array<{
            meta?: { regularMarketPrice?: number; chartPreviousClose?: number };
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      }>(`${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=1d`, {
        timeout: 5000,
        httpsAgent: resilientHttpsAgent,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      const first = res.data?.chart?.result?.[0];
      const metaPrice = Number(first?.meta?.regularMarketPrice ?? 0);
      if (Number.isFinite(metaPrice) && metaPrice > 0) {
        price = roundPrice(metaPrice);
        break;
      }

      const closes = first?.indicators?.quote?.[0]?.close ?? [];
      for (let i = closes.length - 1; i >= 0; i--) {
        const val = Number(closes[i] ?? 0);
        if (Number.isFinite(val) && val > 0) {
          price = roundPrice(val);
          break;
        }
      }
      if (price !== null) break;
    } catch {
      // Try next host or degrade gracefully
    }
  }

  if (yahooQuoteCache.size >= MAX_YAHOO_CACHE_SIZE) {
    const oldestKey = yahooQuoteCache.keys().next().value;
    if (oldestKey) yahooQuoteCache.delete(oldestKey);
  }
  yahooQuoteCache.set(ticker, { fetchedAt: now, price });
  return price;
}

// =============================================================================
// SAFEGUARD #5: WALL STREET BENCHMARK (SPYONUSDT + QQQONUSDT 4H TREND)
// =============================================================================

export async function getUsIndexBenchmark(): Promise<UsIndexBenchmark> {
  const now = Date.now();
  if (cachedBenchmark && now - cachedBenchmark.fetchedAt <= BENCHMARK_CACHE_MS) {
    return cachedBenchmark.data;
  }

  const fetchIndex4h = async (
    symbol: string
  ): Promise<{ trend: TrendRegime; price: number | null }> => {
    try {
      const klines = await fetchMexcKlines(symbol, "4h", 40);
      if (klines.length > 0) {
        return {
          trend: detectTrendFromKlines(klines),
          price: roundPrice(klines[klines.length - 1].close)
        };
      }
    } catch {
      // Graceful fallback
    }
    return { trend: "NEUTRAL", price: null };
  };

  const [spy, qqq] = await Promise.all([
    fetchIndex4h("SPYONUSDT"),
    fetchIndex4h("QQQONUSDT")
  ]);

  const spyTrend4h: TrendRegime = spy.trend;
  const qqqTrend4h: TrendRegime = qqq.trend;
  const spyPrice: number | null = spy.price;
  const qqqPrice: number | null = qqq.price;

  let usIndexRegime: TrendRegime = "NEUTRAL";
  if (
    (spyTrend4h === "BULLISH" && qqqTrend4h !== "BEARISH") ||
    (qqqTrend4h === "BULLISH" && spyTrend4h !== "BEARISH")
  ) {
    usIndexRegime = "BULLISH";
  } else if (
    (spyTrend4h === "BEARISH" && qqqTrend4h !== "BULLISH") ||
    (qqqTrend4h === "BEARISH" && spyTrend4h !== "BULLISH")
  ) {
    usIndexRegime = "BEARISH";
  }

  const data: UsIndexBenchmark = {
    spyTrend4h,
    qqqTrend4h,
    usIndexRegime,
    spyPrice,
    qqqPrice,
    updatedAt: new Date(now).toISOString()
  };
  cachedBenchmark = { fetchedAt: now, data };
  return data;
}

// =============================================================================
// SAFEGUARD #6: STOCK-CALIBRATED QUANT ANALYSIS (LONG + STRICT 1x SHORT)
// =============================================================================

function computeStockLevels(
  entryPrice: number,
  direction: RwaDirection,
  tradeMode: TradeMode,
  atr14: number,
  supportLevel: number,
  resistanceLevel: number
): {
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  riskRewardRatio: number;
} {
  const entry = roundPrice(entryPrice);
  const safeAtr = Math.max(0, atr14);

  const mult1 = 1.8; // 60% close at TP1
  const mult2 = 3.0; // 40% close at TP2
  const mult3 = 4.0; // Extended runner shown on chart

  if (direction === "SHORT") {
    // Stock-calibrated SL bounds: +1.0% .. +2.0% (Intraday) / +1.5% .. +2.8% (Swing)
    const minPct = tradeMode === "SWING" ? 0.015 : 0.01;
    const maxPct = tradeMode === "SWING" ? 0.028 : 0.02;
    const atrStop = entry + Math.max(safeAtr * (tradeMode === "SWING" ? 2.0 : 1.6), entry * minPct);
    const resStop = resistanceLevel > entry ? resistanceLevel * 1.003 : atrStop;
    const clamped = Math.min(entry * (1 + maxPct), Math.max(entry * (1 + minPct), Math.max(atrStop, resStop)));
    const stopLossPrice = roundPrice(clamped);
    const risk = Math.max(stopLossPrice - entry, entry * minPct);

    const tp1Price = roundPrice(Math.max(entry * 0.05, entry - risk * mult1));
    const tp2Price = roundPrice(Math.max(entry * 0.03, Math.min(entry - risk * mult2, tp1Price * 0.996)));
    const tp3Price = roundPrice(Math.max(entry * 0.01, Math.min(entry - risk * mult3, tp2Price * 0.994)));

    if (!(stopLossPrice > entry && entry > tp1Price && tp1Price > tp2Price && tp2Price > tp3Price)) {
      throw new Error(`Invalid RWA SHORT ordering for entry=${entry}`);
    }

    return {
      entryPrice: entry,
      stopLossPrice,
      tp1Price,
      tp2Price,
      tp3Price,
      riskRewardRatio: Number(((entry - tp2Price) / risk).toFixed(2))
    };
  }

  // LONG: -1.0% .. -2.0% (Intraday) / -1.5% .. -2.8% (Swing)
  const minPct = tradeMode === "SWING" ? 0.015 : 0.01;
  const maxPct = tradeMode === "SWING" ? 0.028 : 0.02;
  const atrStop = entry - Math.max(safeAtr * (tradeMode === "SWING" ? 2.0 : 1.6), entry * minPct);
  const supStop = supportLevel > 0 && supportLevel < entry ? supportLevel * 0.997 : atrStop;
  const clamped = Math.max(entry * (1 - maxPct), Math.min(entry * (1 - minPct), Math.min(atrStop, supStop)));
  const stopLossPrice = roundPrice(clamped);
  const risk = Math.max(entry - stopLossPrice, entry * minPct);

  const tp1Price = roundPrice(entry + risk * mult1);
  const tp2Price = roundPrice(Math.max(entry + risk * mult2, tp1Price * 1.004));
  const tp3Price = roundPrice(Math.max(entry + risk * mult3, tp2Price * 1.006));

  if (!(stopLossPrice < entry && entry < tp1Price && tp1Price < tp2Price && tp2Price < tp3Price)) {
    throw new Error(`Invalid RWA LONG ordering for entry=${entry}`);
  }

  return {
    entryPrice: entry,
    stopLossPrice,
    tp1Price,
    tp2Price,
    tp3Price,
    riskRewardRatio: Number(((tp2Price - entry) / risk).toFixed(2))
  };
}

function formatRwaTelegramCaption(item: Omit<RwaStockAnalysisItem, "caption">): string {
  const dirBanner =
    item.direction === "SHORT"
      ? "🔴 *SHORT / SELL (1x — Xavfsiz Hedge / Nol likvidatsiya)*"
      : "🟢 *LONG (SPOT — Tokenizatsiya qilingan aksiya)*";
  const modeHeader = item.tradeMode === "SWING" ? "🏔️ SWING (4H)" : "⚡ INTRADAY (15M)";
  const verdictBadge =
    item.verdict === "APPROVE" ? "✅ TASDIQLANDI (APPROVE)" : "❌ RAD ETILDI (REJECT)";
  const pegText =
    item.realStockPrice !== null && item.pegPremiumPct !== null
      ? `$${item.realStockPrice} (${item.pegPremiumPct >= 0 ? "+" : ""}${item.pegPremiumPct}% Peg)`
      : "Aniqlanmadi (fallback)";
  const chgSign = item.priceChange24hPct >= 0 ? "+" : "";
  const noteLine = item.reasons[0] || "Barcha 7 ta RWA himoya filtri tekshirildi";

  return [
    `🏛️ *CRYPTOQUANT RWA — TOKEN-AKSIYA* | ${modeHeader}`,
    dirBanner,
    ``,
    `📈 *Aksiya:* \`${item.canonicalTicker}\` (\`${item.mexcSymbol}\` • MEXC ${item.provider})`,
    `📊 *Qaror:* ${verdictBadge} | *Ishonch:* ${item.confidenceScore}/100`,
    `💵 *MEXC Narx:* \`$${item.lastPrice}\` (${chgSign}${item.priceChange24hPct}%) | *NASDAQ:* ${pegText}`,
    ``,
    `🎯 *Kirish (Entry):* \`${item.entryPrice}\``,
    `✅ *TP1 (60% yopish):* \`${item.tp1Price}\``,
    `✅ *TP2 (40% asosiy):* \`${item.tp2Price}\``,
    `🚀 *TP3 (Max runner):* \`${item.tp3Price}\``,
    `🛑 *Stop-Loss (SL):* \`${item.stopLossPrice}\``,
    `⚖️ *Risk / Foyda (R:R):* 1:${item.riskRewardRatio}`,
    ``,
    `🧠 *RWA Tahlil:*`,
    `• *Trend:* 15M/${item.trend1h}/${item.trend4h} | SPY/QQQ 4H: *${item.usIndexRegime}*`,
    `• *Indikator:* RSI ${Math.round(item.rsi14)} | ADX ${Math.round(item.adx14)} | Spread: ${item.spreadPct}% | ±0.5% Depth: $${Math.round(item.depthHalfPctUsd)}`,
    `• *Holat:* ${item.marketStatus.sessionLabelUz} • ${noteLine}`,
    ``,
    `⚠️ *Limit buyurtma bilan kiring (RWA likvidlik qoidasi)*`,
    `_Moliyaviy maslahat emas. Riskni o'zingiz boshqaring._`
  ].join("\n");
}

async function resolveRwaInput(
  tickerOrSymbol: string,
  allTickers?: MexcTicker24h[]
): Promise<{
  mexcSymbol: string;
  canonicalTicker: string;
  provider: RwaProvider;
  ticker24h: MexcTicker24h | null;
}> {
  const cleaned = String(tickerOrSymbol || "")
    .trim()
    .toUpperCase()
    .replace(/^\$/, "")
    .replace(/[\/\-_\s]+/g, "");
  if (!cleaned || !/^[A-Z0-9]{1,16}$/.test(cleaned)) {
    throw new Error("Noto'g'ri aksiya belgisi. Masalan: NVDA, AAPL, TSLA.");
  }

  const withUsdt = cleaned.endsWith("USDT") ? cleaned : `${cleaned}USDT`;
  const directParsed = parseRwaSymbol(withUsdt);

  const universe = allTickers ?? (await getCachedMexcTickers24h());
  const bySymbol = new Map<string, MexcTicker24h>();
  for (const t of universe) bySymbol.set(t.symbol, t);

  if (directParsed) {
    if (directParsed.isBlacklisted) {
      throw new Error(
        `⛔ ${directParsed.canonicalTicker} — 3x kredit yelkali / taqiqlangan fond (RWA qora ro'yxatida).`
      );
    }
    const found = bySymbol.get(directParsed.symbol) ?? null;
    return {
      mexcSymbol: directParsed.symbol,
      canonicalTicker: directParsed.canonicalTicker,
      provider: directParsed.provider,
      ticker24h: found
    };
  }

  // Otherwise treat input as canonical US ticker (e.g. NVDA, AAPL, TSLA)
  const canonical = cleaned.endsWith("USDT") ? cleaned.slice(0, -4) : cleaned;
  if (BLACKLIST_TICKERS.has(canonical)) {
    throw new Error(
      `⛔ ${canonical} — 3x kredit yelkali / taqiqlangan fond (RWA qora ro'yxatida).`
    );
  }

  const ondoSym = `${canonical}ONUSDT`;
  const xSym = `${canonical}XUSDT`;
  const ondoT = bySymbol.get(ondoSym) ?? null;
  const xT = bySymbol.get(xSym) ?? null;

  if (ondoT && xT) {
    const pickOndo = ondoT.quoteVolume >= xT.quoteVolume;
    return pickOndo
      ? { mexcSymbol: ondoSym, canonicalTicker: canonical, provider: "Ondo", ticker24h: ondoT }
      : { mexcSymbol: xSym, canonicalTicker: canonical, provider: "xStocks", ticker24h: xT };
  }
  if (ondoT) {
    return { mexcSymbol: ondoSym, canonicalTicker: canonical, provider: "Ondo", ticker24h: ondoT };
  }
  if (xT) {
    return { mexcSymbol: xSym, canonicalTicker: canonical, provider: "xStocks", ticker24h: xT };
  }

  // Final fallback: attempt direct Ondo symbol fetch on MEXC
  const fetched = await fetchMexcTicker24h(ondoSym).catch(() => null);
  if (!fetched) {
    throw new Error(`MEXC Spot Ondo/xStocks bozorida "${canonical}" aksiyasi topilmadi.`);
  }
  return {
    mexcSymbol: ondoSym,
    canonicalTicker: canonical,
    provider: "Ondo",
    ticker24h: fetched
  };
}

async function evaluateRwaStockCore(
  resolved: {
    mexcSymbol: string;
    canonicalTicker: string;
    provider: RwaProvider;
    ticker24h: MexcTicker24h | null;
  },
  benchmark: UsIndexBenchmark,
  marketStatus: UsMarketStatus,
  includeChartPng: boolean
): Promise<{ item: RwaStockAnalysisItem; chartPng: Buffer | null }> {
  const { mexcSymbol, canonicalTicker, provider } = resolved;

  const [klines15m, klines1h, klines4h, book, realStockPrice, fallbackTicker] = await Promise.all([
    fetchMexcKlines(mexcSymbol, "15m", 80),
    fetchMexcKlines(mexcSymbol, "1h", 60).catch(() => [] as MexcKline[]),
    fetchMexcKlines(mexcSymbol, "4h", 50).catch(() => [] as MexcKline[]),
    fetchMexcOrderBook(mexcSymbol, 20).catch(() => ({ bids: [], asks: [] })),
    fetchRealStockQuote(canonicalTicker),
    resolved.ticker24h ? Promise.resolve(resolved.ticker24h) : fetchMexcTicker24h(mexcSymbol)
  ]);

  if (!klines15m || klines15m.length < 20) {
    throw new Error(`${mexcSymbol} uchun yetarli 15M sham ma'lumoti topilmadi.`);
  }

  const closed15m = klines15m.length > 2 ? klines15m.slice(0, -1) : klines15m;
  const closes15m = closed15m.map((k) => k.close);
  const lastPrice = roundPrice(fallbackTicker.lastPrice || closes15m[closes15m.length - 1]);
  const priceChange24hPct = Number(fallbackTicker.priceChangePercent.toFixed(2));
  const quoteVolume24hUsd = Math.round(fallbackTicker.quoteVolume);

  // Safeguard #4: Spread & ±0.5% USD depth
  const bestBid = book.bids[0]?.[0] ?? 0;
  const bestAsk = book.asks[0]?.[0] ?? 0;
  const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : lastPrice;
  const spreadPct =
    bestBid > 0 && bestAsk > 0 && midPrice > 0
      ? Number((((bestAsk - bestBid) / midPrice) * 100).toFixed(3))
      : 99;

  let depthHalfPctUsd = 0;
  if (midPrice > 0) {
    for (const [p, q] of book.bids) {
      if (p >= midPrice * 0.995) depthHalfPctUsd += p * q;
    }
    for (const [p, q] of book.asks) {
      if (p <= midPrice * 1.005) depthHalfPctUsd += p * q;
    }
  }
  depthHalfPctUsd = Math.round(depthHalfPctUsd);

  // Safeguard #3: Real NASDAQ Peg Premium %
  const pegPremiumPct =
    realStockPrice !== null && realStockPrice > 0
      ? Number((((lastPrice - realStockPrice) / realStockPrice) * 100).toFixed(2))
      : null;

  // Stock-Calibrated Technicals (EMA9/21/50, RSI14, Wilder ADX14, ATR14)
  const ema9Arr = calcEmaSeries(closes15m, 9);
  const ema21Arr = calcEmaSeries(closes15m, 21);
  const ema50Arr = calcEmaSeries(closes15m, 50);
  const li = closes15m.length - 1;
  const ema9 = roundPrice(ema9Arr[li] ?? lastPrice);
  const ema21 = roundPrice(ema21Arr[li] ?? lastPrice);
  const ema50 = roundPrice(ema50Arr[li] ?? ema21);
  const rsi14 = calcRsi(closes15m, 14);
  const adx14 = calcAdx14(closed15m);
  const atr14 = calcAtr(closed15m, 14);

  const recent20 = closed15m.slice(-20);
  const supportLevel = Math.min(...recent20.map((k) => k.low));
  const resistanceLevel = Math.max(...recent20.map((k) => k.high));

  const trend1h = detectTrendFromKlines(klines1h);
  const trend4h = detectTrendFromKlines(klines4h);

  const direction: RwaDirection = ema9 < ema21 ? "SHORT" : "LONG";
  const tradeMode: TradeMode =
    (direction === "LONG" && trend1h === "BULLISH" && trend4h === "BULLISH") ||
    (direction === "SHORT" && trend1h === "BEARISH" && trend4h === "BEARISH")
      ? "SWING"
      : "INTRADAY";

  const levels = computeStockLevels(
    lastPrice,
    direction,
    tradeMode,
    atr14,
    supportLevel,
    resistanceLevel
  );

  // Hard Safeguard Gates
  const rejectReasons: string[] = [];

  if (pegPremiumPct !== null && Math.abs(pegPremiumPct) > MAX_PEG_DIFF_PCT) {
    rejectReasons.push(
      `De-peg xavfi: real NASDAQ narxidan > 0.8% farq (${pegPremiumPct >= 0 ? "+" : ""}${pegPremiumPct}%)`
    );
  }
  if (spreadPct > MAX_RWA_SPREAD_PCT) {
    rejectReasons.push(`Spread juda keng (${spreadPct}% > ${MAX_RWA_SPREAD_PCT}%)`);
  }
  if (depthHalfPctUsd < MIN_RWA_DEPTH_HALF_PCT_USD) {
    rejectReasons.push(
      `Order-book sayoz (±0.5% chuqurlik $${depthHalfPctUsd} < $${MIN_RWA_DEPTH_HALF_PCT_USD})`
    );
  }
  if (adx14 < 18) {
    rejectReasons.push(`Aksiya yonlama/tinch (ADX ${adx14} < 18)`);
  }

  if (direction === "LONG") {
    if (rsi14 < 42 || rsi14 > 62) {
      rejectReasons.push(`LONG uchun RSI noqulay (${rsi14}, talab: 42–62)`);
    }
    if (lastPrice < ema9 * 0.997 || ema21 < ema50 * 0.996) {
      rejectReasons.push("15M EMA9/21/50 o'suvchi tuzilmasi to'liq tasdiqlanmagan");
    }
    if (trend1h === "BEARISH" || trend4h === "BEARISH") {
      rejectReasons.push(`Katta trend pasayuvchi (1H: ${trend1h}, 4H: ${trend4h})`);
    }
    if (benchmark.usIndexRegime === "BEARISH" && trend4h !== "BULLISH") {
      rejectReasons.push("Wall Street indekslari (SPY/QQQ 4H) BEARISH — qarshi LONG bloklandi");
    }
  } else {
    if (rsi14 < 38 || rsi14 > 58) {
      rejectReasons.push(`SHORT (1x) uchun RSI noqulay (${rsi14}, talab: 38–58)`);
    }
    if (lastPrice > ema9 * 1.003 || ema21 > ema50 * 1.004) {
      rejectReasons.push("15M EMA9/21/50 pasayuvchi tuzilmasi to'liq tasdiqlanmagan");
    }
    if (trend1h === "BULLISH" || trend4h === "BULLISH") {
      rejectReasons.push(`Katta trend o'suvchi (1H: ${trend1h}, 4H: ${trend4h})`);
    }
    if (benchmark.usIndexRegime === "BULLISH" && trend4h !== "BEARISH") {
      rejectReasons.push("Wall Street indekslari (SPY/QQQ 4H) BULLISH — qarshi SHORT bloklandi");
    }
  }

  // Score calculation (0-100)
  let score = 46;
  if (adx14 >= 22) score += 12;
  else if (adx14 >= 18) score += 7;
  else score -= 12;

  if (direction === "LONG") {
    if (rsi14 >= 45 && rsi14 <= 60) score += 14;
    if (trend1h === "BULLISH") score += 8;
    if (trend4h === "BULLISH") score += 8;
    if (benchmark.usIndexRegime === "BULLISH") score += 6;
  } else {
    if (rsi14 >= 40 && rsi14 <= 55) score += 14;
    if (trend1h === "BEARISH") score += 8;
    if (trend4h === "BEARISH") score += 8;
    if (benchmark.usIndexRegime === "BEARISH") score += 6;
  }
  if (spreadPct <= 0.12) score += 6;
  else if (spreadPct > MAX_RWA_SPREAD_PCT) score -= 15;
  if (depthHalfPctUsd >= 8000) score += 4;
  else if (depthHalfPctUsd < MIN_RWA_DEPTH_HALF_PCT_USD) score -= 12;
  if (pegPremiumPct !== null && Math.abs(pegPremiumPct) > MAX_PEG_DIFF_PCT) score -= 20;

  const confidenceScore = Math.max(0, Math.min(100, Math.round(score)));
  if (confidenceScore < 65) {
    rejectReasons.push(`RWA ishonch balli yetarli emas (${confidenceScore}/100 < 65)`);
  }

  const verdict: "APPROVE" | "REJECT" = rejectReasons.length === 0 ? "APPROVE" : "REJECT";
  const reasons =
    verdict === "APPROVE"
      ? [
          `${direction === "SHORT" ? "1x SHORT Hedge" : "LONG Spot"} (${tradeMode}) | SPY/QQQ 4H: ${benchmark.usIndexRegime} | Spread ${spreadPct}%`
        ]
      : rejectReasons;

  const baseItem: Omit<RwaStockAnalysisItem, "caption"> = {
    canonicalTicker,
    mexcSymbol,
    provider,
    direction,
    tradeMode,
    verdict,
    confidenceScore,
    lastPrice,
    priceChange24hPct,
    quoteVolume24hUsd,
    realStockPrice,
    pegPremiumPct,
    spreadPct,
    depthHalfPctUsd,
    entryPrice: levels.entryPrice,
    stopLossPrice: levels.stopLossPrice,
    tp1Price: levels.tp1Price,
    tp2Price: levels.tp2Price,
    tp3Price: levels.tp3Price,
    riskRewardRatio: levels.riskRewardRatio,
    rsi14,
    adx14,
    ema9,
    ema21,
    trend1h,
    trend4h,
    usIndexRegime: benchmark.usIndexRegime,
    marketStatus,
    reasons,
    tradingViewUrl: buildRwaTradingViewUrl(canonicalTicker),
    analyzedAt: new Date().toISOString()
  };

  const caption = formatRwaTelegramCaption(baseItem);
  const item: RwaStockAnalysisItem = { ...baseItem, caption };

  let chartPng: Buffer | null = null;
  if (includeChartPng) {
    chartPng = generate15mChartPng(klines15m, {
      symbol: mexcSymbol,
      direction,
      entryPrice: levels.entryPrice,
      takeProfitPrice: levels.tp2Price,
      stopLossPrice: levels.stopLossPrice,
      verdict,
      timeframeLabel: "15M"
    });
  }

  return { item, chartPng };
}

export async function analyzeRwaStock(tickerOrSymbol: string): Promise<RwaStockAnalysisResult> {
  const [resolved, benchmark] = await Promise.all([
    resolveRwaInput(tickerOrSymbol),
    getUsIndexBenchmark()
  ]);
  const marketStatus = getUsStockMarketStatus();
  const { item, chartPng } = await evaluateRwaStockCore(resolved, benchmark, marketStatus, true);
  if (!chartPng) {
    throw new Error(`${resolved.mexcSymbol} uchun 15M grafik chizilmadi.`);
  }
  return { ...item, chartPng };
}

// =============================================================================
// SAFEGUARD #7: ISOLATED 5-MINUTE RWA SCANNER & TELEGRAM AUTO-DISPATCH
// =============================================================================

function hasTelegramCredentials(): boolean {
  const tok = (env.TELEGRAM_BOT_TOKEN || "").trim().toLowerCase();
  const cid = (env.TELEGRAM_CHANNEL_ID || "").trim().toLowerCase();
  return tok.length > 10 && tok !== "pending" && tok !== "none" && cid.length > 3 && cid !== "pending" && cid !== "none";
}

async function dispatchRwaTelegramAlert(
  item: RwaStockAnalysisItem,
  chartPng: Buffer
): Promise<boolean> {
  if (!hasTelegramCredentials()) return false;
  try {
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "📈 TradingView (NASDAQ 15M)", url: item.tradingViewUrl }]
      ]
    };
    const form = new FormData();
    form.append("chat_id", env.TELEGRAM_CHANNEL_ID);
    form.append("caption", item.caption);
    form.append("parse_mode", "Markdown");
    form.append("reply_markup", JSON.stringify(replyMarkup));
    form.append(
      "photo",
      new Blob([new Uint8Array(chartPng)], { type: "image/png" }),
      `${item.canonicalTicker}-rwa-15m.png`
    );

    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(15000)
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

export async function runRwaStockScan(): Promise<RwaScanSnapshot> {
  const started = Date.now();
  const marketStatus = getUsStockMarketStatus();
  // Reuse MEXC's 24h ticker snapshot from the 60s Crypto Scout cycle (0 extra 24hr API calls)
  const [allTickers, benchmark] = await Promise.all([
    getCachedMexcTickers24h(180_000),
    getUsIndexBenchmark()
  ]);

  const universe = deduplicateRwaTickers(allTickers, MIN_RWA_VOLUME_USD);
  const tickerBySymbol = new Map<string, MexcTicker24h>();
  for (const t of allTickers) tickerBySymbol.set(t.symbol, t);

  // Rank Top 8 most active deduplicated stocks by volume & absolute 24h move
  const top8 = [...universe]
    .sort((a, b) => {
      const scoreA = a.quoteVolume24hUsd * (1 + Math.min(Math.abs(a.priceChange24hPct), 12) * 0.12);
      const scoreB = b.quoteVolume24hUsd * (1 + Math.min(Math.abs(b.priceChange24hPct), 12) * 0.12);
      return scoreB - scoreA;
    })
    .slice(0, 8);

  let dispatchedCount = 0;
  const evaluated = await mapWithConcurrency(top8, 2, async (st): Promise<RwaStockAnalysisItem | null> => {
    try {
      const resolved = {
        mexcSymbol: st.symbol,
        canonicalTicker: st.canonicalTicker,
        provider: st.provider,
        ticker24h: tickerBySymbol.get(st.symbol) ?? null
      };
      const { item } = await evaluateRwaStockCore(resolved, benchmark, marketStatus, false);

      // Auto-dispatch ONLY when RWA is enabled AND US Market is open (Mon-Fri 09:30-20:30 UTC)
      if (item.verdict === "APPROVE" && rwaEnabled && marketStatus.isOpenForAutoSignals) {
        const lastSentTs = rwaAlertCooldownMap.get(item.canonicalTicker) ?? 0;
        if (Date.now() - lastSentTs >= RWA_ALERT_COOLDOWN_MS) {
          const full = await analyzeRwaStock(item.mexcSymbol);
          const sent = await dispatchRwaTelegramAlert(full, full.chartPng);
          rwaAlertCooldownMap.set(item.canonicalTicker, Date.now());
          if (sent) {
            dispatchedCount += 1;
            pushActivityLog(
              "ALERT",
              "SUCCESS",
              `RWA Signal yuborildi: ${item.canonicalTicker} (${item.direction === "SHORT" ? "1x SHORT" : "LONG"}) | Entry ${item.entryPrice} | Spread ${item.spreadPct}%`
            );
          }
        }
      }

      return item;
    } catch {
      return null;
    }
  });

  const stocks = evaluated
    .filter((x): x is RwaStockAnalysisItem => x !== null)
    .sort((a, b) => b.confidenceScore - a.confidenceScore);

  const snapshot: RwaScanSnapshot = {
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    activeMirror: getActiveMexcMirror(),
    rwaEnabled,
    marketStatus,
    benchmark,
    totalUniverseCount: universe.length,
    deepScannedCount: stocks.length,
    approvedCount: stocks.filter((s) => s.verdict === "APPROVE").length,
    dispatchedCount,
    stocks
  };

  latestRwaSnapshot = snapshot;
  return snapshot;
}

export function resetRwaStateForTest(): void {
  rwaEnabled = true;
  latestRwaSnapshot = null;
  cachedBenchmark = null;
  yahooQuoteCache.clear();
  rwaAlertCooldownMap.clear();
  try {
    if (fs.existsSync(RWA_SETTINGS_FILE)) {
      fs.unlinkSync(RWA_SETTINGS_FILE);
    }
  } catch {
    // Non-fatal
  }
}
