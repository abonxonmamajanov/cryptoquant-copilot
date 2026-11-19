import { ScoutCandidate } from "./scout.agent";
import { TechnicalAnalysisResult, TradeMode } from "./technician.agent";
import { MacroFlowResult } from "./macroFlow.agent";
import { FundamentalReport } from "../services/fundamental.service";
import { getActiveNewsShield } from "../services/newsShield.service";

export interface StarRatingInfo {
  count: number; // 1-5
  label: string;
}

export interface CriticRiskResult {
  symbol: string;
  verdict: "APPROVE" | "REJECT";
  tradeMode?: TradeMode;
  confidenceScore: number;
  longTermStars?: StarRatingInfo;
  softWarnings?: string[];
  reasons: string[];
  latencyMs: number;
}

export function runCriticRiskAgent(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  fundamental?: FundamentalReport
): CriticRiskResult {
  const started = Date.now();
  const rejectReasons: string[] = [];
  const softWarnings: string[] = [];

  // === 4 HARD REJECT RULES ONLY ===
  // 1) Direction / Risk-Reward gate
  if (tech.direction !== "LONG") {
    rejectReasons.push("Technician Agent LONG yo'nalishini tasdiqlamadi");
  }
  if (tech.riskRewardRatio < 2.0) {
    rejectReasons.push(`Risk/Foyda nisbati past (1:${tech.riskRewardRatio} < 1:2.0)`);
  }

  // 2) MEXC ST / Delist / Active Exploit Fundamental Shield hard block
  if (fundamental?.hardBlockReason) {
    rejectReasons.push(`Fundamental Shield blokladi: ${fundamental.hardBlockReason}`);
  }

  // 3) Active High-Impact USD Macro News Shield
  const newsShield = getActiveNewsShield();
  if (newsShield.active) {
    rejectReasons.push(newsShield.reason || "Faol USD Macro News Shield — kirish to'xtatildi");
  }

  // 4) Both 1H and 4H trends BEARISH
  if (macro.trend1h === "BEARISH" && macro.trend4h === "BEARISH") {
    rejectReasons.push("1H va 4H trendlarning ikkalasi ham BEARISH");
  }

  // === SOFT WARNINGS ONLY (adjust Star Rating, never hard-reject) ===
  let starPenalty = 0;

  if (fundamental) {
    for (const w of fundamental.softWarnings) {
      softWarnings.push(w);
      starPenalty += 1;
    }
  }

  if (typeof macro.fundingRatePct === "number" && macro.fundingRatePct >= 0.05) {
    softWarnings.push(`Yuqori Funding Rate (+${macro.fundingRatePct}%) — long squeeze ehtiyoti`);
    starPenalty += 1;
  }

  if (tech.rsi14 > 76) {
    softWarnings.push(`RSI yuqori (${tech.rsi14}) — qisqa muddatli qizib ketish`);
    starPenalty += 1;
  }

  if (macro.spreadPct > 0.4) {
    softWarnings.push(`Order book spread keng (${macro.spreadPct}%) — limit buyurtma tavsiya etiladi`);
    starPenalty += 1;
  }

  const fundamentalBoost = fundamental ? fundamental.fundamentalScore * 0.1 : 8;
  const confidenceScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        scout.scoutScore * 0.2 +
          tech.techScore * 0.42 +
          macro.macroScore * 0.28 +
          fundamentalBoost -
          Math.min(starPenalty * 2, 8)
      )
    )
  );

  if (confidenceScore < 55) {
    rejectReasons.push(`Umumiy ishonch balli past (${confidenceScore}/100 < 55)`);
  }

  // Compute 1-5 Star Rating
  let baseStars = 3;
  if (confidenceScore >= 80) baseStars = 5;
  else if (confidenceScore >= 68) baseStars = 4;
  else if (confidenceScore < 55) baseStars = 2;

  if (macro.trend1h === "BULLISH" && macro.trend4h === "BULLISH") {
    baseStars = Math.min(5, baseStars + 1);
  }
  const starCount = Math.max(1, Math.min(5, baseStars - Math.min(starPenalty, 2)));
  const longTermStars: StarRatingInfo = {
    count: starCount,
    label: `${"★".repeat(starCount)}${"☆".repeat(5 - starCount)} (${starCount}/5)`
  };

  // Hybrid Trade Mode classification
  const tradeMode: TradeMode =
    macro.trend1h === "BULLISH" && macro.trend4h === "BULLISH" && longTermStars.count >= 4
      ? "SWING"
      : "INTRADAY";

  const verdict: "APPROVE" | "REJECT" = rejectReasons.length === 0 ? "APPROVE" : "REJECT";
  const reasons =
    verdict === "APPROVE"
      ? [
          `R:R 1:${tech.riskRewardRatio} talabga mos (${tradeMode})`,
          `Reyting: ${longTermStars.label} | RSI ${tech.rsi14}`,
          `1H/4H: ${macro.trend1h ?? macro.regime}/${macro.trend4h ?? macro.regime}`
        ]
      : rejectReasons;

  return {
    symbol: scout.symbol,
    verdict,
    tradeMode,
    confidenceScore,
    longTermStars,
    softWarnings,
    reasons,
    latencyMs: Date.now() - started
  };
}
