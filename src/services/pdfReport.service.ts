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
      .text("5-Agent Hybrid (Intraday + Swing) Demo Portfel Hisoboti (MEXC Spot)", 42, 50);

    doc
      .fillColor("#94A3B8")
      .fontSize(9)
      .text(`Yaratilgan vaqt: ${new Date().toISOString()}`, 360, 52, { align: "right", width: 190 });

    doc.moveDown(3);
    doc.fillColor("#0F172A").fontSize(13).font("Helvetica-Bold").text("1. Umumiy Ko'rsatkichlar (KPI)", 42, 104);

    // KPI Box
    const kpiTop = 126;
    doc.roundedRect(42, kpiTop, 511, 108, 6).fillAndStroke("#F8FAFC", "#CBD5E1");
    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(10);

    const pnlSign = summary.totalPnlUsd >= 0 ? "+" : "";
    doc.text(`Boshlang'ich balans: $${summary.initialBalanceUsd.toFixed(2)}`, 56, kpiTop + 14);
    doc.text(`Joriy balans: $${summary.currentBalanceUsd.toFixed(2)}`, 230, kpiTop + 14);
    doc.text(`Umumiy PnL: ${pnlSign}$${summary.totalPnlUsd.toFixed(2)} (${pnlSign}${summary.totalPnlPct}%)`, 380, kpiTop + 14);

    doc.font("Helvetica").fillColor("#334155");
    doc.text(`Win Rate: ${summary.winRatePct}%`, 56, kpiTop + 40);
    doc.text(`Yopilgan savdolar: ${summary.closedTradesCount} (Foyda: ${summary.winningTrades} / Zarar: ${summary.losingTrades})`, 230, kpiTop + 40);
    doc.text(`Ochiq savdolar: ${summary.openTradesCount}`, 56, kpiTop + 62);
    doc.text(`Profit Factor: ${summary.profitFactor} | Max Drawdown: ${summary.maxDrawdownPct}%`, 230, kpiTop + 62);

    // Intraday vs Swing breakdown line
    doc.font("Helvetica-Bold").fillColor("#0F172A").fontSize(9);
    doc.text(
      `Intraday Win Rate: ${summary.intradayStats.winRatePct}% (${summary.intradayStats.wins}/${summary.intradayStats.total})`,
      56,
      kpiTop + 84
    );
    doc.text(
      `Swing Win Rate: ${summary.swingStats.winRatePct}% (${summary.swingStats.wins}/${summary.swingStats.total})`,
      280,
      kpiTop + 84
    );

    // Open Trades Section
    let y = 252;
    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(13).text("2. Ochiq Demo Pozitsiyalar", 42, y);
    y += 20;

    if (summary.openTrades.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor("#64748B").text("Hozircha ochiq pozitsiyalar yo'q.", 42, y);
      y += 22;
    } else {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#1E3A8A");
      doc.text("Juftlik", 42, y);
      doc.text("Rejim", 118, y);
      doc.text("Entry", 178, y);
      doc.text("TP1 / TP2", 248, y);
      doc.text("SL (BE)", 360, y);
      doc.text("Hajm ($)", 455, y);
      y += 15;

      doc.font("Helvetica").fontSize(9).fillColor("#0F172A");
      for (const t of summary.openTrades) {
        doc.text(t.symbol, 42, y);
        doc.text(t.tradeMode, 118, y);
        doc.text(String(t.entryPrice), 178, y);
        doc.text(`${t.tp1Price} / ${t.tp2Price}`, 248, y);
        doc.text(`${t.stopLossPrice}${t.breakevenActive ? " (BE)" : ""}`, 360, y);
        doc.text(`$${t.positionSizeUsd}`, 455, y);
        y += 15;
      }
      y += 10;
    }

    // Closed Trades Section
    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(13).text("3. So'nggi Yopilgan Savdolar", 42, y);
    y += 20;

    if (summary.recentClosedTrades.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor("#64748B").text("Hali yopilgan savdolar mavjud emas.", 42, y);
      y += 24;
    } else {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#1E3A8A");
      doc.text("Juftlik", 42, y);
      doc.text("Holat", 125, y);
      doc.text("Entry", 215, y);
      doc.text("Exit", 290, y);
      doc.text("PnL (%)", 370, y);
      doc.text("PnL ($)", 445, y);
      y += 15;

      doc.font("Helvetica").fontSize(9);
      for (const t of summary.recentClosedTrades.slice(0, 12)) {
        const isPos = (t.pnlUsd ?? 0) >= 0;
        doc.fillColor("#0F172A").text(t.symbol, 42, y);
        doc.fillColor(isPos ? "#15803D" : "#B91C1C").text(t.status, 125, y);
        doc.fillColor("#0F172A").text(String(t.entryPrice), 215, y);
        doc.text(String(t.exitPrice ?? "-"), 290, y);
        doc.fillColor(isPos ? "#15803D" : "#B91C1C").text(`${isPos ? "+" : ""}${t.pnlPercent ?? 0}%`, 370, y);
        doc.text(`${isPos ? "+" : ""}$${t.pnlUsd ?? 0}`, 445, y);
        y += 15;
        if (y > 650) break;
      }
      y += 12;
    }

    // SL Post-Mortem Breakdown Section
    if (y < 710) {
      doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(13).text("4. SL Sabablari (Post-Mortem)", 42, y);
      y += 20;
      const entries = Object.entries(summary.slPostMortemBreakdown || {});
      if (entries.length === 0) {
        doc.font("Helvetica").fontSize(10).fillColor("#64748B").text("Hozircha Stop-Loss (SL_HIT) holatlari qayd etilmagan.", 42, y);
      } else {
        doc.font("Helvetica").fontSize(9).fillColor("#334155");
        for (const [reason, count] of entries) {
          doc.text(`• ${reason}: ${count} ta savdo`, 50, y);
          y += 15;
          if (y > 750) break;
        }
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
