import PDFDocument from "pdfkit";
import { DemoPortfolioSummary } from "./demoPortfolio.service";

export async function generatePortfolioPdfBuffer(summary: DemoPortfolioSummary): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.rect(0, 0, doc.page.width, 84).fill("#0F172A");
    doc.fillColor("#FFFFFF").fontSize(20).font("Helvetica-Bold").text("CryptoQuant-Copilot", 42, 24);
    doc
      .fillColor("#38BDF8")
      .fontSize(11)
      .font("Helvetica")
      .text("5-Agent Demo Portfel va Natijalar Hisoboti (MEXC Spot)", 42, 50);

    doc
      .fillColor("#94A3B8")
      .fontSize(9)
      .text(`Yaratilgan vaqt: ${new Date().toISOString()}`, 360, 52, { align: "right", width: 190 });

    doc.moveDown(3);
    doc.fillColor("#0F172A").fontSize(13).font("Helvetica-Bold").text("1. Umumiy Ko'rsatkichlar (KPI)", 42, 104);

    // KPI Box
    const kpiTop = 126;
    doc.roundedRect(42, kpiTop, 511, 88, 6).fillAndStroke("#F8FAFC", "#CBD5E1");
    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(10);

    const pnlSign = summary.totalPnlUsd >= 0 ? "+" : "";
    doc.text(`Boshlang'ich balans: $${summary.initialBalanceUsd.toFixed(2)}`, 56, kpiTop + 14);
    doc.text(`Joriy balans: $${summary.currentBalanceUsd.toFixed(2)}`, 230, kpiTop + 14);
    doc.text(`Umumiy PnL: ${pnlSign}$${summary.totalPnlUsd.toFixed(2)} (${pnlSign}${summary.totalPnlPct}%)`, 380, kpiTop + 14);

    doc.font("Helvetica").fillColor("#334155");
    doc.text(`Win Rate: ${summary.winRatePct}%`, 56, kpiTop + 42);
    doc.text(`Yopilgan savdolar: ${summary.closedTradesCount} (Foyda: ${summary.winningTrades} / Zarar: ${summary.losingTrades})`, 230, kpiTop + 42);
    doc.text(`Ochiq savdolar: ${summary.openTradesCount}`, 56, kpiTop + 64);
    doc.text(`Profit Factor: ${summary.profitFactor} | Max Drawdown: ${summary.maxDrawdownPct}%`, 230, kpiTop + 64);

    // Open Trades Section
    let y = 236;
    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(13).text("2. Ochiq Demo Pozitsiyalar", 42, y);
    y += 22;

    if (summary.openTrades.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor("#64748B").text("Hozircha ochiq pozitsiyalar yo'q.", 42, y);
      y += 24;
    } else {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#1E3A8A");
      doc.text("Juftlik", 42, y);
      doc.text("Entry", 130, y);
      doc.text("TP", 210, y);
      doc.text("SL", 290, y);
      doc.text("R:R", 370, y);
      doc.text("Hajm ($)", 440, y);
      y += 16;

      doc.font("Helvetica").fontSize(9).fillColor("#0F172A");
      for (const t of summary.openTrades) {
        doc.text(t.symbol, 42, y);
        doc.text(String(t.entryPrice), 130, y);
        doc.text(String(t.takeProfitPrice), 210, y);
        doc.text(String(t.stopLossPrice), 290, y);
        doc.text(`1:${t.riskRewardRatio}`, 370, y);
        doc.text(`$${t.positionSizeUsd}`, 440, y);
        y += 16;
      }
      y += 10;
    }

    // Closed Trades Section
    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(13).text("3. So'nggi Yopilgan Savdolar", 42, y);
    y += 22;

    if (summary.recentClosedTrades.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor("#64748B").text("Hali yopilgan savdolar mavjud emas.", 42, y);
    } else {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#1E3A8A");
      doc.text("Juftlik", 42, y);
      doc.text("Holat", 130, y);
      doc.text("Entry", 205, y);
      doc.text("Exit", 285, y);
      doc.text("PnL (%)", 370, y);
      doc.text("PnL ($)", 445, y);
      y += 16;

      doc.font("Helvetica").fontSize(9);
      for (const t of summary.recentClosedTrades.slice(0, 15)) {
        const isPos = (t.pnlUsd ?? 0) >= 0;
        doc.fillColor("#0F172A").text(t.symbol, 42, y);
        doc.fillColor(isPos ? "#15803D" : "#B91C1C").text(t.status, 130, y);
        doc.fillColor("#0F172A").text(String(t.entryPrice), 205, y);
        doc.text(String(t.exitPrice ?? "-"), 285, y);
        doc.fillColor(isPos ? "#15803D" : "#B91C1C").text(`${isPos ? "+" : ""}${t.pnlPercent ?? 0}%`, 370, y);
        doc.text(`${isPos ? "+" : ""}$${t.pnlUsd ?? 0}`, 445, y);
        y += 16;
        if (y > 740) break;
      }
    }

    // Footer disclaimer
    doc
      .fillColor("#64748B")
      .font("Helvetica")
      .fontSize(8)
      .text(
        "Ogohlantirish: Ushbu hisobot virtual/demo portfel sinov natijalarini aks ettiradi va moliyaviy maslahat hisoblanmaydi.",
        42,
        780,
        { align: "center", width: 511 }
      );

    doc.end();
  });
}
