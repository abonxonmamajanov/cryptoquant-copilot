import http from "http";
import { app } from "../src/index";
import { runOrderFlowAnalysis, OrderFlowReport } from "../src/services/orderFlow.service";
import {
  getCircuitBreakerStatus,
  recordSignalOutcome,
  resetCircuitBreakerForTest
} from "../src/services/circuitBreaker.service";
import {
  recomputeLevelsForMode,
  TechnicalAnalysisResult
} from "../src/agents/technician.agent";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";
import { formatTelegramSignalCard } from "../src/agents/executive.agent";
import type { ScoutCandidate } from "../src/agents/scout.agent";
import type { MacroFlowResult } from "../src/agents/macroFlow.agent";

function buildBaseInputs(): {
  scout: ScoutCandidate;
  tech: TechnicalAnalysisResult;
  macro: MacroFlowResult;
  orderFlow: OrderFlowReport;
} {
  const scout: ScoutCandidate = {
    symbol: "SOLUSDT",
    exchange: "MEXC",
    lastPrice: 100,
    priceChange24hPct: 5.2,
    quoteVolume24hUsd: 25_000_000,
    volumeSpikeRatio15m: 1.6,
    momentum15mPct: 0.9,
    scoutScore: 84,
    isAnomaly: true,
    isNewAlert: true,
    reasons: ["Stage 6.0 E2E"],
    detectedAt: new Date().toISOString()
  };

  const tech: TechnicalAnalysisResult = {
    symbol: "SOLUSDT",
    direction: "LONG",
    tradeMode: "SWING",
    entryPrice: 100,
    stopLossPrice: 95.8, // wide -4.2% SWING SL initially!
    takeProfitPrice: 110.5,
    tp1Price: 105.88,
    tp2Price: 110.5,
    tp3Price: 115.96,
    riskRewardRatio: 2.5,
    rsi14: 54,
    ema9: 99.6,
    ema21: 99.1,
    ema50: 98.0,
    ema21Rising: true,
    stretchAboveEma21Pct: 0.9,
    atrPct: 1.9,
    isBullishCandle: true,
    isPullbackReclaim: true,
    atr14: 1.9,
    supportLevel: 95.5,
    support10Level: 96.5,
    resistanceLevel: 104,
    techScore: 88,
    summary: "Stage 6.0 test",
    latencyMs: 2
  };

  const macro: MacroFlowResult = {
    symbol: "SOLUSDT",
    btcChange1hPct: 0.35,
    btcTrend1h: "BULLISH",
    btcTrend4h: "NEUTRAL",
    btcAbove4hEma50: true,
    above4hEma50: true,
    bidDepthUsd: 250_000,
    askDepthUsd: 160_000,
    bidAskRatio: 1.56,
    spreadPct: 0.04,
    regime: "BULLISH",
    trend1h: "BULLISH",
    trend4h: "BULLISH",
    fundingRatePct: 0.01,
    exchanges: ["MEXC", "Binance"],
    macroScore: 84,
    summary: "Stage 6.0 macro",
    latencyMs: 2
  };

  const orderFlow: OrderFlowReport = {
    symbol: "SOLUSDT",
    midPrice: 100,
    weightedObiRatio: 1.8,
    weightedBidsUsd: 450_000,
    weightedAsksUsd: 250_000,
    takerBuyUsd: 305_000,
    takerSellUsd: 195_000,
    takerBuyPct: 61,
    cvdUsd: 110_000,
    majorBidWallPrice: 99.2,
    majorBidWallUsd: 120_000,
    majorAskWallPrice: 105.5,
    majorAskWallUsd: 180_000,
    isSpoofingDetected: false,
    spoofReasonUz: null,
    spoofChecked: true,
    degraded: false,
    latencyMs: 2550
  };

  return { scout, tech, macro, orderFlow };
}

