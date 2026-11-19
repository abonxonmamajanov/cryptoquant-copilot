import http from "http";
import { app } from "../src/index";
import { buildTelegramSignalReplyMarkup } from "../src/utils/exchangeLinks";
import { resetDemoPortfolioForTest } from "../src/services/demoPortfolio.service";

async function main() {
  console.log("=== Stage 5.5 (Manual Demo Buy/Close + Mini App + 5-Agent Live Panel) E2E Started ===");

  resetDemoPortfolioForTest();

  // 1. Verify Telegram signal markup includes demo_buy:SOLUSDT:100 and NO exchange URL
  const markup = buildTelegramSignalReplyMarkup("SOLUSDT", 75);
  const flatBtns = markup.inline_keyboard.flat();
  const hasDemoBuy = flatBtns.some(
    (b) => "callback_data" in b && b.callback_data === "demo_buy:SOLUSDT:100"
  );
  const hasExchangeUrl = flatBtns.some(
    (b) => "url" in b && String(b.url).includes("mexc.com/exchange")
  );
  if (!hasDemoBuy) {
    throw new Error("Missing demo_buy:SOLUSDT:100 button in Telegram signal keyboard");
  }
  if (hasExchangeUrl) {
    throw new Error("Direct exchange link button must NOT be present");
  }
  console.log("[PASS] Telegram 3-row keyboard verified (2x2 + demo_buy:SOLUSDT:100, zero exchange links)");

  // 2. Spin up ephemeral Express server
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // 3. GET /api/agents/status returns all 5 agents
  const agentsRes = await fetch(`${baseUrl}/api/agents/status`);
  const agentsBody = await agentsRes.json();
  const requiredAgents = ["scout", "technician", "macroFlow", "criticRisk", "executive"];
  for (const key of requiredAgents) {
    if (!agentsBody[key] || agentsBody[key].status !== "ACTIVE") {
      throw new Error(`GET /api/agents/status missing or inactive agent: ${key}`);
    }
  }
  console.log("[PASS] GET /api/agents/status returned all 5 ACTIVE agents");

  // 4. POST /api/portfolio/buy ({ symbol: "BTC", amountUsd: 100 })
  const buyRes = await fetch(`${baseUrl}/api/portfolio/buy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "BTC", amountUsd: 100 })
  });
  const buyBody = await buyRes.json();
  if (
    buyRes.status !== 200 ||
    !buyBody.ok ||
    buyBody.trade?.symbol !== "BTCUSDT" ||
    buyBody.trade?.source !== "MANUAL" ||
    buyBody.trade?.positionSizeUsd !== 100
  ) {
    throw new Error(`POST /api/portfolio/buy failed: ${JSON.stringify(buyBody)}`);
  }
  console.log(
    `[PASS] POST /api/portfolio/buy opened MANUAL BTCUSDT trade ($${buyBody.trade.positionSizeUsd} @ ${buyBody.trade.entryPrice})`
  );

  // 5. POST /api/portfolio/close ({ symbol: "BTCUSDT" })
  const closeRes = await fetch(`${baseUrl}/api/portfolio/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "BTCUSDT" })
  });
  const closeBody = await closeRes.json();
  if (
    closeRes.status !== 200 ||
    !closeBody.ok ||
    closeBody.trade?.status !== "MANUAL_CLOSE" ||
    closeBody.portfolio?.closedTradesCount !== 1 ||
    closeBody.portfolio?.openTradesCount !== 0
  ) {
    throw new Error(`POST /api/portfolio/close failed: ${JSON.stringify(closeBody)}`);
  }
  console.log(
    `[PASS] POST /api/portfolio/close closed BTCUSDT cleanly (PnL: ${closeBody.trade.pnlPercent}% / $${closeBody.trade.pnlUsd}, Balance: $${closeBody.portfolio.currentBalanceUsd})`
  );

  // 6. GET / HTML contains Asosiy Dashboard, 5-Agent Paneli, and Demoda sotib olish
  const dashRes = await fetch(`${baseUrl}/`);
  const dashHtml = await dashRes.text();
  if (
    dashRes.status !== 200 ||
    !dashHtml.includes("Asosiy Dashboard") ||
    !dashHtml.includes("5-Agent Paneli") ||
    !dashHtml.includes("Demoda sotib olish")
  ) {
    throw new Error("GET / Dashboard missing Stage 5.5 tabs or manual buy button");
  }
  console.log(`[PASS] GET / Dashboard HTML verified (${dashHtml.length} chars, both tabs + Demoda sotib olish)`);

  // Clean up test state
  resetDemoPortfolioForTest();
  server.close();
  console.log("=== Stage 5.5 E2E Verification Completed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 5.5 Verification Error:", err);
  process.exit(1);
});
