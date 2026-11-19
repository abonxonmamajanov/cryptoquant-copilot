import { fetchMexcKlines, fetchMexcTicker24h } from "./mexcClient.service";
import { isFilteredOutSymbol, ScoutCandidate } from "../agents/scout.agent";
import { runTechnicianAgent } from "../agents/technician.agent";
import { runMacroFlowAgent } from "../agents/macroFlow.agent";
import { runCriticRiskAgent } from "../agents/criticRisk.agent";
import { formatEntryZoneRange } from "../agents/executive.agent";
import { EvaluatedSignalRecord } from "./pipeline.service";
import { generate15mChartPng } from "./chartGenerator.service";

export interface TokenCheckResult {
  symbol: string;
  record: EvaluatedSignalRecord;
  caption: string;
  chartPng: Buffer;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function normalizeMexcSymbol(rawInput: string): string {
  const cleaned = rawInput
    .trim()
    .toUpperCase()
    .replace(/^\$/, "")
    .replace(/[\/\-_\s]+/g, "");
  if (!cleaned) {
    throw new Error("Koin nomi bo'sh bo'lishi mumkin emas.");
  }
  return cleaned.endsWith("USDT") ? cleaned : `${cleaned}USDT`;
}

export async function analyzeTokenOnDemand(rawInput: string): Promise<TokenCheckResult> {
  const symbol = normalizeMexcSymbol(rawInput);
  if (isFilteredOutSymbol(symbol)) {
    throw new Error(
      `${symbol} tahlil qilinmaydi (stablecoin, leveraged ETF token yoki USDT bo'lmagan juftlik).`
    );
  }

  const [ticker, klines15m] = await Promise.all([
    fetchMexcTicker24h(symbol),
    fetchMexcKlines(symbol, "15m", 60)
  ]);

  if (klines15m.length < 15) {
    throw new Error(`${symbol} uchun yetarli 15m shamlar topilmadi.`);
  }

  const latestClosed = klines15m[klines15m.length - 2];
  const history = klines15m.slice(Math.max(0, klines15m.length - 22), klines15m.length - 2);
  const avgQuoteVol =
    history.reduce((sum, k) => sum + k.quoteAssetVolume, 0) / Math.max(history.length, 1);

  const volumeSpikeRatio15m =
    avgQuoteVol > 0 ? Number((latestClosed.quoteAssetVolume / avgQuoteVol).toFixed(2)) : 0;

  const momentum15mPct =
    latestClosed.open > 0
      ? Number((((latestClosed.close - latestClosed.open) / latestClosed.open) * 100).toFixed(2))
      : 0;

  const priceChange24hPct = Number(ticker.priceChangePercent.toFixed(2));
  const volPoints = clamp((volumeSpikeRatio15m - 1) * 20, 0, 50);
  const momPoints = clamp(Math.abs(momentum15mPct) * 10, 0, 30);
  const liqPoints = clamp((Math.log10(Math.max(ticker.quoteVolume, 10)) - 6) * 10, 0, 20);
  const scoutScore = Math.round(clamp(volPoints + momPoints + liqPoints, 0, 100));

  const reasons: string[] = [];
  if (volumeSpikeRatio15m >= 2.0) reasons.push(`15m hajm sakrashi ${volumeSpikeRatio15m}x`);
  if (Math.abs(momentum15mPct) >= 1.2) {
    reasons.push(`15m impuls ${momentum15mPct > 0 ? "+" : ""}${momentum15mPct}%`);
  }
  if (Math.abs(priceChange24hPct) >= 5.0) {
    reasons.push(`24s harakat ${priceChange24hPct > 0 ? "+" : ""}${priceChange24hPct}%`);
  }
  if (reasons.length === 0) reasons.push("On-demand tekshiruv");

  const scout: ScoutCandidate = {
    symbol,
    exchange: "MEXC",
    lastPrice: ticker.lastPrice,
    priceChange24hPct,
    quoteVolume24hUsd: Math.round(ticker.quoteVolume),
    volumeSpikeRatio15m,
    momentum15mPct,
    scoutScore,
    isAnomaly: volumeSpikeRatio15m >= 1.8 || Math.abs(momentum15mPct) >= 1.5 || scoutScore >= 55,
    isNewAlert: false,
    reasons,
    detectedAt: new Date().toISOString()
  };

  const [technician, macroFlow] = await Promise.all([
    runTechnicianAgent(scout),
    runMacroFlowAgent(symbol)
  ]);

  const criticRisk = runCriticRiskAgent(scout, technician, macroFlow);

  const record: EvaluatedSignalRecord = {
    scout,
    technician,
    macroFlow,
    criticRisk,
    executive: null
  };

  const chartPng = generate15mChartPng(klines15m, {
    symbol,
    entryPrice: technician.entryPrice,
    takeProfitPrice: technician.takeProfitPrice,
    stopLossPrice: technician.stopLossPrice,
    verdict: criticRisk.verdict,
    timeframeLabel: "15M"
  });

  const verdictBadge = criticRisk.verdict === "APPROVE" ? "✅ TASDIQLANDI (APPROVE)" : "❌ RAD ETILDI (REJECT)";
  const entryZone = formatEntryZoneRange(technician.entryPrice);

  const caption = [
    `🔎 *CRYPTOQUANT-COPILOT — 5-AGENT TAHLIL*`,
    ``,
    `🪙 *Juftlik:* \`${symbol}\` (MEXC Spot | 15M)`,
    `📊 *Qaror:* ${verdictBadge} | *Ishonch:* ${criticRisk.confidenceScore}/100`,
    ``,
    `🎯 *Kirish (Entry):* \`${technician.entryPrice}\``,
    `📍 *Kirish zonasi:* \`${entryZone}\``,
    `✅ *Take-Profit (TP):* \`${technician.takeProfitPrice}\``,
    `🛑 *Stop-Loss (SL):* \`${technician.stopLossPrice}\``,
    `⚖️ *Risk / Foyda (R:R):* 1:${technician.riskRewardRatio}`,
    ``,
    `🧠 *Agentlar xulosasi:*`,
    `• *Scout:* 24s ${priceChange24hPct >= 0 ? "+" : ""}${priceChange24hPct}% | 15m hajm ${volumeSpikeRatio15m}x`,
    `• *Technician:* ${technician.summary}`,
    `• *Macro & Flow:* ${macroFlow.summary} (${macroFlow.regime})`,
    `• *Critic:* ${criticRisk.reasons.slice(0, 2).join("; ")}`,
    ``,
    `⚠️ _Moliyaviy maslahat emas. Riskni o'zingiz boshqaring._`
  ].join("\n");

  return {
    symbol,
    record,
    caption,
    chartPng
  };
}
