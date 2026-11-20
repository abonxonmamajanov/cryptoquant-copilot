import { getLatestScoutSnapshot, getSchedulerStats } from "./scheduler.service";
import { getLatestPipelineSnapshot } from "./pipeline.service";
import { getDemoPortfolioSummary } from "./demoPortfolio.service";
import { getActiveNewsShield } from "./newsShield.service";
import { isTelegramBotRunning } from "./telegramBot.service";
import { getActiveSignalMode } from "./subscription.service";
import { getActiveMexcMirror } from "./mexcClient.service";

export function getFiveAgentsLiveStatus() {
  const scoutSnap = getLatestScoutSnapshot();
  const pipeSnap = getLatestPipelineSnapshot();
  const scheduler = getSchedulerStats();
  const portfolio = getDemoPortfolioSummary();
  const newsShield = getActiveNewsShield();
  const records = pipeSnap?.records ?? [];

  const avgTechLatencyMs =
    records.length > 0
      ? Math.round(records.reduce((sum, r) => sum + (r.technician.latencyMs || 0), 0) / records.length)
      : 0;

  const btcChange1hPct = records[0]?.macroFlow.btcChange1hPct ?? 0;

  return {
    updatedAt: new Date().toISOString(),
    scout: {
      name: "Scout Agent",
      roleUz: "Bozor skaneri va hajm anomaliyalari",
      status: "ACTIVE" as const,
      activeMirror: scoutSnap?.activeMirror ?? scheduler.activeMirror ?? getActiveMexcMirror(),
      totalUsdtPairs: scoutSnap?.totalUsdtPairs ?? pipeSnap?.scoutSummary.totalUsdtPairs ?? 0,
      filteredOutCount: scoutSnap?.filteredOutCount ?? pipeSnap?.scoutSummary.filteredOutCount ?? 0,
      liquidEligibleCount:
        scoutSnap?.liquidEligibleCount ?? pipeSnap?.scoutSummary.liquidEligibleCount ?? 0,
      anomaliesDetected:
        scoutSnap?.anomaliesDetected ?? pipeSnap?.scoutSummary.anomaliesDetected ?? 0,
      lastDurationMs: scoutSnap?.durationMs ?? pipeSnap?.scoutSummary.durationMs ?? 0,
      lastRunAt: scoutSnap?.scannedAt ?? scheduler.lastScanAt,
      topSymbols: (scoutSnap?.candidates ?? []).slice(0, 6).map((c) => c.symbol)
    },
    technician: {
      name: "Technician Agent",
      roleUz: "RSI, EMA, ATR va TP1/TP2/TP3/SL hisobi",
      status: "ACTIVE" as const,
      analyzedCount: records.length,
      avgLatencyMs: avgTechLatencyMs,
      latestSetups: records.map((r) => ({
        symbol: r.scout.symbol,
        rsi14: r.technician.rsi14,
        riskRewardRatio: r.technician.riskRewardRatio,
        direction: r.technician.direction,
        tp1: r.technician.tp1Price ?? r.technician.takeProfitPrice,
        tp2: r.technician.tp2Price ?? r.technician.takeProfitPrice,
        tp3: r.technician.tp3Price ?? r.technician.takeProfitPrice,
        sl: r.technician.stopLossPrice
      }))
    },
    macroFlow: {
      name: "Macro & Flow Agent",
      roleUz: "MEXC + Binance Order Book, 1H/4H trend, Funding & Fundamental",
      status: "ACTIVE" as const,
      exchanges: ["MEXC", "Binance"],
      btcChange1hPct,
      latestChecks: records.map((r) => ({
        symbol: r.scout.symbol,
        regime: r.macroFlow.regime,
        trend1h: r.macroFlow.trend1h ?? r.macroFlow.regime,
        trend4h: r.macroFlow.trend4h ?? r.macroFlow.regime,
        bidAskRatio: r.macroFlow.bidAskRatio,
        spreadPct: r.macroFlow.spreadPct,
        fundingRatePct: r.macroFlow.fundingRatePct ?? null,
        fundamentalBadge: r.fundamental?.badgeUz ?? "✅ Sog'lom"
      }))
    },
    criticRisk: {
      name: "Critic & Risk Agent",
      roleUz: "Hard/Soft risk elagi, yulduzcha baho va News Shield",
      status: "ACTIVE" as const,
      approvedCount: pipeSnap?.approvedCount ?? 0,
      rejectedCount: pipeSnap?.rejectedCount ?? 0,
      newsShieldActive: newsShield.active,
      newsShieldReason: newsShield.reason,
      latestVerdicts: records.map((r) => ({
        symbol: r.scout.symbol,
        verdict: r.criticRisk.verdict,
        confidenceScore: r.criticRisk.confidenceScore,
        tradeMode: r.criticRisk.tradeMode ?? r.technician.tradeMode ?? "INTRADAY",
        shortStars: r.criticRisk.longTermStars?.label ?? "⭐⭐⭐☆☆ (3/5)",
        longStars: r.criticRisk.longTermStars?.label ?? "⭐⭐⭐☆☆ (3/5)",
        reasons: r.criticRisk.reasons
      }))
    },
    executive: {
      name: "Executive Agent",
      roleUz: "Telegram kartalar, 15M/1H grafiklar, Demo Portfel va PDF",
      status: "ACTIVE" as const,
      telegramBotRunning: isTelegramBotRunning(),
      activeMode: getActiveSignalMode(),
      openTradesCount: portfolio.openTradesCount,
      closedTradesCount: portfolio.closedTradesCount,
      currentBalanceUsd: portfolio.currentBalanceUsd,
      winRatePct: portfolio.winRatePct,
      lastRunAt: pipeSnap?.runAt ?? scheduler.lastPipelineRunAt
    }
  };
}
