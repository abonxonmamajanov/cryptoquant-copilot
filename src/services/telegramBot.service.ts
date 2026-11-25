import { Bot, InlineKeyboard, InputFile } from "grammy";
import { env } from "../config/env";
import {
  closeDemoTradeManually,
  getDemoPortfolioSummary,
  openManualDemoTrade
} from "./demoPortfolio.service";
import { getLatestPipelineSnapshot } from "./pipeline.service";
import { generatePortfolioPdfBuffer } from "./pdfReport.service";
import { triggerPipelineRunNow } from "./scheduler.service";
import { sendDailySummaryNow } from "./dailyReport.service";
import { analyzeTokenOnDemand } from "./tokenCheck.service";
import { fetchMexcKlines, fetchMexcTickerPrice } from "./mexcClient.service";
import { generate15mChartPng } from "./chartGenerator.service";
import { runHistoricalBacktest } from "./backtest.service";
import {
  buildTelegramSignalReplyMarkup,
  buildTradingViewMexcUrl
} from "../utils/exchangeLinks";
import {
  DirectionFilter,
  formatDirectionFilterUz,
  getActiveDirectionFilter,
  getActiveSignalMode,
  LEGAL_DISCLAIMER_UZ,
  RiskProfile,
  setActiveDirectionFilter,
  setActiveSignalMode,
  SignalMode,
  SUBSCRIPTION_PLANS,
  updateSubscriberRisk,
  upsertSubscriber
} from "./subscription.service";
import { addPriceAlert, listPriceAlerts, removePriceAlert } from "./priceAlert.service";
import { calculatePositionRisk } from "../utils/tradingSession";
import { getActiveNewsShield } from "./newsShield.service";
import {
  formatAllTimeTrackerTelegramText,
  get24hSignalReport
} from "./signalTracker.service";
import { pushActivityLog } from "./activityLog.service";

const BRAND_MOTTO = "Tez foyda emas — doimiy xotirjam, aniq savdo";

let botInstance: Bot | null = null;
let botRunning = false;

function getPublicAppUrl(): string {
  const raw = (process.env.PUBLIC_APP_URL || env.PUBLIC_APP_URL || "https://cryptoquant-copilot.onrender.com").trim();
  return raw || "https://cryptoquant-copilot.onrender.com";
}

function isRealToken(val: string): boolean {
  const s = (val || "").trim().toLowerCase();
  return s.length > 20 && s.includes(":") && s !== "pending" && s !== "none";
}

function buildMainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("🖥️ Dashboard (Mini App)", getPublicAppUrl())
    .row()
    .text("📊 Jonli Statistika", "menu_stats")
    .text("📂 Ochiq savdolarim", "menu_positions")
    .row()
    .text("🔍 Oxirgi Signallar", "menu_signals")
    .text("⚖️ Yo'nalish (/direction)", "menu_direction")
    .row()
    .text("🔀 Rejim (/mode)", "menu_mode")
    .text("📄 PDF Hisobot", "menu_pdf")
    .row()
    .text("💎 Tariflar (Free/Pro/VIP)", "menu_plans")
    .text("⚙️ Risk Profili", "menu_risk")
    .row()
    .text("⚠️ Ogohlantirish", "menu_disclaimer");
}

function buildModeKeyboard(current: SignalMode): InlineKeyboard {
  const mark = (m: SignalMode) => (current === m ? "✅ " : "");
  return new InlineKeyboard()
    .text(`${mark("HYBRID")}🔀 HYBRID (Intraday + Swing)`, "mode_HYBRID")
    .row()
    .text(`${mark("INTRADAY")}⚡ INTRADAY (15M)`, "mode_INTRADAY")
    .text(`${mark("SWING")}🏔️ SWING (4H)`, "mode_SWING");
}

function buildDirectionKeyboard(current: DirectionFilter): InlineKeyboard {
  const mark = (d: DirectionFilter) => (current === d ? "✅ " : "");
  return new InlineKeyboard()
    .text(`${mark("BOTH")}⚖️ Ikkalasi (LONG + SHORT)`, "dir_BOTH")
    .row()
    .text(`${mark("LONG")}🟢 Faqat LONG`, "dir_LONG")
    .text(`${mark("SHORT")}🔴 Faqat SHORT (1x)`, "dir_SHORT");
}

function formatStatsText(): string {
  const s = getDemoPortfolioSummary();
  const sign = s.totalPnlUsd >= 0 ? "+" : "";
  return [
    formatAllTimeTrackerTelegramText(),
    ``,
    `📊 *Qo'lda Demo Portfel*`,
    `🔀 *Faol Rejim:* \`${getActiveSignalMode()}\` | *Yo'nalish:* ${formatDirectionFilterUz()}`,
    `💰 *Balans:* $${s.currentBalanceUsd.toFixed(2)} (Boshlang'ich: $${s.initialBalanceUsd})`,
    `📈 *Demo PnL:* ${sign}$${s.totalPnlUsd.toFixed(2)} (${sign}${s.totalPnlPct}%)`,
    `🎯 *Demo Win Rate:* ${s.winRatePct}% (${s.winningTrades} foyda / ${s.losingTrades} zarar)`,
    `📂 *Ochiq:* ${s.openTradesCount} ta | *Yopilgan:* ${s.closedTradesCount} ta | 🛡️ *MaxDD:* ${s.maxDrawdownPct}%`,
    ``,
    `_Yangilangan: ${new Date(s.updatedAt).toLocaleString("uz-UZ")}_`
  ].join("\n");
}

