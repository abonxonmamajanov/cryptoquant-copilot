import { runMarketHealthChecks } from "../src/services/marketHealth.service";
import { app } from "../src/index";
import http from "http";

async function main() {
  console.log("=== Stage 0 E2E Verification Started ===");

  // 1. Spin up ephemeral Express server and test /health
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind ephemeral port");
  }

  const healthRes = await fetch(`http://127.0.0.1:${address.port}/health`);
  const healthBody = await healthRes.json();
  if (healthRes.status !== 200 || healthBody.status !== "ok") {
    throw new Error(`Health check failed: ${JSON.stringify(healthBody)}`);
  }
  console.log("[PASS] /health endpoint:", healthBody);

  // 2. Test live public market API connectivity (MEXC, Binance, CoinGecko)
  const marketChecks = await runMarketHealthChecks();
  for (const check of marketChecks) {
    console.log(
      `[${check.ok ? "PASS" : "WARN"}] ${check.provider} — ${check.detail} (${check.latencyMs}ms)`
    );
  }

  const mexcOk = marketChecks.find((c) => c.provider.includes("MEXC"))?.ok;
  if (!mexcOk) {
    throw new Error("Primary exchange (MEXC Public API) is unreachable.");
  }

  server.close();
  console.log("=== Stage 0 E2E Verification Completed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 0 Verification Error:", err);
  process.exit(1);
});
