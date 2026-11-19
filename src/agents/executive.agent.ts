import axios from "axios";
import { env } from "../config/env";
import { ScoutCandidate } from "./scout.agent";
import { TechnicalAnalysisResult } from "./technician.agent";
import { MacroFlowResult } from "./macroFlow.agent";
import { CriticRiskResult } from "./criticRisk.agent";
import type { DemoTradeItem } from "../services/demoPortfolio.service";
import type { FundamentalReport } from "../services/fundamental.service";
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
  critic: CriticRiskResult,
  fundamental?: FundamentalReport
): string {
  const entryZone = formatEntryZoneRange(tech.entryPrice);
  const tradeMode = critic.tradeMode ?? tech.tradeMode ?? "INTRADAY";
  const modeHeader = tradeMode === "SWING" ? "🏔️ SWING (4H)" : "⚡ INTRADAY (15M)";
  const tp1 = tech.tp1Price ?? roundPrice(tech.entryPrice + (tech.takeProfitPrice - tech.entryPrice) * 0.55);
  const tp2 = tech.tp2Price ?? tech.takeProfitPrice;
  const tp3 = tech.tp3Price ?? roundPrice(tech.entryPrice + (tech.takeProfitPrice - tech.entryPrice) * 1.45);
  const fngText = fundamental?.fearGreed
    ? ` | F&G: ${fundamental.fearGreed.value} (${fundamental.fearGreed.classification})`
    : "";
  const fundLine = fundamental ? `🛡️ *Fundamental:* ${fundamental.badgeUz}${fngText}` : null;
  const starsText = critic.longTermStars ? ` | ${critic.longTermStars.label}` : "";

  const lines = [
    `🚀 *CRYPTOQUANT-COPILOT SIGNAL* | ${modeHeader}`,
    ``,
    `🪙 *Juftlik:* \`${scout.symbol}\` (MEXC Spot)`,
    `📊 *Yo'nalish:* LONG | *Ishonch:* ${critic.confidenceScore}/100${starsText}`,
    ``,
    `🎯 *Kirish (Entry):* \`${tech.entryPrice}\``,
    `📍 *Kirish zonasi (Entry Zone):* \`${entryZone}\``,
    `✅ *TP1 (Breakeven):* \`${tp1}\``,
    `✅ *TP2 (Asosiy):* \`${tp2}\``,
    `🚀 *TP3 (Max):* \`${tp3}\``,
    `🛑 *Stop-Loss (SL):* \`${tech.stopLossPrice}\``,
    `⚖️ *Risk / Foyda (R:R):* 1:${tech.riskRewardRatio}`,
    ``,
    `🧠 *Agentlar xulosasi:*`,
    `• *Scout:* 24s ${scout.priceChange24hPct >= 0 ? "+" : ""}${scout.priceChange24hPct}% | 15m hajm ${scout.volumeSpikeRatio15m}x`,
    `• *Technician:* ${tech.summary}`,
    `• *Macro & Flow:* ${macro.summary} (${macro.regime})`,
    `• *Critic:* TASDIQLANDI (${critic.reasons[0]})`
  ];

  if (fundLine) {
    lines.push(fundLine);
  }
  if (critic.softWarnings && critic.softWarnings.length > 0) {
    lines.push(`⚠️ *Ehtiyot eslatma:* ${critic.softWarnings.slice(0, 2).join("; ")}`);
  }

  lines.push(``, `⚠️ _Moliyaviy maslahat emas. Riskni o'zingiz boshqaring._`);
  return lines.join("\n");
}

export function formatTp1BreakevenCard(trade: DemoTradeItem): string {
  return [
    `🎯 *TP1 URILDI (${trade.symbol})* — SL kirish narxiga (*Breakeven:* \`${trade.entryPrice}\`) surildi!`,
    ``,
    `🪙 *Juftlik:* \`${trade.symbol}\` (${trade.tradeMode})`,
    `✅ *TP1:* \`${trade.tp1Price}\` | 🎯 *Keyingi maqsad (TP2):* \`${trade.tp2Price}\` | 🚀 *TP3:* \`${trade.tp3Price}\``,
    `🛡️ *Yangi Stop-Loss:* \`${trade.entryPrice}\` (Risk = 0)`
  ].join("\n");
}

export function formatTradeClosedCard(trade: DemoTradeItem): string {
  const icon =
    trade.status === "TP_HIT"
      ? "✅"
      : trade.status === "BREAKEVEN_EXIT"
        ? "🛡️"
        : trade.status === "SL_HIT"
          ? "🛑"
          : "⏱️";
  const label =
    trade.status === "TP_HIT"
      ? "TAKE-PROFIT URILDI (TP_HIT)"
      : trade.status === "BREAKEVEN_EXIT"
        ? "BREAKEVEN YOPILDI (0 ZARAR)"
        : trade.status === "SL_HIT"
          ? "STOP-LOSS URILDI (SL_HIT)"
          : "MUDDAT TUGADI (EXPIRED)";
  const pnlPct = trade.pnlPercent ?? 0;
  const pnlUsd = trade.pnlUsd ?? 0;
  const sign = pnlUsd >= 0 ? "+" : "";

  const lines = [
    `${icon} *DEMO SAVDO YOPILDI — ${label}*`,
    ``,
    `🪙 *Juftlik:* \`${trade.symbol}\` (MEXC Spot | ${trade.tradeMode})`,
    `🎯 *Entry:* \`${trade.entryPrice}\` → *Exit:* \`${trade.exitPrice ?? "-"}\``,
    `💰 *Natija:* ${sign}${pnlPct}% (${sign}$${pnlUsd})`,
    `📦 *Pozitsiya hajmi:* $${trade.positionSizeUsd}`
  ];

  if (trade.slPostMortemReason) {
    lines.push(`🔎 *Post-Mortem sabab:* ${trade.slPostMortemReason}`);
  }
  lines.push(``, `⚠️ _Virtual demo portfel hisoboti._`);
  return lines.join("\n");
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
  critic: CriticRiskResult,
  fundamental?: FundamentalReport
): Promise<ExecutiveDispatchResult> {
  const telegramMessage = formatTelegramSignalCard(scout, tech, macro, critic, fundamental);
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
