import http from "http";
import { app } from "../src/index";
import { isFilteredOutSymbol } from "../src/agents/scout.agent";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";
import { analyzeTokenOnDemand } from "../src/services/tokenCheck.service";
import {
  canDispatchSignal,
  getCircuitBreakerStatus,
  getDispatchGuardStatus,
  recordSymbolStopLoss,
  resetCooldownsForTest
} from "../src/services/cooldown.service";
import {
  evaluateTrackedSignals,
  formatAllTimeTrackerTelegramText,
  getAtRiskActiveCount,
  getSignalTrackerSummary,
  hasActiveSignal,
  registerDispatchedSignal,
  resetSignalTrackerForTest
} from "../src/services/signalTracker.service";
import type { EvaluatedSignalRecord } from "../src/services/pipeline.service";

function makeRecord(
  symbol: string,
  entry: number,
  sl: number,
  tp1: number,
  tp2: number,
  tp3: number
): EvaluatedSignalRecord {
  return {
    scout: {
      symbol,
      exchange: "MEXC",
      lastPrice: entry,
      priceChange24hPct: 4.5,
      quoteVolume24hUsd: 20_000_000,
      volumeSpikeRatio15m: 1.8,
      momentum15mPct: 0.9,
      scoutScore: 82,
      isAnomaly: true,
      isNewAlert: true,
      reasons: ["Stage 5.9 test"],
      detectedAt: new Date().toISOString()
    },
    technician: {
      symbol,
      direction: "LONG",
      tradeMode: "INTRADAY",
      entryPrice: entry,
      stopLossPrice: sl,
      takeProfitPrice: tp2,
      tp1Price: tp1,
      tp2Price: tp2,
      tp3Price: tp3,
      riskRewardRatio: 2.2,
      rsi14: 54,
      ema9: entry * 0.997,
      ema21: entry * 0.991,
      ema50: entry * 0.982,
      ema21Rising: true,
      stretchAboveEma21Pct: 0.9,
      atrPct: 1.1,
      isBullishCandle: true,
      isPullbackReclaim: true,
      atr14: entry * 0.011,
      supportLevel: sl,
      resistanceLevel: tp2,
      techScore: 88,
      summary: "INTRADAY EMA9>21>50 (Pullback-Reclaim)",
      latencyMs: 2
    },
    macroFlow: {
      symbol,
      btcChange1hPct: 0.4,
      btcTrend1h: "BULLISH",
      btcTrend4h: "BULLISH",
      btcAbove4hEma50: true,
      above4hEma50: true,
      bidDepthUsd: 250_000,
      askDepthUsd: 150_000,
      bidAskRatio: 1.67,
      spreadPct: 0.04,
      regime: "BULLISH",
      trend1h: "BULLISH",
      trend4h: "BULLISH",
      fundingRatePct: 0.01,
      exchanges: ["MEXC", "Binance"],
      macroScore: 84,
      summary: "BTC +0.4%, 1H/4H BULLISH/BULLISH",
      latencyMs: 2
    },
    criticRisk: {
      symbol,
      verdict: "APPROVE",
      tradeMode: "INTRADAY",
      confidenceScore: 85,
      longTermStars: { count: 5, label: "⭐⭐⭐⭐⭐ (5/5)" },
      softWarnings: [],
      reasons: ["Approved"],
      latencyMs: 1
    },
    executive: null
  };
}

