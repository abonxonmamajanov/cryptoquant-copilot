import { runScoutScan, ScoutCandidate, ScoutScanSnapshot } from "../agents/scout.agent";
import { runTechnicianAgent, TechnicalAnalysisResult } from "../agents/technician.agent";
import { runMacroFlowAgent, MacroFlowResult } from "../agents/macroFlow.agent";
import { runCriticRiskAgent, CriticRiskResult } from "../agents/criticRisk.agent";
import { runExecutiveAgent, ExecutiveDispatchResult } from "../agents/executive.agent";

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
  records: EvaluatedSignalRecord[];
}

const MAX_SYMBOLS_TO_EVALUATE = 5;

export async function runFiveAgentPipeline(): Promise<{
  scoutSnapshot: ScoutScanSnapshot;
  pipelineSnapshot: PipelineRunSnapshot;
}> {
  const started = Date.now();
  const scoutSnapshot = await runScoutScan();
  const topCandidates = scoutSnapshot.candidates.slice(0, MAX_SYMBOLS_TO_EVALUATE);

  const records: EvaluatedSignalRecord[] = [];

  for (const candidate of topCandidates) {
    const [technician, macroFlow] = await Promise.all([
      runTechnicianAgent(candidate),
      runMacroFlowAgent(candidate.symbol)
    ]);

    const criticRisk = runCriticRiskAgent(candidate, technician, macroFlow);

    let executive: ExecutiveDispatchResult | null = null;
    if (criticRisk.verdict === "APPROVE") {
      executive = await runExecutiveAgent(candidate, technician, macroFlow, criticRisk);
    }

    records.push({
      scout: candidate,
      technician,
      macroFlow,
      criticRisk,
      executive
    });
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
      records
    }
  };
}
