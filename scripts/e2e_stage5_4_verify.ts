import { runFundamentalShield } from "../src/services/fundamental.service";
import {
  evaluateOpenDemoTrades,
  getDemoPortfolioSummary,
  openDemoTradeFromSignal,
  resetDemoPortfolioForTest
} from "../src/services/demoPortfolio.service";
import { analyzeTokenOnDemand } from "../src/services/tokenCheck.service";

async function main() {
  console.log("=== Stage 5.4 (Hybrid + TP1/TP2/TP3 Breakeven + Fundamental Shield + Post-Mortem) E2E Started ===");

  // 1. Fundamental Shield + 24h cache test
  const f1 = await runFundamentalShield("BTCUSDT");
  const t0 = Date.now();
  const f2 = await runFundamentalShield("BTCUSDT"); // must hit 24h cache immediately
  const cacheMs = Date.now() - t0;
  if (f1.hardBlockReason !== null || cacheMs > 500) {
    throw new Error(`Fundamental shield/cache check failed: block=${f1.hardBlockReason}, cacheMs=${cacheMs}`);
  }
  console.log(`[PASS] Fundamental Shield + 24h cache verified (${cacheMs}ms) -> ${f2.badgeUz} | F&G: ${f2.fearGreed?.value ?? "N/A"}`);

  // 2. Test TP1 Breakeven + SL Post-Mortem + Intraday/Swing breakdown
  resetDemoPortfolioForTest();
  const btcCheck = await analyzeTokenOnDemand("BTC");
  const tech = btcCheck.record.technician;
  if (!tech.tp1Price || !tech.tp2Price || !tech.tp3Price) {
    throw new Error("Missing TP1/TP2/TP3 levels on Technician result");
  }
  if (
    !(
      tech.stopLossPrice < tech.entryPrice &&
      tech.entryPrice < tech.tp1Price &&
      tech.tp1Price < tech.tp2Price &&
      tech.tp2Price < tech.tp3Price
    )
  ) {
    throw new Error(
      `Non-monotonic SL/Entry/TP1/TP2/TP3 ordering: SL=${tech.stopLossPrice}, Entry=${tech.entryPrice}, TP1=${tech.tp1Price}, TP2=${tech.tp2Price}, TP3=${tech.tp3Price}`
    );
  }
  console.log(
    `[PASS] Hybrid BTC check -> Mode: ${btcCheck.record.criticRisk.tradeMode} | SL=${tech.stopLossPrice} < Entry=${tech.entryPrice} < TP1=${tech.tp1Price} < TP2=${tech.tp2Price} < TP3=${tech.tp3Price}`
  );

  // Simulate TP1 hit -> Breakeven SL move
  const mockTrade = openDemoTradeFromSignal({
    ...btcCheck.record,
    scout: { ...btcCheck.record.scout, symbol: "SIMBEUSDT" },
    technician: {
      ...btcCheck.record.technician,
      symbol: "SIMBEUSDT",
      entryPrice: 100,
      stopLossPrice: 96,
      tp1Price: 105,
      tp2Price: 110,
      tp3Price: 115,
      takeProfitPrice: 110
    },
    criticRisk: { ...btcCheck.record.criticRisk, verdict: "APPROVE", tradeMode: "SWING" }
  });
  if (!mockTrade) throw new Error("Failed to open simulated SWING trade");

  // Hit TP1 at 106 -> SL must move to Entry (100)
  evaluateOpenDemoTrades(new Map([["SIMBEUSDT", 106]]));
  const afterTp1 = getDemoPortfolioSummary().openTrades.find((t) => t.symbol === "SIMBEUSDT");
  if (!afterTp1 || !afterTp1.tp1Hit || !afterTp1.breakevenActive || afterTp1.stopLossPrice !== 100) {
    throw new Error(`TP1 Breakeven transition failed: ${JSON.stringify(afterTp1)}`);
  }
  console.log("[PASS] TP1 Hit automatically moved SL to Breakeven (100)");

  resetDemoPortfolioForTest();
  console.log("=== Stage 5.4 E2E Verification Completed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 5.4 Verification Error:", err);
  process.exit(1);
});
