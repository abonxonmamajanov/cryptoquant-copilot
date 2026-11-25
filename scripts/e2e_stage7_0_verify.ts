import http from "http";
import { app } from "../src/index";
import { isFilteredOutSymbol } from "../src/agents/scout.agent";
import {
  analyzeRwaStock,
  BLACKLIST_TICKERS,
  deduplicateRwaTickers,
  getUsStockMarketStatus,
  parseRwaSymbol,
  resetRwaStateForTest
} from "../src/services/rwaStocks.service";
import type { MexcTicker24h } from "../src/services/mexcClient.service";

async function main() {
  console.log("=== Stage 7.0 (Isolated Tokenized Stocks — MEXC Ondo & xStocks RWA) E2E Started ===");
  resetRwaStateForTest();

  // 1. Blacklist strictly blocks SOXLONUSDT, SOXSONUSDT, TQQQONUSDT, BILONUSDT
  const blacklistedSymbols = ["SOXLONUSDT", "SOXSONUSDT", "TQQQONUSDT", "BILONUSDT"];
  for (const sym of blacklistedSymbols) {
    const parsed = parseRwaSymbol(sym);
    if (!parsed || !parsed.isBlacklisted) {
      throw new Error(`Expected ${sym} to be parsed and marked blacklisted: ${JSON.stringify(parsed)}`);
    }
  }

  const mockTickers: MexcTicker24h[] = [
    { symbol: "SOXLONUSDT", lastPrice: 28, priceChangePercent: 5, quoteVolume: 300_000, volume: 10000, highPrice: 29, lowPrice: 27 },
    { symbol: "SOXSONUSDT", lastPrice: 6.4, priceChangePercent: -5, quoteVolume: 420_000, volume: 65000, highPrice: 7, lowPrice: 6 },
    { symbol: "TQQQONUSDT", lastPrice: 45, priceChangePercent: 3, quoteVolume: 210_000, volume: 4600, highPrice: 46, lowPrice: 44 },
    { symbol: "BILONUSDT", lastPrice: 91.5, priceChangePercent: 0.01, quoteVolume: 180_000, volume: 1900, highPrice: 91.6, lowPrice: 91.4 },
    { symbol: "NVDAONUSDT", lastPrice: 151.7, priceChangePercent: -2.1, quoteVolume: 235_000, volume: 1540, highPrice: 155, lowPrice: 149 },
    { symbol: "NVDAXUSDT", lastPrice: 151.6, priceChangePercent: -2.2, quoteVolume: 82_000, volume: 540, highPrice: 155, lowPrice: 149 },
    { symbol: "AAPLONUSDT", lastPrice: 230.0, priceChangePercent: 1.1, quoteVolume: 150_000, volume: 650, highPrice: 232, lowPrice: 228 },
    { symbol: "AAPLXUSDT", lastPrice: 230.0, priceChangePercent: 1.1, quoteVolume: 150_000, volume: 650, highPrice: 232, lowPrice: 228 }
  ];

  const deduped = deduplicateRwaTickers(mockTickers, 100_000);
  if (
    deduped.some((d) => BLACKLIST_TICKERS.has(d.canonicalTicker)) ||
    deduped.length !== 2
  ) {
    throw new Error(`Blacklist or deduplication failed: ${JSON.stringify(deduped)}`);
  }
  const nvdaEntry = deduped.find((d) => d.canonicalTicker === "NVDA");
  const aaplEntry = deduped.find((d) => d.canonicalTicker === "AAPL");
  if (
    !nvdaEntry ||
    nvdaEntry.symbol !== "NVDAONUSDT" ||
    nvdaEntry.provider !== "Ondo" ||
    !aaplEntry ||
    aaplEntry.symbol !== "AAPLONUSDT" ||
    aaplEntry.provider !== "Ondo"
  ) {
    throw new Error(`Deduplication failed to prefer Ondo for NVDA/AAPL: ${JSON.stringify(deduped)}`);
  }

  let soxlRejected = false;
  try {
    await analyzeRwaStock("SOXL");
  } catch (err) {
    if (err instanceof Error && err.message.includes("qora ro'yxatida")) {
      soxlRejected = true;
    }
  }
  if (!soxlRejected) {
    throw new Error("Expected analyzeRwaStock('SOXL') to reject blacklisted 3x ETF");
  }
  console.log(
    "[PASS] 1. Blacklist (SOXL/SOXS/TQQQ/BIL blocked) & Provider Deduplication (NVDA/AAPL -> Ondo) verified"
  );

  // 2. Strict Crypto Isolation Wall: RWA stocks excluded from Crypto Scout, real crypto untouched
  const mustBeExcludedFromCrypto = ["NVDAONUSDT", "NVDAXUSDT", "AAPLONUSDT", "SOXLONUSDT", "SPYONUSDT"];
  for (const sym of mustBeExcludedFromCrypto) {
    if (!isFilteredOutSymbol(sym)) {
      throw new Error(`Crypto isolation breach: isFilteredOutSymbol('${sym}') returned false!`);
    }
  }
  const mustStayInCrypto = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "TRXUSDT", "AVAXUSDT", "TONUSDT", "IMXUSDT", "SNXUSDT", "STXUSDT"];
  for (const sym of mustStayInCrypto) {
    if (isFilteredOutSymbol(sym)) {
      throw new Error(`Crypto false positive: isFilteredOutSymbol('${sym}') wrongly blocked real crypto!`);
    }
  }
  console.log(
    `[PASS] 2. Strict Crypto Isolation verified (${mustBeExcludedFromCrypto.length} RWA excluded; ${mustStayInCrypto.length} real crypto untouched)`
  );

  // 3. US Stock Market Hours Guard (Mon-Fri 09:30-20:30 UTC)
  const wedPre = getUsStockMarketStatus(new Date("2026-11-25T11:00:00Z"));
  const wedOpen = getUsStockMarketStatus(new Date("2026-11-25T15:30:00Z"));
  const friGapGuard = getUsStockMarketStatus(new Date("2026-11-27T20:45:00Z"));
  const satClosed = getUsStockMarketStatus(new Date("2026-11-28T15:00:00Z"));
  if (
    !wedPre.isOpenForAutoSignals ||
    !wedOpen.isOpenForAutoSignals ||
    friGapGuard.isOpenForAutoSignals ||
    satClosed.isOpenForAutoSignals
  ) {
    throw new Error(
      `US Market Hours Guard mismatch: ${JSON.stringify({ wedPre, wedOpen, friGapGuard, satClosed })}`
    );
  }
  console.log(
    `[PASS] 3. US Market Hours Guard verified (Pre=${wedPre.isOpenForAutoSignals}, Open=${wedOpen.isOpenForAutoSignals}, Fri20:45=${friGapGuard.isOpenForAutoSignals}, Sat=${satClosed.isOpenForAutoSignals})`
  );

  // 4. Live analyzeRwaStock("NVDA") — valid levels (SL/Entry/TP1/TP2/TP3) + valid 15M PNG chart + NASDAQ Peg
  const nvda = await analyzeRwaStock("NVDA");
  const validLongOrder =
    nvda.direction === "LONG" &&
    nvda.stopLossPrice < nvda.entryPrice &&
    nvda.entryPrice < nvda.tp1Price &&
    nvda.tp1Price < nvda.tp2Price &&
    nvda.tp2Price < nvda.tp3Price;
  const validShortOrder =
    nvda.direction === "SHORT" &&
    nvda.stopLossPrice > nvda.entryPrice &&
    nvda.entryPrice > nvda.tp1Price &&
    nvda.tp1Price > nvda.tp2Price &&
    nvda.tp2Price > nvda.tp3Price;

  if (!validLongOrder && !validShortOrder) {
    throw new Error(`Invalid NVDA RWA levels (${nvda.direction}): ${JSON.stringify(nvda)}`);
  }
  if (
    !Buffer.isBuffer(nvda.chartPng) ||
    nvda.chartPng.length < 2500 ||
    nvda.chartPng[0] !== 0x89 ||
    nvda.chartPng[1] !== 0x50 ||
    nvda.chartPng[2] !== 0x4e ||
    nvda.chartPng[3] !== 0x47
  ) {
    throw new Error("NVDA 15M PNG chart failed magic header or size check");
  }
  if (
    !nvda.caption.includes("Limit buyurtma bilan kiring (RWA likvidlik qoidasi)") ||
    !nvda.tradingViewUrl.includes("symbol=NVDA")
  ) {
    throw new Error(`NVDA RWA caption/TradingView URL missing required safeguards:\n${nvda.caption}`);
  }
  console.log(
    `[PASS] 4. Live NVDA RWA verified: ${nvda.mexcSymbol} (${nvda.provider}) | MEXC=$${nvda.lastPrice} | NASDAQ=${nvda.realStockPrice ?? "N/A"} (Peg=${nvda.pegPremiumPct !== null ? `${nvda.pegPremiumPct}%` : "N/A"}) | Spread=${nvda.spreadPct}% | Depth±0.5%=$${nvda.depthHalfPctUsd} | ${nvda.direction} ${nvda.verdict} (${nvda.confidenceScore}/100) | Entry=${nvda.entryPrice} TP1=${nvda.tp1Price} TP2=${nvda.tp2Price} SL=${nvda.stopLossPrice} | PNG=${nvda.chartPng.length}B`
  );

  // 5. Ephemeral HTTP checks: GET /api/rwa/latest, GET /api/rwa/check/NVDA, POST /api/rwa/toggle, GET /
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind ephemeral port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const [latestRes, checkRes, xssRes, dashRes] = await Promise.all([
      fetch(`${baseUrl}/api/rwa/latest`),
      fetch(`${baseUrl}/api/rwa/check/NVDA`),
      fetch(`${baseUrl}/api/rwa/check/${encodeURIComponent("<script>alert(1)</script>")}`),
      fetch(`${baseUrl}/`)
    ]);

    const latestBody = await latestRes.json();
    const checkBody = await checkRes.json();
    const dashHtml = await dashRes.text();

    if (latestRes.status !== 200 || !latestBody.ok || typeof latestBody.rwaEnabled !== "boolean") {
      throw new Error(`GET /api/rwa/latest failed: HTTP ${latestRes.status} ${JSON.stringify(latestBody)}`);
    }
    if (
      checkRes.status !== 200 ||
      !checkBody.ok ||
      checkBody.result?.canonicalTicker !== "NVDA" ||
      !String(checkBody.result?.chartDataUrl || "").startsWith("data:image/png;base64,")
    ) {
      throw new Error(`GET /api/rwa/check/NVDA failed: HTTP ${checkRes.status}`);
    }
    if (xssRes.status !== 400) {
      throw new Error(`Expected XSS payload on /api/rwa/check to return 400, got ${xssRes.status}`);
    }
    if (dashRes.status !== 200 || !dashHtml.includes("Token-Aksiyalar (RWA)")) {
      throw new Error("GET / missing 5th Dashboard tab 'Token-Aksiyalar (RWA)'");
    }

    const togOff = await fetch(`${baseUrl}/api/rwa/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });
    const togOffBody = await togOff.json();
    if (togOff.status !== 200 || togOffBody.rwaEnabled !== false) {
      throw new Error(`POST /api/rwa/toggle OFF failed: ${JSON.stringify(togOffBody)}`);
    }

    console.log(
      "[PASS] 5. HTTP checks verified: /api/rwa/latest (200), /api/rwa/check/NVDA (200 + PNG), XSS blocked (400), /api/rwa/toggle (200), GET / contains 'Token-Aksiyalar (RWA)'"
    );
  } finally {
    resetRwaStateForTest();
    server.close();
  }

  console.log("=== Stage 7.0 Isolated Tokenized Stocks (RWA) Verification Completed (100% PASS) ===");
}

main().catch((err) => {
  resetRwaStateForTest();
  console.error("[FAIL] Stage 7.0 Verification Error:", err);
  process.exit(1);
});
