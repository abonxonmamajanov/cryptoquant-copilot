import http from "http";
import { app } from "../src/index";
import { calculatePositionRisk } from "../src/utils/tradingSession";
import {
  addPriceAlert,
  evaluatePriceAlerts,
  resetPriceAlertsForTest
} from "../src/services/priceAlert.service";
import {
  evaluateTrackedSignals,
  get24hSignalReport,
  registerDispatchedSignal,
  resetSignalTrackerForTest
} from "../src/services/signalTracker.service";
import { pushActivityLog } from "../src/services/activityLog.service";
import { runCriticRiskAgent } from "../src/agents/criticRisk.agent";
import { formatTelegramSignalCard } from "../src/agents/executive.agent";
import type { EvaluatedSignalRecord } from "../src/services/pipeline.service";

function buildMockRecord(
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
      priceChange24hPct: 6.4,
      quoteVolume24hUsd: 12_000_000,
      volumeSpikeRatio15m: 2.4,
      momentum15mPct: 1.3,
      scoutScore: 82,
      isAnomaly: true,
      isNewAlert: true,
      reasons: ["Erta breakout zonasi (+6.4%)"],
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
      riskRewardRatio: 2.5,
      rsi14: 54,
      ema9: entry,
      ema21: entry * 0.992,
      atr14: entry * 0.01,
      supportLevel: sl,
      resistanceLevel: tp2,
      techScore: 86,
      summary: "INTRADAY EMA9/21 ijobiy, RSI=54, R:R=1:2.5",
      latencyMs: 3
    },
    macroFlow: {
      symbol,
      btcChange1hPct: 0.45,
      bidDepthUsd: 180_000,
      askDepthUsd: 110_000,
      bidAskRatio: 1.64,
      spreadPct: 0.04,
      regime: "BULLISH",
      trend1h: "BULLISH",
      trend4h: "BULLISH",
      fundingRatePct: 0.01,
      exchanges: ["MEXC", "Binance"],
      macroScore: 84,
      summary: "BTC 1s: +0.45%, 1H/4H: BULLISH/BULLISH, Bid/Ask: 1.64x (MEXC+Binance), Spread: 0.04%",
      latencyMs: 3
    },
    criticRisk: {
      symbol,
      verdict: "APPROVE",
      tradeMode: "SWING",
      confidenceScore: 85,
      longTermStars: { count: 5, label: "⭐⭐⭐⭐⭐ (5/5)" },
      softWarnings: [],
      reasons: ["R:R 1:2.5 talabga mos (SWING)"],
      latencyMs: 2
    },
    executive: null
  };
}

