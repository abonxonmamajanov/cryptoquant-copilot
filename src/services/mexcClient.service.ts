import axios, { AxiosError } from "axios";
import { resilientHttpsAgent } from "./marketHealth.service";

const MEXC_MIRRORS = [
  "https://api.mexc.com",
  "https://api.mexc.io",
  "https://api.mexc.co"
];

let activeMirrorIndex = 0;

export interface MexcTicker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  volume: number;
  highPrice: number;
  lowPrice: number;
}

export interface MexcKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteAssetVolume: number;
}

export interface MexcOrderBook {
  bids: Array<[number, number]>; // [price, qty]
  asks: Array<[number, number]>; // [price, qty]
}

export function getActiveMexcMirror(): string {
  return MEXC_MIRRORS[activeMirrorIndex];
}

async function fetchWithMirrorFallback<T>(path: string, timeoutMs = 10000): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MEXC_MIRRORS.length; attempt++) {
    const idx = (activeMirrorIndex + attempt) % MEXC_MIRRORS.length;
    const baseUrl = MEXC_MIRRORS[idx];
    const url = `${baseUrl}${path}`;

    try {
      const response = await axios.get<T>(url, {
        timeout: timeoutMs,
        httpsAgent: resilientHttpsAgent,
        headers: {
          Accept: "application/json",
          "User-Agent": "CryptoQuant-Copilot/0.3"
        }
      });
      activeMirrorIndex = idx;
      return response.data;
    } catch (err) {
      lastError = err;
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 429) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : "All MEXC mirrors failed";
  throw new Error(`MEXC request failed for ${path}: ${msg}`);
}

function normalizeMexcPriceChangePct(rawPct: unknown, lastPrice: number, openPrice: unknown): number {
  const open = Number(openPrice || 0);
  if (Number.isFinite(open) && open > 0 && Number.isFinite(lastPrice) && lastPrice > 0) {
    return Number((((lastPrice - open) / open) * 100).toFixed(4));
  }
  const n = Number(rawPct || 0);
  if (!Number.isFinite(n)) return 0;
  // MEXC /api/v3/ticker/24hr returns decimal ratio (e.g. 0.05 = +5%, 2.254 = +225.4%)
  return Number((n * 100).toFixed(4));
}

export async function fetchMexcTickers24h(): Promise<MexcTicker24h[]> {
  const raw = await fetchWithMirrorFallback<Array<Record<string, string>>>("/api/v3/ticker/24hr", 15000);

  return raw
    .map((item) => {
      const lastPrice = Number(item.lastPrice || 0);
      return {
        symbol: String(item.symbol || ""),
        lastPrice,
        priceChangePercent: normalizeMexcPriceChangePct(item.priceChangePercent, lastPrice, item.openPrice),
        quoteVolume: Number(item.quoteVolume || 0),
        volume: Number(item.volume || 0),
        highPrice: Number(item.highPrice || 0),
        lowPrice: Number(item.lowPrice || 0)
      };
    })
    .filter((t) => t.symbol.length > 0 && Number.isFinite(t.lastPrice) && t.lastPrice > 0);
}

export async function fetchMexcTicker24h(symbol: string): Promise<MexcTicker24h> {
  const item = await fetchWithMirrorFallback<Record<string, string>>(
    `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol.toUpperCase().trim())}`,
    10000
  );
  const lastPrice = Number(item.lastPrice || 0);
  if (!item.symbol || !Number.isFinite(lastPrice) || lastPrice <= 0) {
    throw new Error(`Ticker not found on MEXC Spot: ${symbol}`);
  }
  return {
    symbol: String(item.symbol),
    lastPrice,
    priceChangePercent: normalizeMexcPriceChangePct(item.priceChangePercent, lastPrice, item.openPrice),
    quoteVolume: Number(item.quoteVolume || 0),
    volume: Number(item.volume || 0),
    highPrice: Number(item.highPrice || 0),
    lowPrice: Number(item.lowPrice || 0)
  };
}

export async function fetchMexcTickerPrice(symbol: string): Promise<number> {
  const data = await fetchWithMirrorFallback<{ symbol: string; price: string }>(
    `/api/v3/ticker/price?symbol=${encodeURIComponent(symbol.toUpperCase().trim())}`,
    8000
  );
  const price = Number(data.price || 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid live price for ${symbol}`);
  }
  return price;
}

export async function fetchMexcKlines(
  symbol: string,
  interval: "15m" | "1h" | "60m" | "4h" = "15m",
  limit = 60
): Promise<MexcKline[]> {
  const mexcInterval = interval === "1h" ? "60m" : interval;
  const raw = await fetchWithMirrorFallback<Array<Array<string | number>>>(
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${mexcInterval}&limit=${limit}`,
    10000
  );

  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
    quoteAssetVolume: Number(k[7])
  }));
}

export async function fetchMexcKlines15m(symbol: string, limit = 22): Promise<MexcKline[]> {
  return fetchMexcKlines(symbol, "15m", limit);
}

export async function fetchMexcOrderBook(symbol: string, limit = 20): Promise<MexcOrderBook> {
  const raw = await fetchWithMirrorFallback<{
    bids: Array<[string, string]>;
    asks: Array<[string, string]>;
  }>(`/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`, 10000);

  return {
    bids: (raw.bids || []).map(([p, q]) => [Number(p), Number(q)]),
    asks: (raw.asks || []).map(([p, q]) => [Number(p), Number(q)])
  };
}
