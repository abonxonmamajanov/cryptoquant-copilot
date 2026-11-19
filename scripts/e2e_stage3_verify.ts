import http from "http";
import { app } from "../src/index";
import {
  canDispatchSignal,
  markSignalDispatched,
  resetCooldownsForTest
} from "../src/services/cooldown.service";
import {
  evaluateOpenDemoTrades,
  getDemoPortfolioSummary,
  openDemoTradeFromSignal,
  resetDemoPortfolioForTest
} from "../src/services/demoPortfolio.service";

async function main() {
  console.log("=== Stage 3 (Demo Portfolio, Cooldown & PDF Report) E2E Verification Started ===");

  // 1. Test 2h Anti-Spam Cooldown
  resetCooldownsForTest();
  if (!canDispatchSignal("SOLUSDT")) throw new Error("Expected SOLUSDT to be dispatchable initially");
  markSignalDispatched("SOLUSDT");
  if (canDispatchSignal("SOLUSDT")) throw new Error("Expected SOLUSDT to be blocked during 2h cooldown");
  console.log("[PASS] 2-hour anti-spam cooldown verified");

  // 2. Test Demo Portfolio TP_HIT and SL_HIT lifecycle
  resetDemoPortfolioForTest();
  const baseRecord = (symbol: string, entry: number, tp: number, sl: number) => ({
    scout: {
      symbol,
      exchange: "MEXC" as const,
      lastPrice: entry,
      priceChange24hPct: 5,
      quoteVolume24hUsd: 10_000_000,
      volumeSpikeRatio15m: 2.2,
      momentum15mPct: 1.5,
      scoutScore: 75,
      isAnomaly: true,
      isNewAlert: true,
      reasons: ["Test"],
      detectedAt: new Date().toISOString()
    },
    technician: {
      symbol,
      direction: "LONG" as const,
      entryPrice: entry,
      stopLossPrice: sl,
      takeProfitPrice: tp,
      riskRewardRatio: 2.5,
      rsi14: 55,
      ema9: entry,
      ema21: entry * 0.99,
      atr14: entry * 0.01,
      supportLevel: sl,
      resistanceLevel: tp,
      techScore: 80,
      summary: "Test",
      latencyMs: 5
    },
    macroFlow: {
      symbol,
      btcChange1hPct: 0.4,
      bidDepthUsd: 100_000,
      askDepthUsd: 70_000,
      bidAskRatio: 1.4,
      spreadPct: 0.05,
      regime: "BULLISH" as const,
      macroScore: 80,
      summary: "Test",
      latencyMs: 5
    },
    criticRisk: {
      symbol,
      verdict: "APPROVE" as const,
      confidenceScore: 78,
      reasons: ["Approved"],
      latencyMs: 2
    },
    executive: null
  });

  const t1 = openDemoTradeFromSignal(baseRecord("TEST1USDT", 100, 110, 96));
  const t2 = openDemoTradeFromSignal(baseRecord("TEST2USDT", 100, 110, 96));
  if (!t1 || !t2) throw new Error("Failed to open demo trades");

  // Simulate TP hit on TEST1USDT and SL hit on TEST2USDT
  const closed = evaluateOpenDemoTrades(
    new Map([
      ["TEST1USDT", 111],
      ["TEST2USDT", 95]
    ])
  );
  if (closed.length !== 2) throw new Error(`Expected 2 closed trades, got ${closed.length}`);
  const summary = getDemoPortfolioSummary();
  if (summary.winningTrades !== 1 || summary.losingTrades !== 1 || summary.winRatePct !== 50) {
    throw new Error(`Unexpected portfolio metrics: ${JSON.stringify(summary)}`);
  }
  if (summary.currentBalanceUsd <= 1000) {
    throw new Error(`Expected positive net PnL (10% TP vs 4% SL), got balance ${summary.currentBalanceUsd}`);
  }
  console.log(
    `[PASS] Demo Portfolio TP/SL lifecycle — Balance: $${summary.currentBalanceUsd} | WinRate: ${summary.winRatePct}% | PnL: +$${summary.totalPnlUsd}`
  );

  // 3. Test HTTP endpoints (/health, /api/portfolio, /api/reports/pdf)
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const portRes = await fetch(`${baseUrl}/api/portfolio`);
  const portBody = await portRes.json();
  if (portRes.status !== 200 || portBody.closedTradesCount !== 2) {
    throw new Error(`GET /api/portfolio failed: ${JSON.stringify(portBody)}`);
  }
  console.log("[PASS] GET /api/portfolio verified");

  const pdfRes = await fetch(`${baseUrl}/api/reports/pdf`);
  const contentType = pdfRes.headers.get("content-type") || "";
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  if (pdfRes.status !== 200 || !contentType.includes("application/pdf") || !pdfBuf.subarray(0, 5).toString().startsWith("%PDF-")) {
    throw new Error(`GET /api/reports/pdf failed: status=${pdfRes.status}, type=${contentType}, bytes=${pdfBuf.length}`);
  }
  console.log(`[PASS] GET /api/reports/pdf generated valid PDF (${pdfBuf.length} bytes)`);

  const healthRes = await fetch(`${baseUrl}/health`);
  const healthBody = await healthRes.json();
  if (healthRes.status !== 200 || healthBody.stage !== "stage-3-demo-portfolio-pdf") {
    throw new Error(`GET /health mismatch: ${JSON.stringify(healthBody)}`);
  }
  console.log("[PASS] GET /health confirmed stage-3-demo-portfolio-pdf");

  // Clean test state before exiting
  resetDemoPortfolioForTest();
  resetCooldownsForTest();
  server.close();
  console.log("=== Stage 3 E2E Verification Completed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 3 Verification Error:", err);
  process.exit(1);
});
