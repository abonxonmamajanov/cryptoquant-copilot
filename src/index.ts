import express from "express";
import { env } from "./config/env";
import { runMarketHealthChecks } from "./services/marketHealth.service";
import {
  fetchMexcKlines,
  fetchMexcTickerPrice,
  getActiveMexcMirror
} from "./services/mexcClient.service";
import {
  getLatestPipelineSnapshot,
  getLatestScoutSnapshot,
  getSchedulerStats,
  startScoutScheduler,
  stopScoutScheduler,
  triggerPipelineRunNow,
  triggerScoutScanNow
} from "./services/scheduler.service";
import {
  closeDemoTradeManually,
  getDemoPortfolioSummary,
  openManualDemoTrade
} from "./services/demoPortfolio.service";
import { generatePortfolioPdfBuffer } from "./services/pdfReport.service";
import { sendTelegramPdfReport } from "./agents/executive.agent";
import {
  getSubscriberCount,
  LEGAL_DISCLAIMER_UZ,
  SUBSCRIPTION_PLANS
} from "./services/subscription.service";
import {
  isTelegramBotRunning,
  startTelegramBot,
  stopTelegramBot
} from "./services/telegramBot.service";
import { renderDashboardHtml } from "./views/dashboard.view";
import { runHistoricalBacktest } from "./services/backtest.service";
import {
  startDailyReportScheduler,
  stopDailyReportScheduler
} from "./services/dailyReport.service";
import { isFilteredOutSymbol } from "./agents/scout.agent";
import {
  analyzeTokenOnDemand,
  normalizeMexcSymbol
} from "./services/tokenCheck.service";
import { generate15mChartPng } from "./services/chartGenerator.service";
import { buildTradingViewMexcUrl } from "./utils/exchangeLinks";
import { getFiveAgentsLiveStatus } from "./services/agentTelemetry.service";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(renderDashboardHtml());
});

app.get("/ping", (_req, res) => {
  res.status(200).send("pong");
});

app.get("/health", (_req, res) => {
  const portfolio = getDemoPortfolioSummary();
  res.status(200).json({
    service: "cryptoquant-copilot",
    stage: "stage-5-production-100",
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

app.get("/api/metrics", (_req, res) => {
  const memoryRssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
  res.status(200).json({
    uptimeSec: Math.round(process.uptime()),
    memoryRssMb,
    activeMirror: getActiveMexcMirror(),
    scheduler: getSchedulerStats(),
    portfolio: getDemoPortfolioSummary(),
    telegramBotRunning: isTelegramBotRunning(),
    timestamp: new Date().toISOString()
  });
});

app.get("/api/agents/status", (_req, res) => {
  res.status(200).json(getFiveAgentsLiveStatus());
});

app.get("/api/backtest", async (req, res) => {
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase().trim();
  const parsedLimit = Number(req.query.limit ?? 240);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 240;

  if (!symbol || isFilteredOutSymbol(symbol)) {
    res.status(400).json({
      error: `Symbol ${symbol || "(empty)"} is filtered out (stablecoin, leveraged token, or non-USDT).`
    });
    return;
  }

  try {
    const result = await runHistoricalBacktest(symbol, limit);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backtest error";
    const status = message.includes("filtered out") || message.includes("Insufficient") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

app.get("/api/token/:symbol/check", async (req, res) => {
  try {
    const result = await analyzeTokenOnDemand(req.params.symbol);
    res.status(200).json({
      symbol: result.symbol,
      record: result.record,
      caption: result.caption,
      chartUrl: `/api/token/${encodeURIComponent(result.symbol)}/chart.png`,
      tradingViewUrl: buildTradingViewMexcUrl(result.symbol, "15")
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token check error";
    const status = message.includes("tahlil qilinmaydi") || message.includes("not found") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

app.get("/api/token/:symbol/chart.png", async (req, res) => {
  try {
    const intervalParam = String(req.query.interval || "15m").toLowerCase();
    const is1h = intervalParam === "1h" || intervalParam === "60";
    const analysis = await analyzeTokenOnDemand(req.params.symbol);
    let png = analysis.chartPng;
    if (is1h) {
      const klines1h = await fetchMexcKlines(analysis.symbol, "1h", 60);
      png = generate15mChartPng(klines1h, {
        symbol: analysis.symbol,
        entryPrice: analysis.record.technician.entryPrice,
        takeProfitPrice: analysis.record.technician.takeProfitPrice,
        stopLossPrice: analysis.record.technician.stopLossPrice,
        verdict: analysis.record.criticRisk.verdict,
        timeframeLabel: "1H"
      });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(png);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chart generation error";
    res.status(400).json({ error: message });
  }
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

app.post("/api/portfolio/buy", async (req, res) => {
  try {
    const rawSymbol = String(req.body?.symbol || "").trim();
    if (!rawSymbol) {
      res.status(400).json({ ok: false, error: "symbol talab qilinadi" });
      return;
    }
    const rawAmount = req.body?.amountUsd;
    const amountUsd = rawAmount !== undefined && rawAmount !== null ? Number(rawAmount) : undefined;

    const analysis = await analyzeTokenOnDemand(rawSymbol);
    const result = openManualDemoTrade(analysis.record, amountUsd);
    if (!result.ok) {
      res.status(400).json({
        ok: false,
        error: result.error,
        portfolio: getDemoPortfolioSummary()
      });
      return;
    }

    res.status(200).json({
      ok: true,
      trade: result.trade,
      portfolio: getDemoPortfolioSummary()
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Manual demo buy error";
    res.status(400).json({ ok: false, error: message, portfolio: getDemoPortfolioSummary() });
  }
});

app.post("/api/portfolio/close", async (req, res) => {
  try {
    const rawSymbol = String(req.body?.symbol || "").trim();
    if (!rawSymbol) {
      res.status(400).json({ ok: false, error: "symbol talab qilinadi" });
      return;
    }
    const symbol = normalizeMexcSymbol(rawSymbol);
    const livePrice = await fetchMexcTickerPrice(symbol);
    const result = closeDemoTradeManually(symbol, livePrice);

    if (!result.ok) {
      res.status(400).json({
        ok: false,
        error: result.error,
        portfolio: getDemoPortfolioSummary()
      });
      return;
    }

    res.status(200).json({
      ok: true,
      trade: result.trade,
      portfolio: getDemoPortfolioSummary()
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Manual demo close error";
    res.status(400).json({ ok: false, error: message, portfolio: getDemoPortfolioSummary() });
  }
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
  const server = app.listen(env.PORT, () => {
    console.log(`[CryptoQuant-Copilot] Stage 5.5 (Mini App + 5-Agent Live Panel) server running on port ${env.PORT}`);
    startScoutScheduler(60_000);
    startDailyReportScheduler();
    startTelegramBot();
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[CryptoQuant-Copilot] Received ${signal}, shutting down cleanly...`);

    stopScoutScheduler();
    stopDailyReportScheduler();

    try {
      await stopTelegramBot();
    } catch (err) {
      console.error("[Telegram Bot] Error during stop:", err instanceof Error ? err.message : err);
    }

    const forceExitTimer = setTimeout(() => process.exit(0), 5000);
    forceExitTimer.unref();

    server.close(() => {
      clearTimeout(forceExitTimer);
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });
}

export { app };