async function main() {
  console.log("=== Stage 5.7 Pro Edition E2E Verification Started ===");

  resetPriceAlertsForTest();
  resetSignalTrackerForTest();

  // 1. Position Risk Calculator check
  const risk = calculatePositionRisk(500, 2, 100, 96);
  if (risk.maxLossUsd !== 10 || risk.positionSizeUsd !== 250 || risk.coinQty !== 2.5) {
    throw new Error(`calculatePositionRisk mismatch: ${JSON.stringify(risk)}`);
  }
  console.log(
    `[PASS] calculatePositionRisk(500, 2, 100, 96) -> maxLossUsd=$${risk.maxLossUsd}, positionSizeUsd=$${risk.positionSizeUsd}, qty=${risk.coinQty}`
  );

  // 2. Price Alerts: reject stablecoin + trigger cleanly
  const badAlert = addPriceAlert("USDC", 1.01, 1.0);
  if (badAlert.ok) {
    throw new Error("Expected stablecoin USDC price alert to be rejected");
  }
  const goodAlert = addPriceAlert("SOL", 150, 140);
  if (!goodAlert.ok || !goodAlert.alert || goodAlert.alert.direction !== "ABOVE") {
    throw new Error(`Expected valid ABOVE SOLUSDT alert, got: ${JSON.stringify(goodAlert)}`);
  }
  const triggered = evaluatePriceAlerts(new Map([["SOLUSDT", 152]]));
  if (triggered.length !== 1 || !triggered[0].telegramText.includes("SOLUSDT")) {
    throw new Error(`Expected SOLUSDT price alert to trigger, got: ${JSON.stringify(triggered)}`);
  }
  console.log("[PASS] Price alerts reject stablecoins (USDC) and trigger cleanly on live hit");

  // 3. Signal Tracker replyToMessageId=98765 + 24h Report with coin-by-coin metrics & motto
  const mockWin = buildMockRecord("SOLUSDT", 100, 96, 105, 110, 116);
  registerDispatchedSignal(mockWin, 98765);
  const tp1Events = evaluateTrackedSignals(new Map([["SOLUSDT", 106]]));
  if (
    tp1Events.length !== 1 ||
    tp1Events[0].eventType !== "TP1_HIT" ||
    tp1Events[0].replyToMessageId !== 98765 ||
    !tp1Events[0].telegramText.includes("Signal vaqti") ||
    !tp1Events[0].telegramText.includes("Joriy narx")
  ) {
    throw new Error(`Expected TP1_HIT with replyToMessageId=98765, got: ${JSON.stringify(tp1Events)}`);
  }
  const tp3Events = evaluateTrackedSignals(new Map([["SOLUSDT", 117]]));
  if (tp3Events.length !== 1 || tp3Events[0].replyToMessageId !== 98765) {
    throw new Error(`Expected TP3_HIT preserving replyToMessageId=98765, got: ${JSON.stringify(tp3Events)}`);
  }

  const mockSl = buildMockRecord("AVAXUSDT", 50, 48, 53, 55, 58);
  registerDispatchedSignal(mockSl, 98766);
  const slEvents = evaluateTrackedSignals(new Map([["AVAXUSDT", 47.5]]));
  if (slEvents.length !== 1 || slEvents[0].eventType !== "SL_HIT" || slEvents[0].replyToMessageId !== 98766) {
    throw new Error(`Expected SL_HIT preserving replyToMessageId=98766, got: ${JSON.stringify(slEvents)}`);
  }

  const report24h = get24hSignalReport();
  if (
    report24h.total !== 2 ||
    report24h.tpCount !== 1 ||
    report24h.slCount !== 1 ||
    report24h.accuracyPct !== 50 ||
    report24h.byCoin.length !== 2 ||
    !report24h.formattedTelegramText.includes("Tez foyda emas — doimiy xotirjam, aniq savdo")
  ) {
    throw new Error(`get24hSignalReport mismatch: ${JSON.stringify(report24h)}`);
  }
  console.log(
    `[PASS] Signal Tracker replyToMessageId=98765 & 24h Report verified (total=${report24h.total}, acc=${report24h.accuracyPct}%, net=${report24h.netPnlPct}%)`
  );

  // 4. Quant Discipline: Late parabolic FOMO hard-reject + 3-line Signal Card
  const fomoReject = runCriticRiskAgent(
    { ...mockWin.scout, priceChange24hPct: 35.5 },
    { ...mockWin.technician, rsi14: 78 },
    mockWin.macroFlow
  );
  if (fomoReject.verdict !== "REJECT") {
    throw new Error(`Expected late parabolic FOMO (>28% & RSI>72) to hard-reject, got ${fomoReject.verdict}`);
  }
  const cardText = formatTelegramSignalCard(
    mockWin.scout,
    mockWin.technician,
    mockWin.macroFlow,
    mockWin.criticRisk
  );
  if (
    !cardText.includes("• *Trend:*") ||
    !cardText.includes("• *Bozor:*") ||
    !cardText.includes("• *Eslatma:*")
  ) {
    throw new Error(`3-line Telegram card format missing expected markers:\n${cardText}`);
  }
  console.log("[PASS] Early-breakout FOMO hard-reject & 3-line Telegram signal card verified");

  // 5. Ephemeral HTTP checks for Dashboard & Stage 5.7 API routes
  pushActivityLog("SCOUT", "INFO", "Stage 5.7 E2E verification log entry");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind ephemeral server port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const htmlRes = await fetch(`${baseUrl}/`);
    const html = await htmlRes.text();
    const requiredHtmlTokens = [
      "Tez foyda emas",
      "Wall Street",
      "Treyder Asboblari",
      "TOKYO",
      "LONDON",
      "NEW YORK",
      "#050914"
    ];
    if (htmlRes.status !== 200) {
      throw new Error(`GET / returned HTTP ${htmlRes.status}`);
    }
    for (const token of requiredHtmlTokens) {
      if (!html.includes(token)) {
        throw new Error(`GET / HTML missing required token: "${token}"`);
      }
    }
    console.log(`[PASS] GET / verified (HTTP 200, ${html.length} chars, all 7 Stage 5.7 markers present)`);

    for (const ep of ["/api/logs/recent", "/api/signals/report24h", "/api/alerts"]) {
      const r = await fetch(`${baseUrl}${ep}`);
      if (r.status !== 200) {
        throw new Error(`GET ${ep} returned HTTP ${r.status}`);
      }
    }
    console.log("[PASS] GET /api/logs/recent, /api/signals/report24h, /api/alerts all returned HTTP 200");
  } finally {
    resetPriceAlertsForTest();
    resetSignalTrackerForTest();
    server.close();
  }

  console.log("=== Stage 5.7 Pro Edition E2E Verification Completed (100% PASS) ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 5.7 Verification Error:", err);
  process.exit(1);
});
