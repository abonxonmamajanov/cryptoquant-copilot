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
  DirectionFilter,
  getActiveDirectionFilter,
  getSubscriberCount,
  LEGAL_DISCLAIMER_UZ,
  setActiveDirectionFilter,
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
import { get24hSignalReport, getSignalTrackerSummary } from "./services/signalTracker.service";
import { getActiveNewsShield } from "./services/newsShield.service";
import { getRecentActivityLogs, pushActivityLog } from "./services/activityLog.service";
import { addPriceAlert, listPriceAlerts, removePriceAlert } from "./services/priceAlert.service";
import { getCircuitBreakerStatus as getWallStreetCircuitBreakerStatus } from "./services/circuitBreaker.service";
import {
  createRateLimiter,
  isSafeSymbolInput,
  safeErrorHandler,
  securityHeadersMiddleware
} from "./middleware/security.middleware";

const app = express();
app.disable("x-powered-by");
app.use(securityHeadersMiddleware);
app.use(express.json({ limit: "32kb" }));

// General API rate limit (leaves /ping and /health exempt for UptimeRobot)
const generalApiLimiter = createRateLimiter(80, 60_000, false);
const heavyApiLimiter = createRateLimiter(18, 60_000, true);
app.use("/api", generalApiLimiter);
app.use(
  [
    "/api/chart",
    "/api/reports/pdf",
    "/api/pipeline/run",
    "/api/portfolio/buy",
    "/api/portfolio/close",
    "/api/alerts"
  ],
  heavyApiLimiter
);

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(renderDashboardHtml());
});

app.get("/ping", (_req, res) => {
  res.status(200).send("pong");
});

