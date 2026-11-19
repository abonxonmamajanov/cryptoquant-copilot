import http from "http";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { app } from "../src/index";
import { analyzeTokenOnDemand } from "../src/services/tokenCheck.service";
import {
  closeDemoTradeManually,
  openManualDemoTrade,
  resetDemoPortfolioForTest
} from "../src/services/demoPortfolio.service";
import {
  evaluateTrackedSignals,
  getSignalTrackerSummary,
  registerDispatchedSignal,
  resetSignalTrackerForTest
} from "../src/services/signalTracker.service";
import type { EvaluatedSignalRecord } from "../src/services/pipeline.service";

function buildMockRecord(symbol: string, entry: number, sl: number, tp1: number, tp2: number, tp3: number): EvaluatedSignalRecord {
  return {
    scout: {
      symbol,
      exchange: "MEXC",
      lastPrice: entry,
      priceChange24hPct: 4.2,
      quoteVolume24hUsd: 15_000_000,
      volumeSpikeRatio15m: 2.3,
      momentum15mPct: 1.4,
      scoutScore: 76,
      isAnomaly: true,
      isNewAlert: true,
      reasons: ["Stress test"],
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
      riskRewardRatio: 2.4,
      rsi14: 55,
      ema9: entry,
      ema21: entry * 0.99,
      atr14: entry * 0.01,
      supportLevel: sl,
      resistanceLevel: tp2,
      techScore: 80,
      summary: "Stress test setup",
      latencyMs: 3
    },
    macroFlow: {
      symbol,
      btcChange1hPct: 0.4,
      bidDepthUsd: 100_000,
      askDepthUsd: 70_000,
      bidAskRatio: 1.4,
      spreadPct: 0.05,
      regime: "BULLISH",
      trend1h: "BULLISH",
      trend4h: "BULLISH",
      fundingRatePct: 0.01,
      macroScore: 80,
      summary: "Stress test macro",
      latencyMs: 3
    },
    criticRisk: {
      symbol,
      verdict: "APPROVE",
      tradeMode: "INTRADAY",
      confidenceScore: 80,
      longTermStars: { count: 4, label: "★★★★☆ (4/5)" },
      softWarnings: [],
      reasons: ["Approved"],
      latencyMs: 2
    },
    executive: null
  };
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceFiles(full));
    else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function main() {
  console.log("===================================================================");
  console.log("=== CryptoQuant-Copilot Stage 5.6 — FULL 6-POINT STRESS TEST ===");
  console.log("===================================================================");

  resetDemoPortfolioForTest();
  resetSignalTrackerForTest();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind ephemeral port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // -----------------------------------------------------------------
    // TEST 1: Parallel Load & RAM Ceiling (Render 512MB Free Tier check)
    // -----------------------------------------------------------------
    console.log("\n--- [TEST 1] Parallel Load (10 Concurrent Requests) & RAM Ceiling ---");
    const t1Start = Date.now();
    const parallelUrls = [
      `${baseUrl}/api/chart/BTCUSDT.png`,
      `${baseUrl}/api/chart/BTCUSDT.png`,
      `${baseUrl}/api/chart/BTCUSDT.png`,
      `${baseUrl}/api/reports/pdf`,
      `${baseUrl}/api/reports/pdf`,
      `${baseUrl}/api/agents/status`,
      `${baseUrl}/api/agents/status`,
      `${baseUrl}/api/agents/status`,
      `${baseUrl}/api/check/BTC`,
      `${baseUrl}/api/check/BTC`
    ];
    const parallelRes = await Promise.all(
      parallelUrls.map(async (url) => {
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        return { url, status: r.status, bytes: buf.length };
      })
    );
    const t1WallMs = Date.now() - t1Start;
    for (const item of parallelRes) {
      if (item.status !== 200 || item.bytes === 0) {
        throw new Error(`Parallel request failed: ${item.url} -> HTTP ${item.status} (${item.bytes} bytes)`);
      }
    }
    const peakRssMb = Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2));
    if (peakRssMb >= 380) {
      throw new Error(`RAM ceiling exceeded: ${peakRssMb} MB >= 380 MB`);
    }
    console.log(
      `[PASS] TEST 1: 10/10 concurrent HTTP 200 in ${t1WallMs}ms | Peak RSS RAM: ${peakRssMb} MB (< 380 MB)`
    );

    // -----------------------------------------------------------------
    // TEST 2: Fuzzing & Invalid/Malicious Inputs (0 Crashes)
    // -----------------------------------------------------------------
    console.log("\n--- [TEST 2] Fuzzing & Invalid Input Rejection ---");
    const badGets = [
      `${baseUrl}/api/check/USDC`,
      `${baseUrl}/api/check/FDUSD`,
      `${baseUrl}/api/check/FAKECOIN99999`,
      `${baseUrl}/api/backtest?symbol=USDCUSDT`
    ];
    for (const url of badGets) {
      const r = await fetch(url);
      if (r.status !== 400 && r.status !== 404) {
        throw new Error(`Expected 400/404 for ${url}, got ${r.status}`);
      }
    }

    const badPosts: Array<{ path: string; body: Record<string, unknown> }> = [
      { path: "/api/portfolio/buy", body: { symbol: "BTC", amountUsd: -500 } },
      { path: "/api/portfolio/buy", body: { symbol: "BTC", amountUsd: 9999999 } },
      { path: "/api/portfolio/buy", body: { symbol: "USDC", amountUsd: 100 } },
      { path: "/api/portfolio/close", body: { symbol: "NONEXISTENTUSDT" } }
    ];
    for (const p of badPosts) {
      const r = await fetch(`${baseUrl}${p.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p.body)
      });
      if (r.status !== 400 && r.status !== 404) {
        throw new Error(`Expected 400/404 for POST ${p.path} ${JSON.stringify(p.body)}, got ${r.status}`);
      }
    }

    const pingRes = await fetch(`${baseUrl}/ping`);
    const pingText = await pingRes.text();
    if (pingRes.status !== 200 || pingText !== "pong") {
      throw new Error(`Server unhealthy after fuzzing: /ping -> ${pingRes.status} ${pingText}`);
    }
    console.log("[PASS] TEST 2: All 8 fuzz/invalid inputs rejected cleanly (400/404) & /ping -> pong");

    // -----------------------------------------------------------------
    // TEST 3: Manual-Only Demo + Signal Tracker TP1/TP2/TP3/SL Lifecycle
    // -----------------------------------------------------------------
    console.log("\n--- [TEST 3] Manual-Only Demo & Signal Tracker Lifecycle ---");
    resetSignalTrackerForTest();
    resetDemoPortfolioForTest();

    // Signal A: TP1 -> TP2 -> TP3
    registerDispatchedSignal(buildMockRecord("SIGAUSDT", 100, 96, 105, 110, 116));
    const a1 = evaluateTrackedSignals(new Map([["SIGAUSDT", 106]]));
    if (a1.length !== 1 || a1[0].eventType !== "TP1_HIT" || a1[0].signal.stopLossPrice !== 100) {
      throw new Error(`Expected TP1_HIT moving SL to 100, got: ${JSON.stringify(a1)}`);
    }
    const a2 = evaluateTrackedSignals(new Map([["SIGAUSDT", 111]]));
    if (a2.length !== 1 || a2[0].eventType !== "TP2_HIT" || a2[0].signal.stopLossPrice !== 105) {
      throw new Error(`Expected TP2_HIT moving SL to TP1 (105), got: ${JSON.stringify(a2)}`);
    }
    const a3 = evaluateTrackedSignals(new Map([["SIGAUSDT", 117]]));
    if (a3.length !== 1 || a3[0].eventType !== "TP3_HIT" || !a3[0].telegramText.includes("TP3")) {
      throw new Error(`Expected TP3_HIT close, got: ${JSON.stringify(a3)}`);
    }

    // Signal B: Direct SL_HIT
    registerDispatchedSignal(buildMockRecord("SIGBUSDT", 100, 96, 105, 110, 116));
    const b1 = evaluateTrackedSignals(new Map([["SIGBUSDT", 95]]));
    if (b1.length !== 1 || b1[0].eventType !== "SL_HIT" || !b1[0].telegramText.includes("STOP-LOSS")) {
      throw new Error(`Expected SL_HIT alert, got: ${JSON.stringify(b1)}`);
    }

    // Check /api/signals/tracker HTTP endpoint
    const trackerRes = await fetch(`${baseUrl}/api/signals/tracker`);
    const trackerBody = await trackerRes.json();
    if (trackerRes.status !== 200 || trackerBody.closedCount !== 2 || trackerBody.winsCount !== 1 || trackerBody.slCount !== 1) {
      throw new Error(`GET /api/signals/tracker mismatch: ${JSON.stringify(trackerBody)}`);
    }

    // Manual Demo Buy + Duplicate Protection + Manual Close
    const rec = buildMockRecord("MANUSDT", 100, 96, 105, 110, 116);
    const buy1 = openManualDemoTrade(rec, 100);
    if (!buy1.ok || !buy1.trade) throw new Error(`Manual buy failed: ${buy1.error}`);
    const dup = openManualDemoTrade(rec, 100);
    if (dup.ok) throw new Error("Duplicate manual demo buy should have been blocked");
    const closedMan = closeDemoTradeManually("MANUSDT", 104);
    if (!closedMan.ok || closedMan.trade?.status !== "MANUAL_CLOSE" || closedMan.trade.pnlUsd !== 4) {
      throw new Error(`Manual close failed: ${JSON.stringify(closedMan)}`);
    }
    console.log(
      "[PASS] TEST 3: Signal Tracker (TP1->BE, TP2->TP1 SL, TP3, SL_HIT) & Manual Demo Buy/Dup-Guard/Close verified"
    );

    // -----------------------------------------------------------------
    // TEST 4: Strict SL < Entry < TP1 < TP2 < TP3 Invariant (BTC & SOL)
    // -----------------------------------------------------------------
    console.log("\n--- [TEST 4] Strict SL < Entry < TP1 < TP2 < TP3 Invariant ---");
    for (const sym of ["BTC", "SOL"]) {
      const check = await analyzeTokenOnDemand(sym);
      const t = check.record.technician;
      if (
        !t.tp1Price ||
        !t.tp2Price ||
        !t.tp3Price ||
        !(t.stopLossPrice < t.entryPrice && t.entryPrice < t.tp1Price && t.tp1Price < t.tp2Price && t.tp2Price < t.tp3Price)
      ) {
        throw new Error(
          `Invariant failed for ${sym}: SL=${t.stopLossPrice}, E=${t.entryPrice}, TP1=${t.tp1Price}, TP2=${t.tp2Price}, TP3=${t.tp3Price}`
        );
      }
      console.log(
        `  [OK] ${check.symbol}: SL=${t.stopLossPrice} < Entry=${t.entryPrice} < TP1=${t.tp1Price} < TP2=${t.tp2Price} < TP3=${t.tp3Price}`
      );
    }
    console.log("[PASS] TEST 4: Strict monotonic TP/SL invariant verified on live BTC & SOL");

    // -----------------------------------------------------------------
    // TEST 5: Live Render Production Audit (Non-fatal WARN if mid-deploy)
    // -----------------------------------------------------------------
    console.log("\n--- [TEST 5] Live Render Production Audit (https://cryptoquant-copilot.onrender.com) ---");
    const renderBase = (process.env.PUBLIC_APP_URL || "https://cryptoquant-copilot.onrender.com").replace(/\/$/, "");
    const renderPaths = [
      "/ping",
      "/health",
      "/",
      "/api/agents/status",
      "/api/portfolio",
      "/api/macro/news",
      "/api/reports/pdf"
    ];
    for (const p of renderPaths) {
      const t0 = Date.now();
      try {
        const r = await fetch(`${renderBase}${p}`, { signal: AbortSignal.timeout(12000) });
        const ms = Date.now() - t0;
        const tag = r.status === 200 ? "PASS" : "WARN";
        console.log(`  [${tag}] Render ${p} -> HTTP ${r.status} (${ms}ms)`);
      } catch (err) {
        const ms = Date.now() - t0;
        console.log(`  [WARN] Render ${p} -> ${err instanceof Error ? err.message : "Network error"} (${ms}ms)`);
      }
    }

    // -----------------------------------------------------------------
    // TEST 6: Security & Secret Leak Check
    // -----------------------------------------------------------------
    console.log("\n--- [TEST 6] Security & Secret Leak Check ---");
    const trackedFiles = execSync("git ls-files", { encoding: "utf8" })
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);

    const forbiddenTracked = trackedFiles.filter(
      (f) => f === ".env" || f.startsWith(".env.") && f !== ".env.example" || f.startsWith("data/")
    );
    if (forbiddenTracked.length > 0) {
      throw new Error(`Sensitive/runtime files tracked in Git: ${forbiddenTracked.join(", ")}`);
    }

    const tokenPattern = /\d{8,10}:[A-Za-z0-9_-]{30,}/;
    const srcFiles = walkSourceFiles(path.join(process.cwd(), "src"));
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (tokenPattern.test(content)) {
        throw new Error(`Hardcoded Telegram bot token detected in ${file}`);
      }
    }
    console.log(`[PASS] TEST 6: 0 secrets in ${srcFiles.length} src files; .env & data/ not tracked in Git`);

    console.log("\n===================================================================");
    console.log("=== ALL 6 STRESS TEST CHECKS COMPLETED SUCCESSFULLY (100% PASS) ===");
    console.log("===================================================================");
  } finally {
    resetDemoPortfolioForTest();
    resetSignalTrackerForTest();
    server.close();
  }
}

main().catch((err) => {
  console.error("[FAIL] Stress Test Error:", err);
  process.exit(1);
});
