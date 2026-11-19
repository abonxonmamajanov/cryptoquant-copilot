import http from "http";
import { app } from "../src/index";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";
import { formatTelegramSignalCard } from "../src/agents/executive.agent";

async function main() {
  console.log("=== Stage 2 (5-Agent Pipeline) E2E Verification Started ===");

  // 1. Unit test Critic & Risk Agent (REJECT low R:R + APPROVE strong setup)
  const mockScout = {
    symbol: "SOLUSDT",
    exchange: "MEXC" as const,
    lastPrice: 180,
    priceChange24hPct: 6.5,
    quoteVolume24hUsd: 25_000_000,
    volumeSpikeRatio15m: 2.6,
    momentum15mPct: 1.8,
    scoutScore: 78,
    isAnomaly: true,
    isNewAlert: true,
    reasons: ["15m hajm sakrashi 2.6x"],
    detectedAt: new Date().toISOString()
  };

  const badTech = {
    symbol: "SOLUSDT",
    direction: "LONG" as const,
    entryPrice: 180,
    stopLossPrice: 175,
    takeProfitPrice: 185,
    riskRewardRatio: 1.0,
    rsi14: 58,
    ema9: 179,
    ema21: 176,
    atr14: 2.1,
    supportLevel: 174,
    resistanceLevel: 185,
    techScore: 75,
    summary: "Low RR test",
    latencyMs: 5
  };

  const goodMacro = {
    symbol: "SOLUSDT",
    btcChange1hPct: 0.5,
    bidDepthUsd: 120_000,
    askDepthUsd: 80_000,
    bidAskRatio: 1.5,
    spreadPct: 0.05,
    regime: "BULLISH" as const,
    macroScore: 85,
    summary: "BTC +0.5%, Bid/Ask 1.5x",
    latencyMs: 5
  };

  const rejectRes = runCriticRiskAgent(mockScout, badTech, goodMacro);
  if (rejectRes.verdict !== "REJECT") {
    throw new Error("Critic Agent failed to REJECT R:R < 2.0 setup");
  }
  console.log("[PASS] Critic Agent strictly REJECTED R:R 1:1.0 setup:", rejectRes.reasons);

  const goodTech = { ...badTech, takeProfitPrice: 193, riskRewardRatio: 2.6, techScore: 88 };
  const approveRes = runCriticRiskAgent(mockScout, goodTech, goodMacro);
  if (approveRes.verdict !== "APPROVE") {
    throw new Error(`Critic Agent unexpectedly rejected strong setup: ${approveRes.reasons.join("; ")}`);
  }
  const card = formatTelegramSignalCard(mockScout, goodTech, goodMacro, approveRes);
  if (!card.includes("SOLUSDT") || !card.includes("Moliyaviy maslahat emas")) {
    throw new Error("Telegram card format missing required fields");
  }
  console.log("[PASS] Critic Agent APPROVED strong setup & Executive formatted Uzbek Telegram card");

  // 2. Live HTTP E2E test of full 5-agent pipeline
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const runRes = await fetch(`${baseUrl}/api/pipeline/run`, { method: "POST" });
  const runBody = await runRes.json();
  if (runRes.status !== 200 || typeof runBody.evaluatedCount !== "number" || runBody.evaluatedCount === 0) {
    throw new Error(`POST /api/pipeline/run failed: ${JSON.stringify(runBody)}`);
  }

  console.log(
    `[PASS] POST /api/pipeline/run — Evaluated: ${runBody.evaluatedCount} | Approved: ${runBody.approvedCount} | Rejected: ${runBody.rejectedCount} | Duration: ${runBody.durationMs}ms`
  );
  for (const r of runBody.records) {
    console.log(
      `  -> ${r.scout.symbol} | Verdict: ${r.criticRisk.verdict} (${r.criticRisk.confidenceScore}/100) | RSI: ${r.technician.rsi14} | R:R 1:${r.technician.riskRewardRatio} | Macro: ${r.macroFlow.regime}`
    );
  }

  const healthRes = await fetch(`${baseUrl}/health`);
  const healthBody = await healthRes.json();
  if (healthRes.status !== 200 || healthBody.stage !== "stage-2-five-agent-pipeline") {
    throw new Error(`Health check mismatch: ${JSON.stringify(healthBody)}`);
  }
  console.log("[PASS] GET /health confirmed stage-2-five-agent-pipeline");

  server.close();
  console.log("=== Stage 2 E2E Verification Completed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 2 Verification Error:", err);
  process.exit(1);
});
