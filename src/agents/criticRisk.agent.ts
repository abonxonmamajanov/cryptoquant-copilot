import { ScoutCandidate } from "./scout.agent";
import { SignalDirection, TechnicalAnalysisResult, TradeMode } from "./technician.agent";
import { MacroFlowResult } from "./macroFlow.agent";
import { FundamentalReport } from "../services/fundamental.service";
import { getActiveNewsShield } from "../services/newsShield.service";
import type { OrderFlowReport } from "../services/orderFlow.service";

export interface StarRatingInfo {
  count: number; // 1-5
  label: string;
}

export type ConvictionSizeMultiplier = 0.5 | 1.0 | 1.5;

export interface CriticRiskResult {
  symbol: string;
  direction: SignalDirection;
  verdict: "APPROVE" | "REJECT";
  tradeMode?: TradeMode;
  confidenceScore: number;
  longTermStars?: StarRatingInfo;
  suggestedSizeMultiplier: ConvictionSizeMultiplier;
  softWarnings?: string[];
  reasons: string[];
  latencyMs: number;
}

export function computeConvictionSizeMultiplier(starCount: number): ConvictionSizeMultiplier {
  if (starCount >= 5) return 1.5;
  if (starCount === 4) return 1.0;
  return 0.5;
}

function computeShortMacroScore(macro: MacroFlowResult): number {
  let score = 50;
  if (macro.bidAskRatio <= 0.95) score += 16;
  else if (macro.bidAskRatio > 1.35) score -= 20;

  if (macro.spreadPct <= 0.15) score += 10;
  else if (macro.spreadPct > 0.35) score -= 20;

  if (macro.btcChange1hPct <= -0.2) score += 10;
  else if (macro.btcChange1hPct >= 0.6) score -= 22;

  if (macro.btcTrend1h === "BEARISH" && macro.btcTrend4h === "BEARISH") score += 8;
  else if (macro.btcTrend1h === "BULLISH" && macro.btcTrend4h === "BULLISH") score -= 18;

  if (macro.trend1h === "BEARISH") score += 7;
  else if (macro.trend1h === "BULLISH") score -= 12;

  if (macro.trend4h === "BEARISH") score += 7;
  else if (macro.trend4h === "BULLISH") score -= 12;

  if (macro.below4hEma50 === true || macro.above4hEma50 === false) score += 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function runCriticRiskAgent(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  fundamental?: FundamentalReport,
  orderFlow?: OrderFlowReport
): CriticRiskResult {
  const started = Date.now();
  const rejectReasons: string[] = [];
  const softWarnings: string[] = [];
  const fundingPct =
    typeof macro.fundingRatePct === "number"
      ? macro.fundingRatePct
      : typeof macro.fundingRate?.fundingRatePct === "number"
        ? macro.fundingRate.fundingRatePct
        : null;

  // =========================================================================
  // BRANCH A: STAGE 6.2 STRICT 1x SHORT (ANTI-SQUEEZE) EVALUATION
  // =========================================================================
  if (tech.direction === "SHORT") {
    if (tech.riskRewardRatio < 2.0) {
      rejectReasons.push(`Risk/Foyda nisbati past (1:${tech.riskRewardRatio} < 1:2.0)`);
    }
    if (tech.rsi14 < 40 || tech.rsi14 > 58) {
      rejectReasons.push(
        `SHORT uchun RSI xavfli zonada (${tech.rsi14}, talab: 40–58 — tubdan sotish taqiqlangan)`
      );
    }
    if (typeof tech.adx14 === "number" && tech.adx14 < 20) {
      rejectReasons.push("Bozor yonlama/tinch (ADX < 20) — sovuqqon kutish rejimi");
    }
    if (scout.volumeSpikeRatio15m < 1.0) {
      rejectReasons.push(
        `15m savdo hajmi past (${scout.volumeSpikeRatio15m}x < 1.0x) — bo'sh likvidlikda SHORT bloklandi`
      );
    }
    if (fundamental?.hardBlockReason) {
      rejectReasons.push(`Fundamental Shield blokladi: ${fundamental.hardBlockReason}`);
    }
    const newsShield = getActiveNewsShield();
    if (newsShield.active) {
      rejectReasons.push(newsShield.reason || "Faol USD Macro News Shield — kirish to'xtatildi");
    }
    if (macro.trend1h === "BULLISH" || macro.trend4h === "BULLISH") {
      rejectReasons.push(
        `Katta timeframe o'suvchi (1H: ${macro.trend1h ?? "—"}, 4H: ${macro.trend4h ?? "—"}) — o'suvchi trendga qarshi SHORT taqiqlangan`
      );
    }
    if (macro.btcChange1hPct >= 0.6) {
      rejectReasons.push(`BTC 1s kuchli o'smoqda (+${macro.btcChange1hPct}% >= +0.6%) — altcoin SHORT to'xtatildi`);
    }
    if (macro.btcTrend1h === "BULLISH" && macro.btcTrend4h === "BULLISH") {
      rejectReasons.push("BTC 1H va 4H trendlari ikkalasi ham BULLISH — short squeeze himoyasi faol");
    }
    if (macro.btcTrend4h === "BULLISH" && macro.trend4h !== "BEARISH") {
      rejectReasons.push(
        `BTC 4H BULLISH — faqat aniq 4H BEARISH autsayderlarga ruxsat (bu koin 4H: ${macro.trend4h ?? "NEUTRAL"})`
      );
    }
    if (typeof fundingPct === "number" && fundingPct <= -0.04) {
      rejectReasons.push(
        `Short Squeeze xavfi! Manfiy Funding Rate (${fundingPct}% <= -0.04%) — olomon shortda`
      );
    }

    const stretchBelowEma21Pct =
      typeof tech.stretchBelowEma21Pct === "number"
        ? tech.stretchBelowEma21Pct
        : tech.ema21 > 0
          ? Number((((tech.ema21 - tech.entryPrice) / tech.ema21) * 100).toFixed(2))
          : 0;

    if (scout.priceChange24hPct < -20) {
      rejectReasons.push(
        `Kechki vahima tushishini quvish (24s ${scout.priceChange24hPct}%) — keskin sakrash xavfi`
      );
    }
    if (stretchBelowEma21Pct > 2.5) {
      rejectReasons.push(
        `Narx EMA21 dan -${stretchBelowEma21Pct.toFixed(1)}% cho'zilgan (>2.5%) — tepaga qaytish kutiladi`
      );
    }
    if (tech.isRallyRejection === false) {
      rejectReasons.push("EMA9/21 rally-rejection tasdig'i yo'q — qizil shamni quvish bloklandi");
    }
    if (macro.bidAskRatio > 1.45) {
      rejectReasons.push(`Kuchli xaridor devori (Bid/Ask ${macro.bidAskRatio}x > 1.45x)`);
    }
    if (macro.spreadPct > 0.35) {
      rejectReasons.push(`Order book spread juda keng (${macro.spreadPct}% > 0.35%)`);
    }
    if (typeof tech.atrPct === "number" && tech.atrPct > 3.2) {
      rejectReasons.push(`Haddan tashqari 15m volatillik (ATR ${tech.atrPct}% > 3.2%) — whipsaw riski`);
    }
    if (orderFlow && !orderFlow.degraded) {
      if (orderFlow.isSpoofingDetected) {
        rejectReasons.push(orderFlow.spoofReasonUz || "Soxta sotuvchi devori (Spoofing) aniqlandi");
      }
      if (orderFlow.takerBuyPct > 55 && orderFlow.weightedObiRatio > 1.15) {
        rejectReasons.push(
          `Order-Flow xaridorlar yutib olmoqda: Taker Buy ${orderFlow.takerBuyPct}% (>55%) va OBI ${orderFlow.weightedObiRatio}x (>1.15x)`
        );
      }
    }

    let starPenalty = 0;
    if (fundamental) {
      for (const w of fundamental.softWarnings) {
        softWarnings.push(w);
        starPenalty += 1;
      }
    }
    if (typeof fundingPct === "number" && fundingPct <= -0.02 && fundingPct > -0.04) {
      softWarnings.push(`Manfiy Funding Rate (${fundingPct}%) — short squeeze ehtiyoti`);
      starPenalty += 1;
    }
    if (macro.btcTrend4h === "BULLISH") {
      softWarnings.push("BTC 4H BULLISH — faqat 1x ehtiyotkor hedge kirish");
      starPenalty += 1;
    }
    if (stretchBelowEma21Pct > 1.8 && stretchBelowEma21Pct <= 2.5) {
      softWarnings.push(
        `Narx EMA21 dan -${stretchBelowEma21Pct.toFixed(1)}% pastda — limit buyurtma ma'qul`
      );
      starPenalty += 1;
    }
    if (macro.bidAskRatio > 1.1 && macro.bidAskRatio <= 1.45) {
      softWarnings.push(`Xaridor qarshiligi bor (${macro.bidAskRatio}x) — ehtiyotkor 1x kirish`);
      starPenalty += 1;
    }
    if (macro.spreadPct > 0.2 && macro.spreadPct <= 0.35) {
      softWarnings.push(`Spread biroz keng (${macro.spreadPct}%) — limit buyurtma tavsiya etiladi`);
      starPenalty += 1;
    }

    let orderFlowAdjust = 0;
    if (orderFlow && !orderFlow.degraded) {
      if (orderFlow.weightedObiRatio <= 0.75 && orderFlow.takerBuyPct <= 45) {
        orderFlowAdjust = 4;
      } else if (orderFlow.takerBuyPct > 52 || orderFlow.weightedObiRatio > 1.1) {
        softWarnings.push(
          `Order-Flow sotuv bosimi kuchsizroq (OBI ${orderFlow.weightedObiRatio}x | Taker Buy ${orderFlow.takerBuyPct}%)`
        );
        orderFlowAdjust = -3;
      }
    }

    const shortMacroScore = computeShortMacroScore(macro);
    const fundamentalBoost = fundamental ? fundamental.fundamentalScore * 0.1 : 8;
    const confidenceScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          scout.scoutScore * 0.2 +
            tech.techScore * 0.44 +
            shortMacroScore * 0.26 +
            fundamentalBoost +
            orderFlowAdjust -
            Math.min(starPenalty * 2, 8)
        )
      )
    );

    if (confidenceScore < 65) {
      rejectReasons.push(`Umumiy ishonch balli past (${confidenceScore}/100 < 65)`);
    }

    let baseStars = 3;
    if (confidenceScore >= 78) baseStars = 5;
    else if (confidenceScore >= 68) baseStars = 4;
    else if (confidenceScore < 55) baseStars = 2;

    if (macro.trend1h === "BEARISH" && macro.trend4h === "BEARISH") {
      baseStars = Math.min(5, baseStars + 1);
    }
    const starCount = Math.max(1, Math.min(5, baseStars - Math.min(starPenalty, 2)));
    const longTermStars: StarRatingInfo = {
      count: starCount,
      label: `${"⭐".repeat(starCount)}${"☆".repeat(5 - starCount)} (${starCount}/5)`
    };
    const suggestedSizeMultiplier = computeConvictionSizeMultiplier(starCount);

    const tradeMode: TradeMode =
      macro.trend1h === "BEARISH" &&
      macro.trend4h === "BEARISH" &&
      macro.btcTrend4h !== "BULLISH" &&
      macro.above4hEma50 === false &&
      longTermStars.count >= 4
        ? "SWING"
        : "INTRADAY";

    const orderFlowTag =
      orderFlow && !orderFlow.degraded
        ? ` | OBI ${orderFlow.weightedObiRatio}x, Taker ${orderFlow.takerBuyPct}%`
        : "";
    const adxTag = typeof tech.adx14 === "number" ? ` | ADX ${tech.adx14}` : "";

    const verdict: "APPROVE" | "REJECT" = rejectReasons.length === 0 ? "APPROVE" : "REJECT";
    const reasons =
      verdict === "APPROVE"
        ? [
            `SHORT (1x) R:R 1:${tech.riskRewardRatio} (${tradeMode}) | Tavsiya hajm: ${suggestedSizeMultiplier.toFixed(1)}x`,
            `Reyting: ${longTermStars.label} | RSI ${tech.rsi14}${adxTag}${tech.isRallyRejection ? " | Rally-Rejection ✅" : ""}`,
            `1H/4H: ${macro.trend1h ?? macro.regime}/${macro.trend4h ?? macro.regime} | BTC: ${macro.btcChange1hPct >= 0 ? "+" : ""}${macro.btcChange1hPct}%${orderFlowTag}`
          ]
        : rejectReasons;

    return {
      symbol: scout.symbol,
      direction: "SHORT",
      verdict,
      tradeMode,
      confidenceScore,
      longTermStars,
      suggestedSizeMultiplier,
      softWarnings,
      reasons,
      latencyMs: Date.now() - started
    };
  }

  // =========================================================================
  // BRANCH B: STAGE 6.1/6.2 PRECISION LONG EVALUATION
  // =========================================================================
  if (tech.direction !== "LONG") {
    rejectReasons.push("Technician Agent aniq LONG yoki 1x SHORT tuzilmasini tasdiqlamadi");
  }
  if (tech.riskRewardRatio < 2.0) {
    rejectReasons.push(`Risk/Foyda nisbati past (1:${tech.riskRewardRatio} < 1:2.0)`);
  }

  // (1b) Stage 6.1 ADX(14) Chop / Flat-Market Gate ("Cash is a position")
  if (typeof tech.adx14 === "number" && tech.adx14 < 20) {
    rejectReasons.push("Bozor yonlama/tinch (ADX < 20) — sovuqqon kutish rejimi");
  }

  // (2) MEXC ST / Delist / Spot Halted Fundamental Shield
  if (fundamental?.hardBlockReason) {
    rejectReasons.push(`Fundamental Shield blokladi: ${fundamental.hardBlockReason}`);
  }

  // (3) Active High-Impact USD Macro News Shield
  const newsShield = getActiveNewsShield();
  if (newsShield.active) {
    rejectReasons.push(newsShield.reason || "Faol USD Macro News Shield — kirish to'xtatildi");
  }

  // (4) Strict Higher-Timeframe Alignment (block ANY bearish 1H or 4H to prevent dead-cat bounces)
  if (macro.trend1h === "BEARISH" || macro.trend4h === "BEARISH") {
    rejectReasons.push(
      `Katta timeframe qarshi (1H: ${macro.trend1h ?? "—"}, 4H: ${macro.trend4h ?? "—"}) — pasayuvchi trendda LONG taqiqlangan`
    );
  }

  // (5) BTC Macro Regime Shield + Stage 6.0 BTC 4H Bearish Relative-Strength Rule
  if (macro.btcChange1hPct <= -0.6) {
    rejectReasons.push(`BTC 1s bosim ostida (${macro.btcChange1hPct}% <= -0.6%) — altcoin LONG to'xtatildi`);
  }
  if (macro.btcTrend1h === "BEARISH" && macro.btcTrend4h === "BEARISH") {
    rejectReasons.push("BTC 1H va 4H trendlari ikkalasi ham BEARISH — makro himoya faol");
  }
  if (macro.btcTrend4h === "BEARISH" && macro.trend4h !== "BULLISH") {
    rejectReasons.push(
      `BTC 4H BEARISH — faqat 4H BULLISH liderlarga ruxsat (bu koin 4H: ${macro.trend4h ?? "NEUTRAL"})`
    );
  }

  // (6) Stage 6.0 Precision Entry Discipline (7-day replay proven RSI 42-60 + Vol >= 1.0x + Pullback-Reclaim)
  const stretchAboveEma21Pct =
    typeof tech.stretchAboveEma21Pct === "number"
      ? tech.stretchAboveEma21Pct
      : tech.ema21 > 0
        ? Number((((tech.entryPrice - tech.ema21) / tech.ema21) * 100).toFixed(2))
        : 0;

  if (scout.priceChange24hPct > 20 || (scout.priceChange24hPct > 28 && tech.rsi14 > 72)) {
    rejectReasons.push(
      `Kechki FOMO quvish (24s +${scout.priceChange24hPct}%, RSI ${tech.rsi14}) — rad etildi`
    );
  }
  if (tech.rsi14 > 60 || tech.rsi14 < 42) {
    rejectReasons.push(`RSI aniq kirish zonasidan tashqarida (${tech.rsi14}, talab: 42–60)`);
  }
  if (scout.volumeSpikeRatio15m < 1.0) {
    rejectReasons.push(
      `15m savdo hajmi past (${scout.volumeSpikeRatio15m}x < 1.0x) — bo'sh likvidlikda kirish bloklandi`
    );
  }
  if (stretchAboveEma21Pct > 2.5) {
    rejectReasons.push(
      `Narx EMA21 dan +${stretchAboveEma21Pct.toFixed(1)}% cho'zilgan (>2.5%) — pullback kutiladi`
    );
  }
  if (tech.isPullbackReclaim === false) {
    rejectReasons.push("EMA9/21 pullback-reclaim tasdig'i yo'q — yashil shamni quvish bloklandi");
  }

  // (7) Order-Book Seller Wall, Spread & Extreme Volatility Whipsaw Guard
  if (macro.bidAskRatio < 0.7) {
    rejectReasons.push(`Kuchli sotuv devori (Bid/Ask ${macro.bidAskRatio}x < 0.70x)`);
  }
  if (macro.spreadPct > 0.35) {
    rejectReasons.push(`Order book spread juda keng (${macro.spreadPct}% > 0.35%)`);
  }
  if (typeof tech.atrPct === "number" && tech.atrPct > 3.2) {
    rejectReasons.push(`Haddan tashqari 15m volatillik (ATR ${tech.atrPct}% > 3.2%) — whipsaw riski`);
  }

  // (8) Stage 6.0 Institutional Order-Flow Hard Gate (Anti-Spoofing + Taker CVD + Weighted OBI)
  if (orderFlow && !orderFlow.degraded) {
    if (orderFlow.isSpoofingDetected) {
      rejectReasons.push(orderFlow.spoofReasonUz || "Soxta xaridor devori (Spoofing) aniqlandi");
    }
    if (orderFlow.takerBuyPct < 45 && orderFlow.weightedObiRatio < 0.85) {
      rejectReasons.push(
        `Order-Flow sotuv bosimi: Taker Buy ${orderFlow.takerBuyPct}% (<45%) va OBI ${orderFlow.weightedObiRatio}x (<0.85x)`
      );
    }
  }

  // === SOFT WARNINGS (adjust 1–5 Star Rating ⭐) ===
  let starPenalty = 0;

  if (fundamental) {
    for (const w of fundamental.softWarnings) {
      softWarnings.push(w);
      starPenalty += 1;
    }
  }

  if (typeof fundingPct === "number" && fundingPct >= 0.05) {
    softWarnings.push(`Yuqori Funding Rate (+${fundingPct}%) — long squeeze ehtiyoti`);
    starPenalty += 1;
  }

  if (macro.btcTrend4h === "BEARISH") {
    softWarnings.push("BTC 4H BEARISH — faqat kuchli 4H lider sifatida ehtiyotkor kirish");
    starPenalty += 1;
  }

  if (stretchAboveEma21Pct > 1.8 && stretchAboveEma21Pct <= 2.5) {
    softWarnings.push(
      `Narx EMA21 dan +${stretchAboveEma21Pct.toFixed(1)}% yuqorida — limit buyurtma ma'qul`
    );
    starPenalty += 1;
  }

  if (macro.bidAskRatio >= 0.7 && macro.bidAskRatio < 0.95) {
    softWarnings.push(`Order book sotuv bosimi bor (${macro.bidAskRatio}x) — ehtiyotkor kirish`);
    starPenalty += 1;
  }

  if (macro.spreadPct > 0.2 && macro.spreadPct <= 0.35) {
    softWarnings.push(`Spread biroz keng (${macro.spreadPct}%) — limit buyurtma tavsiya etiladi`);
    starPenalty += 1;
  }

  let orderFlowAdjust = 0;
  if (orderFlow && !orderFlow.degraded) {
    if (orderFlow.weightedObiRatio >= 1.4 && orderFlow.takerBuyPct >= 55) {
      orderFlowAdjust = 4;
    } else if (orderFlow.takerBuyPct < 48 || orderFlow.weightedObiRatio < 0.9) {
      softWarnings.push(
        `Order-Flow zaifroq (OBI ${orderFlow.weightedObiRatio}x | Taker Buy ${orderFlow.takerBuyPct}%)`
      );
      orderFlowAdjust = -3;
    }
  }

  const fundamentalBoost = fundamental ? fundamental.fundamentalScore * 0.1 : 8;
  const confidenceScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        scout.scoutScore * 0.2 +
          tech.techScore * 0.44 +
          macro.macroScore * 0.26 +
          fundamentalBoost +
          orderFlowAdjust -
          Math.min(starPenalty * 2, 8)
      )
    )
  );

  // (9) Minimum Quality Confidence Gate
  if (confidenceScore < 65) {
    rejectReasons.push(`Umumiy ishonch balli past (${confidenceScore}/100 < 65)`);
  }

  // Compute 1–5 Star Rating (⭐) & Stage 6.1 Star-Rating Conviction Sizing
  let baseStars = 3;
  if (confidenceScore >= 78) baseStars = 5;
  else if (confidenceScore >= 68) baseStars = 4;
  else if (confidenceScore < 55) baseStars = 2;

  if (macro.trend1h === "BULLISH" && macro.trend4h === "BULLISH") {
    baseStars = Math.min(5, baseStars + 1);
  }
  const starCount = Math.max(1, Math.min(5, baseStars - Math.min(starPenalty, 2)));
  const longTermStars: StarRatingInfo = {
    count: starCount,
    label: `${"⭐".repeat(starCount)}${"☆".repeat(5 - starCount)} (${starCount}/5)`
  };
  const suggestedSizeMultiplier = computeConvictionSizeMultiplier(starCount);

  // Hybrid Trade Mode classification: SWING requires non-bearish BTC 4H & coin above 4H EMA50
  const tradeMode: TradeMode =
    macro.trend1h === "BULLISH" &&
    macro.trend4h === "BULLISH" &&
    macro.btcTrend4h !== "BEARISH" &&
    macro.above4hEma50 !== false &&
    longTermStars.count >= 4
      ? "SWING"
      : "INTRADAY";

  const orderFlowTag =
    orderFlow && !orderFlow.degraded
      ? ` | OBI ${orderFlow.weightedObiRatio}x, Taker ${orderFlow.takerBuyPct}%`
      : "";
  const adxTag = typeof tech.adx14 === "number" ? ` | ADX ${tech.adx14}` : "";

  const verdict: "APPROVE" | "REJECT" = rejectReasons.length === 0 ? "APPROVE" : "REJECT";
  const reasons =
    verdict === "APPROVE"
      ? [
          `R:R 1:${tech.riskRewardRatio} talabga mos (${tradeMode}) | Tavsiya hajm: ${suggestedSizeMultiplier.toFixed(1)}x`,
          `Reyting: ${longTermStars.label} | RSI ${tech.rsi14}${adxTag}${tech.isPullbackReclaim ? " | Pullback-Reclaim ✅" : ""}`,
          `1H/4H: ${macro.trend1h ?? macro.regime}/${macro.trend4h ?? macro.regime} | BTC: ${macro.btcChange1hPct >= 0 ? "+" : ""}${macro.btcChange1hPct}%${orderFlowTag}`
        ]
      : rejectReasons;

  return {
    symbol: scout.symbol,
    direction: tech.direction,
    verdict,
    tradeMode,
    confidenceScore,
    longTermStars,
    suggestedSizeMultiplier,
    softWarnings,
    reasons,
    latencyMs: Date.now() - started
  };
}
