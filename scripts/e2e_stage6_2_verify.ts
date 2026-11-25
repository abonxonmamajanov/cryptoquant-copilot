import http from "http";
import { app } from "../src/index";
import { runOrderFlowAnalysis, OrderFlowReport } from "../src/services/orderFlow.service";
import { recomputeLevelsForMode, TechnicalAnalysisResult } from "../src/agents/technician.agent";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";
import { formatTelegramSignalCard } from "../src/agents/executive.agent";
import { generate15mChartPng } from "../src/services/chartGenerator.service";
import {
  evaluateTrackedSignals,
  getSignalTrackerSummary,
  registerDispatchedSignal,
  resetSignalTrackerForTest
} from "../src/services/signalTracker.service";
import {
  evaluateOpenDemoTrades,
  openManualDemoTrade,
  resetDemoPortfolioForTest
} from "../src/services/demoPortfolio.service";
import {
  getActiveDirectionFilter,
  resetSubscribersForTest,
  setActiveDirectionFilter
} from "../src/services/subscription.service";
import { resetCircuitBreakerForTest } from "../src/services/circuitBreaker.service";
import type { ScoutCandidate } from "../src/agents/scout.agent";
import type { MacroFlowResult } from "../src/agents/macroFlow.agent";
import type { MexcKline } from "../src/services/mexcClient.service";

function buildShortBaseInputs(): {
  scout: ScoutCandidate;
  tech: TechnicalAnalysisResult;
  macro: MacroFlowResult;
  orderFlow: OrderFlowReport;
} {
  const scout: ScoutCandidate = {
    symbol: "SOLUSDT",
    exchange: "MEXC",
    lastPrice: 100,
    priceChange24hPct: -5.4,
    quoteVolume24hUsd: 28_000_000,
    volumeSpikeRatio15m: 1.65,
    momentum15mPct: -0.95,
    scoutScore: 84,
    isAnomaly: true,
    isNewAlert: true,
    reasons: ["Stage 6.2 1x SHORT E2E"],
    detectedAt: new Date().toISOString()
  };

  const tech: TechnicalAnalysisResult = {
    symbol: "SOLUSDT",
    direction: "SHORT",
    tradeMode: "SWING",
    entryPrice: 100,
    stopLossPrice: 103.8,
    takeProfitPrice: 87.08,
    tp1Price: 92.4,
    tp2Price: 87.08,
    tp3Price: 82.52,
    riskRewardRatio: 3.4,
    rsi14: 48,
    adx14: 29.2,
    isChoppyMarket: false,
    ema9: 100.4,
    ema21: 101.0,
    ema50: 102.3,
    ema21Rising: false,
    ema21Falling: true,
    stretchAboveEma21Pct: -1.0,
    stretchBelowEma21Pct: 0.99,
    atrPct: 1.9,
    isBullishCandle: false,
    isBearishCandle: true,
    isPullbackReclaim: false,
    isRallyRejection: true,
    atr14: 1.9,
    supportLevel: 94.0,
    support10Level: 95.5,
    resistanceLevel: 104.5,
    resistance10Level: 103.5,
    techScore: 88,
    summary: "Stage 6.2 SHORT (1x) test",
    latencyMs: 2
  };

  const macro: MacroFlowResult = {
    symbol: "SOLUSDT",
    btcChange1hPct: -0.35,
    btcTrend1h: "BEARISH",
    btcTrend4h: "BEARISH",
    btcAbove4hEma50: false,
    above4hEma50: false,
    below4hEma50: true,
    bidDepthUsd: 165_000,
    askDepthUsd: 255_000,
    bidAskRatio: 0.65,
    spreadPct: 0.04,
    regime: "BEARISH",
    trend1h: "BEARISH",
    trend4h: "BEARISH",
    fundingRatePct: -0.01,
    exchanges: ["MEXC", "Binance"],
    macroScore: 34,
    summary: "Stage 6.2 bearish macro",
    latencyMs: 2
  };

  const orderFlow: OrderFlowReport = {
    symbol: "SOLUSDT",
    midPrice: 100,
    weightedObiRatio: 0.62,
    weightedBidsUsd: 220_000,
    weightedAsksUsd: 355_000,
    takerBuyUsd: 180_000,
    takerSellUsd: 320_000,
    takerBuyPct: 36,
    cvdUsd: -140_000,
    majorBidWallPrice: 94.5,
    majorBidWallUsd: 195_000,
    majorAskWallPrice: 104.2,
    majorAskWallUsd: 160_000,
    isSpoofingDetected: false,
    spoofReasonUz: null,
    spoofChecked: true,
    degraded: false,
    latencyMs: 2540
  };

  return { scout, tech, macro, orderFlow };
}