function formatLatestSignalsText(): string {
  const snap = getLatestPipelineSnapshot();
  if (!snap || snap.records.length === 0) {
    return "🔍 Hozircha oxirgi 5-agent skanerlash natijalari shakllanmoqda. Birozdan so'ng qayta tekshiring.";
  }

  const pulseLine = snap.marketPulse?.biasUz ?? "⚖️ Muvozanatli";
  const lines = [
    `🔍 *Oxirgi 5-Agent Tahlili (${snap.evaluatedCount} ta koin | Rejim: ${getActiveSignalMode()})*`,
    `🧭 *Bozor Pulsi:* ${pulseLine}`,
    `⚖️ *Faol yo'nalish:* ${formatDirectionFilterUz(snap.activeDirectionFilter ?? getActiveDirectionFilter())}`,
    `✅ Tasdiqlangan: ${snap.approvedCount} | ❌ Rad etilgan: ${snap.rejectedCount}`,
    ``
  ];

  for (const r of snap.records) {
    const icon = r.criticRisk.verdict === "APPROVE" ? "✅" : "❌";
    const modeTag = r.criticRisk.tradeMode === "SWING" ? "🏔️" : "⚡";
    const dirTag =
      r.technician.direction === "SHORT"
        ? "🔴 SHORT 1x"
        : r.technician.direction === "LONG"
          ? "🟢 LONG"
          : "⚪ SKIP";
    lines.push(
      `${icon}${modeTag} *${r.scout.symbol}* [${dirTag}] — ${r.criticRisk.verdict} (${r.criticRisk.confidenceScore}/100) | RSI: ${r.technician.rsi14} | R:R 1:${r.technician.riskRewardRatio}`
    );
  }
  return lines.join("\n");
}

function formatPlansText(currentTier: string): string {
  const lines = [`💎 *Obuna Tariflari* (Joriy tarifingiz: *${currentTier}*)`, ``];
  for (const p of SUBSCRIPTION_PLANS) {
    const price =
      p.priceStars === 0
        ? "Bepul ($0)"
        : `${p.priceStars} Telegram Stars (~$${p.priceUsdApprox}/${p.billingCycleUz})`;
    lines.push(`*${p.titleUz}* — ${price}`);
    for (const f of p.featuresUz) {
      lines.push(`  • ${f}`);
    }
    lines.push(``);
  }
  lines.push(`_To'lov va VIP ulanish tez orada Telegram Stars orqali avtomatik yoqiladi._`);
  return lines.join("\n");
}

async function buildOpenPositionsPayload(): Promise<{
  text: string;
  keyboard: InlineKeyboard;
}> {
  const summary = getDemoPortfolioSummary();
  if (summary.openTrades.length === 0) {
    return {
      text: "📂 *Ochiq demo pozitsiyalar yo'q.*\n\nIstalgan koinni `/buy SOL` orqali yoki signal ostidagi `🛒 Demoda sotib olish ($100)` tugmasi bilan ochishingiz mumkin.",
      keyboard: buildMainMenu()
    };
  }

  const livePrices = await Promise.all(
    summary.openTrades.map(async (t) => {
      try {
        return await fetchMexcTickerPrice(t.symbol);
      } catch {
        return t.entryPrice;
      }
    })
  );

  const lines = [
    `📂 *Ochiq Demo Savdolarim (${summary.openTrades.length} ta)*`,
    `💰 *Demo Balans:* $${summary.currentBalanceUsd.toFixed(2)}`,
    ``
  ];

  const kb = new InlineKeyboard();

  summary.openTrades.forEach((t, idx) => {
    const live = livePrices[idx] ?? t.entryPrice;
    const rawPct =
      t.direction === "SHORT"
        ? ((t.entryPrice - live) / t.entryPrice) * 100
        : ((live - t.entryPrice) / t.entryPrice) * 100;
    const pnlPct = Number(rawPct.toFixed(2));
    const pnlUsd = Number(((t.positionSizeUsd * pnlPct) / 100).toFixed(2));
    const sign = pnlUsd >= 0 ? "+" : "";
    const pnlIcon = pnlUsd >= 0 ? "🟢" : "🔴";
    const dirTag = t.direction === "SHORT" ? "SHORT 1x" : "LONG";
    const beTag = t.breakevenActive ? " | 🛡️ Himoya faol" : "";
    const srcTag = t.source === "MANUAL" ? "Qo'lda" : "Avto";

    lines.push(
      `${pnlIcon} *${t.symbol}* (${dirTag} • ${t.tradeMode} • ${srcTag}${beTag})`,
      `  • Entry: \`${t.entryPrice}\` → Jonli: \`${live}\` | *${sign}${pnlPct}% (${sign}$${pnlUsd})*`,
      `  • TP1: \`${t.tp1Price}\` | TP2: \`${t.tp2Price}\` | SL: \`${t.stopLossPrice}\` | Hajm: $${t.positionSizeUsd}`,
      ``
    );

    kb.text(`🔴 Yopish: ${t.symbol}`, `demo_close:${t.symbol}`).row();
  });

  kb.webApp("🖥️ Dashboard (Mini App)", getPublicAppUrl());

  return { text: lines.join("\n"), keyboard: kb };
}

