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

  // === 5 HARD REJECT RULES ONLY ===
  // (a) Risk/Reward gate (< 2.0) or non-LONG technical setup
  if (tech.direction !== "LONG") {
    rejectReasons.push("Technician Agent LONG yo'nalishini tasdiqlamadi");
  }
  if (tech.riskRewardRatio < 2.0) {
    rejectReasons.push(`Risk/Foyda nisbati past (1:${tech.riskRewardRatio} < 1:2.0)`);
  }

  // (b) MEXC ST / Delist / Active Exploit Fundamental Shield hard block
  if (fundamental?.hardBlockReason) {
    rejectReasons.push(`Fundamental Shield blokladi: ${fundamental.hardBlockReason}`);
  }

  // (c) Active High-Impact USD Macro News Shield
  const newsShield = getActiveNewsShield();
  if (newsShield.active) {
    rejectReasons.push(newsShield.reason || "Faol USD Macro News Shield — kirish to'xtatildi");
  }

  // (d) Both 1H and 4H trends BEARISH
  if (macro.trend1h === "BEARISH" && macro.trend4h === "BEARISH") {
    rejectReasons.push("1H va 4H trendlarning ikkalasi ham BEARISH");
  }

  // (e) Late parabolic FOMO chase (24h > +28% AND RSI > 72)
  if (scout.priceChange24hPct > 28 && tech.rsi14 > 72) {
    rejectReasons.push(
      `Kechki parabolik FOMO quvish (24s +${scout.priceChange24hPct}%, RSI ${tech.rsi14})`
    );
  }

  // === SOFT WARNINGS ONLY (adjust 1–5 Star Rating ⭐, never hard-reject) ===
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

  if (tech.rsi14 > 72 && !(scout.priceChange24hPct > 28)) {
    softWarnings.push(`RSI qizigan (${tech.rsi14}) — pullback kutish foydali`);
    starPenalty += 1;
  }

  const stretchAboveEma21Pct =
    tech.ema21 > 0 ? ((tech.entryPrice - tech.ema21) / tech.ema21) * 100 : 0;
  if (stretchAboveEma21Pct > 3.0) {
    softWarnings.push(
      `Narx EMA21 dan +${stretchAboveEma21Pct.toFixed(1)}% cho'zilgan — limit kirish ma'qul`
    );
    starPenalty += 1;
  }

  if (scout.priceChange24hPct > 22 && !(scout.priceChange24hPct > 28 && tech.rsi14 > 72)) {
    softWarnings.push(`24s o'sish yuqori (+${scout.priceChange24hPct}%) — ehtiyotkor pozitsiya`);
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
        scout.scoutScore * 0.22 +
          tech.techScore * 0.42 +
          macro.macroScore * 0.26 +
          fundamentalBoost -
          Math.min(starPenalty * 2, 8)
      )
    )
  );

  // Compute 1–5 Star Rating (⭐)
  let baseStars = 3;
  if (confidenceScore >= 78) baseStars = 5;
  else if (confidenceScore >= 66) baseStars = 4;
  else if (confidenceScore < 52) baseStars = 2;

  if (macro.trend1h === "BULLISH" && macro.trend4h === "BULLISH") {
    baseStars = Math.min(5, baseStars + 1);
  }
  const starCount = Math.max(1, Math.min(5, baseStars - Math.min(starPenalty, 2)));
  const longTermStars: StarRatingInfo = {
    count: starCount,
    label: `${"⭐".repeat(starCount)}${"☆".repeat(5 - starCount)} (${starCount}/5)`
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
