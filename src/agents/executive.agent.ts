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
import { getCurrentTradingSession } from "../utils/tradingSession";
import type { OrderFlowReport } from "../services/orderFlow.service";

export interface ExecutiveDispatchResult {
  symbol: string;
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
  sent: boolean;
  telegramMessage: string;
  telegramMessageId: number | null;
  chartAttached?: boolean;
  error?: string;
}

export interface TelegramSendResult {
  mode: "LIVE_TELEGRAM" | "DRY_RUN";
  sent: boolean;
  telegramMessageId: number | null;
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

export function formatThreeLineAgentSummary(
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  critic: CriticRiskResult,
  fundamental?: FundamentalReport,
  orderFlow?: OrderFlowReport
): string[] {
  const trend1h = macro.trend1h ?? macro.regime;
  const trend4h = macro.trend4h ?? macro.regime;

  let rsiStateUz = "Sog'lom";
  if (tech.rsi14 < 40) rsiStateUz = "Sotilgan";
  else if (tech.rsi14 <= 60) rsiStateUz = "Sog'lom";
  else if (tech.rsi14 <= 70) rsiStateUz = "Faol";
  else rsiStateUz = "Qizigan";

  let buyerStrengthUz = "Muvozanatli";
  if (macro.bidAskRatio >= 1.25) buyerStrengthUz = "Xaridorlar ustun";
  else if (macro.bidAskRatio < 0.9) buyerStrengthUz = "Sotuv bosimi";

  const exchanges = (macro.exchanges && macro.exchanges.length > 0 ? macro.exchanges : ["MEXC"]).join(
    "+"
  );
  const orderFlowProof =
    orderFlow && !orderFlow.degraded
      ? `OBI ${orderFlow.weightedObiRatio}x | Taker Buy ${orderFlow.takerBuyPct}%`
      : `${buyerStrengthUz} (${macro.bidAskRatio}x, ${exchanges})`;
  const fundamentalBadge = fundamental?.badgeUz ?? "✅ Sog'lom";
  const sessionLabelUz = getCurrentTradingSession().labelUz;
  const softWarning = critic.softWarnings?.[0] || "";

  const adxSegment = typeof tech.adx14 === "number" ? ` | ADX: ${Math.round(tech.adx14)}` : "";

  return [
    `• *Trend:* 15M/${trend1h}/${trend4h} | RSI: ${Math.round(tech.rsi14)} (${rsiStateUz})${adxSegment}`,
    `• *Bozor:* ${orderFlowProof} | Fundamental: ${fundamentalBadge}`,
    `• *Eslatma:* ${sessionLabelUz}${softWarning ? " • " + softWarning : ""}`
  ];
}

export function formatTelegramSignalCard(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  critic: CriticRiskResult,
  fundamental?: FundamentalReport,
  orderFlow?: OrderFlowReport
): string {
  const entryZone = formatEntryZoneRange(tech.entryPrice);
  const tradeMode = critic.tradeMode ?? tech.tradeMode ?? "INTRADAY";
  const modeHeader = tradeMode === "SWING" ? "🏔️ SWING (4H)" : "⚡ INTRADAY (15M)";
  const isShort = tech.direction === "SHORT" || critic.direction === "SHORT";
  const dirLabel = isShort
    ? "🔴 *SHORT / SELL (1x — Xavfsiz Hedge / Nol likvidatsiya)*"
    : "🟢 *LONG (SPOT)*";
  const marketVenue = isShort ? "MEXC 1x Hedge" : "MEXC Spot";

  const tp1 =
    tech.tp1Price ??
    roundPrice(tech.entryPrice + (tech.takeProfitPrice - tech.entryPrice) * 0.6);
  const tp2 = tech.tp2Price ?? tech.takeProfitPrice;
  const tp3 =
    tech.tp3Price ??
    roundPrice(tech.entryPrice + (tech.takeProfitPrice - tech.entryPrice) * 1.35);
  const starsText = critic.longTermStars ? ` | ${critic.longTermStars.label}` : "";
  const sizeMult = critic.suggestedSizeMultiplier ?? 1.0;
  const threeLineSummary = formatThreeLineAgentSummary(tech, macro, critic, fundamental, orderFlow);

  const lines = [
    `🚀 *CRYPTOQUANT-COPILOT SIGNAL* | ${modeHeader}`,
    `${dirLabel}`,
    ``,
    `🪙 *Juftlik:* \`${scout.symbol}\` (${marketVenue})`,
    `📊 *Ishonch:* ${critic.confidenceScore}/100${starsText} | 💰 *Tavsiya hajm:* ${sizeMult.toFixed(1)}x`,
    ``,
    `🎯 *Kirish (Entry):* \`${tech.entryPrice}\` (Zona: \`${entryZone}\`)`,
    `✅ *TP1 (60% yopish):* \`${tp1}\``,
    `✅ *TP2 (40% asosiy):* \`${tp2}\``,
    `🚀 *TP3 (Max runner):* \`${tp3}\``,
    `🛑 *Stop-Loss (SL):* \`${tech.stopLossPrice}\``,
    `⚖️ *Risk / Foyda (R:R):* 1:${tech.riskRewardRatio}`,
    ``,
    `🧠 *5-Agent tahlili:*`,
    ...threeLineSummary,
    ``,
    `⚠️ _Moliyaviy maslahat emas. Riskni o'zingiz boshqaring._`
  ];

  return lines.join("\n");
}

export function formatTp1BreakevenCard(trade: DemoTradeItem): string {
  const dirTag = trade.direction === "SHORT" ? "🔴 SHORT 1x" : "🟢 LONG";
  const trailNote =
    trade.direction === "SHORT"
      ? "-2.3R da -0.5R foyda himoyasiga tushadi"
      : "2.3R da +0.5R ga ko'tariladi";
  return [
    `🎯 *TP1 URILDI (${trade.symbol} | ${dirTag})* — 60% foyda olindi! Qolgan 40% SL \`${trade.stopLossPrice}\` yumshoq himoyaga surildi!`,
    ``,
    `🪙 *Juftlik:* \`${trade.symbol}\` (${trade.tradeMode} • ${dirTag})`,
    `✅ *TP1 (60%):* \`${trade.tp1Price}\` | 🎯 *TP2 (40%):* \`${trade.tp2Price}\` | 🚀 *TP3:* \`${trade.tp3Price}\``,
    `🛡️ *Yangi Stop-Loss:* \`${trade.stopLossPrice}\` (${trailNote})`
  ].join("\n");
}

export function formatTradeClosedCard(trade: DemoTradeItem): string {
  const icon =
    trade.status === "TP_HIT"
      ? "✅"
      : trade.status === "BREAKEVEN_EXIT"
        ? "🛡️"
        : trade.status === "MANUAL_CLOSE"
          ? "🔴"
          : trade.status === "SL_HIT"
            ? "🛑"
            : "⏱️";
  const label =
    trade.status === "TP_HIT"
      ? "TAKE-PROFIT URILDI (TP_HIT)"
      : trade.status === "BREAKEVEN_EXIT"
        ? "TP1 HIMOYA YOPILDI"
        : trade.status === "MANUAL_CLOSE"
          ? "QO'LDA YOPILDI (MANUAL_CLOSE)"
          : trade.status === "SL_HIT"
            ? "STOP-LOSS URILDI (SL_HIT)"
            : "MUDDAT TUGADI (EXPIRED)";
  const pnlPct = trade.pnlPercent ?? 0;
  const pnlUsd = trade.pnlUsd ?? 0;
  const sign = pnlUsd >= 0 ? "+" : "";
  const dirTag = trade.direction === "SHORT" ? "SHORT 1x" : "LONG Spot";

  const lines = [
    `${icon} *DEMO SAVDO YOPILDI — ${label}*`,
    ``,
    `🪙 *Juftlik:* \`${trade.symbol}\` (${dirTag} | ${trade.tradeMode})`,
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
  replyToMessageId?: number | null,
  replyMarkup?: Record<string, unknown>
): Promise<TelegramSendResult> {
  if (!hasTelegramCredentials()) {
    return {
      mode: "DRY_RUN",
      sent: false,
      telegramMessageId: null
    };
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: env.TELEGRAM_CHANNEL_ID,
      text,
      parse_mode: "Markdown"
    };
    if (typeof replyToMessageId === "number" && Number.isFinite(replyToMessageId) && replyToMessageId > 0) {
      payload.reply_to_message_id = replyToMessageId;
      payload.allow_sending_without_reply = true;
    }
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const res = await axios.post<{ ok?: boolean; result?: { message_id?: number } }>(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      payload,
      { timeout: 10000 }
    );
    const msgId =
      typeof res.data?.result?.message_id === "number" ? res.data.result.message_id : null;
    return {
      mode: "LIVE_TELEGRAM",
      sent: true,
      telegramMessageId: msgId
    };
  } catch (err) {
    return {
      mode: "LIVE_TELEGRAM",
      sent: false,
      telegramMessageId: null,
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
      sent: false,
      telegramMessageId: null
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
        telegramMessageId: null,
        error: `Telegram sendDocument HTTP ${response.status}: ${bodyText}`
      };
    }

    let msgId: number | null = null;
    try {
      const json = (await response.json()) as { result?: { message_id?: number } };
      if (typeof json?.result?.message_id === "number") msgId = json.result.message_id;
    } catch {
      // Non-fatal
    }

    return {
      mode: "LIVE_TELEGRAM",
      sent: true,
      telegramMessageId: msgId
    };
  } catch (err) {
    return {
      mode: "LIVE_TELEGRAM",
      sent: false,
      telegramMessageId: null,
      error: err instanceof Error ? err.message : "Telegram PDF dispatch error"
    };
  }
}

