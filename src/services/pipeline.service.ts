import { fetchMexcTickers24h } from "./mexcClient.service";
import { runScoutScan, ScoutCandidate, ScoutScanSnapshot } from "../agents/scout.agent";
import { runTechnicianAgent, TechnicalAnalysisResult } from "../agents/technician.agent";
import { runMacroFlowAgent, MacroFlowResult } from "../agents/macroFlow.agent";
import { runCriticRiskAgent, CriticRiskResult } from "../agents/criticRisk.agent";
import {
  ExecutiveDispatchResult,
  formatTp1BreakevenCard,
  formatTradeClosedCard,
  runExecutiveAgent,
  sendTelegramTextMessage
} from "../agents/executive.agent";
import { canDispatchSignal, markSignalDispatched } from "./cooldown.service";
import {
  DemoPortfolioSummary,
  DemoTradeItem,
  evaluateOpenDemoTrades,
  getDemoPortfolioSummary
} from "./demoPortfolio.service";
import { FundamentalReport, runFundamentalShield } from "./fundamental.service";
import { getActiveSignalMode, SignalMode } from "./subscription.service";
import {
  evaluateTrackedSignals,
  getSignalTrackerSummary,
  registerDispatchedSignal,
  SignalMilestoneAlert
} from "./signalTracker.service";
import { evaluatePriceAlerts } from "./priceAlert.service";
import { pushActivityLog } from "./activityLog.service";
import { getActiveNewsShield } from "./newsShield.service";

export interface EvaluatedSignalRecord {
  scout: ScoutCandidate;
  technician: TechnicalAnalysisResult;
  macroFlow: MacroFlowResult;
  fundamental?: FundamentalReport;
  criticRisk: CriticRiskResult;
  executive: ExecutiveDispatchResult | null;
}

export interface PipelineRunSnapshot {
  runAt: string;
  durationMs: number;
  activeSignalMode: SignalMode;
  scoutSummary: Omit<ScoutScanSnapshot, "candidates">;
  evaluatedCount: number;
  approvedCount: number;
  rejectedCount: number;
  tp1BreakevenThisRun: DemoTradeItem[];
  closedTradesThisRun: DemoTradeItem[];
  signalAlertsThisRun: SignalMilestoneAlert[];
  signalTrackerSummary: ReturnType<typeof getSignalTrackerSummary>;
  portfolioSummary: DemoPortfolioSummary;
  records: EvaluatedSignalRecord[];
}

const MAX_SYMBOLS_TO_EVALUATE = 5;
let latestPipelineSnapshot: PipelineRunSnapshot | null = null;

export function getLatestPipelineSnapshot(): PipelineRunSnapshot | null {
  return latestPipelineSnapshot;
}