app.get("/health", (_req, res) => {
  const portfolio = getDemoPortfolioSummary();
  const tracker = getSignalTrackerSummary();
  const wallStreetCircuitBreaker = getWallStreetCircuitBreakerStatus();
  res.status(200).json({
    service: "cryptoquant-copilot",
    stage: "stage-6.2-dual-direction-1x-short",
    status: "ok",
    activeDirectionFilter: getActiveDirectionFilter(),
    telegramBotRunning: isTelegramBotRunning(),
    subscribersCount: getSubscriberCount(),
    scheduler: getSchedulerStats(),
    wallStreetCircuitBreaker,
    signalTracker: {
      activeCount: tracker.activeCount,
      activeLongCount: tracker.activeLongCount,
      activeShortCount: tracker.activeShortCount,
      atRiskActiveCount: tracker.atRiskActiveCount,
      closedCount: tracker.closedCount,
      longClosedCount: tracker.longClosedCount,
      shortClosedCount: tracker.shortClosedCount,
      tpCount: tracker.tpCount,
      beCount: tracker.beCount,
      slCount: tracker.slCount,
      accuracyPct: tracker.accuracyPct,
      totalNetPnlPct: tracker.totalNetPnlPct,
      profitFactor: tracker.profitFactor,
      circuitBreakerActive: tracker.circuitBreaker.active || wallStreetCircuitBreaker.active
    },
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

app.get("/api/settings/direction", (_req, res) => {
  res.status(200).json({ directionFilter: getActiveDirectionFilter() });
});

app.post("/api/settings/direction", (req, res) => {
  const raw = String(req.body?.direction || req.body?.directionFilter || "").trim().toUpperCase();
  if (raw !== "BOTH" && raw !== "LONG" && raw !== "SHORT") {
    res.status(400).json({ ok: false, error: "Noto'g'ri yo'nalish (BOTH | LONG | SHORT)." });
    return;
  }
  const updated = setActiveDirectionFilter(raw as DirectionFilter);
  res.status(200).json({ ok: true, directionFilter: updated });
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

app.get("/api/logs/recent", (req, res) => {
  const rawLimit = Number(req.query.limit ?? 25);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(40, Math.floor(rawLimit)) : 25;
  res.status(200).json({ logs: getRecentActivityLogs(limit) });
});

app.get("/api/signals/tracker", (_req, res) => {
  res.status(200).json(getSignalTrackerSummary());
});

app.get("/api/signals/report24h", (_req, res) => {
  res.status(200).json(get24hSignalReport());
});

app.get("/api/alerts", (_req, res) => {
  res.status(200).json({ alerts: listPriceAlerts() });
});

app.post("/api/alerts", async (req, res) => {
  try {
    const rawSymbol = String(req.body?.symbol || "").trim();
    const targetPrice = Number(req.body?.targetPrice);
    if (!isSafeSymbolInput(rawSymbol)) {
      res.status(400).json({ ok: false, error: "Noto'g'ri yoki ruxsat etilmagan koin belgisi." });
      return;
    }
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      res.status(400).json({ ok: false, error: "Maqsadli narx musbat son bo'lishi kerak." });
      return;
    }
    const clean = rawSymbol.toUpperCase().replace("/USDT", "");
    const fullSymbol = clean.endsWith("USDT") ? clean : `${clean}USDT`;
    if (isFilteredOutSymbol(fullSymbol)) {
      res.status(400).json({ ok: false, error: "Stablecoin yoki ruxsat etilmagan juftlik." });
      return;
    }

    let currentPrice = Number(req.body?.currentPrice);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      currentPrice = await fetchMexcTickerPrice(fullSymbol);
    }

    const result = addPriceAlert(fullSymbol, targetPrice, currentPrice);
    if (!result.ok || !result.alert) {
      res.status(400).json({ ok: false, error: result.error || "Eslatma saqlanmadi" });
      return;
    }

    pushActivityLog(
      "ALERT",
      "INFO",
      `Yangi narx eslatma: ${result.alert.symbol} ${result.alert.direction} ${result.alert.targetPrice}`
    );
    res.status(200).json({ ok: true, alert: result.alert, currentPrice, alerts: listPriceAlerts() });
  } catch {
    res.status(400).json({ ok: false, error: "Narx eslatmasini saqlashda xatolik." });
  }
});

app.delete("/api/alerts/:id", (req, res) => {
  const removed = removePriceAlert(String(req.params.id || ""));
  res.status(200).json({ ok: removed, alerts: listPriceAlerts() });
});

app.get("/api/macro/news", (_req, res) => {
  res.status(200).json(getActiveNewsShield());
});

app.get("/api/backtest", async (req, res) => {
  const rawSymbol = String(req.query.symbol || "BTCUSDT").trim();
  if (!isSafeSymbolInput(rawSymbol)) {
    res.status(400).json({ error: "Noto'g'ri yoki ruxsat etilmagan koin belgisi." });
    return;
  }
  const symbol = rawSymbol.toUpperCase().replace(/\/USDT$/, "");
  const fullSymbol = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  const parsedLimit = Number(req.query.limit ?? 240);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(500, parsedLimit) : 240;

  if (isFilteredOutSymbol(fullSymbol)) {
    res.status(400).json({
      error: "Stablecoin, leveraged token yoki ruxsat etilmagan juftlik."
    });
    return;
  }

  try {
    const result = await runHistoricalBacktest(fullSymbol, limit);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backtest error";
    const status = message.includes("filtered out") || message.includes("Insufficient") ? 400 : 500;
    res.status(status).json({ error: status === 400 ? message : "Backtest bajarishda xatolik." });
  }
});

async function handleTokenCheckRoute(symbolParam: string, res: express.Response): Promise<void> {
  if (!isSafeSymbolInput(symbolParam)) {
    res.status(400).json({ error: "Noto'g'ri yoki ruxsat etilmagan koin belgisi." });
    return;
  }
  try {
    const result = await analyzeTokenOnDemand(symbolParam);
    res.status(200).json({
      symbol: result.symbol,
      record: result.record,
      caption: result.caption,
      chartUrl: `/api/chart/${encodeURIComponent(result.symbol)}.png`,
      tradingViewUrl: buildTradingViewMexcUrl(result.symbol, "15")
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token check error";
    const isClientErr =
      message.includes("tahlil qilinmaydi") ||
      message.includes("not found") ||
      message.includes("Invalid") ||
      message.includes("bo'sh") ||
      message.includes("400") ||
      message.includes("MEXC request failed");
    res.status(isClientErr ? 400 : 500).json({
      error: isClientErr ? "Koin topilmadi yoki tahlil qilinmaydi." : "Koin tekshiruvida xatolik."
    });
  }
}

async function handleTokenChartRoute(
  symbolParam: string,
  intervalQuery: unknown,
  res: express.Response
): Promise<void> {
  if (!isSafeSymbolInput(symbolParam)) {
    res.status(400).json({ error: "Noto'g'ri yoki ruxsat etilmagan koin belgisi." });
    return;
  }
  try {
    const intervalParam = String(intervalQuery || "15m").toLowerCase();
    const is1h = intervalParam === "1h" || intervalParam === "60";
    const analysis = await analyzeTokenOnDemand(symbolParam);
    let png = analysis.chartPng;
    if (is1h) {
      const klines1h = await fetchMexcKlines(analysis.symbol, "1h", 60);
      png = generate15mChartPng(klines1h, {
        symbol: analysis.symbol,
        direction: analysis.record.technician.direction,
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
  } catch {
    res.status(400).json({ error: "Grafik yaratishda xatolik." });
  }
}

app.get("/api/check/:symbol", async (req, res) => {
  await handleTokenCheckRoute(req.params.symbol, res);
});

app.get("/api/token/:symbol/check", async (req, res) => {
  await handleTokenCheckRoute(req.params.symbol, res);
});

app.get("/api/chart/:symbol.png", async (req, res) => {
  await handleTokenChartRoute(req.params.symbol, req.query.interval, res);
});

app.get("/api/token/:symbol/chart.png", heavyApiLimiter, async (req, res) => {
  await handleTokenChartRoute(String(req.params.symbol || ""), req.query.interval, res);
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
  } catch {
    res.status(500).json({ error: "Scout skanerlashda xatolik." });
  }
});

app.post("/api/scout/scan", async (_req, res) => {
  try {
    const snapshot = await triggerScoutScanNow();
    res.status(200).json(snapshot);
  } catch {
    res.status(500).json({ error: "Scout skanerlashda xatolik." });
  }
});

app.get("/api/pipeline/latest", async (_req, res) => {
  try {
    const snapshot = getLatestPipelineSnapshot() ?? (await triggerPipelineRunNow());
    res.status(200).json(snapshot);
  } catch {
    res.status(500).json({ error: "Pipeline ishga tushirishda xatolik." });
  }
});

app.post("/api/pipeline/run", async (_req, res) => {
  try {
    const snapshot = await triggerPipelineRunNow();
    res.status(200).json(snapshot);
  } catch {
    res.status(500).json({ error: "Pipeline ishga tushirishda xatolik." });
  }
});

app.get("/api/portfolio", (_req, res) => {
  res.status(200).json(getDemoPortfolioSummary());
});

app.post("/api/portfolio/buy", async (req, res) => {
  try {
    const rawSymbol = String(req.body?.symbol || "").trim();
    if (!isSafeSymbolInput(rawSymbol)) {
      res.status(400).json({ ok: false, error: "Noto'g'ri yoki ruxsat etilmagan koin belgisi." });
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
  } catch {
    res.status(400).json({ ok: false, error: "Demo xaridida xatolik.", portfolio: getDemoPortfolioSummary() });
  }
});

app.post("/api/portfolio/close", async (req, res) => {
  try {
    const rawSymbol = String(req.body?.symbol || "").trim();
    if (!isSafeSymbolInput(rawSymbol)) {
      res.status(400).json({ ok: false, error: "Noto'g'ri yoki ruxsat etilmagan koin belgisi." });
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
  } catch {
    res.status(400).json({ ok: false, error: "Demo yopishda xatolik.", portfolio: getDemoPortfolioSummary() });
  }
});

app.get("/api/reports/pdf", async (_req, res) => {
  try {
    const summary = getDemoPortfolioSummary();
    const pdfBuffer = await generatePortfolioPdfBuffer(summary);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="cryptoquant-report.pdf"');
    res.status(200).send(pdfBuffer);
  } catch {
    res.status(500).json({ error: "PDF yaratishda xatolik." });
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
  } catch {
    res.status(500).json({ error: "Telegram PDF yuborishda xatolik." });
  }
});

// Non-reflecting 404 fallback + safe production error handler (must be last)
app.use((_req, res) => {
  res.status(404).json({ error: "Manzil topilmadi (404)." });
});
app.use(safeErrorHandler);

if (require.main === module) {
  const server = app.listen(env.PORT, () => {
    console.log(`[CryptoQuant-Copilot] Stage 5.8 (Security Shield + Wall Street 4-Tab Pro) running on port ${env.PORT}`);
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
