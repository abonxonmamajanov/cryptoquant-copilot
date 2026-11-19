import http from "http";
import { app } from "../src/index";

async function main() {
  console.log("=== Stage 5 (100% Production Release) E2E Verification Started ===");

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // 1. /ping keep-alive endpoint
  const pingRes = await fetch(`${baseUrl}/ping`);
  const pingText = await pingRes.text();
  if (pingRes.status !== 200 || pingText !== "pong") {
    throw new Error(`GET /ping failed: status=${pingRes.status}, body=${pingText}`);
  }
  console.log("[PASS] GET /ping -> pong");

  // 2. /api/metrics
  const metricsRes = await fetch(`${baseUrl}/api/metrics`);
  const metricsBody = await metricsRes.json();
  if (metricsRes.status !== 200 || typeof metricsBody.uptimeSec !== "number") {
    throw new Error(`GET /api/metrics failed: ${JSON.stringify(metricsBody)}`);
  }
  console.log(`[PASS] GET /api/metrics -> memoryMb=${metricsBody.memoryRssMb}, mirror=${metricsBody.activeMirror}`);

  // 3. /api/backtest (stablecoin rejected + BTCUSDT live historical backtest passes)
  const stableRes = await fetch(`${baseUrl}/api/backtest?symbol=USDCUSDT&limit=100`);
  if (stableRes.status !== 400) {
    throw new Error(`Expected stablecoin USDCUSDT backtest to return 400, got ${stableRes.status}`);
  }
  console.log("[PASS] Stablecoin USDCUSDT strictly rejected by backtester");

  const btRes = await fetch(`${baseUrl}/api/backtest?symbol=BTCUSDT&limit=120`);
  const btBody = await btRes.json();
  if (btRes.status !== 200 || btBody.symbol !== "BTCUSDT" || btBody.candlesAnalyzed < 80) {
    throw new Error(`GET /api/backtest?symbol=BTCUSDT failed: ${JSON.stringify(btBody)}`);
  }
  console.log(
    `[PASS] GET /api/backtest (BTCUSDT, ${btBody.candlesAnalyzed} candles) -> trades=${btBody.totalTrades}, winRate=${btBody.winRatePct}%, netPnl=${btBody.netPnlPct}%`
  );

  // 4. /health reports stage-5-production-100
  const healthRes = await fetch(`${baseUrl}/health`);
  const healthBody = await healthRes.json();
  if (healthRes.status !== 200 || healthBody.stage !== "stage-5-production-100") {
    throw new Error(`GET /health mismatch: ${JSON.stringify(healthBody)}`);
  }
  console.log("[PASS] GET /health confirmed stage-5-production-100");

  server.close();
  console.log("=== Stage 5 E2E Verification (100% COMPLETE) Passed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 5 Verification Error:", err);
  process.exit(1);
});
