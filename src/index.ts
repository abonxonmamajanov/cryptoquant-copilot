import express from "express";
import { env } from "./config/env";
import { runMarketHealthChecks } from "./services/marketHealth.service";
import {
  getLatestPipelineSnapshot,
  getLatestScoutSnapshot,
  getSchedulerStats,
  startScoutScheduler,
  triggerPipelineRunNow,
  triggerScoutScanNow
} from "./services/scheduler.service";
import { getDemoPortfolioSummary } from "./services/demoPortfolio.service";
import { generatePortfolioPdfBuffer } from "./services/pdfReport.service";
import { sendTelegramPdfReport } from "./agents/executive.agent";
import {
  getSubscriberCount,
  LEGAL_DISCLAIMER_UZ,
  SUBSCRIPTION_PLANS
} from "./services/subscription.service";
import { isTelegramBotRunning, startTelegramBot } from "./services/telegramBot.service";
import { renderDashboardHtml } from "./views/dashboard.view";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(renderDashboardHtml());
});

app.get("/health", (_req, res) => {
  const portfolio = getDemoPortfolioSummary();
  res.status(200).json({
    service: "cryptoquant-copilot",
    stage: "stage-4-product-dashboard-bot",
    status: "ok",
    telegramBotRunning: isTelegramBotRunning(),
    subscribersCount: getSubscriberCount(),
    scheduler: getSchedulerStats(),
    portfolio: {
      currentBalanceUsd: portfolio.currentBalanceUsd,
      totalPnlPct: portfolio.totalPnlPct,
      openTradesCount: portfolio.openTradesCount,
      closedTradesCount: portfolio.closedTradesCount,
      winRatePct: portfolio.winRatePct
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/health/markets", async (_req, res) => {
  const checks = await runMarketHealthChecks();
  const allOk = checks.every((c) => c.ok);
  res.status(allOk ? 200 : 207).json({
    allOk,
    checks,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/plans", (_req, res) => {
  res.status(200).json({
    plans: SUBSCRIPTION_PLANS,
    disclaimer: LEGAL_DISCLAIMER_UZ
  });
});

app.get("/api/scout/latest", async (_req, res) => {
  try {
    const snapshot = getLatestScoutSnapshot() ?? (await triggerScoutScanNow());
    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scout scan error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/scout/scan", async (_req, res) => {
  try {
    const snapshot = await triggerScoutScanNow();
    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scout scan error";
    res.status(500).json({ error: message });
  }
});

app.get("/api/pipeline/latest", async (_req, res) => {
  try {
    const snapshot = getLatestPipelineSnapshot() ?? (await triggerPipelineRunNow());
    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline run error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/pipeline/run", async (_req, res) => {
  try {
    const snapshot = await triggerPipelineRunNow();
    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline run error";
    res.status(500).json({ error: message });
  }
});

app.get("/api/portfolio", (_req, res) => {
  res.status(200).json(getDemoPortfolioSummary());
});

app.get("/api/reports/pdf", async (_req, res) => {
  try {
    const summary = getDemoPortfolioSummary();
    const pdfBuffer = await generatePortfolioPdfBuffer(summary);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="cryptoquant-report.pdf"');
    res.status(200).send(pdfBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF generation error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/reports/pdf/telegram", async (_req, res) => {
  try {
    const summary = getDemoPortfolioSummary();
    const pdfBuffer = await generatePortfolioPdfBuffer(summary);
    const pnlSign = summary.totalPnlUsd >= 0 ? "+" : "";
    const caption = `CryptoQuant-Copilot Demo Portfel Hisoboti | Balans: $${summary.currentBalanceUsd.toFixed(2)} (${pnlSign}${summary.totalPnlPct}%) | Win Rate: ${summary.winRatePct}%`;
    const result = await sendTelegramPdfReport(pdfBuffer, "cryptoquant-report.pdf", caption);
    res.status(200).json({
      filename: "cryptoquant-report.pdf",
      bytes: pdfBuffer.length,
      ...result
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Telegram PDF report error";
    res.status(500).json({ error: message });
  }
});

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`[CryptoQuant-Copilot] Stage 4 server running on port ${env.PORT}`);
    startScoutScheduler(60_000);
    startTelegramBot();
  });
}

export { app };
