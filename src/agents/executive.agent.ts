import axios from "axios";
import { env } from "../config/env";
import { ScoutCandidate } from "./scout.agent";
import { TechnicalAnalysisResult } from "./technician.agent";
import { MacroFlowResult } from "./macroFlow.agent";
import { CriticRiskResult } from "./criticRisk.agent";
import type { DemoTradeItem } from "../services/demoPortfolio.service";

export interface ExecutiveDispatchResult {
  symbol: string;
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
  sent: boolean;
  telegramMessage: string;
  error?: string;
}

export interface TelegramSendResult {
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
  sent: boolean;
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

export function formatTradeClosedCard(trade: DemoTradeItem): string {
  const icon =
    trade.status === "TP_HIT" ? "✅" : trade.status === "SL_HIT" ? "🛑" : "⏱️";
  const label =
    trade.status === "TP_HIT"
      ? "TAKE-PROFIT URILDI (TP_HIT)"
      : trade.status === "SL_HIT"
        ? "STOP-LOSS URILDI (SL_HIT)"
        : "MUDDAT TUGADI (EXPIRED)";
  const pnlPct = trade.pnlPercent ?? 0;
  const pnlUsd = trade.pnlUsd ?? 0;
  const sign = pnlUsd >= 0 ? "+" : "";

  return [
    `${icon} *DEMO SAVDO YOPILDI — ${label}*`,
    ``,
    `🪙 *Juftlik:* \`${trade.symbol}\` (MEXC Spot)`,
    `🎯 *Entry:* \`${trade.entryPrice}\` → *Exit:* \`${trade.exitPrice ?? "-"}\``,
    `💰 *Natija:* ${sign}${pnlPct}% (${sign}$${pnlUsd})`,
    `📦 *Pozitsiya hajmi:* $${trade.positionSizeUsd}`,
    ``,
    `⚠️ _Virtual demo portfel hisoboti._`
  ].join("\n");
}

function isConfiguredSecret(val: string): boolean {
  const cleaned = (val || "").trim().toLowerCase();
  return cleaned.length > 5 && cleaned !== "pending" && cleaned !== "none";
}

function hasTelegramCredentials(): boolean {
  return (
    isConfiguredSecret(env.TELEGRAM_BOT_TOKEN) && isConfiguredSecret(env.TELEGRAM_CHANNEL_ID)
  );
}

export async function sendTelegramTextMessage(text: string): Promise<TelegramSendResult> {
  if (!hasTelegramCredentials()) {
    return {
      mode: "DRY_RUN",
      sent: false
    };
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: env.TELEGRAM_CHANNEL_ID,
        text,
        parse_mode: "Markdown"
      },
      { timeout: 10000 }
    );
    return {
      mode: "LIVE_TELEGRAM",
      sent: true
    };
  } catch (err) {
    return {
      mode: "LIVE_TELEGRAM",
      sent: false,
      error: err instanceof Error ? err.message : "Telegram dispatch error"
    };
  }
}

export async function sendTelegramPdfReport(
  pdfBuffer: Buffer,
  filename: string,
  caption: string
): Promise<TelegramSendResult> {
  if (!hasTelegramCredentials()) {
    return {
      mode: "DRY_RUN",
      sent: false
    };
  }

  try {
    const form = new FormData();
    form.append("chat_id", env.TELEGRAM_CHANNEL_ID);
    form.append("caption", caption);
    form.append(
      "document",
      new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
      filename
    );

    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return {
        mode: "LIVE_TELEGRAM",
        sent: false,
        error: `Telegram sendDocument HTTP ${response.status}: ${bodyText}`
      };
    }

    return {
      mode: "LIVE_TELEGRAM",
      sent: true
    };
  } catch (err) {
    return {
      mode: "LIVE_TELEGRAM",
      sent: false,
      error: err instanceof Error ? err.message : "Telegram PDF dispatch error"
    };
  }
}

export async function runExecutiveAgent(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  critic: CriticRiskResult
): Promise<ExecutiveDispatchResult> {
  const telegramMessage = formatTelegramSignalCard(scout, tech, macro, critic);
  const res = await sendTelegramTextMessage(telegramMessage);

  return {
    symbol: scout.symbol,
    mode: res.mode,
    sent: res.sent,
    telegramMessage,
    ...(res.error ? { error: res.error } : {})
  };
}
