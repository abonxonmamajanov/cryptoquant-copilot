import { Bot, InlineKeyboard, InputFile } from "grammy";
import { env } from "../config/env";
import { getDemoPortfolioSummary } from "./demoPortfolio.service";
import { getLatestPipelineSnapshot } from "./pipeline.service";
import { generatePortfolioPdfBuffer } from "./pdfReport.service";
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

    bot.command("start", async (ctx) => {
      const uid = String(ctx.from?.id ?? "unknown");
      const user = upsertSubscriber(uid, ctx.from?.username ?? null, ctx.from?.first_name ?? null);
      await ctx.reply(
        `Assalomu alaykum, *${user.firstName || "Treyder"}*! 👋\n\n*CryptoQuant-Copilot* — 5 ta mustaqil agentdan iborat MEXC Spot kripto-signal tizimiga xush kelibsiz.\n\n📌 Tarifingiz: *${user.tier}* | Risk profili: *${user.riskProfile}*`,
        { parse_mode: "Markdown", reply_markup: buildMainMenu() }
      );
    });

    bot.command("stats", async (ctx) => {
      await ctx.reply(formatStatsText(), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
    });

    bot.command("signals", async (ctx) => {
      await ctx.reply(formatLatestSignalsText(), { parse_mode: "Markdown", reply_markup: buildMainMenu() });
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
