import { getDemoPortfolioSummary } from "./demoPortfolio.service";
import { generatePortfolioPdfBuffer } from "./pdfReport.service";
import { sendTelegramPdfReport, sendTelegramTextMessage } from "../agents/executive.agent";

let lastDailyReportDateUtc = "";
let dailyInterval: NodeJS.Timeout | null = null;

export async function sendDailySummaryNow(): Promise<{
  sentText: boolean;
  sentPdf: boolean;
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
}> {
  const s = getDemoPortfolioSummary();
  const sign = s.totalPnlUsd >= 0 ? "+" : "";

  const text = [
    `🌙 *CRYPTOQUANT-COPILOT — KUNLIK XULOSA*`,
    ``,
    `💰 *Demo Balans:* $${s.currentBalanceUsd.toFixed(2)} (${sign}${s.totalPnlPct}%)`,
    `📈 *Umumiy PnL:* ${sign}$${s.totalPnlUsd.toFixed(2)}`,
    `🎯 *Win Rate:* ${s.winRatePct}% (${s.winningTrades} foyda / ${s.losingTrades} zarar)`,
    `📂 *Ochiq savdolar:* ${s.openTradesCount} ta | *Yopilgan:* ${s.closedTradesCount} ta`,
    `🛡️ *Max Drawdown:* ${s.maxDrawdownPct}%`,
    ``,
    `📄 _To'liq PDF hisobot quyida biriktirildi._`
  ].join("\n");

  const textRes = await sendTelegramTextMessage(text);
  const pdfBuf = await generatePortfolioPdfBuffer(s);
  const dateTag = new Date().toISOString().slice(0, 10);
  const pdfRes = await sendTelegramPdfReport(
    pdfBuf,
    `cryptoquant-daily-${dateTag}.pdf`,
    `📊 Kunlik hisobot (${dateTag})`
  );

  return {
    sentText: textRes.sent,
    sentPdf: pdfRes.sent,
    mode: textRes.mode
  };
}

export function startDailyReportScheduler(): void {
  if (dailyInterval) return;
  // Check every 60s; fire once daily at 16:00 UTC (21:00 Tashkent)
  dailyInterval = setInterval(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const todayKey = now.toISOString().slice(0, 10);
    if (utcHour === 16 && lastDailyReportDateUtc !== todayKey) {
      lastDailyReportDateUtc = todayKey;
      sendDailySummaryNow().catch((err) => {
        console.error("[Daily Report] Failed:", err instanceof Error ? err.message : err);
      });
    }
  }, 60_000);
}

export function stopDailyReportScheduler(): void {
  if (dailyInterval) {
    clearInterval(dailyInterval);
    dailyInterval = null;
  }
}
