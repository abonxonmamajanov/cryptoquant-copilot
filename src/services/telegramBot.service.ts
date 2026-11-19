import { Bot, InlineKeyboard, InputFile } from "grammy";
import { env } from "../config/env";
import { getDemoPortfolioSummary } from "./demoPortfolio.service";
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
  LEGAL_DISCLAIMER_UZ,
  RiskProfile,
  SUBSCRIPTION_PLANS,
  updateSubscriberRisk,
  upsertSubscriber
} from "./subscription.service";

let botInstance: Bot | null = null;
let botRunning = false;

function isRealToken(val: string): boolean {
  const s = (val || "").trim().toLowerCase();
  return s.length > 20 && s.includes(":") && s !== "pending" && s !== "none";
}

function buildMainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Jonli Statistika", "menu_stats")
    .text("🔍 Oxirgi Signallar", "menu_signals")
    .row()
    .text("💎 Tariflar (Free/Pro/VIP)", "menu_plans")
    .text("📄 PDF Hisobot", "menu_pdf")
    .row()
    .text("⚙️ Risk Profili", "menu_risk")
    .text("⚠️ Ogohlantirish", "menu_disclaimer");
}

function formatStatsText(): string {
  const s = getDemoPortfolioSummary();
  const sign = s.totalPnlUsd >= 0 ? "+" : "";
  return [
    `📊 *CryptoQuant-Copilot — Jonli Demo Statistika*`,
    ``,
    `💰 *Balans:* $${s.currentBalanceUsd.toFixed(2)} (Boshlang'ich: $${s.initialBalanceUsd})`,
    `📈 *Umumiy PnL:* ${sign}$${s.totalPnlUsd.toFixed(2)} (${sign}${s.totalPnlPct}%)`,
    `🎯 *Win Rate:* ${s.winRatePct}% (${s.winningTrades} foyda / ${s.losingTrades} zarar)`,
    `📂 *Ochiq pozitsiyalar:* ${s.openTradesCount} ta | *Yopilgan:* ${s.closedTradesCount} ta`,
    `🛡️ *Max Drawdown:* ${s.maxDrawdownPct}%`,
    ``,
    `_Yangilangan: ${new Date(s.updatedAt).toLocaleString("uz-UZ")}_`
  ].join("\n");
}

function formatLatestSignalsText(): string {
  const snap = getLatestPipelineSnapshot();
  if (!snap || snap.records.length === 0) {
    return "🔍 Hozircha oxirgi 5-agent skanerlash natijalari shakllanmoqda. Birozdan so'ng qayta tekshiring.";
  }

  const lines = [
    `🔍 *Oxirgi 5-Agent Tahlili (${snap.evaluatedCount} ta koin)*`,
    `✅ Tasdiqlangan: ${snap.approvedCount} | ❌ Rad etilgan: ${snap.rejectedCount}`,
    ``
  ];

  for (const r of snap.records) {
    const icon = r.criticRisk.verdict === "APPROVE" ? "✅" : "❌";
    lines.push(
      `${icon} *${r.scout.symbol}* — ${r.criticRisk.verdict} (${r.criticRisk.confidenceScore}/100) | RSI: ${r.technician.rsi14} | R:R 1:${r.technician.riskRewardRatio}`
    );
  }
  return lines.join("\n");
}

function formatPlansText(currentTier: string): string {
  const lines = [`💎 *Obuna Tariflari* (Joriy tarifingiz: *${currentTier}*)`, ``];
  for (const p of SUBSCRIPTION_PLANS) {
    const price = p.priceStars === 0 ? "Bepul ($0)" : `${p.priceStars} Telegram Stars (~$${p.priceUsdApprox}/${p.billingCycleUz})`;
    lines.push(`*${p.titleUz}* — ${price}`);
    for (const f of p.featuresUz) {
      lines.push(`  • ${f}`);
    }
    lines.push(``);
  }
  lines.push(`_To'lov va VIP ulanish tez orada Telegram Stars orqali avtomatik yoqiladi._`);
  return lines.join("\n");
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

    const handleTokenCheck = async (
      ctx: {
        reply: Bot["api"]["sendMessage"] extends never ? never : (text: string, other?: Record<string, unknown>) => Promise<unknown>;
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

    bot.command("start", async (ctx) => {
      const uid = String(ctx.from?.id ?? "unknown");
      const user = upsertSubscriber(uid, ctx.from?.username ?? null, ctx.from?.first_name ?? null);
      await ctx.reply(
        `Assalomu alaykum, *${user.firstName || "Treyder"}*! 👋\n\n*CryptoQuant-Copilot* — 5 ta mustaqil agentdan iborat MEXC Spot kripto-signal tizimiga xush kelibsiz.\n\n📌 Tarifingiz: *${user.tier}* | Risk profili: *${user.riskProfile}*\n🔎 Istalgan koinni tekshirish uchun \`SOL\`, \`BTC\` yoki \`/check HYPE\` yozing.`,
        { parse_mode: "Markdown", reply_markup: buildMainMenu() }
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
          `✅ *Jonli 5-Agent Skanerlash Tugadi* (${snap.durationMs}ms)`,
          `📊 Tahlil: ${snap.evaluatedCount} | ✅ Tasdiqlangan: ${snap.approvedCount} | ❌ Rad etilgan: ${snap.rejectedCount}`,
          ``
        ];
        for (const r of snap.records) {
          const icon = r.criticRisk.verdict === "APPROVE" ? "✅" : "❌";
          lines.push(
            `${icon} *${r.scout.symbol}* — ${r.criticRisk.verdict} (${r.criticRisk.confidenceScore}/100) | RSI: ${r.technician.rsi14} | R:R 1:${r.technician.riskRewardRatio}`
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
        const summary = getDemoPortfolioSummary();
        const buf = await generatePortfolioPdfBuffer(summary);
        await ctx.reply(formatStatsText(), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
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
            `🔄 *Jonli Narx Yangilandi — \`${symbol}\`*`,
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
            `📊 *\`${symbol}\` — 1H Grafik (MEXC Spot)*`,
            `🎯 Entry: \`${tech.entryPrice}\` | ✅ TP: \`${tech.takeProfitPrice}\` | 🛑 SL: \`${tech.stopLossPrice}\``,
            `⚖️ R:R: 1:${tech.riskRewardRatio} | Qaror: *${critic.verdict}* (${critic.confidenceScore}/100)`
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
            `🧪 *Tarixiy Backtest — \`${bt.symbol}\` (15M)*`,
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
