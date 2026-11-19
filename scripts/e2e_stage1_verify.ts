import http from "http";
import { app } from "../src/index";
import { isFilteredOutSymbol } from "../src/agents/scout.agent";

async function main() {
  console.log("=== Stage 1 (Scout Agent) E2E Verification Started ===");

  // 1. Unit checks on Stablecoin & Leveraged Token filter
  const mustFilter = ["USDCUSDT", "FDUSDUSDT", "DAIUSD", "BTC3LUSDT", "ETH5SUSDT"];
  const mustPass = ["BTCUSDT", "SOLUSDT", "SUIUSDT"];

  for (const sym of mustFilter) {
    if (!isFilteredOutSymbol(sym)) {
      throw new Error(`Filter failed: expected ${sym} to be filtered out`);
    }
  }
  for (const sym of mustPass) {
    if (isFilteredOutSymbol(sym)) {
      throw new Error(`Filter failed: expected ${sym} to pass`);
    }
  }
  console.log("[PASS] Stablecoin & leveraged token filter rules verified");

  // 2. Spin up ephemeral Express server and test Stage 1 endpoints
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind ephemeral port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Trigger live Scout scan via POST /api/scout/scan
  const scanRes = await fetch(`${baseUrl}/api/scout/scan`, { method: "POST" });
  const scanBody = await scanRes.json();

  if (scanRes.status !== 200 || !Array.isArray(scanBody.candidates) || scanBody.candidates.length === 0) {
    throw new Error(`POST /api/scout/scan failed: ${JSON.stringify(scanBody)}`);
  }

  // Confirm no stablecoins slipped into candidates
  for (const c of scanBody.candidates) {
    if (isFilteredOutSymbol(c.symbol)) {
      throw new Error(`Filtered symbol leaked into candidates: ${c.symbol}`);
    }
  }

  console.log(
    `[PASS] POST /api/scout/scan — Mirror: ${scanBody.activeMirror} | Total USDT: ${scanBody.totalUsdtPairs} | Eligible: ${scanBody.liquidEligibleCount} | Deep scanned: ${scanBody.deepScannedCount} | Anomalies: ${scanBody.anomaliesDetected}`
  );
  console.log("[INFO] Top 3 Scout candidates:", scanBody.candidates.slice(0, 3));

  // Verify GET /api/scout/latest returns cached snapshot
  const latestRes = await fetch(`${baseUrl}/api/scout/latest`);
  const latestBody = await latestRes.json();
  if (latestRes.status !== 200 || latestBody.scannedAt !== scanBody.scannedAt) {
    throw new Error("GET /api/scout/latest did not return cached snapshot");
  }
  console.log("[PASS] GET /api/scout/latest returned cached snapshot cleanly");

  // Verify GET /health reports stage-1-scout-agent
  const healthRes = await fetch(`${baseUrl}/health`);
  const healthBody = await healthRes.json();
  if (healthRes.status !== 200 || healthBody.stage !== "stage-1-scout-agent") {
    throw new Error(`GET /health mismatch: ${JSON.stringify(healthBody)}`);
  }
  console.log("[PASS] GET /health:", healthBody);

  server.close();
  console.log("=== Stage 1 E2E Verification Completed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 1 Verification Error:", err);
  process.exit(1);
});