export async function runExecutiveAgent(
  scout: ScoutCandidate,
  tech: TechnicalAnalysisResult,
  macro: MacroFlowResult,
  critic: CriticRiskResult,
  fundamental?: FundamentalReport,
  orderFlow?: OrderFlowReport
): Promise<ExecutiveDispatchResult> {
  const telegramMessage = formatTelegramSignalCard(scout, tech, macro, critic, fundamental, orderFlow);
  const replyMarkup = buildTelegramSignalReplyMarkup(scout.symbol, tech.entryPrice);

  let chartPng: Buffer | null = null;
  try {
    const klines = await fetchMexcKlines(scout.symbol, "15m", 60);
    chartPng = generate15mChartPng(klines, {
      symbol: scout.symbol,
      direction: tech.direction,
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
      telegramMessageId: null,
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
        let msgId: number | null = null;
        try {
          const json = (await response.json()) as { result?: { message_id?: number } };
          if (typeof json?.result?.message_id === "number") msgId = json.result.message_id;
        } catch {
          // Non-fatal
        }
        return {
          symbol: scout.symbol,
          mode: "LIVE_TELEGRAM",
          sent: true,
          telegramMessage,
          telegramMessageId: msgId,
          chartAttached: true
        };
      }
    } catch {
      // Fall back to text sendMessage with reply_markup below
    }
  }

  const res = await sendTelegramTextMessage(telegramMessage, null, replyMarkup);

  return {
    symbol: scout.symbol,
    mode: res.mode,
    sent: res.sent,
    telegramMessage,
    telegramMessageId: res.telegramMessageId,
    chartAttached: false,
    ...(res.error ? { error: res.error } : {})
  };
}
