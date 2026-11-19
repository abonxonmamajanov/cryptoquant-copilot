import { buildTelegramSignalReplyMarkup, buildTradingViewMexcUrl } from "../src/utils/exchangeLinks";
import { analyzeTokenOnDemand } from "../src/services/tokenCheck.service";
import { fetchMexcKlines } from "../src/services/mexcClient.service";
import { generate15mChartPng } from "../src/services/chartGenerator.service";

async function main() {
  console.log("=== Stage 5.2 (2x2 Buttons + 15M/1H Charts + TradingView MEXC) E2E Verification Started ===");

  // 1. Verify 2x2 inline keyboard (NO exchange URL button)
  const markup = buildTelegramSignalReplyMarkup("HYPEUSDT", 81.5);
  const flatBtns = markup.inline_keyboard.flat();
  if (flatBtns.length !== 4) {
    throw new Error(`Expected 4 buttons in 2x2 grid, got ${flatBtns.length}`);
  }
  const tvUrl = buildTradingViewMexcUrl("HYPEUSDT", "15");
  if (tvUrl !== "https://www.tradingview.com/chart/?symbol=MEXC:HYPEUSDT&interval=15") {
    throw new Error(`Unexpected TradingView URL: ${tvUrl}`);
  }
  const hasExchangeUrl = flatBtns.some((b) => "url" in b && String(b.url).includes("mexc.com/exchange"));
  if (hasExchangeUrl) {
    throw new Error("Direct exchange link button must NOT be present");
  }
  console.log("[PASS] 2x2 Telegram keyboard verified (TradingView MEXC 15M, Live Refresh, 1H Chart, Backtest)");

  // 2. Verify live 15M & 1H PNG chart generation
  const res = await analyzeTokenOnDemand("BTC");
  const klines1h = await fetchMexcKlines("BTCUSDT", "1h", 60);
  const png1h = generate15mChartPng(klines1h, {
    symbol: "BTCUSDT",
    entryPrice: res.record.technician.entryPrice,
    takeProfitPrice: res.record.technician.takeProfitPrice,
    stopLossPrice: res.record.technician.stopLossPrice,
    verdict: res.record.criticRisk.verdict,
    timeframeLabel: "1H"
  });

  const isPng = (b: Buffer) => b.length > 5000 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (!isPng(res.chartPng) || !isPng(png1h)) {
    throw new Error("Invalid 15M or 1H PNG chart buffer");
  }
  console.log(`[PASS] Live 15M PNG (${res.chartPng.length} bytes) & 1H PNG (${png1h.length} bytes) verified`);

  console.log("=== Stage 5.2 E2E Verification Completed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 5.2 Verification Error:", err);
  process.exit(1);
});