async function main() {
  console.log("=== Stage 6.0 (Order-Flow Engine + Precision Sync + Circuit Breaker) E2E Started ===");

  resetCircuitBreakerForTest();

  // 1. Live Order-Flow Engine verification on BTCUSDT (100-lvl OBI, 2.5s Anti-Spoofing, 500-trade CVD, Ask-Wall)
  const btcFlow = await runOrderFlowAnalysis("BTCUSDT", true);
  if (
    btcFlow.degraded ||
    !Number.isFinite(btcFlow.weightedObiRatio) ||
    btcFlow.weightedObiRatio <= 0 ||
    !Number.isFinite(btcFlow.takerBuyPct) ||
    btcFlow.takerBuyPct < 0 ||
    btcFlow.takerBuyPct > 100 ||
    typeof btcFlow.majorAskWallPrice !== "number" ||
    btcFlow.majorAskWallPrice <= 0 ||
    typeof btcFlow.isSpoofingDetected !== "boolean" ||
    !btcFlow.spoofChecked
  ) {
    throw new Error(`Live runOrderFlowAnalysis("BTCUSDT", true) failed: ${JSON.stringify(btcFlow)}`);
  }
  console.log(
    `[PASS] 1. Live BTCUSDT Order-Flow verified (${btcFlow.latencyMs}ms): OBI=${btcFlow.weightedObiRatio}x | TakerBuy=${btcFlow.takerBuyPct}% | CVD=$${btcFlow.cvdUsd} | AskWall=${btcFlow.majorAskWallPrice} ($${btcFlow.majorAskWallUsd}) | Spoofing=${btcFlow.isSpoofingDetected}`
  );

  // 2. recomputeLevelsForMode strict INTRADAY SL clamping (-1.5% .. -2.6%) + Ask-Wall TP snapping + monotonic ordering
  const { scout, tech, macro, orderFlow } = buildBaseInputs();
  // Downgrade wide -4.2% SWING tech into INTRADAY with a resting Ask wall at 105.5 (below 105.72 TP2!)
  const syncedIntraday = recomputeLevelsForMode(tech, "INTRADAY", 105.5);
  const slPct = Number((((syncedIntraday.entryPrice - syncedIntraday.stopLossPrice) / syncedIntraday.entryPrice) * 100).toFixed(2));
  if (
    syncedIntraday.tradeMode !== "INTRADAY" ||
    slPct < 1.5 ||
    slPct > 2.6 ||
    !syncedIntraday.tp1Price ||
    !syncedIntraday.tp2Price ||
    !syncedIntraday.tp3Price ||
    !(
      syncedIntraday.stopLossPrice < syncedIntraday.entryPrice &&
      syncedIntraday.entryPrice < syncedIntraday.tp1Price &&
      syncedIntraday.tp1Price < syncedIntraday.tp2Price &&
      syncedIntraday.tp2Price < syncedIntraday.tp3Price
    ) ||
    syncedIntraday.riskRewardRatio < 2.0 ||
    !syncedIntraday.tpSnappedToAskWall ||
    syncedIntraday.tp2Price >= 105.5
  ) {
    throw new Error(
      `recomputeLevelsForMode INTRADAY clamp/snap failed (SL=-${slPct}%): ${JSON.stringify(syncedIntraday)}`
    );
  }
  console.log(
    `[PASS] 2. recomputeLevelsForMode clamped INTRADAY SL=-${slPct}% (-1.5..-2.6%) & snapped TP2=${syncedIntraday.tp2Price} below AskWall=105.5 (R:R 1:${syncedIntraday.riskRewardRatio})`
  );

  // 3. Wall Street Circuit Breaker: 3 consecutive SLs -> 4-hour pause; BE neutral; WIN resets cleanly
  const t0 = Date.now();
  const r1 = recordSignalOutcome("SL", t0);
  const r2 = recordSignalOutcome("SL", t0 + 1000);
  const rBe = recordSignalOutcome("BE", t0 + 2000);
  if (r1.triggeredNow || r2.triggeredNow || rBe.status.active || rBe.status.consecutiveLosses !== 2) {
    throw new Error(`Circuit breaker triggered prematurely: ${JSON.stringify(rBe)}`);
  }
  const r3 = recordSignalOutcome("SL", t0 + 3000);
  if (
    !r3.triggeredNow ||
    !r3.status.active ||
    r3.status.remainingMin < 235 ||
    !r3.reasonUz?.includes("WALL STREET CIRCUIT BREAKER")
  ) {
    throw new Error(`Expected 3rd consecutive SL to trigger 4h pause: ${JSON.stringify(r3)}`);
  }
  const rWin = recordSignalOutcome("WIN", t0 + 4000);
  if (rWin.status.active || rWin.status.consecutiveLosses !== 0) {
    throw new Error(`Expected WIN to reset Circuit Breaker cleanly: ${JSON.stringify(rWin)}`);
  }
  console.log(
    `[PASS] 3. Wall Street Circuit Breaker verified (3x SL -> 4h pause ${r3.status.remainingMin}m; WIN -> full reset)`
  );

  // 4. Stage 6.0 Critic Precision & Order-Flow Gates + 3-line Card Order-Flow proof
  const okVerdict = runCriticRiskAgent(scout, syncedIntraday, macro, undefined, orderFlow);
  if (okVerdict.verdict !== "APPROVE") {
    throw new Error(`Expected clean Stage 6.0 setup to APPROVE: ${okVerdict.reasons.join("; ")}`);
  }

  const rejectCases = [
    {
      name: "Overheated RSI=63 (>60)",
      v: runCriticRiskAgent(scout, { ...syncedIntraday, rsi14: 63 }, macro, undefined, orderFlow)
    },
    {
      name: "Low 15m volume=0.65x (<1.0x)",
      v: runCriticRiskAgent({ ...scout, volumeSpikeRatio15m: 0.65 }, syncedIntraday, macro, undefined, orderFlow)
    },
    {
      name: "BTC 4H BEARISH + non-leader 4H NEUTRAL",
      v: runCriticRiskAgent(scout, syncedIntraday, { ...macro, btcTrend4h: "BEARISH", trend4h: "NEUTRAL" }, undefined, orderFlow)
    },
    {
      name: "Spoofing wall detected",
      v: runCriticRiskAgent(scout, syncedIntraday, macro, undefined, {
        ...orderFlow,
        isSpoofingDetected: true,
        spoofReasonUz: "Soxta xaridor devori (Spoofing) aniqlandi"
      })
    },
    {
      name: "Order-Flow sell pressure (Taker 39%, OBI 0.72x)",
      v: runCriticRiskAgent(scout, syncedIntraday, macro, undefined, {
        ...orderFlow,
        takerBuyPct: 39,
        weightedObiRatio: 0.72
      })
    }
  ];
  for (const rc of rejectCases) {
    if (rc.v.verdict !== "REJECT") {
      throw new Error(`Stage 6.0 Critic failed to REJECT [${rc.name}]`);
    }
  }

  // Verify BTC 4H BEARISH ALLOWS genuine 4H BULLISH leader!
  const leaderVerdict = runCriticRiskAgent(
    scout,
    syncedIntraday,
    { ...macro, btcTrend4h: "BEARISH", trend4h: "BULLISH" },
    undefined,
    orderFlow
  );
  if (leaderVerdict.verdict !== "APPROVE") {
    throw new Error(`Expected 4H BULLISH leader to pass during BTC 4H BEARISH: ${leaderVerdict.reasons.join("; ")}`);
  }

  const card = formatTelegramSignalCard(scout, syncedIntraday, macro, okVerdict, undefined, orderFlow);
  if (!card.includes("OBI 1.8x | Taker Buy 61%") || !card.includes("• *Trend:*") || !card.includes("• *Bozor:*")) {
    throw new Error(`Telegram 3-line card missing Stage 6.0 Order-Flow proof:\n${card}`);
  }
  console.log(
    `[PASS] 4. All ${rejectCases.length} Stage 6.0 Precision/Order-Flow hard-reject gates + 4H leader pass + 3-line card OBI/Taker proof verified`
  );

  // 5. Ephemeral HTTP check for /health Stage 6.0 metadata
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind ephemeral port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    const hRes = await fetch(`${baseUrl}/health`);
    const hBody = await hRes.json();
    if (
      hRes.status !== 200 ||
      hBody.stage !== "stage-6.0-institutional-orderflow" ||
      typeof hBody.wallStreetCircuitBreaker?.active !== "boolean"
    ) {
      throw new Error(`GET /health Stage 6.0 mismatch: ${JSON.stringify(hBody)}`);
    }
    console.log("[PASS] 5. GET /health confirmed stage-6.0-institutional-orderflow & wallStreetCircuitBreaker");
  } finally {
    resetCircuitBreakerForTest();
    server.close();
  }

  if (getCircuitBreakerStatus().active) {
    throw new Error("Failed to clean circuit breaker state after test");
  }

  console.log("=== Stage 6.0 Verification Completed (100% PASS) ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 6.0 Verification Error:", err);
  process.exit(1);
});