export function isTelegramBotRunning(): boolean {
  return botRunning;
}

export function startTelegramBot(): void {
  if (botRunning || !isRealToken(env.TELEGRAM_BOT_TOKEN)) {
    console.log("[Telegram Bot] Token not configured yet — running in headless API/Dashboard mode.");
    return;
  }

  try {
    const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

    // Stage 5.8 Personal Owner Guard (set OWNER_ONLY_MODE=false to unlock public access)
    bot.use(async (ctx, next) => {
      const ownerOnly = (process.env.OWNER_ONLY_MODE ?? "true").toLowerCase() !== "false";
      const configuredId = (env.TELEGRAM_CHANNEL_ID || "").trim();
      if (ownerOnly && /^\d{5,15}$/.test(configuredId)) {
        const senderId = String(ctx.from?.id || "");
        if (senderId !== configuredId) {
          if (ctx.callbackQuery) {
            await ctx
              .answerCallbackQuery({
                text: "🔒 Ushbu bot hozircha yopiq sinov rejimida.",
                show_alert: true
              })
              .catch(() => {});
          } else if (ctx.message) {
            await ctx.reply("🔒 Ushbu bot hozircha yopiq sinov rejimida.").catch(() => {});
          }
          return;
        }
      }
      await next();
    });

    const handleTokenCheck = async (
      ctx: {
        reply: (text: string, other?: Record<string, unknown>) => Promise<unknown>;
        replyWithPhoto: (photo: InputFile, other?: Record<string, unknown>) => Promise<unknown>;
      },
      rawSymbol: string
    ) => {
      try {
        const result = await analyzeTokenOnDemand(rawSymbol);
        const replyMarkup = buildTelegramSignalReplyMarkup(
          result.record.scout.symbol,
          result.record.technician.entryPrice
        );
        await ctx.replyWithPhoto(new InputFile(result.chartPng, `${result.symbol}-15m.png`), {
          caption: result.caption,
          parse_mode: "Markdown",
          reply_markup: replyMarkup
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Koin topilmadi";
        await ctx.reply(`❌ *${rawSymbol.toUpperCase()}* tekshiruvida xatolik: ${msg}`, {
          parse_mode: "Markdown"
        });
      }
    };

    const handleManualBuy = async (
      ctx: {
        reply: (text: string, other?: Record<string, unknown>) => Promise<unknown>;
      },
      rawSymbol: string,
      amountUsd?: number
    ) => {
      try {
        const analysis = await analyzeTokenOnDemand(rawSymbol);
        const res = openManualDemoTrade(analysis.record, amountUsd);
        if (!res.ok || !res.trade) {
          await ctx.reply(`⚠️ Sotib olib bo'lmadi: ${res.error || "Xatolik"}`, {
            parse_mode: "Markdown"
          });
          return;
        }
        const t = res.trade;
        const summary = getDemoPortfolioSummary();
        const kb = new InlineKeyboard()
          .text("📂 Ochiq savdolarim", "menu_positions")
          .text(`🔴 Yopish: ${t.symbol}`, `demo_close:${t.symbol}`)
          .row()
          .webApp("🖥️ Dashboard (Mini App)", getPublicAppUrl());

        await ctx.reply(
          [
            `✅ *DEMO POZITSIYA OCHILDI (QO'LDA)*`,
            ``,
            `🪙 *Juftlik:* \`${t.symbol}\` (${t.tradeMode})`,
            `💵 *Tikilgan hajm:* $${t.positionSizeUsd} | *Joriy balans:* $${summary.currentBalanceUsd.toFixed(2)}`,
            `🎯 *Kirish (Entry):* \`${t.entryPrice}\``,
            `✅ *TP1 (Breakeven):* \`${t.tp1Price}\``,
            `✅ *TP2 (Asosiy):* \`${t.tp2Price}\``,
            `🚀 *TP3 (Max):* \`${t.tp3Price}\``,
            `🛑 *Stop-Loss (SL):* \`${t.stopLossPrice}\``,
            ``,
            `_TP1/TP2/SL har 60 soniyada avtomatik kuzatiladi._`
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: kb }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Demo xarid xatosi";
        await ctx.reply(`❌ *${rawSymbol.toUpperCase()}* demo xaridida xatolik: ${msg}`, {
          parse_mode: "Markdown"
        });
      }
    };

    bot.command("start", async (ctx) => {
      const uid = String(ctx.from?.id ?? "unknown");
      const user = upsertSubscriber(uid, ctx.from?.username ?? null, ctx.from?.first_name ?? null);
      await ctx.reply(
        `Assalomu alaykum, *${user.firstName || "Treyder"}*! 👋\n\n*CryptoQuant-Copilot* — 5 ta mustaqil agentdan iborat MEXC Spot kripto-signal tizimiga xush kelibsiz.\n_"${BRAND_MOTTO}"_\n\n📌 Tarif: *${user.tier}* | Risk: *${user.riskProfile}* | Rejim: *${getActiveSignalMode()}*\n🔎 Koin tekshirish: \`SOL\`, \`BTC\` yoki \`/check HYPE\`\n🛒 Demo xarid: \`/buy SOL 100\` | 📂 Ochiq savdolar: \`/positions\`\n🔔 Narx eslatma: \`/alert BTC 95000\` | 🧮 Risk kalkulyator: \`/calc 500 2 100 96\``,
        { parse_mode: "Markdown", reply_markup: buildMainMenu() }
      );
    });

    bot.command("buy", async (ctx) => {
      const parts = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        await ctx.reply("🛒 Foydalanish: `/buy SOL` yoki `/buy SOL 200`", {
          parse_mode: "Markdown"
        });
        return;
      }
      const rawSym = parts[0];
      const amount = parts[1] ? Number(parts[1]) : undefined;
      await handleManualBuy(ctx, rawSym, amount);
    });

    bot.command("positions", async (ctx) => {
      const { text, keyboard } = await buildOpenPositionsPayload();
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    });

    bot.command("mode", async (ctx) => {
      const arg = (ctx.match || "").trim().toUpperCase();
      if (arg === "HYBRID" || arg === "INTRADAY" || arg === "SWING") {
        const updated = setActiveSignalMode(arg, String(ctx.from?.id ?? "unknown"));
        await ctx.reply(`✅ Signal rejimi *${updated}* ga o'zgartirildi.`, {
          parse_mode: "Markdown",
          reply_markup: buildMainMenu()
        });
        return;
      }
      const current = getActiveSignalMode();
      await ctx.reply(
        `🔀 *Signal Rejimini Tanlang* (Hozirgi: *${current}*)\n\n• *HYBRID:* Intraday (15M) + Swing (4H) signallari\n• *INTRADAY:* Faqat tezkor 15M signallar\n• *SWING:* Faqat kuchli 1H/4H trenddagi Swing signallar`,
        { parse_mode: "Markdown", reply_markup: buildModeKeyboard(current) }
      );
    });

    bot.command("direction", async (ctx) => {
      const arg = (ctx.match || "").trim().toUpperCase();
      if (arg === "BOTH" || arg === "LONG" || arg === "SHORT") {
        const updated = setActiveDirectionFilter(arg as DirectionFilter, String(ctx.from?.id ?? "unknown"));
        await ctx.reply(`✅ Yo'nalish filtri *${formatDirectionFilterUz(updated)}* ga o'zgartirildi.`, {
          parse_mode: "Markdown",
          reply_markup: buildMainMenu()
        });
        return;
      }
      const current = getActiveDirectionFilter();
      await ctx.reply(
        `⚖️ *Signal Yo'nalishini Tanlang* (Hozirgi: *${formatDirectionFilterUz(current)}*)\n\n• *⚖️ Ikkalasi:* Bozor o'sganda 🟢 LONG (Spot), tushganda 🔴 SHORT (qat'iy 1x Hedge)\n• *🟢 Faqat LONG:* Faqat Spot o'sish signallari\n• *🔴 Faqat SHORT (1x):* Faqat kredit yelkasiz 1x pasayish/hedge signallari`,
        { parse_mode: "Markdown", reply_markup: buildDirectionKeyboard(current) }
      );
    });

    bot.command("news", async (ctx) => {
      const shield = getActiveNewsShield();
      const text = shield.active
        ? `🚨 *USD MACRO NEWS SHIELD — FAOL!*\n\n📰 Tadbir: *${shield.eventTitle || "High-Impact USD News"}*\n🛡️ Holat: ${shield.reason || "Yangi signallar vaqtincha bloklangan."}`
        : `🛡️ *USD Macro News Shield — SOKIN*\n\n✅ Hozircha yuqori ta'sirli AQSh makroiqtisodiy yangiliklari (CPI/FOMC/NFP) blokirovkasi faol emas. 5-agent tizimi odatiy rejimda ishlamoqda.`;
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: buildMainMenu() });
    });

    bot.command("alert", async (ctx) => {
      const parts = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        await ctx.reply("🔔 Foydalanish: `/alert BTC 95000` yoki `/alert SOL 180.5`", {
          parse_mode: "Markdown"
        });
        return;
      }
      const rawSym = parts[0];
      const targetPrice = Number(parts[1]);
      if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
        await ctx.reply("❌ Maqsadli narx musbat son bo'lishi kerak. Masalan: `/alert SOL 180`", {
          parse_mode: "Markdown"
        });
        return;
      }
      try {
        const cleanSym = rawSym.toUpperCase().replace("/USDT", "");
        const fullSym = cleanSym.endsWith("USDT") ? cleanSym : `${cleanSym}USDT`;
        const currentPrice = await fetchMexcTickerPrice(fullSym);
        const res = addPriceAlert(fullSym, targetPrice, currentPrice);
        if (!res.ok || !res.alert) {
          await ctx.reply(`❌ ${res.error || "Narx eslatmasini qo'shib bo'lmadi."}`);
          return;
        }
        pushActivityLog(
          "ALERT",
          "INFO",
          `Yangi narx eslatma: ${res.alert.symbol} ${res.alert.direction} ${res.alert.targetPrice}`
        );
        const dirUz = res.alert.direction === "ABOVE" ? "yuqoriga o'tganda 📈" : "pastga tushganda 📉";
        await ctx.reply(
          `🔔 *Narx eslatmasi saqlandi!*\n\n🪙 Juftlik: \`${res.alert.symbol}\`\n🎯 Maqsad: \`${res.alert.targetPrice}\` (${dirUz})\n💰 Hozirgi narx: \`${currentPrice}\`\n\nBarcha eslatmalar: \`/alerts\``,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Koin narxi olinmadi";
        await ctx.reply(`❌ Eslatma qo'shishda xatolik: ${msg}`);
      }
    });

    bot.command("alerts", async (ctx) => {
      const items = listPriceAlerts();
      if (items.length === 0) {
        await ctx.reply(
          "🔔 *Faol narx eslatmalari yo'q.*\n\nYangi qo'shish: `/alert BTC 95000`",
          { parse_mode: "Markdown" }
        );
        return;
      }
      const kb = new InlineKeyboard();
      const lines = [`🔔 *Faol Shaxsiy Narx Eslatmalari (${items.length} ta)*`, ``];
      for (const a of items.slice(0, 10)) {
        const arrow = a.direction === "ABOVE" ? "📈 >=" : "📉 <=";
        lines.push(`• \`${a.symbol}\` ${arrow} \`${a.targetPrice}\``);
        kb.text(`🗑️ ${a.symbol} (${a.targetPrice})`, `del_alert:${a.id}`).row();
      }
      await ctx.reply(lines.join("\n"), { parse_mode: "Markdown", reply_markup: kb });
    });

    bot.callbackQuery(/^del_alert:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const removed = removePriceAlert(id);
      await ctx.answerCallbackQuery(removed ? "Eslatma o'chirildi" : "Topilmadi");
      if (removed) {
        await ctx.reply("🗑️ Narx eslatmasi o'chirildi.");
      }
    });

    bot.command("calc", async (ctx) => {
      const parts = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
      if (parts.length < 4) {
        await ctx.reply(
          "🧮 Foydalanish: `/calc <DEPOSIT> <RISK_PCT> <ENTRY> <SL>`\nMasalan: `/calc 500 2 100 96`",
          { parse_mode: "Markdown" }
        );
        return;
      }
      const [deposit, riskPct, entry, sl] = parts.map(Number);
      if (
        !Number.isFinite(deposit) ||
        !Number.isFinite(riskPct) ||
        !Number.isFinite(entry) ||
        !Number.isFinite(sl) ||
        deposit <= 0 ||
        riskPct <= 0 ||
        entry <= 0 ||
        sl <= 0 ||
        entry === sl
      ) {
        await ctx.reply("❌ Barcha qiymatlar musbat son bo'lishi va Entry ≠ SL bo'lishi kerak.");
        return;
      }
      const calc = calculatePositionRisk(deposit, riskPct, entry, sl);
      await ctx.reply(
        [
          `🧮 *POZITSIYA VA RISK KALKULYATORI*`,
          ``,
          `💰 *Depozit:* $${calc.depositUsd} | *Risk:* ${calc.riskPct}%`,
          `🎯 *Entry:* \`${entry}\` | 🛑 *SL:* \`${sl}\` (Masofa: *${calc.stopDistPct}%*)`,
          `🛡️ *Maksimal ruxsat etilgan zarar:* *$${calc.maxLossUsd}*`,
          `📦 *Tavsiya etilgan pozitsiya hajmi:* *$${calc.positionSizeUsd}*`,
          `🪙 *Koin miqdori:* \`${calc.coinQty}\``
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    });

    bot.command("check", async (ctx) => {
      const arg = (ctx.match || "").trim();
      if (!arg) {
        await ctx.reply("🔎 Foydalanish: `/check SOL` yoki shunchaki `BTC` deb yozing.", {
          parse_mode: "Markdown"
        });
        return;
      }
      await handleTokenCheck(ctx, arg);
    });

    bot.command("stats", async (ctx) => {
      await ctx.reply(formatStatsText(), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
    });

    bot.command("signals", async (ctx) => {
      await ctx.reply(formatLatestSignalsText(), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
    });

    bot.command("scan", async (ctx) => {
      await ctx.reply("🔍 *5-agent jonli skanerlash boshlandi...* Biroz kuting.", { parse_mode: "Markdown" });
      try {
        const snap = await triggerPipelineRunNow();
        const lines = [
          `✅ *Jonli 5-Agent Skanerlash Tugadi* (${snap.durationMs}ms | Rejim: ${snap.activeSignalMode})`,
          `📊 Tahlil: ${snap.evaluatedCount} | ✅ Tasdiqlangan: ${snap.approvedCount} | ❌ Rad etilgan: ${snap.rejectedCount}`,
          ``
        ];
        for (const r of snap.records) {
          const icon = r.criticRisk.verdict === "APPROVE" ? "✅" : "❌";
          const modeTag = r.criticRisk.tradeMode === "SWING" ? "🏔️" : "⚡";
          lines.push(
            `${icon}${modeTag} *${r.scout.symbol}* — ${r.criticRisk.verdict} (${r.criticRisk.confidenceScore}/100) | RSI: ${r.technician.rsi14} | R:R 1:${r.technician.riskRewardRatio}`
          );
        }
        await ctx.reply(lines.join("\n"), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Skanerlash xatosi";
        await ctx.reply(`❌ Skanerlashda xatolik yuz berdi: ${msg}`);
      }
    });

    bot.command("summary", async (ctx) => {
      try {
        const res = await sendDailySummaryNow();
        const sameChat = String(ctx.chat?.id ?? "") === String(env.TELEGRAM_CHANNEL_ID || "").trim();
        if (sameChat && res.sentText && res.sentPdf) {
          return;
        }
        const report24h = get24hSignalReport();
        const summary = getDemoPortfolioSummary();
        const buf = await generatePortfolioPdfBuffer(summary);
        await ctx.reply(report24h.formattedTelegramText, {
          parse_mode: "Markdown",
          reply_markup: buildMainMenu()
        });
        await ctx.replyWithDocument(new InputFile(buf, "cryptoquant-summary.pdf"), {
          caption: `📄 CryptoQuant-Copilot Kunlik Xulosa | Balans: $${summary.currentBalanceUsd.toFixed(2)} | Win Rate: ${summary.winRatePct}%`
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Xulosa xatosi";
        await ctx.reply(`❌ Kunlik xulosani tayyorlashda xatolik: ${msg}`);
      }
    });

    bot.command("plans", async (ctx) => {
      const user = upsertSubscriber(String(ctx.from?.id ?? "unknown"));
      await ctx.reply(formatPlansText(user.tier), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
    });

    bot.command("disclaimer", async (ctx) => {
      await ctx.reply(LEGAL_DISCLAIMER_UZ);
    });

    bot.command("pdf", async (ctx) => {
      const summary = getDemoPortfolioSummary();
      const buf = await generatePortfolioPdfBuffer(summary);
      await ctx.replyWithDocument(new InputFile(buf, "cryptoquant-report.pdf"), {
        caption: `📄 CryptoQuant-Copilot jonli PDF hisoboti | Balans: $${summary.currentBalanceUsd.toFixed(2)} | Win Rate: ${summary.winRatePct}%`
      });
    });

    // Positions & Manual Demo Buy/Close callbacks
    bot.callbackQuery("menu_positions", async (ctx) => {
      await ctx.answerCallbackQuery("Ochiq savdolar yuklanmoqda...");
      const { text, keyboard } = await buildOpenPositionsPayload();
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
    });

    bot.callbackQuery(/^demo_buy:([A-Z0-9]+):([0-9.]+)$/, async (ctx) => {
      const symbol = ctx.match[1];
      const amount = Number(ctx.match[2]) || 100;
      await ctx.answerCallbackQuery(`${symbol} demoda sotib olinmoqda...`);
      await handleManualBuy(ctx, symbol, amount);
    });

    bot.callbackQuery(/^demo_close:([A-Z0-9]+)$/, async (ctx) => {
      const symbol = ctx.match[1];
      await ctx.answerCallbackQuery(`${symbol} yopilmoqda...`);
      try {
        const livePrice = await fetchMexcTickerPrice(symbol);
        const res = closeDemoTradeManually(symbol, livePrice);
        if (!res.ok || !res.trade) {
          await ctx.reply(`⚠️ Yopib bo'lmadi: ${res.error || "Ochiq pozitsiya topilmadi"}`);
          return;
        }
        const t = res.trade;
        const summary = getDemoPortfolioSummary();
        const pnlUsd = t.pnlUsd ?? 0;
        const pnlPct = t.pnlPercent ?? 0;
        const sign = pnlUsd >= 0 ? "+" : "";
        const icon = pnlUsd >= 0 ? "🟢" : "🔴";

        await ctx.reply(
          [
            `${icon} *DEMO POZITSIYA QO'LDA YOPILDI*`,
            ``,
            `🪙 *Juftlik:* \`${t.symbol}\``,
            `🎯 *Entry:* \`${t.entryPrice}\` → *Exit:* \`${t.exitPrice}\``,
            `💰 *Realizatsiya PnL:* *${sign}${pnlPct}% (${sign}$${pnlUsd})*`,
            `🏦 *Yangilangan Demo Balans:* $${summary.currentBalanceUsd.toFixed(2)}`
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: buildMainMenu() }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Yopish xatosi";
        await ctx.reply(`❌ \`${symbol}\` pozitsiyasini yopishda xatolik: ${msg}`, {
          parse_mode: "Markdown"
        });
      }
    });

    // Mode & Direction switcher callbacks
    bot.callbackQuery("menu_mode", async (ctx) => {
      await ctx.answerCallbackQuery();
      const current = getActiveSignalMode();
      await ctx.reply(
        `🔀 *Signal Rejimini Tanlang* (Hozirgi: *${current}*)\n\n• *HYBRID:* Intraday (15M) + Swing (4H)\n• *INTRADAY:* Faqat 15M signallar\n• *SWING:* Faqat 1H/4H Swing signallar`,
        { parse_mode: "Markdown", reply_markup: buildModeKeyboard(current) }
      );
    });

    bot.callbackQuery(/^mode_(HYBRID|INTRADAY|SWING)$/, async (ctx) => {
      const chosen = ctx.match[1] as SignalMode;
      setActiveSignalMode(chosen, String(ctx.from?.id ?? "unknown"));
      await ctx.answerCallbackQuery(`Rejim: ${chosen}`);
      await ctx.reply(`✅ Signal rejimi *${chosen}* ga o'zgartirildi.`, {
        parse_mode: "Markdown",
        reply_markup: buildMainMenu()
      });
    });

    bot.callbackQuery("menu_direction", async (ctx) => {
      await ctx.answerCallbackQuery();
      const current = getActiveDirectionFilter();
      await ctx.reply(
        `⚖️ *Signal Yo'nalishini Tanlang* (Hozirgi: *${formatDirectionFilterUz(current)}*)\n\n• *⚖️ Ikkalasi:* Bozor o'sganda 🟢 LONG (Spot), tushganda 🔴 SHORT (qat'iy 1x Hedge)\n• *🟢 Faqat LONG:* Faqat Spot o'sish signallari\n• *🔴 Faqat SHORT (1x):* Faqat kredit yelkasiz 1x pasayish/hedge signallari`,
        { parse_mode: "Markdown", reply_markup: buildDirectionKeyboard(current) }
      );
    });

    bot.callbackQuery(/^dir_(BOTH|LONG|SHORT)$/, async (ctx) => {
      const chosen = ctx.match[1] as DirectionFilter;
      setActiveDirectionFilter(chosen, String(ctx.from?.id ?? "unknown"));
      await ctx.answerCallbackQuery(`Yo'nalish: ${chosen}`);
      await ctx.reply(`✅ Yo'nalish filtri *${formatDirectionFilterUz(chosen)}* ga o'zgartirildi.`, {
        parse_mode: "Markdown",
        reply_markup: buildMainMenu()
      });
    });

    // Interactive 2x2 signal button callbacks
    bot.callbackQuery(/^sig_refresh:([A-Z0-9]+):([0-9.]+)$/, async (ctx) => {
      const symbol = ctx.match[1];
      const entry = Number(ctx.match[2]);
      await ctx.answerCallbackQuery("Jonli narx tekshirilmoqda...");
      try {
        const livePrice = await fetchMexcTickerPrice(symbol);
        const diffPct = entry > 0 ? Number((((livePrice - entry) / entry) * 100).toFixed(2)) : 0;
        let statusLine: string;
        if (Math.abs(diffPct) <= 0.6) {
          statusLine = `✅ Kirish zonasida (ulgurasiz)`;
        } else if (diffPct > 0.6) {
          statusLine = `⚠️ Narx +${diffPct}% yuqorilab ketgan (quvmang)`;
        } else {
          statusLine = `📉 Narx ${diffPct}% pastlagan (SL darajasini tekshiring)`;
        }

        const sign = diffPct >= 0 ? "+" : "";
        const kb = new InlineKeyboard().url(
          "📈 TradingView (MEXC 15M)",
          buildTradingViewMexcUrl(symbol, "15")
        );
        await ctx.reply(
          [
            `🔄 *Jonli Narx Yangilandi — ${symbol}*`,
            ``,
            `💵 *Joriy narx:* \`${livePrice}\``,
            `🎯 *Signal Entry:* \`${entry}\` (${sign}${diffPct}%)`,
            `${statusLine}`
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: kb }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Narx olinmadi";
        await ctx.reply(`❌ \`${symbol}\` jonli narxini olishda xatolik: ${msg}`, {
          parse_mode: "Markdown"
        });
      }
    });

    bot.callbackQuery(/^sig_1h:([A-Z0-9]+)$/, async (ctx) => {
      const symbol = ctx.match[1];
      await ctx.answerCallbackQuery("1H grafik chizilmoqda...");
      try {
        const [analysis, klines1h] = await Promise.all([
          analyzeTokenOnDemand(symbol),
          fetchMexcKlines(symbol, "1h", 60)
        ]);
        const tech = analysis.record.technician;
        const critic = analysis.record.criticRisk;
        const png1h = generate15mChartPng(klines1h, {
          symbol,
          direction: tech.direction,
          entryPrice: tech.entryPrice,
          takeProfitPrice: tech.takeProfitPrice,
          stopLossPrice: tech.stopLossPrice,
          verdict: critic.verdict,
          timeframeLabel: "1H"
        });
        const kb = new InlineKeyboard().url(
          "📈 TradingView (MEXC 1H)",
          buildTradingViewMexcUrl(symbol, "60")
        );
        await ctx.replyWithPhoto(new InputFile(png1h, `${symbol}-1h.png`), {
          caption: [
            `📊 *${symbol} — 1H Grafik (${tech.direction === "SHORT" ? "MEXC 1x Hedge" : "MEXC Spot"})*`,
            `🎯 Entry: \`${tech.entryPrice}\` | ✅ TP1: \`${tech.tp1Price ?? tech.takeProfitPrice}\` | TP2: \`${tech.takeProfitPrice}\` | 🚀 TP3: \`${tech.tp3Price ?? tech.takeProfitPrice}\` | 🛑 SL: \`${tech.stopLossPrice}\``,
            `⚖️ R:R: 1:${tech.riskRewardRatio} | Joriy jonli holat: *${critic.verdict}* (${critic.confidenceScore}/100)`
          ].join("\n"),
          parse_mode: "Markdown",
          reply_markup: kb
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "1H grafik xatosi";
        await ctx.reply(`❌ \`${symbol}\` 1H grafigini chizishda xatolik: ${msg}`, {
          parse_mode: "Markdown"
        });
      }
    });

    bot.callbackQuery(/^sig_bt:([A-Z0-9]+)$/, async (ctx) => {
      const symbol = ctx.match[1];
      await ctx.answerCallbackQuery("Tarixiy backtest hisoblanmoqda...");
      try {
        const bt = await runHistoricalBacktest(symbol, 240);
        const sign = bt.netPnlPct >= 0 ? "+" : "";
        const kb = new InlineKeyboard().url(
          "📈 TradingView (MEXC 15M)",
          buildTradingViewMexcUrl(symbol, "15")
        );
        await ctx.reply(
          [
            `🧪 *Tarixiy Backtest — ${bt.symbol} (15M)*`,
            ``,
            `🕯️ *Tahlil qilingan shamlar:* ${bt.candlesAnalyzed} ta`,
            `📊 *Jami savdolar:* ${bt.totalTrades} ta (✅ ${bt.wins} foyda / 🛑 ${bt.losses} zarar)`,
            `🎯 *Win Rate:* ${bt.winRatePct}%`,
            `💰 *Sof PnL:* ${sign}${bt.netPnlPct}%`,
            `🛡️ *Max Drawdown:* ${bt.maxDrawdownPct}%`,
            ``,
            `_Tarixiy natijalar kelajakdagi foydani kafolatlamaydi._`
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: kb }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Backtest xatosi";
        await ctx.reply(`❌ \`${symbol}\` backtest xatosi: ${msg}`, {
          parse_mode: "Markdown"
        });
      }
    });

    bot.callbackQuery("menu_stats", async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.reply(formatStatsText(), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
    });

    bot.callbackQuery("menu_signals", async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.reply(formatLatestSignalsText(), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
    });

    bot.callbackQuery("menu_plans", async (ctx) => {
      await ctx.answerCallbackQuery();
      const user = upsertSubscriber(String(ctx.from?.id ?? "unknown"));
      await ctx.reply(formatPlansText(user.tier), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
    });

    bot.callbackQuery("menu_pdf", async (ctx) => {
      await ctx.answerCallbackQuery("PDF tayyorlanmoqda...");
      const summary = getDemoPortfolioSummary();
      const buf = await generatePortfolioPdfBuffer(summary);
      await ctx.replyWithDocument(new InputFile(buf, "cryptoquant-report.pdf"), {
        caption: `📄 CryptoQuant-Copilot Demo Portfel Hisoboti`
      });
    });

    bot.callbackQuery("menu_risk", async (ctx) => {
      await ctx.answerCallbackQuery();
      const kb = new InlineKeyboard()
        .text("🛡️ Konservativ", "risk_CONSERVATIVE")
        .text("⚖️ O'rtacha", "risk_MODERATE")
        .text("🔥 Faol", "risk_AGGRESSIVE");
      await ctx.reply("⚙️ *Risk profilingizni tanlang:*", { parse_mode: "Markdown", reply_markup: kb });
    });

    bot.callbackQuery(/^risk_(CONSERVATIVE|MODERATE|AGGRESSIVE)$/, async (ctx) => {
      const chosen = ctx.match[1] as RiskProfile;
      const uid = String(ctx.from?.id ?? "unknown");
      updateSubscriberRisk(uid, chosen);
      await ctx.answerCallbackQuery("Saqlandi!");
      await ctx.reply(`✅ Risk profilingiz *${chosen}* ga yangilandi.`, {
        parse_mode: "Markdown",
        reply_markup: buildMainMenu()
      });
    });

    bot.callbackQuery("menu_disclaimer", async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.reply(LEGAL_DISCLAIMER_UZ);
    });

    // Direct ticker text search (e.g., "SOL", "HYPE", "BTC", "$ETH")
    bot.on("message:text", async (ctx) => {
      const text = (ctx.message.text || "").trim();
      if (!text || text.startsWith("/")) return;
      if (!/^\$?[A-Za-z0-9]{2,12}(\/?USDT)?$/i.test(text)) return;
      await handleTokenCheck(ctx, text);
    });

    bot.catch((err) => {
      console.error("[Telegram Bot] Runtime error:", err.message);
    });

    const appUrl = getPublicAppUrl();
    bot.api
      .setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "🖥️ Dashboard",
          web_app: { url: appUrl }
        }
      })
      .catch(() => {});

    bot.api
      .setMyCommands([
        { command: "start", description: "Bosh menyu va Dashboard" },
        { command: "scan", description: "5-agent jonli skanerlash" },
        { command: "direction", description: "Yo'nalish (LONG / SHORT 1x / Ikkalasi)" },
        { command: "mode", description: "Rejim tanlash (Hybrid/Intraday/Swing)" },
        { command: "positions", description: "Ochiq demo savdolarim" },
        { command: "news", description: "USD Macro News Shield holati" },
        { command: "summary", description: "24 soatlik signal hisoboti" },
        { command: "pdf", description: "PDF demo portfel hisoboti" },
        { command: "alert", description: "Shaxsiy narx eslatma (/alert BTC 95000)" },
        { command: "calc", description: "Pozitsiya & risk kalkulyatori" }
      ])
      .catch(() => {});

    botInstance = bot;
    botRunning = true;
    bot.start().catch((err) => {
      botRunning = false;
      console.error("[Telegram Bot] Polling stopped:", err instanceof Error ? err.message : err);
    });
    console.log("[Telegram Bot] Interactive grammY bot started.");
  } catch (err) {
    botRunning = false;
    console.error("[Telegram Bot] Init failed:", err instanceof Error ? err.message : err);
  }
}

export async function stopTelegramBot(): Promise<void> {
  if (botInstance && botRunning) {
    await botInstance.stop();
    botRunning = false;
  }
}
