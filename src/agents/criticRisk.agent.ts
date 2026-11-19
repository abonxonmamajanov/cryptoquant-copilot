import { ScoutCandidate } from "./scout.agent";
import { TechnicalAnalysisResult } from "./technician.agent";
import { MacroFlowResult } from "./macroFlow.agent";

export interface CriticRiskResult {
  symbol: string;
  verdict: "APPROVE" | "REJECT";
  confidenceScore: number;
  reasons: string[];
  latencyMs: number;
}

export function runCriticRiskAgent(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult
): CriticRiskResult {
  const started = Date.now();
  const rejectReasons: string[] = [];

  if (tech.direction !== "LONG") {
    rejectReasons.push("Technician Agent LONG yo'nalishini tasdiqlamadi");
  }
  if (tech.riskRewardRatio < 2.0) {
    rejectReasons.push(`Risk/Foyda nisbati past (1:${tech.riskRewardRatio} < 1:2.0)`);
  }
  if (tech.rsi14 > 76) {
    rejectReasons.push(`Koin haddan tashqari qizib ketgan (RSI=${tech.rsi14})`);
  }
  if (macro.spreadPct > 0.4) {
    rejectReasons.push(`Order book spread juda keng (${macro.spreadPct}% > 0.4%)`);
  }
  if (macro.regime === "BEARISH") {
    rejectReasons.push(`Bozor foni xavfli/BEARISH (${macro.summary})`);
  }

  const confidenceScore = Math.round(
    scout.scoutScore * 0.25 + tech.techScore * 0.45 + macro.macroScore * 0.3
  );

  if (confidenceScore < 58) {
    rejectReasons.push(`Umumiy ishonch balli past (${confidenceScore}/100 < 58)`);
  }

  const verdict: "APPROVE" | "REJECT" = rejectReasons.length === 0 ? "APPROVE" : "REJECT";
  const reasons =
    verdict === "APPROVE"
      ? [
          `R:R 1:${tech.riskRewardRatio} talabga mos`,
          `RSI ${tech.rsi14} sog'lom zonada`,
          `Order book va BTC foni (${macro.regime}) qulay`
        ]
      : rejectReasons;

  return {
    symbol: scout.symbol,
    verdict,
    confidenceScore,
    reasons,
    latencyMs: Date.now() - started
  };
}
