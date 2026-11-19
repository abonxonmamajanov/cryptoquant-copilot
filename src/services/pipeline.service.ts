import { fetchMexcTickers24h } from "./mexcClient.service";
import { runScoutScan, ScoutCandidate, ScoutScanSnapshot } from "../agents/scout.agent";
import { runTechnicianAgent, TechnicalAnalysisResult } from "../agents/technician.agent";
import { runMacroFlowAgent, MacroFlowResult } from "../agents/macroFlow.agent";
import { runCriticRiskAgent, CriticRiskResult } from "../agents/criticRisk.agent";
import {
  ExecutiveDispatchResult,
  formatTradeClosedCard,
  runExecutiveAgent,
  sendTelegramTextMessage
} from "../agents/executive.agent";
import { canDispatchSignal, markSignalDispatched } from "./cooldown.service";
import {
  DemoPortfolioSummary,
  DemoTradeItem,
  evaluateOpenDemoTrades,
  getDemoPortfolioSummary,
  openDemoTradeFromSignal
} from "./demoPortfolio.service";

export interface EvaluatedSignalRecord {
  scout: ScoutCandidate;
  technician: TechnicalAnalysisResult;
  macroFlow: MacroFlowResult;
  criticRisk: CriticRiskResult;
  executive: ExecutiveDispatchResult | null;
}

export interface PipelineRunSnapshot {
  runAt: string;
  durationMs: number;
  scoutSummary: Omit<ScoutScanSnapshot, "candidates">;
  evaluatedCount: number;
  approvedCount: number;
  rejectedCount: number;
  closedTradesThisRun: DemoTradeItem[];
  portfolioSummary: DemoPortfolioSummary;
  records: EvaluatedSignalRecord[];
}

const MAX_SYMBOLS_TO_EVALUATE = 5;

export async function runFiveAgentPipeline(): Promise<{
  scoutSnapshot: ScoutScanSnapshot;
  pipelineSnapshot: PipelineRunSnapshot;
}> {
  const started = Date.now();
  const allTickers = await fetchMexcTickers24h();

  // 1. Evaluate any open Demo Portfolio positions against live prices
  const priceMap = new Map<string, number>();
  for (const ticker of allTickers) {
    priceMap.set(ticker.symbol, ticker.lastPrice);
  }
  const closedTradesThisRun = evaluateOpenDemoTrades(priceMap);

  for (const closedTrade of closedTradesThisRun) {
    await sendTelegramTextMessage(formatTradeClosedCard(closedTrade)).catch(() => {});
  }

  // 2. Run Scout Agent reusing the fetched 24h tickers
  const scoutSnapshot = await runScoutScan(allTickers);
  const topCandidates = scoutSnapshot.candidates.slice(0, MAX_SYMBOLS_TO_EVALUATE);

  const records: EvaluatedSignalRecord[] = [];

  for (const candidate of topCandidates) {
    const [technician, macroFlow] = await Promise.all([
      runTechnicianAgent(candidate),
      runMacroFlowAgent(candidate.symbol)
    ]);

    const criticRisk = runCriticRiskAgent(candidate, technician, macroFlow);

    let executive: ExecutiveDispatchResult | null = null;
    const record: EvaluatedSignalRecord = {
      scout: candidate,
      technician,
      macroFlow,
      criticRisk,
      executive
    };

    if (criticRisk.verdict === "APPROVE") {
      if (canDispatchSignal(candidate.symbol)) {
        executive = await runExecutiveAgent(candidate, technician, macroFlow, criticRisk);
        record.executive = executive;
        markSignalDispatched(candidate.symbol);
        openDemoTradeFromSignal(record);
      } else {
        criticRisk.reasons.push("Cooldown faol — qayta yuborilmadi");
      }
    }

    records.push(record);
  }

  const { candidates: _omit, ...scoutSummary } = scoutSnapshot;
  const approvedCount = records.filter((r) => r.criticRisk.verdict === "APPROVE").length;
  const rejectedCount = records.length - approvedCount;

  return {
    scoutSnapshot,
    pipelineSnapshot: {
      runAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      scoutSummary,
      evaluatedCount: records.length,
      approvedCount,
      rejectedCount,
      closedTradesThisRun,
      portfolioSummary: getDemoPortfolioSummary(),
      records
    }
  };
}
