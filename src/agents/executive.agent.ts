import axios from "axios";
import { env } from "../config/env";
import { ScoutCandidate } from "./scout.agent";
import { TechnicalAnalysisResult } from "./technician.agent";
import { MacroFlowResult } from "./macroFlow.agent";
import { CriticRiskResult } from "./criticRisk.agent";
import type { DemoTradeItem } from "../services/demoPortfolio.service";
import { buildTelegramSignalReplyMarkup } from "../utils/exchangeLinks";
import { fetchMexcKlines } from "../services/mexcClient.service";
import { generate15mChartPng } from "../services/chartGenerator.service";

export interface ExecutiveDispatchResult {
  symbol: string;
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
  sent: boolean;
  telegramMessage: string;
  chartAttached?: boolean;
  error?: string;
}

export interface TelegramSendResult {
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
  sent: boolean;
  error?: string;
}

function roundPrice(price: number): number {
  if (price >= 100) return Number(price.toFixed(2));
  if (price >= 1) return Number(price.toFixed(4));
  if (price >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(7));
}

export function formatEntryZoneRange(entryPrice: number): string {
  const low = roundPrice(entryPrice * 0.997);
  const high = roundPrice(entryPrice * 1.003);
  return `${low} – ${high}`;
}

export function formatTelegramSignalCard(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  critic: CriticRiskResult
): string {
  const entryZone = formatEntryZoneRange(tech.entryPrice);
  return [
    `🚀 *CRYPTOQUANT-COPILOT SIGNAL*`,
    ``,
    `🪙 *Juftlik:* \`${scout.symbol}\` (MEXC Spot)`,
    `📊 *Yo'nalish:* LONG | *Ishonch:* ${critic.confidenceScore}/100`,
    ``,
    `🎯 *Kirish (Entry):* \`${tech.entryPrice}\``,
    `📍 *Kirish zonasi (Entry Zone):* \`${entryZone}\``,
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

export async function sendTelegramTextMessage(
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<TelegramSendResult> {
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
        parse_mode: "Markdown",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
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
  const replyMarkup = buildTelegramSignalReplyMarkup(scout.symbol, tech.entryPrice);

  let chartPng: Buffer | null = null;
  try {
    const klines = await fetchMexcKlines(scout.symbol, "15m", 60);
    chartPng = generate15mChartPng(klines, {
      symbol: scout.symbol,
      entryPrice: tech.entryPrice,
      takeProfitPrice: tech.takeProfitPrice,
      stopLossPrice: tech.stopLossPrice,
      verdict: critic.verdict,
      timeframeLabel: "15M"
    });
  } catch {
    chartPng = null;
  }

  if (!hasTelegramCredentials()) {
    return {
      symbol: scout.symbol,
      mode: "DRY_RUN",
      sent: false,
      telegramMessage,
      chartAttached: Boolean(chartPng)
    };
  }

  if (chartPng) {
    try {
      const form = new FormData();
      form.append("chat_id", env.TELEGRAM_CHANNEL_ID);
      form.append("caption", telegramMessage);
      form.append("parse_mode", "Markdown");
      form.append("reply_markup", JSON.stringify(replyMarkup));
      form.append(
        "photo",
        new Blob([new Uint8Array(chartPng)], { type: "image/png" }),
        `${scout.symbol}-15m.png`
      );

      const response = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
        {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(15000)
        }
      );

      if (response.ok) {
        return {
          symbol: scout.symbol,
          mode: "LIVE_TELEGRAM",
          sent: true,
          telegramMessage,
          chartAttached: true
        };
      }
    } catch {
      // Fall back to text sendMessage with reply_markup below
    }
  }

  const res = await sendTelegramTextMessage(telegramMessage, replyMarkup);

  return {
    symbol: scout.symbol,
    mode: res.mode,
    sent: res.sent,
    telegramMessage,
    chartAttached: false,
    ...(res.error ? { error: res.error } : {})
  };
}
