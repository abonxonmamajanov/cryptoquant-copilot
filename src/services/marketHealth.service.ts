import axios from "axios";
import dns from "dns";
import https from "https";
import { env } from "../config/env";

export interface ProviderCheckResult {
  provider: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

const dohCache = new Map<string, { ip: string; expiresAt: number }>();

async function resolveViaDoH(hostname: string): Promise<string | null> {
  const cached = dohCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ip;
  }
  const endpoints = [
    "https://1.0.0.1/dns-query",
    "https://cloudflare-dns.com/dns-query"
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(
        `${endpoint}?name=${encodeURIComponent(hostname)}&type=A`,
        {
          headers: { accept: "application/dns-json" },
          signal: AbortSignal.timeout(6000)
        }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        Answer?: Array<{ type: number; data: string; TTL?: number }>;
      };
      const record = data.Answer?.find((a) => a.type === 1);
      if (!record?.data) continue;
      dohCache.set(hostname, {
        ip: record.data,
        expiresAt: Date.now() + Math.max(30, record.TTL ?? 60) * 1000
      });
      return record.data;
    } catch {
      // Try next DoH endpoint
    }
  }
  return null;
}

function resilientLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ) => void
): void {
  const respond = (ip: string) => {
    if (options && options.all) {
      callback(null, [{ address: ip, family: 4 }]);
    } else {
      callback(null, ip, 4);
    }
  };

  const cached = dohCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    respond(cached.ip);
    return;
  }

  let settled = false;
  const fallbackToDoH = (origErr: NodeJS.ErrnoException | null) => {
    resolveViaDoH(hostname)
      .then((ip) => {
        if (settled) return;
        settled = true;
        if (ip) {
          respond(ip);
        } else {
          callback(origErr ?? new Error(`Failed to resolve ${hostname}`), "");
        }
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        callback(origErr ?? new Error(`Failed to resolve ${hostname}`), "");
      });
  };

  const timer = setTimeout(() => {
    if (!settled) {
      fallbackToDoH(null);
    }
  }, 1500);

  dns.lookup(hostname, { family: 4 }, (err, address) => {
    clearTimeout(timer);
    if (settled) return;
    if (!err && address) {
      settled = true;
      respond(address);
    } else {
      fallbackToDoH(err);
    }
  });
}

const resilientHttpsAgent = new https.Agent({
  keepAlive: false,
  lookup: resilientLookup as unknown as https.AgentOptions["lookup"]
});

async function checkEndpointWithFallbacks(
  provider: string,
  urls: string[],
  headers?: Record<string, string>
): Promise<ProviderCheckResult> {
  const started = Date.now();
  let lastError = "Unknown error";

  for (const url of urls) {
    const attemptStart = Date.now();
    try {
      const res = await axios.get(url, {
        timeout: 10000,
        httpsAgent: resilientHttpsAgent,
        headers: {
          "User-Agent": "cryptoquant-copilot/0.1.0",
          ...headers
        }
      });
      if (res.status >= 200 && res.status < 300) {
        const host = new URL(url).hostname;
        return {
          provider,
          ok: true,
          latencyMs: Date.now() - attemptStart,
          detail: `HTTP ${res.status} (${host})`
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : "Unknown error";
    }
  }

  return {
    provider,
    ok: false,
    latencyMs: Date.now() - started,
    detail: lastError
  };
}

export async function runMarketHealthChecks(): Promise<ProviderCheckResult[]> {
  const cgHeaders: Record<string, string> = {};
  if (env.COINGECKO_API_KEY) {
    cgHeaders["x-cg-demo-api-key"] = env.COINGECKO_API_KEY;
  }

  return Promise.all([
    checkEndpointWithFallbacks("MEXC Public API", [
      "https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT",
      "https://api.mexc.io/api/v3/ticker/price?symbol=BTCUSDT",
      "https://api.mexc.co/api/v3/ticker/price?symbol=BTCUSDT"
    ]),
    checkEndpointWithFallbacks("Binance Public API", [
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT"
    ]),
    checkEndpointWithFallbacks(
      "CoinGecko API",
      ["https://api.coingecko.com/api/v3/ping"],
      cgHeaders
    )
  ]);
}
