import axios from "axios";
import { env } from "../config/env";
import { ScoutCandidate } from "./scout.agent";
import { TechnicalAnalysisResult } from "./technician.agent";
import { MacroFlowResult } from "./macroFlow.agent";
import { CriticRiskResult } from "./criticRisk.agent";

export interface ExecutiveDispatchResult {
  symbol: string;
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
  sent: boolean;
  telegramMessage: string;
  error?: string;
}

export function formatTelegramSignalCard(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  critic: CriticRiskResult
): string {
  return [
    `🚀 *CRYPTOQUANT-COPILOT SIGNAL*`,
    ``,
    `🪙 *Juftlik:* \`${scout.symbol}\` (MEXC Spot)`,
    `📊 *Yo'nalish:* LONG | *Ishonch:* ${critic.confidenceScore}/100`,
    ``,
    `🎯 *Kirish (Entry):* \`${tech.entryPrice}\``,
    `✅ *Take-Profit (TP):* \`${tech.takeProfitPrice}\``,
    `🛑 *Stop-Loss (SL):* \`${tech.stopLossPrice}\``,
    `⚖️ *Risk / Foyda (R:R):* 1:${tech.riskRewardRatio}`,
    ``,
    `🧠 *Agentlar xulosasi:*`,
    `• *Scout:* 24s ${scout.priceChange24hPct >= 0 ? "+" : ""}${scout.priceChange24hPct}% | 15m hajm ${scout.volumeSpikeRatio15m}x`,
    `• *Technician:* ${tech.summary}`,
    `• *Macro & Flow:* ${macro.summary} (${macro.regime})`,
    `• *Critic:* TASDIQLANDI (${critic.reasons[0]})`,
    ``,
    `⚠️ _Moliyaviy maslahat emas. Riskni o'zingiz boshqaring._`
  ].join("\n");
}

function isConfiguredSecret(val: string): boolean {
  const cleaned = (val || "").trim().toLowerCase();
  return cleaned.length > 5 && cleaned !== "pending" && cleaned !== "none";
}

export async function runExecutiveAgent(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  critic: CriticRiskResult
): Promise<ExecutiveDispatchResult> {
  const telegramMessage = formatTelegramSignalCard(scout, tech, macro, critic);

  const hasTelegram =
    isConfiguredSecret(env.TELEGRAM_BOT_TOKEN) && isConfiguredSecret(env.TELEGRAM_CHANNEL_ID);

  if (!hasTelegram) {
    return {
      symbol: scout.symbol,
      mode: "DRY_RUN",
      sent: false,
      telegramMessage
    };
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: env.TELEGRAM_CHANNEL_ID,
        text: telegramMessage,
        parse_mode: "Markdown"
      },
      { timeout: 10000 }
    );
    return {
      symbol: scout.symbol,
      mode: "LIVE_TELEGRAM",
      sent: true,
      telegramMessage
    };
  } catch (err) {
    return {
      symbol: scout.symbol,
      mode: "LIVE_TELEGRAM",
      sent: false,
      telegramMessage,
      error: err instanceof Error ? err.message : "Telegram dispatch error"
    };
  }
}
