import { getDemoPortfolioSummary } from "./demoPortfolio.service";
import { generatePortfolioPdfBuffer } from "./pdfReport.service";
import { sendTelegramPdfReport, sendTelegramTextMessage } from "../agents/executive.agent";
import { get24hSignalReport } from "./signalTracker.service";
import { pushActivityLog } from "./activityLog.service";

let lastDailyReportDateUtc = "";
let dailyInterval: NodeJS.Timeout | null = null;

export async function sendDailySummaryNow(): Promise<{
  sentText: boolean;
  sentPdf: boolean;
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
}> {
  const s = getDemoPortfolioSummary();
  const report24h = get24hSignalReport();

  const textRes = await sendTelegramTextMessage(report24h.formattedTelegramText);
  const pdfBuf = await generatePortfolioPdfBuffer(s);
  const dateTag = new Date().toISOString().slice(0, 10);
  const pdfRes = await sendTelegramPdfReport(
    pdfBuf,
    `cryptoquant-daily-${dateTag}.pdf`,
    `📊 Kunlik hisobot (${dateTag}) | Demo Balans: $${s.currentBalanceUsd.toFixed(2)}`
  );

  pushActivityLog(
    "EXECUTIVE",
    "INFO",
    `24s kunlik hisobot yuborildi (${report24h.total} ta signal, aniqlik ${report24h.accuracyPct}%)`
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