export async function runFiveAgentPipeline(): Promise<{
  scoutSnapshot: ScoutScanSnapshot;
  pipelineSnapshot: PipelineRunSnapshot;
}> {
  const started = Date.now();
  const allTickers = await fetchMexcTickers24h();

  const priceMap = new Map<string, number>();
  for (const ticker of allTickers) {
    priceMap.set(ticker.symbol, ticker.lastPrice);
  }

  const newsShield = getActiveNewsShield();
  if (newsShield.active) {
    pushActivityLog("NEWS", "ALERT", `Macro News Shield FAOL: ${newsShield.eventTitle || "USD News"}`);
  }

  // 1a. Evaluate user's manually opened Demo Portfolio trades (TP1 Breakeven + TP2/SL/Expiry)
  const tp1BreakevenThisRun: DemoTradeItem[] = [];
  const closedTradesThisRun = evaluateOpenDemoTrades(priceMap, Date.now(), tp1BreakevenThisRun);

  for (const tp1Trade of tp1BreakevenThisRun) {
    pushActivityLog("EXECUTIVE", "SUCCESS", `Demo ${tp1Trade.symbol}: TP1 urildi, SL Breakeven ga surildi`);
    await sendTelegramTextMessage(formatTp1BreakevenCard(tp1Trade)).catch(() => {});
  }
  for (const closedTrade of closedTradesThisRun) {
    const isWin = (closedTrade.pnlUsd ?? 0) >= 0;
    pushActivityLog(
      "EXECUTIVE",
      isWin ? "SUCCESS" : "WARN",
      `Demo ${closedTrade.symbol} yopildi (${closedTrade.status}): ${closedTrade.pnlPercent ?? 0}%`
    );
    await sendTelegramTextMessage(formatTradeClosedCard(closedTrade)).catch(() => {});
  }

  // 1b. Evaluate ALL dispatched auto-signals in Signal Tracker (Reply to original signal!)
  const signalAlertsThisRun = evaluateTrackedSignals(priceMap);
  for (const alert of signalAlertsThisRun) {
    const lvl = alert.eventType === "SL_HIT" ? "WARN" : "SUCCESS";
    pushActivityLog(
      "TRACKER",
      lvl,
      `${alert.signal.symbol} → ${alert.eventType} (${alert.pnlPct >= 0 ? "+" : ""}${alert.pnlPct}%) @ ${alert.livePrice}`
    );
    await sendTelegramTextMessage(alert.telegramText, alert.replyToMessageId).catch(() => {});
  }

  // 1c. Evaluate user's custom Price Alerts
  const triggeredPriceAlerts = evaluatePriceAlerts(priceMap);
  for (const pa of triggeredPriceAlerts) {
    pushActivityLog(
      "ALERT",
      "ALERT",
      `Narx eslatmasi ishga tushdi: ${pa.alert.symbol} ${pa.alert.direction} ${pa.alert.targetPrice} (jonli: ${pa.livePrice})`
    );
    await sendTelegramTextMessage(pa.telegramText).catch(() => {});
  }

  // 2. Run Scout Agent reusing the fetched 24h tickers
  const scoutSnapshot = await runScoutScan(allTickers);
  pushActivityLog(
    "SCOUT",
    "INFO",
    `Skanerlash tugadi: ${scoutSnapshot.liquidEligibleCount} ta likvid juftlik (>=$2M), ${scoutSnapshot.anomaliesDetected} ta erta anomaliya (${scoutSnapshot.durationMs}ms)`
  );

  const topCandidates = scoutSnapshot.candidates.slice(0, MAX_SYMBOLS_TO_EVALUATE);
  const activeSignalMode = getActiveSignalMode();

  const records: EvaluatedSignalRecord[] = [];

  for (const candidate of topCandidates) {
    const [technician, macroFlow, fundamental] = await Promise.all([
      runTechnicianAgent(candidate),
      runMacroFlowAgent(candidate.symbol),
      runFundamentalShield(candidate.symbol)
    ]);

    pushActivityLog(
      "TECHNICIAN",
      "INFO",
      `${candidate.symbol}: RSI ${technician.rsi14}, R:R 1:${technician.riskRewardRatio}, rejim ${technician.tradeMode ?? "INTRADAY"}`
    );
    pushActivityLog(
      "MACRO",
      macroFlow.regime === "BEARISH" ? "WARN" : "INFO",
      `${candidate.symbol}: 1H/4H ${macroFlow.trend1h}/${macroFlow.trend4h}, Bid/Ask ${macroFlow.bidAskRatio}x (${(macroFlow.exchanges ?? ["MEXC"]).join("+")})`
    );

    const criticRisk = runCriticRiskAgent(candidate, technician, macroFlow, fundamental);
    pushActivityLog(
      "CRITIC",
      criticRisk.verdict === "APPROVE" ? "SUCCESS" : "WARN",
      `${candidate.symbol}: ${criticRisk.verdict} (${criticRisk.confidenceScore}/100) ${criticRisk.longTermStars?.label ?? ""}`
    );

    let executive: ExecutiveDispatchResult | null = null;
    const record: EvaluatedSignalRecord = {
      scout: candidate,
      technician,
      macroFlow,
      fundamental,
      criticRisk,
      executive
    };

    if (criticRisk.verdict === "APPROVE") {
      const tradeMode = criticRisk.tradeMode ?? technician.tradeMode ?? "INTRADAY";
      const modeAllowed =
        activeSignalMode === "HYBRID" || activeSignalMode === tradeMode;

      if (!modeAllowed) {
        criticRisk.reasons.push(`Faol rejim ${activeSignalMode} — ${tradeMode} signali o'tkazib yuborildi`);
      } else if (canDispatchSignal(candidate.symbol)) {
        executive = await runExecutiveAgent(
          candidate,
          technician,
          macroFlow,
          criticRisk,
          fundamental
        );
        record.executive = executive;
        markSignalDispatched(candidate.symbol);
        // Track every dispatched signal with original Telegram message ID; Demo remains manual-only
        registerDispatchedSignal(record, executive.telegramMessageId);
        pushActivityLog(
          "EXECUTIVE",
          "SUCCESS",
          `Signal yuborildi: ${candidate.symbol} (${tradeMode}) | Entry ${technician.entryPrice} | msgId=${executive.telegramMessageId ?? "DRY"}`
        );
      } else {
        criticRisk.reasons.push("Cooldown faol — qayta yuborilmadi");
      }
    }

    records.push(record);
  }

  const { candidates: _omit, ...scoutSummary } = scoutSnapshot;
  const approvedCount = records.filter((r) => r.criticRisk.verdict === "APPROVE").length;
  const rejectedCount = records.length - approvedCount;

  const pipelineSnapshot: PipelineRunSnapshot = {
    runAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    activeSignalMode,
    scoutSummary,
    evaluatedCount: records.length,
    approvedCount,
    rejectedCount,
    tp1BreakevenThisRun,
    closedTradesThisRun,
    signalAlertsThisRun,
    signalTrackerSummary: getSignalTrackerSummary(),
    portfolioSummary: getDemoPortfolioSummary(),
    records
  };
  latestPipelineSnapshot = pipelineSnapshot;

  return {
    scoutSnapshot,
    pipelineSnapshot
  };
}