async function main() {
  console.log("=== Stage 6.2 (Dual-Direction LONG + Strict 1x SHORT + Anti-Squeeze Gates) E2E Started ===");

  resetCircuitBreakerForTest();
  resetDemoPortfolioForTest();
  resetSignalTrackerForTest();
  resetSubscribersForTest();
  setActiveDirectionFilter("BOTH");

  // 1. Live Order-Flow check with SHORT directionHint (verifies Bid-Wall magnet + 2.5s Ask-Wall Anti-Spoofing)
  const btcShortFlow = await runOrderFlowAnalysis("BTCUSDT", true, "SHORT");
  if (
    btcShortFlow.degraded ||
    !btcShortFlow.spoofChecked ||
    !Number.isFinite(btcShortFlow.weightedObiRatio) ||
    typeof btcShortFlow.isSpoofingDetected !== "boolean"
  ) {
    throw new Error(`Live SHORT runOrderFlowAnalysis("BTCUSDT") failed: ${JSON.stringify(btcShortFlow)}`);
  }
  console.log(
    `[PASS] 1. Live BTCUSDT SHORT Order-Flow verified (${btcShortFlow.latencyMs}ms): OBI=${btcShortFlow.weightedObiRatio}x | TakerBuy=${btcShortFlow.takerBuyPct}% | BidWall=${btcShortFlow.majorBidWallPrice ?? "none"} | Spoofing=${btcShortFlow.isSpoofingDetected}`
  );

  // 2. recomputeLevelsForMode for SHORT enforces SL > Entry > TP1 > TP2 > TP3 + Bid-Wall TP snapping
  const { scout, tech, macro, orderFlow } = buildShortBaseInputs();
  const unsnappedShort = recomputeLevelsForMode(tech, "INTRADAY", null);
  const shortSlPct = Number(
    (((unsnappedShort.stopLossPrice - unsnappedShort.entryPrice) / unsnappedShort.entryPrice) * 100).toFixed(2)
  );
  if (
    unsnappedShort.direction !== "SHORT" ||
    shortSlPct < 1.6 ||
    shortSlPct > 2.5 ||
    !unsnappedShort.tp1Price ||
    !unsnappedShort.tp2Price ||
    !unsnappedShort.tp3Price ||
    !(
      unsnappedShort.stopLossPrice > unsnappedShort.entryPrice &&
      unsnappedShort.entryPrice > unsnappedShort.tp1Price &&
      unsnappedShort.tp1Price > unsnappedShort.tp2Price &&
      unsnappedShort.tp2Price > unsnappedShort.tp3Price
    ) ||
    unsnappedShort.riskRewardRatio < 2.95
  ) {
    throw new Error(`Stage 6.2 SHORT INTRADAY levels check failed: ${JSON.stringify(unsnappedShort)}`);
  }

  // With BidWall at 94.5 (between TP1=95.5 and TP2=92.5), TP2 snaps 0.2% ABOVE buyer wall (94.69) while R:R >= 2.0
  const snappedShort = recomputeLevelsForMode(tech, "INTRADAY", 94.5);
  if (
    !snappedShort.tpSnappedToBidWall ||
    !snappedShort.tp2Price ||
    snappedShort.tp2Price <= 94.5 ||
    snappedShort.riskRewardRatio < 2.0 ||
    !(
      snappedShort.stopLossPrice > snappedShort.entryPrice &&
      snappedShort.entryPrice > (snappedShort.tp1Price ?? 0) &&
      (snappedShort.tp1Price ?? 0) > snappedShort.tp2Price &&
      snappedShort.tp2Price > (snappedShort.tp3Price ?? 0)
    )
  ) {
    throw new Error(`Stage 6.2 SHORT Bid-Wall TP snap failed: ${JSON.stringify(snappedShort)}`);
  }
  console.log(
    `[PASS] 2. SHORT (1x) Levels verified: SL=${snappedShort.stopLossPrice} (+${shortSlPct}%) > Entry=${snappedShort.entryPrice} > TP1=${snappedShort.tp1Price} > TP2=${snappedShort.tp2Price} [BidWall Snap > 94.5] > TP3=${snappedShort.tp3Price} (R:R 1:${snappedShort.riskRewardRatio})`
  );

  // 3. Critic Anti-Squeeze Gates for SHORT (1x)
  const okShort = runCriticRiskAgent(scout, snappedShort, macro, undefined, orderFlow);
  if (
    okShort.verdict !== "APPROVE" ||
    okShort.direction !== "SHORT" ||
    okShort.suggestedSizeMultiplier !== 1.5
  ) {
    throw new Error(`Expected clean 5★ SHORT (1x) setup to APPROVE: ${JSON.stringify(okShort)}`);
  }

  const shortRejectCases = [
    {
      name: "Oversold bottom RSI=36 (<40)",
      v: runCriticRiskAgent(scout, { ...snappedShort, rsi14: 36 }, macro, undefined, orderFlow)
    },
    {
      name: "High RSI=61 (>58)",
      v: runCriticRiskAgent(scout, { ...snappedShort, rsi14: 61 }, macro, undefined, orderFlow)
    },
    {
      name: "Choppy market ADX=17 (<20)",
      v: runCriticRiskAgent(scout, { ...snappedShort, adx14: 17, isChoppyMarket: true }, macro, undefined, orderFlow)
    },
    {
      name: "Short Squeeze negative Funding=-0.05% (<=-0.04%)",
      v: runCriticRiskAgent(scout, snappedShort, { ...macro, fundingRatePct: -0.05 }, undefined, orderFlow)
    },
    {
      name: "Counter-trend 1H BULLISH",
      v: runCriticRiskAgent(scout, snappedShort, { ...macro, trend1h: "BULLISH" }, undefined, orderFlow)
    },
    {
      name: "Order-Flow buyer absorption (TakerBuy=60%, OBI=1.25x)",
      v: runCriticRiskAgent(scout, snappedShort, macro, undefined, {
        ...orderFlow,
        takerBuyPct: 60,
        weightedObiRatio: 1.25
      })
    },
    {
      name: "Spoofing Ask wall detected",
      v: runCriticRiskAgent(scout, snappedShort, macro, undefined, {
        ...orderFlow,
        isSpoofingDetected: true,
        spoofReasonUz: "Soxta sotuvchi devori (Spoofing) aniqlandi"
      })
    },
    {
      name: "Missing EMA9/21 Rally-Rejection",
      v: runCriticRiskAgent(scout, { ...snappedShort, isRallyRejection: false }, macro, undefined, orderFlow)
    }
  ];

  for (const rc of shortRejectCases) {
    if (rc.v.verdict !== "REJECT") {
      throw new Error(`Stage 6.2 Critic failed to REJECT SHORT hazard [${rc.name}]`);
    }
  }
  console.log(`[PASS] 3. Clean SHORT (1x) APPROVE + all ${shortRejectCases.length} Anti-Squeeze gates verified`);

  // 4. SignalTracker & DemoPortfolio strict 1x SHORT PnL math (TP1 -> +0.2R soft SL -> -0.5R trail -> TP2 win + SL loss)
  const shortRecord = {
    scout,
    technician: unsnappedShort, // Entry=100, SL=102.5 (+2.5%), TP1=95.5, TP2=92.5, TP3=90
    macroFlow: macro,
    criticRisk: okShort,
    executive: null
  };

  // 4a. SignalTracker SHORT TP1 -> Trail -> TP2 win
  registerDispatchedSignal(shortRecord, 101);
  const a1 = evaluateTrackedSignals(new Map([["SOLUSDT", 95.4]]), Date.now()); // hits TP1 (95.5) -> SL moves to 100.5
  if (a1.length !== 1 || a1[0].eventType !== "TP1_HIT" || a1[0].signal.stopLossPrice !== 100.5) {
    throw new Error(`SignalTracker SHORT TP1 soft-SL failed: ${JSON.stringify(a1)}`);
  }
  evaluateTrackedSignals(new Map([["SOLUSDT", 94.1]]), Date.now()); // crosses -2.3R (94.25) -> SL locks profit at 98.75
  const a2 = evaluateTrackedSignals(new Map([["SOLUSDT", 92.4]]), Date.now()); // hits TP2 (92.5) -> full win
  if (a2.length !== 1 || a2[0].eventType !== "TP2_HIT" || a2[0].pnlPct < 5.5) {
    throw new Error(`SignalTracker SHORT TP2 weighted win failed: ${JSON.stringify(a2)}`);
  }

  // 4b. SignalTracker SHORT direct SL hit (price rises to 102.6 >= 102.5)
  registerDispatchedSignal({ ...shortRecord, scout: { ...scout, symbol: "AVAXUSDT" }, technician: { ...unsnappedShort, symbol: "AVAXUSDT" } }, 102);
  const aSl = evaluateTrackedSignals(new Map([["AVAXUSDT", 102.6]]), Date.now());
  if (aSl.length !== 1 || aSl[0].eventType !== "SL_HIT" || aSl[0].pnlPct >= 0) {
    throw new Error(`SignalTracker SHORT SL_HIT negative PnL check failed: ${JSON.stringify(aSl)}`);
  }
  const trSummary = getSignalTrackerSummary();
  if (trSummary.shortClosedCount !== 2) {
    throw new Error(`Expected shortClosedCount=2, got ${trSummary.shortClosedCount}`);
  }

  // 4c. DemoPortfolio 1x SHORT manual open + 60/40 TP1 -> Trail exit
  const demoOpen = openManualDemoTrade(shortRecord);
  if (!demoOpen.ok || !demoOpen.trade || demoOpen.trade.direction !== "SHORT" || demoOpen.trade.positionSizeUsd !== 150) {
    throw new Error(`DemoPortfolio SHORT open failed: ${JSON.stringify(demoOpen)}`);
  }
  const demoTp1: typeof demoOpen.trade[] = [];
  evaluateOpenDemoTrades(new Map([["SOLUSDT", 95.4]]), Date.now(), demoTp1);
  if (demoTp1.length !== 1 || demoTp1[0].stopLossPrice !== 100.5) {
    throw new Error(`DemoPortfolio SHORT TP1 soft-SL failed: ${JSON.stringify(demoTp1)}`);
  }
  evaluateOpenDemoTrades(new Map([["SOLUSDT", 94.1]]), Date.now()); // locks +0.5R at 98.75
  const demoClosed = evaluateOpenDemoTrades(new Map([["SOLUSDT", 98.8]]), Date.now()); // bounce hits 98.75 trail stop
  if (demoClosed.length !== 1 || (demoClosed[0].pnlPercent ?? 0) < 3.0 || (demoClosed[0].pnlUsd ?? 0) <= 0) {
    throw new Error(`DemoPortfolio SHORT +0.5R trail profit lock failed: ${JSON.stringify(demoClosed)}`);
  }
  console.log(
    `[PASS] 4. SignalTracker & DemoPortfolio 1x SHORT PnL verified (TP2=+${a2[0].pnlPct}%, SL=${aSl[0].pnlPct}%, Demo Trail=+${demoClosed[0].pnlPercent}% / +$${demoClosed[0].pnlUsd})`
  );

  // 5. SHORT (1x) PNG Chart Rendering & Strict 1x Telegram Card (zero >1x leverage text)
  const mockKlines: MexcKline[] = Array.from({ length: 60 }, (_, idx) => {
    const base = 106 - idx * 0.1;
    return {
      openTime: Date.now() - (60 - idx) * 900_000,
      open: base + 0.2,
      high: base + 0.6,
      low: base - 0.5,
      close: base - 0.1,
      volume: 1500 + idx * 20,
      closeTime: Date.now() - (59 - idx) * 900_000,
      quoteAssetVolume: 150_000
    };
  });
  const pngBuf = generate15mChartPng(mockKlines, {
    symbol: "SOLUSDT",
    direction: "SHORT",
    entryPrice: snappedShort.entryPrice,
    takeProfitPrice: snappedShort.takeProfitPrice,
    stopLossPrice: snappedShort.stopLossPrice,
    verdict: "APPROVE",
    timeframeLabel: "15M"
  });
  if (
    !Buffer.isBuffer(pngBuf) ||
    pngBuf.length < 2500 ||
    pngBuf[0] !== 0x89 ||
    pngBuf[1] !== 0x50 ||
    pngBuf[2] !== 0x4e ||
    pngBuf[3] !== 0x47
  ) {
    throw new Error("SHORT (1x) PNG chart rendering failed magic header or size check");
  }

  const shortCard = formatTelegramSignalCard(scout, snappedShort, macro, okShort, undefined, orderFlow);
  const forbiddenLeveragePattern = /\b([2-9]|[1-9]\d+)x\s*(leverage|kredit|short|yelka)/i;
  if (
    !shortCard.includes("🔴 *SHORT / SELL (1x — Xavfsiz Hedge / Nol likvidatsiya)*") ||
    forbiddenLeveragePattern.test(shortCard)
  ) {
    throw new Error(`SHORT Telegram card failed strict 1x header/leverage rule:\n${shortCard}`);
  }
  console.log(
    `[PASS] 5. SHORT (1x) PNG Chart (${pngBuf.length} bytes) & Strict 1x Telegram Card verified (zero >1x leverage)`
  );

  // 6. /direction toggle + Ephemeral HTTP /health & /api/settings/direction check
  setActiveDirectionFilter("SHORT");
  if (getActiveDirectionFilter() !== "SHORT") {
    throw new Error("Failed to toggle activeDirectionFilter to SHORT");
  }
  setActiveDirectionFilter("BOTH");

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
      hBody.stage !== "stage-6.2-dual-direction-1x-short" ||
      hBody.activeDirectionFilter !== "BOTH"
    ) {
      throw new Error(`GET /health Stage 6.2 mismatch: ${JSON.stringify(hBody)}`);
    }
    console.log(`[PASS] 6. GET /health (${hBody.stage}) & /direction toggle verified`);
  } finally {
    resetSignalTrackerForTest();
    resetDemoPortfolioForTest();
    resetCircuitBreakerForTest();
    resetSubscribersForTest();
    setActiveDirectionFilter("BOTH");
    server.close();
  }

  console.log("=== Stage 6.2 Dual-Direction Verification Completed (100% PASS) ===");
}

main().catch((err) => {
  resetSignalTrackerForTest();
  resetDemoPortfolioForTest();
  resetCircuitBreakerForTest();
  resetSubscribersForTest();
  setActiveDirectionFilter("BOTH");
  console.error("[FAIL] Stage 6.2 Verification Error:", err);
  process.exit(1);
});