async function main() {
  console.log("=== Stage 5.9 (All-Time Net PnL + Quant Alpha Shield) E2E Verification Started ===");

  resetSignalTrackerForTest();
  resetCooldownsForTest();

  // 1. Hardened Symbol Filter (blocks GOLD(PAXG), GOLD(XAUT), OIL(USOON), non-ASCII memes)
  const mustBlock = [
    "GOLD(PAXG)USDT",
    "GOLD(XAUT)USDT",
    "OIL(USOON)USDT",
    "牛逼USDT",
    "USDCUSDT",
    "FDUSDUSDT",
    "BTC3LUSDT"
  ];
  for (const sym of mustBlock) {
    if (!isFilteredOutSymbol(sym)) {
      throw new Error(`Expected ${sym} to be filtered out`);
    }
  }
  for (const sym of ["BTCUSDT", "SOLUSDT", "ETHUSDT", "ENAUSDT"]) {
    if (isFilteredOutSymbol(sym)) {
      throw new Error(`Expected ${sym} to pass symbol filter`);
    }
  }
  console.log("[PASS] 1. Hardened symbol filter blocks GOLD(PAXG)/GOLD(XAUT)/OIL/non-ASCII/stablecoins");

  // 2. All-Time Signal Tracker Net PnL + Partial-TP + Trailing Profit Classification
  const sol = makeRecord("SOLUSDT", 100, 98, 102.4, 104.4, 106.6);
  registerDispatchedSignal(sol, 1001);
  if (!hasActiveSignal("SOLUSDT") || getAtRiskActiveCount() !== 1) {
    throw new Error("Expected SOLUSDT active and 1 at-risk slot");
  }
  // Hit TP1 -> moves SL to 100 (risk-free, so atRiskActiveCount becomes 0!)
  evaluateTrackedSignals(new Map([["SOLUSDT", 102.5]]));
  if (getAtRiskActiveCount() !== 0) {
    throw new Error(`Expected atRiskActiveCount=0 after TP1 Breakeven, got ${getAtRiskActiveCount()}`);
  }
  // Hit TP2 -> trails SL to TP1 (102.4)
  evaluateTrackedSignals(new Map([["SOLUSDT", 104.5]]));
  // Retrace to trailed SL (102.3) -> must close as TP2_HIT profit (NOT BREAKEVEN!)
  const solClose = evaluateTrackedSignals(new Map([["SOLUSDT", 102.3]]));
  if (
    solClose.length !== 1 ||
    solClose[0].signal.status !== "TP2_HIT" ||
    solClose[0].signal.finalPnlPct !== 3.1
  ) {
    throw new Error(`Expected SOLUSDT trailed profit TP2_HIT (+3.1%), got: ${JSON.stringify(solClose)}`);
  }

  // ETH: Hits TP1 (+2.4%), retraces to BE (2000) -> BREAKEVEN with 40% booked = +0.96%
  const eth = makeRecord("ETHUSDT", 2000, 1960, 2048, 2088, 2132);
  registerDispatchedSignal(eth, 1002);
  evaluateTrackedSignals(new Map([["ETHUSDT", 2050]]));
  const ethBe = evaluateTrackedSignals(new Map([["ETHUSDT", 1999]]));
  if (
    ethBe.length !== 1 ||
    ethBe[0].signal.status !== "BREAKEVEN" ||
    ethBe[0].signal.finalPnlPct !== 0.96 ||
    ethBe[0].signal.runnerPnlPct !== 0
  ) {
    throw new Error(`Expected ETHUSDT BREAKEVEN (+0.96% partial, 0% runner), got: ${JSON.stringify(ethBe)}`);
  }

  // CTUSDT: Direct SL (-2.0%)
  const ct = makeRecord("CTUSDT", 1.0, 0.98, 1.024, 1.044, 1.066);
  registerDispatchedSignal(ct, 1003);
  const ctSl = evaluateTrackedSignals(new Map([["CTUSDT", 0.979]]));
  if (ctSl.length !== 1 || ctSl[0].signal.status !== "SL_HIT" || ctSl[0].signal.finalPnlPct !== -2) {
    throw new Error(`Expected CTUSDT SL_HIT (-2%), got: ${JSON.stringify(ctSl)}`);
  }

  const summary = getSignalTrackerSummary();
  if (
    summary.closedCount !== 3 ||
    summary.tpCount !== 1 ||
    summary.beCount !== 1 ||
    summary.slCount !== 1 ||
    summary.totalNetPnlPct !== 2.06 ||
    summary.accuracyPct !== 66.7 ||
    summary.profitFactor !== 2.03 ||
    summary.bestSignal?.symbol !== "SOLUSDT" ||
    summary.worstSignal?.symbol !== "CTUSDT" ||
    summary.byCoinAllTime.length !== 3
  ) {
    throw new Error(`All-time tracker summary mismatch: ${JSON.stringify(summary)}`);
  }
  const tgAllTime = formatAllTimeTrackerTelegramText();
  if (!tgAllTime.includes("+2.06%") || !tgAllTime.includes("2.03")) {
    throw new Error(`Telegram all-time formatter missing net PnL/PF:\n${tgAllTime}`);
  }
  console.log(
    `[PASS] 2. All-time Signal Tracker verified: closed=${summary.closedCount}, net=+${summary.totalNetPnlPct}%, PF=${summary.profitFactor}, acc=${summary.accuracyPct}%`
  );

  // 3. Adaptive SL Backoff (6h -> 24h) & Global 3-SL-in-2h Circuit Breaker
  resetCooldownsForTest();
  const t0 = Date.now();
  recordSymbolStopLoss("CTUSDT", t0);
  const g1 = getDispatchGuardStatus("CTUSDT", t0 + 1000);
  if (g1.allowed || g1.remainingSec < 20_000) {
    throw new Error(`Expected 6h SL backoff on 1st SL, got: ${JSON.stringify(g1)}`);
  }
  if (!canDispatchSignal("BTCUSDT", t0 + 1000)) {
    throw new Error("Expected BTCUSDT to still be allowed after 1 SL on CTUSDT");
  }
  // 2nd SL on CTUSDT -> 24h lock
  recordSymbolStopLoss("CTUSDT", t0 + 10_000);
  const g2 = getDispatchGuardStatus("CTUSDT", t0 + 11_000);
  if (g2.allowed || g2.remainingSec < 80_000) {
    throw new Error(`Expected 24h lockout after 2nd SL on CTUSDT, got: ${JSON.stringify(g2)}`);
  }
  // 3rd SL across market within 2h -> Global Circuit Breaker activates!
  const cb = recordSymbolStopLoss("LITUSDT", t0 + 20_000);
  if (!cb.active || canDispatchSignal("BTCUSDT", t0 + 21_000)) {
    throw new Error(`Expected Global SL Circuit Breaker to pause BTCUSDT, got: ${JSON.stringify(cb)}`);
  }
  console.log(
    `[PASS] 3. Adaptive SL Backoff (6h -> 24h) & Global Circuit Breaker (${cb.recentSlCount}/${cb.threshold} SL -> pause) verified`
  );

  // 4. Institutional Critic & Risk Quant Gates
  const base = makeRecord("SOLUSDT", 100, 98, 102.4, 104.4, 106.6);
  const passVerdict = runCriticRiskAgent(base.scout, base.technician, base.macroFlow);
  if (passVerdict.verdict !== "APPROVE") {
    throw new Error(`Expected clean Pullback-Reclaim setup to APPROVE, got REJECT: ${passVerdict.reasons.join("; ")}`);
  }
  const failCases: Array<{ name: string; res: ReturnType<typeof runCriticRiskAgent> }> = [
    {
      name: "BTC 1h dump (-0.9%)",
      res: runCriticRiskAgent(base.scout, base.technician, { ...base.macroFlow, btcChange1hPct: -0.9 })
    },
    {
      name: "BTC dual-TF BEARISH",
      res: runCriticRiskAgent(base.scout, base.technician, {
        ...base.macroFlow,
        btcTrend1h: "BEARISH",
        btcTrend4h: "BEARISH"
      })
    },
    {
      name: "Coin 1H BEARISH (dead-cat bounce)",
      res: runCriticRiskAgent(base.scout, base.technician, { ...base.macroFlow, trend1h: "BEARISH", trend4h: "NEUTRAL" })
    },
    {
      name: "Seller wall Bid/Ask 0.49x",
      res: runCriticRiskAgent(base.scout, base.technician, { ...base.macroFlow, bidAskRatio: 0.49 })
    },
    {
      name: "No pullback-reclaim (chasing spike)",
      res: runCriticRiskAgent(base.scout, { ...base.technician, isPullbackReclaim: false }, base.macroFlow)
    },
    {
      name: "Whipsaw volatility ATR 4.1%",
      res: runCriticRiskAgent(base.scout, { ...base.technician, atrPct: 4.1 }, base.macroFlow)
    },
    {
      name: "Low confidence (<65)",
      res: runCriticRiskAgent(
        { ...base.scout, scoutScore: 20 },
        { ...base.technician, techScore: 30 },
        { ...base.macroFlow, macroScore: 30 }
      )
    }
  ];
  for (const fc of failCases) {
    if (fc.res.verdict !== "REJECT") {
      throw new Error(`Critic gate failed to REJECT [${fc.name}]`);
    }
  }
  console.log(`[PASS] 4. All ${failCases.length} institutional Critic & Risk hard-reject gates verified`);

  // 5. Live Technician SL/TP Fix Verification (BTC & SOL)
  for (const sym of ["BTC", "SOL"]) {
    const check = await analyzeTokenOnDemand(sym);
    const t = check.record.technician;
    const slPct = Number((((t.entryPrice - t.stopLossPrice) / t.entryPrice) * 100).toFixed(2));
    if (
      !t.tp1Price ||
      !t.tp2Price ||
      !t.tp3Price ||
      !(t.stopLossPrice < t.entryPrice && t.entryPrice < t.tp1Price && t.tp1Price < t.tp2Price && t.tp2Price < t.tp3Price)
    ) {
      throw new Error(`Live SL/TP monotonic invariant broken on ${sym}`);
    }
    if (slPct < 1.45 || slPct > 4.3) {
      throw new Error(`Live SL distance out of volatility-respecting bounds on ${sym}: -${slPct}%`);
    }
    if (typeof t.ema50 !== "number" || typeof t.atrPct !== "number") {
      throw new Error(`Missing ema50/atrPct on live Technician result for ${sym}`);
    }
    console.log(
      `  [OK] Live ${check.symbol}: SL=-${slPct}% (${t.tradeMode}) | ATR=${t.atrPct}% | PullbackReclaim=${t.isPullbackReclaim} | BTC 1H=${check.record.macroFlow.btcChange1hPct}% (${check.record.macroFlow.btcTrend1h}/${check.record.macroFlow.btcTrend4h}) | Verdict=${check.record.criticRisk.verdict}`
    );
  }
  console.log("[PASS] 5. Live Technician volatility-respecting SL (>=1.5%) & EMA50 diagnostics verified");

  // 6. Ephemeral HTTP check for /health, /api/signals/tracker & Dashboard HTML
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind ephemeral port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthBody = await healthRes.json();
    if (
      healthRes.status !== 200 ||
      healthBody.stage !== "stage-5.9-quant-alpha-shield" ||
      healthBody.signalTracker?.totalNetPnlPct !== 2.06
    ) {
      throw new Error(`GET /health Stage 5.9 mismatch: ${JSON.stringify(healthBody)}`);
    }

    const trkRes = await fetch(`${baseUrl}/api/signals/tracker`);
    const trkBody = await trkRes.json();
    if (
      trkRes.status !== 200 ||
      trkBody.totalNetPnlPct !== 2.06 ||
      trkBody.profitFactor !== 2.03 ||
      trkBody.circuitBreaker?.active !== true
    ) {
      throw new Error(`GET /api/signals/tracker Stage 5.9 mismatch: ${JSON.stringify(trkBody)}`);
    }

    const dashRes = await fetch(`${baseUrl}/`);
    const dashHtml = await dashRes.text();
    if (!dashHtml.includes("allTimeNetPnl") || !dashHtml.includes("allTimeCbBadge")) {
      throw new Error("Dashboard HTML missing Stage 5.9 All-Time Signal KPI elements");
    }
    console.log("[PASS] 6. HTTP /health, /api/signals/tracker, and Dashboard All-Time Net PnL UI verified");
  } finally {
    resetSignalTrackerForTest();
    resetCooldownsForTest();
    server.close();
  }

  const cbReset = getCircuitBreakerStatus();
  if (cbReset.active) throw new Error("Failed to clean circuit breaker state");

  console.log("=== Stage 5.9 Verification Completed (100% PASS) ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 5.9 Verification Error:", err);
  process.exit(1);
});
