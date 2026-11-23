import http from "http";
import { app } from "../src/index";
import { runOrderFlowAnalysis, OrderFlowReport } from "../src/services/orderFlow.service";
import {
  getCircuitBreakerStatus,
  recordSignalOutcome,
  resetCircuitBreakerForTest
} from "../src/services/circuitBreaker.service";
import {
  calcAdx14,
  recomputeLevelsForMode,
  TechnicalAnalysisResult
} from "../src/agents/technician.agent";
import {
  computeConvictionSizeMultiplier,
  runCriticRiskAgent
} from "../src/agents/criticRisk.agent";
import { formatTelegramSignalCard } from "../src/agents/executive.agent";
import {
  evaluateOpenDemoTrades,
  openManualDemoTrade,
  resetDemoPortfolioForTest
} from "../src/services/demoPortfolio.service";
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
    reasons: ["Stage 6.1 E2E"],
    detectedAt: new Date().toISOString()
  };

  const tech: TechnicalAnalysisResult = {
    symbol: "SOLUSDT",
    direction: "LONG",
    tradeMode: "SWING",
    entryPrice: 100,
    stopLossPrice: 96.2, // wide -3.8% SWING SL initially
    takeProfitPrice: 112.92,
    tp1Price: 107.6,
    tp2Price: 112.92,
    tp3Price: 117.48,
    riskRewardRatio: 3.4,
    rsi14: 54,
    adx14: 28.4,
    isChoppyMarket: false,
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
    summary: "Stage 6.1 test",
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
    summary: "Stage 6.1 macro",
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
  console.log("=== Stage 6.0 + 6.1 (Order-Flow + Wall Street Exit Math + ADX>=20 + Conviction Sizing) E2E Started ===");

  resetCircuitBreakerForTest();
  resetDemoPortfolioForTest();

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

  // 2. recomputeLevelsForMode strict INTRADAY SL clamping (-1.6% .. -2.5%), 1.8R/3.0R/4.0R & Ask-Wall TP snapping
  const { scout, tech, macro, orderFlow } = buildBaseInputs();
  const unsnappedIntraday = recomputeLevelsForMode(tech, "INTRADAY", null);
  const unsnappedSlPct = Number(
    (((unsnappedIntraday.entryPrice - unsnappedIntraday.stopLossPrice) / unsnappedIntraday.entryPrice) * 100).toFixed(2)
  );
  if (
    unsnappedSlPct < 1.6 ||
    unsnappedSlPct > 2.5 ||
    unsnappedIntraday.riskRewardRatio < 2.95
  ) {
    throw new Error(`Stage 6.1 INTRADAY 3.0R payoff check failed: ${JSON.stringify(unsnappedIntraday)}`);
  }

  // With AskWall at 105.5 (between 1.8R=104.5 and 3.0R=107.5), TP2 snaps cleanly below wall while R:R >= 2.0
  const syncedIntraday = recomputeLevelsForMode(tech, "INTRADAY", 105.5);
  const slPct = Number(
    (((syncedIntraday.entryPrice - syncedIntraday.stopLossPrice) / syncedIntraday.entryPrice) * 100).toFixed(2)
  );
  if (
    syncedIntraday.tradeMode !== "INTRADAY" ||
    slPct < 1.6 ||
    slPct > 2.5 ||
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

  // Verify Wilder ADX(14) distinguishes trending vs dead flat/choppy candles
  const trendingBars = Array.from({ length: 45 }, (_, idx) => ({
    high: 100 + idx * 1.2 + 0.5,
    low: 100 + idx * 1.2 - 0.3,
    close: 100 + idx * 1.2 + 0.2
  }));
  const choppyBars = Array.from({ length: 45 }, (_, idx) => ({
    high: 100 + (idx % 2 === 0 ? 0.3 : 0.25),
    low: 100 - (idx % 2 === 0 ? 0.25 : 0.3),
    close: 100 + (idx % 2 === 0 ? 0.1 : -0.1)
  }));
  const trendAdx = calcAdx14(trendingBars);
  const chopAdx = calcAdx14(choppyBars);
  if (trendAdx < 25 || chopAdx >= 20) {
    throw new Error(`Wilder calcAdx14 failed: trendAdx=${trendAdx}, chopAdx=${chopAdx}`);
  }
  console.log(
    `[PASS] 2. Stage 6.1 Levels (SL=-${slPct}%, 1.8R/3.0R/4.0R, AskWall snap TP2=${syncedIntraday.tp2Price}) & Wilder ADX14 (trend=${trendAdx}, chop=${chopAdx}) verified`
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

  // 4. Stage 6.0 + 6.1 Critic Precision, ADX<20 Chop Gate, Conviction Sizing & 60/40 Demo Exit Math
  const okVerdict = runCriticRiskAgent(scout, syncedIntraday, macro, undefined, orderFlow);
  if (
    okVerdict.verdict !== "APPROVE" ||
    okVerdict.suggestedSizeMultiplier !== 1.5 ||
    computeConvictionSizeMultiplier(3) !== 0.5 ||
    computeConvictionSizeMultiplier(4) !== 1.0 ||
    computeConvictionSizeMultiplier(5) !== 1.5
  ) {
    throw new Error(`Expected clean Stage 6.1 5★ setup to APPROVE with 1.5x sizing: ${JSON.stringify(okVerdict)}`);
  }

  const rejectCases = [
    {
      name: "Choppy market ADX=16.5 (<20)",
      v: runCriticRiskAgent(scout, { ...syncedIntraday, adx14: 16.5, isChoppyMarket: true }, macro, undefined, orderFlow)
    },
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
      throw new Error(`Stage 6.1 Critic failed to REJECT [${rc.name}]`);
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

  // Verify 60/40 Demo Portfolio exit math + 5★ 1.5x ($150) default conviction sizing + -0.2R soft SL -> +0.5R at 2.3R
  const manualRes = openManualDemoTrade({
    scout,
    technician: unsnappedIntraday,
    macroFlow: macro,
    criticRisk: okVerdict,
    executive: null
  });
  if (!manualRes.ok || !manualRes.trade || manualRes.trade.positionSizeUsd !== 150) {
    throw new Error(`Expected 5★ manual demo trade to default to $150 (1.5x): ${JSON.stringify(manualRes)}`);
  }
  // Step A: hit TP1 (104.5) -> remaining 40% SL moves to -0.2R (99.5), NOT 100!
  const tp1Events: typeof manualRes.trade[] = [];
  evaluateOpenDemoTrades(new Map([["SOLUSDT", 104.6]]), Date.now(), tp1Events);
  if (tp1Events.length !== 1 || tp1Events[0].stopLossPrice !== 99.5) {
    throw new Error(`Expected TP1 soft protection SL=99.5 (-0.2R): ${JSON.stringify(tp1Events)}`);
  }
  // Step B: hit +2.3R (105.75) -> SL upgrades to +0.5R (101.25), then pullback to 101.2 closes remaining 40% with +3.2% weighted win!
  evaluateOpenDemoTrades(new Map([["SOLUSDT", 105.8]]), Date.now());
  const closedDemo = evaluateOpenDemoTrades(new Map([["SOLUSDT", 101.2]]), Date.now());
  if (closedDemo.length !== 1 || (closedDemo[0].pnlPercent ?? 0) < 3.0) {
    throw new Error(`Expected 60/40 +0.5R trailing exit to lock >= +3.0% (+1.28R): ${JSON.stringify(closedDemo)}`);
  }
  resetDemoPortfolioForTest();

  const card = formatTelegramSignalCard(scout, syncedIntraday, macro, okVerdict, undefined, orderFlow);
  if (
    !card.includes("OBI 1.8x | Taker Buy 61%") ||
    !card.includes("Tavsiya hajm:* 1.5x") ||
    !card.includes("• *Trend:*") ||
    !card.includes("• *Bozor:*")
  ) {
    throw new Error(`Telegram 3-line card missing Stage 6.1 Order-Flow / Conviction proof:\n${card}`);
  }
  console.log(
    `[PASS] 4. All ${rejectCases.length} Stage 6.1 gates (incl. ADX<20), Conviction Sizing (0.5x/1.0x/1.5x), 60/40 exit (+${closedDemo[0].pnlPercent}%), & Telegram card verified`
  );

  // 5. Ephemeral HTTP check for /health Stage 6.1 metadata
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
      !String(hBody.stage || "").startsWith("stage-6.") ||
      typeof hBody.wallStreetCircuitBreaker?.active !== "boolean"
    ) {
      throw new Error(`GET /health Stage 6.x mismatch: ${JSON.stringify(hBody)}`);
    }
    console.log(`[PASS] 5. GET /health confirmed ${hBody.stage} & wallStreetCircuitBreaker`);
  } finally {
    resetCircuitBreakerForTest();
    resetDemoPortfolioForTest();
    server.close();
  }

  if (getCircuitBreakerStatus().active) {
    throw new Error("Failed to clean circuit breaker state after test");
  }

  console.log("=== Stage 6.0 + 6.1 Verification Completed (100% PASS) ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 6.1 Verification Error:", err);
  process.exit(1);
});
