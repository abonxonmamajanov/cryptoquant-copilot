import { LEGAL_DISCLAIMER_UZ } from "../services/subscription.service";

export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="uz" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>CryptoQuant-Copilot — 5-Agent MEXC Spot Signal & Demo Portfel</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <style>
    body {
      background: radial-gradient(circle at top left, #0f172a 0%, #020617 60%);
      overflow-x: hidden;
    }
    .glass-card {
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.16);
      backdrop-filter: blur(12px);
    }
  </style>
</head>
<body class="min-h-screen text-slate-100 antialiased selection:bg-sky-500/30">
  <!-- Top Navbar -->
  <header class="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
    <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 text-lg font-extrabold text-slate-950 shadow-lg shadow-sky-500/20">
          CQ
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-base font-bold tracking-tight text-white sm:text-lg">CryptoQuant-Copilot</h1>
            <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
              <span class="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
              Jonli (MEXC Spot)
            </span>
          </div>
          <p class="text-[11px] text-slate-400 sm:text-xs">5-Agent Kripto-Tahlil, Signal & Demo Portfel Ekotizimi</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <a
          href="/api/reports/pdf"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-sky-500/50 hover:bg-slate-800 hover:text-white sm:text-sm"
        >
          <span>📄</span>
          <span>PDF Hisobot</span>
        </a>
        <button
          id="scanNowBtn"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-md shadow-sky-500/20 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
        >
          <span>🔍</span>
          <span id="scanBtnLabel">Hozir Skanerlash</span>
        </button>
      </div>
    </div>

    <!-- Top Tab Navigation Bar -->
    <div class="border-t border-slate-800/70 bg-slate-950/60">
      <div class="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:px-6">
        <button
          id="tabMainBtn"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-sky-500/50 bg-sky-500/15 px-3.5 py-1.5 text-xs font-semibold text-sky-300 transition sm:text-sm"
        >
          <span>📊</span>
          <span>Asosiy Dashboard</span>
        </button>
        <button
          id="tabAgentsBtn"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-transparent bg-slate-900/70 px-3.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-slate-700 hover:text-slate-200 sm:text-sm"
        >
          <span>🤖</span>
          <span>5-Agent Paneli</span>
        </button>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <!-- Toast Notification -->
    <div id="actionToast" class="hidden rounded-xl border px-4 py-3 text-xs font-medium"></div>

    <!-- Status Banner -->
    <div id="statusBar" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-400">
      <div>Holat: <span id="pipelineMeta" class="font-medium text-slate-200">Ma'lumotlar yuklanmoqda...</span></div>
      <div>Avto-yangilanish: har 30 soniyada | Oxirgi: <span id="lastUpdated" class="text-slate-200">—</span></div>
    </div>

    <!-- ==================== TAB 1: ASOSIY DASHBOARD ==================== -->
    <div id="panelMain" class="space-y-6">
      <!-- KPI Cards -->
      <section aria-label="Demo Portfel KPI">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-semibold text-white">📊 Demo Portfel Ko'rsatkichlari</h2>
          <span class="text-xs text-slate-400">Boshlang'ich balans: $1,000.00 | TP1 = Breakeven SL</span>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div class="glass-card rounded-2xl p-4">
            <div class="text-[11px] font-medium uppercase tracking-wider text-slate-400">Joriy Balans</div>
            <div id="kpiBalance" class="mt-1.5 text-xl font-bold text-white sm:text-2xl">$1,000.00</div>
            <div id="kpiPnlUsd" class="mt-1 text-xs text-slate-400">PnL: $0.00</div>
          </div>
          <div class="glass-card rounded-2xl p-4">
            <div class="text-[11px] font-medium uppercase tracking-wider text-slate-400">Umumiy PnL (%)</div>
            <div id="kpiPnlPct" class="mt-1.5 text-xl font-bold text-emerald-400 sm:text-2xl">0.00%</div>
            <div id="kpiProfitFactor" class="mt-1 text-xs text-slate-400">Profit Factor: 0</div>
          </div>
          <div class="glass-card rounded-2xl p-4">
            <div class="text-[11px] font-medium uppercase tracking-wider text-slate-400">Win Rate</div>
            <div id="kpiWinRate" class="mt-1.5 text-xl font-bold text-sky-400 sm:text-2xl">0%</div>
            <div id="kpiWinLoss" class="mt-1 text-xs text-slate-400">0 foyda / 0 zarar</div>
          </div>
          <div class="glass-card rounded-2xl p-4">
            <div class="text-[11px] font-medium uppercase tracking-wider text-slate-400">Ochiq / Yopilgan</div>
            <div id="kpiTrades" class="mt-1.5 text-xl font-bold text-white sm:text-2xl">0 / 0</div>
            <div id="kpiModes" class="mt-1 text-xs text-slate-400">Intraday 0% | Swing 0%</div>
          </div>
          <div class="glass-card col-span-2 rounded-2xl p-4 sm:col-span-1">
            <div class="text-[11px] font-medium uppercase tracking-wider text-slate-400">Max Drawdown</div>
            <div id="kpiDrawdown" class="mt-1.5 text-xl font-bold text-amber-400 sm:text-2xl">0%</div>
            <div class="mt-1 text-xs text-slate-400">2 soatlik anti-spam himoya</div>
          </div>
        </div>
      </section>

      <!-- On-Demand Token Search & 15M Chart -->
      <section class="glass-card rounded-2xl p-4 sm:p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-white">🔎 Koin Tekshirish (15M Grafik + 5-Agent + Demo Xarid)</h2>
            <p class="text-xs text-slate-400">Istalgan MEXC Spot juftligini kiriting (masalan: BTC, SOL, HYPE, SUI)</p>
          </div>
          <form id="tokenSearchForm" class="flex w-full gap-2 sm:w-auto">
            <input
              id="tokenSearchInput"
              type="text"
              placeholder="SOL, BTC, HYPE..."
              class="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3.5 py-2 text-sm uppercase text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none sm:w-48"
            />
            <button
              id="tokenSearchBtn"
              type="submit"
              class="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-60"
            >
              Tekshirish
            </button>
          </form>
        </div>
        <div id="tokenSearchResult" class="mt-4 hidden"></div>
      </section>

      <!-- Open & Closed Demo Trades -->
      <section class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <!-- Open Trades with Live Manual Close Button -->
        <div class="glass-card overflow-hidden rounded-2xl">
          <div class="border-b border-slate-800 px-5 py-4">
            <h2 class="text-base font-semibold text-white">📂 Ochiq Demo Pozitsiyalar</h2>
            <p class="text-xs text-slate-400">Avto TP1/Breakeven/TP2/SL kuzatuvi + bir klikda qo'lda yopish</p>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-800/80 text-left text-xs">
              <thead class="bg-slate-900/70 uppercase tracking-wider text-slate-400">
                <tr>
                  <th class="px-4 py-3">Juftlik</th>
                  <th class="px-3 py-3">Entry</th>
                  <th class="px-3 py-3">TP1 / TP2 / SL</th>
                  <th class="px-3 py-3">Hajm</th>
                  <th class="px-3 py-3 text-right">Amal</th>
                </tr>
              </thead>
              <tbody id="openTradesBody" class="divide-y divide-slate-800/60 text-slate-200">
                <tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">Hozircha ochiq pozitsiyalar yo'q.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent Closed Trades -->
        <div class="glass-card overflow-hidden rounded-2xl">
          <div class="border-b border-slate-800 px-5 py-4">
            <h2 class="text-base font-semibold text-white">🏁 So'nggi Yopilgan Savdolar</h2>
            <p class="text-xs text-slate-400">TP_HIT, BREAKEVEN_EXIT, MANUAL_CLOSE va SL_HIT natijalari</p>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-800/80 text-left text-xs">
              <thead class="bg-slate-900/70 uppercase tracking-wider text-slate-400">
                <tr>
                  <th class="px-4 py-3">Juftlik</th>
                  <th class="px-3 py-3">Holat</th>
                  <th class="px-3 py-3">Entry → Exit</th>
                  <th class="px-3 py-3">PnL (%)</th>
                  <th class="px-3 py-3">PnL ($)</th>
                </tr>
              </thead>
              <tbody id="closedTradesBody" class="divide-y divide-slate-800/60 text-slate-200">
                <tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">Hali yopilgan savdolar mavjud emas.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Live 5-Agent Pipeline Table -->
      <section class="glass-card overflow-hidden rounded-2xl">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-white">🧠 5-Agent Pipeline Oxirgi Tahlili</h2>
            <p class="text-xs text-slate-400">Scout → Technician → Macro &amp; Flow → Critic &amp; Risk → Executive</p>
          </div>
          <div id="pipelineCounts" class="text-xs font-medium text-slate-300">—</div>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-800/80 text-left text-sm">
            <thead class="bg-slate-900/70 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th class="px-4 py-3">Juftlik</th>
                <th class="px-3 py-3">Qaror</th>
                <th class="px-3 py-3">Ishonch</th>
                <th class="px-3 py-3">RSI</th>
                <th class="px-3 py-3">R:R</th>
                <th class="px-3 py-3">Entry / TP1 / TP2 / SL</th>
                <th class="px-3 py-3">Macro</th>
              </tr>
            </thead>
            <tbody id="pipelineTableBody" class="divide-y divide-slate-800/60 text-slate-200">
              <tr>
                <td colspan="7" class="px-5 py-8 text-center text-slate-400">5-agent ma'lumotlari yuklanmoqda...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Subscription Plans -->
      <section aria-label="Obuna Tariflari">
        <div class="mb-4">
          <h2 class="text-lg font-bold text-white">💎 Obuna Tariflari (Free / Pro / VIP)</h2>
          <p class="text-xs text-slate-400">Telegram Bot kabineti orqali boshqariladi — Telegram Stars to'lovlariga tayyor</p>
        </div>
        <div id="plansGrid" class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div class="glass-card rounded-2xl p-6 text-sm text-slate-400">Tariflar yuklanmoqda...</div>
        </div>
      </section>
    </div>

    <!-- ==================== TAB 2: 5-AGENT LIVE PANEL ==================== -->
    <div id="panelAgents" class="hidden space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-white">🤖 5-Agent Live Monitoring Paneli</h2>
          <p class="text-xs text-slate-400">Har bir agentning real vaqtdagi holati, metrikalari va oxirgi qarorlari (har 30s yangilanadi)</p>
        </div>
        <button
          id="refreshAgentsBtn"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-sky-500/60 hover:text-white"
        >
          <span>🔄</span>
          <span>Yangilash</span>
        </button>
      </div>

      <div id="agentsGrid" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="glass-card rounded-2xl p-6 text-xs text-slate-400">5-Agent telemetriyasi yuklanmoqda...</div>
      </div>
    </div>
  </main>

  <!-- Legal Disclaimer Footer -->
  <footer class="mt-10 border-t border-slate-800/80 bg-slate-950/90">
    <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <p class="text-xs leading-relaxed text-slate-400">
        ${LEGAL_DISCLAIMER_UZ} <span class="font-semibold text-slate-300">Moliyaviy maslahat emas.</span>
      </p>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>© ${new Date().getFullYear()} CryptoQuant-Copilot — 5-Agent MEXC Spot Screener</span>
        <span>Stablecoinlar &amp; ETF tokenlar avtomatik filtrlangan</span>
      </div>
    </div>
  </footer>

  <script>
    // Telegram Mini App integration
    if (window.Telegram && window.Telegram.WebApp) {
      try {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      } catch {}
    }

    function escapeHtml(val) {
      return String(val ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function showToast(msg, isError) {
      const el = document.getElementById("actionToast");
      el.textContent = msg;
      el.className = isError
        ? "rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-3 text-xs font-medium text-rose-200"
        : "rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-xs font-medium text-emerald-200";
      setTimeout(() => {
        el.className = "hidden";
      }, 6000);
    }

    // Tab switching
    const tabMainBtn = document.getElementById("tabMainBtn");
    const tabAgentsBtn = document.getElementById("tabAgentsBtn");
    const panelMain = document.getElementById("panelMain");
    const panelAgents = document.getElementById("panelAgents");

    function switchTab(tab) {
      const activeCls = "inline-flex items-center gap-2 rounded-lg border border-sky-500/50 bg-sky-500/15 px-3.5 py-1.5 text-xs font-semibold text-sky-300 transition sm:text-sm";
      const idleCls = "inline-flex items-center gap-2 rounded-lg border border-transparent bg-slate-900/70 px-3.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-slate-700 hover:text-slate-200 sm:text-sm";
      if (tab === "agents") {
        panelMain.classList.add("hidden");
        panelAgents.classList.remove("hidden");
        tabMainBtn.className = idleCls;
        tabAgentsBtn.className = activeCls;
        refreshAgentsStatus();
      } else {
        panelAgents.classList.add("hidden");
        panelMain.classList.remove("hidden");
        tabMainBtn.className = activeCls;
        tabAgentsBtn.className = idleCls;
      }
    }

    tabMainBtn.addEventListener("click", () => switchTab("main"));
    tabAgentsBtn.addEventListener("click", () => switchTab("agents"));

    async function manualDemoBuy(symbol, amountUsd) {
      try {
        const res = await fetch("/api/portfolio/buy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, amountUsd: amountUsd || 100 })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast("❌ " + (data.error || "Sotib olishda xatolik"), true);
          return;
        }
        if (data.portfolio) renderPortfolio(data.portfolio);
        showToast("✅ " + data.trade.symbol + " demoda sotib olindi ($" + data.trade.positionSizeUsd + " @ " + data.trade.entryPrice + ")", false);
      } catch (err) {
        showToast("❌ " + err.message, true);
      }
    }

    async function manualDemoClose(symbol) {
      try {
        const res = await fetch("/api/portfolio/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast("❌ " + (data.error || "Yopishda xatolik"), true);
          return;
        }
        if (data.portfolio) renderPortfolio(data.portfolio);
        const s = (data.trade.pnlUsd ?? 0) >= 0 ? "+" : "";
        showToast("🔴 " + data.trade.symbol + " yopildi | PnL: " + s + data.trade.pnlPercent + "% (" + s + "$" + data.trade.pnlUsd + ")", false);
      } catch (err) {
        showToast("❌ " + err.message, true);
      }
    }

    window.manualDemoClose = manualDemoClose;
    window.manualDemoBuy = manualDemoBuy;

    function renderPortfolio(p) {
      const sign = p.totalPnlUsd >= 0 ? "+" : "";
      const pnlColor = p.totalPnlUsd >= 0 ? "text-emerald-400" : "text-rose-400";

      document.getElementById("kpiBalance").textContent = "$" + Number(p.currentBalanceUsd).toFixed(2);
      document.getElementById("kpiPnlUsd").textContent = "PnL: " + sign + "$" + Number(p.totalPnlUsd).toFixed(2);
      const pnlPctEl = document.getElementById("kpiPnlPct");
      pnlPctEl.textContent = sign + Number(p.totalPnlPct).toFixed(2) + "%";
      pnlPctEl.className = "mt-1.5 text-xl font-bold sm:text-2xl " + pnlColor;

      document.getElementById("kpiProfitFactor").textContent = "Profit Factor: " + p.profitFactor;
      document.getElementById("kpiWinRate").textContent = p.winRatePct + "%";
      document.getElementById("kpiWinLoss").textContent = p.winningTrades + " foyda / " + p.losingTrades + " zarar";
      document.getElementById("kpiTrades").textContent = p.openTradesCount + " / " + p.closedTradesCount;
      if (p.intradayStats && p.swingStats) {
        document.getElementById("kpiModes").textContent =
          "Intraday " + p.intradayStats.winRatePct + "% | Swing " + p.swingStats.winRatePct + "%";
      }
      document.getElementById("kpiDrawdown").textContent = p.maxDrawdownPct + "%";

      const openBody = document.getElementById("openTradesBody");
      if (!p.openTrades || p.openTrades.length === 0) {
        openBody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">Hozircha ochiq pozitsiyalar yo\\'q.</td></tr>';
      } else {
        openBody.innerHTML = p.openTrades.map((t) => {
          const srcTag = t.source === "MANUAL"
            ? '<span class="ml-1 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">QO\\'LDA</span>'
            : '<span class="ml-1 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">AVTO</span>';
          const beTag = t.breakevenActive
            ? '<span class="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">BE</span>'
            : "";
          return \`
            <tr class="hover:bg-slate-800/40">
              <td class="px-4 py-3 font-semibold text-white">
                <div>\${escapeHtml(t.symbol)}\${srcTag}\${beTag}</div>
                <div class="text-[10px] text-slate-400">\${escapeHtml(t.tradeMode || "INTRADAY")}</div>
              </td>
              <td class="px-3 py-3 font-mono">\${escapeHtml(t.entryPrice)}</td>
              <td class="px-3 py-3 font-mono text-[11px]">
                <span class="text-emerald-300">\${escapeHtml(t.tp1Price ?? t.takeProfitPrice)}</span> /
                <span class="text-emerald-400">\${escapeHtml(t.tp2Price ?? t.takeProfitPrice)}</span> /
                <span class="text-rose-400">\${escapeHtml(t.stopLossPrice)}</span>
              </td>
              <td class="px-3 py-3 font-mono">$\${escapeHtml(t.positionSizeUsd)}</td>
              <td class="px-3 py-3 text-right">
                <button
                  type="button"
                  onclick="manualDemoClose('\${escapeHtml(t.symbol)}')"
                  class="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/30"
                >
                  🔴 Yopish
                </button>
              </td>
            </tr>\`;
        }).join("");
      }

      const closedBody = document.getElementById("closedTradesBody");
      if (!p.recentClosedTrades || p.recentClosedTrades.length === 0) {
        closedBody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">Hali yopilgan savdolar mavjud emas.</td></tr>';
      } else {
        closedBody.innerHTML = p.recentClosedTrades.map((t) => {
          const isPos = (t.pnlUsd ?? 0) >= 0;
          const badge = isPos
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            : "bg-rose-500/15 text-rose-300 border-rose-500/30";
          const s = isPos ? "+" : "";
          return \`
            <tr class="hover:bg-slate-800/40">
              <td class="px-4 py-3 font-semibold text-white">\${escapeHtml(t.symbol)}</td>
              <td class="px-3 py-3"><span class="rounded border px-2 py-0.5 text-[10px] font-semibold \${badge}">\${escapeHtml(t.status)}</span></td>
              <td class="px-3 py-3 font-mono">\${escapeHtml(t.entryPrice)} → \${escapeHtml(t.exitPrice ?? "-")}</td>
              <td class="px-3 py-3 font-mono \${isPos ? "text-emerald-400" : "text-rose-400"}">\${s}\${escapeHtml(t.pnlPercent ?? 0)}%</td>
              <td class="px-3 py-3 font-mono \${isPos ? "text-emerald-400" : "text-rose-400"}">\${s}$\${escapeHtml(t.pnlUsd ?? 0)}</td>
            </tr>\`;
        }).join("");
      }
    }

    function renderPipeline(snap) {
      if (!snap || !Array.isArray(snap.records)) return;
      document.getElementById("pipelineCounts").textContent =
        "Tahlil: " + snap.evaluatedCount + " | ✅ Tasdiq: " + snap.approvedCount + " | ❌ Rad: " + snap.rejectedCount;
      document.getElementById("pipelineMeta").textContent =
        "Mirror: " + (snap.scoutSummary?.activeMirror || "MEXC") +
        " | Skaner: " + (snap.scoutSummary?.totalUsdtPairs || 0) + " USDT (" + snap.durationMs + "ms)";
      document.getElementById("lastUpdated").textContent = new Date(snap.runAt).toLocaleTimeString("uz-UZ");

      const tbody = document.getElementById("pipelineTableBody");
      if (snap.records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400">Hozircha nomzod juftliklar topilmadi.</td></tr>';
        return;
      }

      tbody.innerHTML = snap.records.map((r) => {
        const approved = r.criticRisk.verdict === "APPROVE";
        const verdictBadge = approved
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
          : "bg-rose-500/15 text-rose-300 border-rose-500/40";
        const regimeColor = r.macroFlow.regime === "BULLISH"
          ? "text-emerald-400"
          : r.macroFlow.regime === "BEARISH"
            ? "text-rose-400"
            : "text-amber-300";

        return \`
          <tr class="transition hover:bg-slate-800/40">
            <td class="px-4 py-3">
              <div class="font-semibold text-white">\${escapeHtml(r.scout.symbol)}</div>
              <div class="text-[11px] text-slate-400">\${escapeHtml(r.criticRisk.tradeMode || "INTRADAY")} | 24s: \${r.scout.priceChange24hPct >= 0 ? "+" : ""}\${escapeHtml(r.scout.priceChange24hPct)}%</div>
            </td>
            <td class="px-3 py-3">
              <span class="inline-flex rounded-md border px-2 py-0.5 text-xs font-bold \${verdictBadge}">\${escapeHtml(r.criticRisk.verdict)}</span>
            </td>
            <td class="px-3 py-3 font-mono text-xs font-semibold">\${escapeHtml(r.criticRisk.confidenceScore)}/100</td>
            <td class="px-3 py-3 font-mono text-xs">\${escapeHtml(r.technician.rsi14)}</td>
            <td class="px-3 py-3 font-mono text-xs">1:\${escapeHtml(r.technician.riskRewardRatio)}</td>
            <td class="px-3 py-3 font-mono text-[11px]">
              <div>E: <span class="text-white">\${escapeHtml(r.technician.entryPrice)}</span> | SL: <span class="text-rose-400">\${escapeHtml(r.technician.stopLossPrice)}</span></div>
              <div>TP1: <span class="text-emerald-300">\${escapeHtml(r.technician.tp1Price ?? r.technician.takeProfitPrice)}</span> | TP2: <span class="text-emerald-400">\${escapeHtml(r.technician.tp2Price ?? r.technician.takeProfitPrice)}</span></div>
            </td>
            <td class="px-3 py-3 text-xs font-semibold \${regimeColor}">\${escapeHtml(r.macroFlow.regime)}</td>
          </tr>\`;
      }).join("");
    }

    function renderAgentsPanel(data) {
      const grid = document.getElementById("agentsGrid");
      if (!data) return;

      const s = data.scout;
      const t = data.technician;
      const m = data.macroFlow;
      const c = data.criticRisk;
      const e = data.executive;

      const agentCards = [
        {
          num: "1",
          accent: "border-sky-500/40",
          badge: "bg-sky-500/15 text-sky-300",
          name: s.name,
          role: s.roleUz,
          status: s.status,
          latency: (s.lastDurationMs || 0) + "ms",
          metrics: [
            ["Mirror", s.activeMirror || "MEXC"],
            ["USDT Juftlik", s.totalUsdtPairs],
            ["Likvid (> $1M)", s.liquidEligibleCount],
            ["Anomaliya", s.anomaliesDetected]
          ],
          itemsHtml: (s.topSymbols && s.topSymbols.length > 0)
            ? '<div class="flex flex-wrap gap-1.5">' + s.topSymbols.map((sym) => '<span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-sky-300">' + escapeHtml(sym) + '</span>').join("") + '</div>'
            : '<div class="text-xs text-slate-500">Hali skanerlash kutilmoqda...</div>'
        },
        {
          num: "2",
          accent: "border-indigo-500/40",
          badge: "bg-indigo-500/15 text-indigo-300",
          name: t.name,
          role: t.roleUz,
          status: t.status,
          latency: (t.avgLatencyMs || 0) + "ms o'rtacha",
          metrics: [
            ["Tahlil qilindi", t.analyzedCount + " ta"],
            ["Indikatorlar", "EMA9/21, RSI14, ATR"],
            ["Targets", "TP1 / TP2 / TP3"],
            ["O'rtacha vaqt", (t.avgLatencyMs || 0) + "ms"]
          ],
          itemsHtml: (t.latestSetups && t.latestSetups.length > 0)
            ? '<div class="space-y-1.5">' + t.latestSetups.map((x) =>
                '<div class="flex flex-wrap items-center justify-between gap-1 rounded-lg bg-slate-900/70 px-2.5 py-1.5 font-mono text-[11px]">' +
                '<span class="font-bold text-white">' + escapeHtml(x.symbol) + '</span>' +
                '<span class="text-slate-300">RSI ' + escapeHtml(x.rsi14) + ' | 1:' + escapeHtml(x.riskRewardRatio) + '</span>' +
                '<span class="text-emerald-400">TP1 ' + escapeHtml(x.tp1) + '</span>' +
                '</div>'
              ).join("") + '</div>'
            : '<div class="text-xs text-slate-500">Hozircha texnik tahlil yo\\'q.</div>'
        },
        {
          num: "3",
          accent: "border-amber-500/40",
          badge: "bg-amber-500/15 text-amber-300",
          name: m.name,
          role: m.roleUz,
          status: m.status,
          latency: "BTC 1s: " + (m.btcChange1hPct >= 0 ? "+" : "") + m.btcChange1hPct + "%",
          metrics: [
            ["Birjalar", (m.exchanges || []).join(" + ")],
            ["BTC 1H", (m.btcChange1hPct >= 0 ? "+" : "") + m.btcChange1hPct + "%"],
            ["Tekshiruv", (m.latestChecks || []).length + " ta"],
            ["Fundamental", "24s kesh"]
          ],
          itemsHtml: (m.latestChecks && m.latestChecks.length > 0)
            ? '<div class="space-y-1.5">' + m.latestChecks.map((x) =>
                '<div class="flex flex-wrap items-center justify-between gap-1 rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-[11px]">' +
                '<span class="font-mono font-bold text-white">' + escapeHtml(x.symbol) + '</span>' +
                '<span class="text-slate-300">1H/4H: ' + escapeHtml(x.trend1h) + '/' + escapeHtml(x.trend4h) + '</span>' +
                '<span class="text-amber-300">' + escapeHtml(x.fundamentalBadge) + '</span>' +
                '</div>'
              ).join("") + '</div>'
            : '<div class="text-xs text-slate-500">Hozircha macro tekshiruv yo\\'q.</div>'
        },
        {
          num: "4",
          accent: "border-rose-500/40",
          badge: "bg-rose-500/15 text-rose-300",
          name: c.name,
          role: c.roleUz,
          status: c.status,
          latency: c.newsShieldActive ? "🛡️ NEWS SHIELD FAOL" : "🛡️ News Shield sokin",
          metrics: [
            ["Tasdiqlangan", c.approvedCount + " ta"],
            ["Rad etilgan", c.rejectedCount + " ta"],
            ["News Shield", c.newsShieldActive ? "BLOK" : "OCHIQ"],
            ["Qoidalar", "4 Hard + Soft"]
          ],
          itemsHtml: (c.latestVerdicts && c.latestVerdicts.length > 0)
            ? '<div class="space-y-1.5">' + c.latestVerdicts.map((x) => {
                const ok = x.verdict === "APPROVE";
                return '<div class="flex flex-wrap items-center justify-between gap-1 rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-[11px]">' +
                  '<span class="font-mono font-bold text-white">' + escapeHtml(x.symbol) + ' (' + escapeHtml(x.tradeMode) + ')</span>' +
                  '<span class="font-bold ' + (ok ? "text-emerald-400" : "text-rose-400") + '">' + escapeHtml(x.verdict) + ' ' + escapeHtml(x.confidenceScore) + '/100</span>' +
                  '<span class="text-amber-300">' + escapeHtml(x.longStars) + '</span>' +
                  '</div>';
              }).join("") + '</div>'
            : '<div class="text-xs text-slate-500">Hozircha Critic qarorlari yo\\'q.</div>'
        },
        {
          num: "5",
          accent: "border-emerald-500/40 lg:col-span-2",
          badge: "bg-emerald-500/15 text-emerald-300",
          name: e.name,
          role: e.roleUz,
          status: e.status,
          latency: "Rejim: " + e.activeMode,
          metrics: [
            ["Telegram Bot", e.telegramBotRunning ? "ONLINE" : "HEADLESS"],
            ["Faol Rejim", e.activeMode],
            ["Demo Balans", "$" + Number(e.currentBalanceUsd).toFixed(2)],
            ["Win Rate", e.winRatePct + "% (" + e.openTradesCount + " ochiq / " + e.closedTradesCount + " yopilgan)"]
          ],
          itemsHtml: '<div class="text-xs text-slate-300">Oxirgi sikl: <span class="font-mono text-white">' +
            escapeHtml(e.lastRunAt ? new Date(e.lastRunAt).toLocaleString("uz-UZ") : "Kutilmoqda") +
            '</span> | Telegram 15M/1H grafiklar, Mini App va PDF hisobotlar tayyor.</div>'
        }
      ];

      grid.innerHTML = agentCards.map((card) => \`
        <div class="glass-card rounded-2xl border p-4 sm:p-5 space-y-3 \${card.accent}">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <span class="rounded-md px-2 py-0.5 text-xs font-bold \${card.badge}">#\${card.num}</span>
                <h3 class="text-sm font-bold text-white sm:text-base">\${escapeHtml(card.name)}</h3>
              </div>
              <p class="mt-1 text-xs text-slate-400">\${escapeHtml(card.role)}</p>
            </div>
            <div class="flex flex-col items-end gap-1">
              <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
                \${escapeHtml(card.status)}
              </span>
              <span class="font-mono text-[11px] text-slate-400">\${escapeHtml(card.latency)}</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            \${card.metrics.map(([k, v]) => \`
              <div class="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div class="text-[10px] uppercase tracking-wider text-slate-500">\${escapeHtml(k)}</div>
                <div class="mt-0.5 truncate font-mono text-xs font-semibold text-slate-100">\${escapeHtml(v)}</div>
              </div>\`).join("")}
          </div>

          <div class="pt-1">\${card.itemsHtml}</div>
        </div>\`).join("");
    }

    function renderPlans(data) {
      const grid = document.getElementById("plansGrid");
      if (!data || !Array.isArray(data.plans)) return;
      grid.innerHTML = data.plans.map((plan) => {
        const highlight = plan.tier === "PRO"
          ? "border-sky-500/60 ring-1 ring-sky-500/40"
          : plan.tier === "VIP"
            ? "border-amber-400/50"
            : "border-slate-800";
        const priceLabel = plan.priceStars === 0
          ? "Bepul ($0)"
          : plan.priceStars + " Stars (~$" + plan.priceUsdApprox + "/" + plan.billingCycleUz + ")";

        return \`
          <div class="glass-card flex flex-col justify-between rounded-2xl border p-5 \${highlight}">
            <div>
              <div class="flex items-center justify-between">
                <span class="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold tracking-wider text-sky-300">\${escapeHtml(plan.tier)}</span>
                <span class="text-xs text-slate-400">\${escapeHtml(plan.billingCycleUz)}</span>
              </div>
              <h3 class="mt-3 text-base font-bold text-white">\${escapeHtml(plan.titleUz)}</h3>
              <div class="mt-1 text-xl font-extrabold text-sky-400">\${escapeHtml(priceLabel)}</div>
              <ul class="mt-3 space-y-1.5 text-xs text-slate-300">
                \${plan.featuresUz.map((f) => '<li class="flex items-start gap-2"><span class="text-emerald-400">✓</span><span>' + escapeHtml(f) + '</span></li>').join("")}
              </ul>
            </div>
            <div class="mt-5 rounded-lg border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-center text-xs text-slate-300">
              Telegram Bot orqali /plans buyrug'i
            </div>
          </div>\`;
      }).join("");
    }

    async function runDashboardBacktest(symbol) {
      const box = document.getElementById("tokenBacktestBox");
      if (!box) return;
      box.classList.remove("hidden");
      box.innerHTML = '<div class="text-xs text-slate-400">🧪 Tarixiy backtest hisoblanmoqda (240 x 15M sham)...</div>';
      try {
        const res = await fetch("/api/backtest?symbol=" + encodeURIComponent(symbol) + "&limit=240");
        const bt = await res.json();
        if (!res.ok) throw new Error(bt.error || "Backtest xatosi");
        const sign = bt.netPnlPct >= 0 ? "+" : "";
        box.innerHTML = \`
          <div class="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
            <div><span class="text-slate-400">Shamlar:</span> <span class="font-semibold text-white">\${escapeHtml(bt.candlesAnalyzed)}</span></div>
            <div><span class="text-slate-400">Savdolar:</span> <span class="font-semibold text-white">\${escapeHtml(bt.totalTrades)} (\${escapeHtml(bt.wins)}W / \${escapeHtml(bt.losses)}L)</span></div>
            <div><span class="text-slate-400">Win Rate:</span> <span class="font-semibold text-sky-400">\${escapeHtml(bt.winRatePct)}%</span></div>
            <div><span class="text-slate-400">Sof PnL:</span> <span class="font-semibold \${bt.netPnlPct >= 0 ? "text-emerald-400" : "text-rose-400"}">\${sign}\${escapeHtml(bt.netPnlPct)}%</span></div>
            <div><span class="text-slate-400">Max DD:</span> <span class="font-semibold text-amber-400">\${escapeHtml(bt.maxDrawdownPct)}%</span></div>
          </div>\`;
      } catch (err) {
        box.innerHTML = '<div class="text-xs text-rose-400">❌ ' + escapeHtml(err.message) + '</div>';
      }
    }

    document.getElementById("tokenSearchForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("tokenSearchInput");
      const btn = document.getElementById("tokenSearchBtn");
      const container = document.getElementById("tokenSearchResult");
      const raw = (input.value || "").trim();
      if (!raw) return;

      btn.disabled = true;
      btn.textContent = "Tahlil...";
      container.classList.remove("hidden");
      container.innerHTML = '<div class="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">🔍 5-agent va 15M grafik tayyorlanmoqda...</div>';

      try {
        const res = await fetch("/api/token/" + encodeURIComponent(raw) + "/check");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Tekshiruvda xatolik");

        const r = data.record;
        const approved = r.criticRisk.verdict === "APPROVE";
        const badgeClass = approved
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
          : "bg-rose-500/15 text-rose-300 border-rose-500/40";
        const tvUrl = data.tradingViewUrl || ("https://www.tradingview.com/chart/?symbol=MEXC:" + encodeURIComponent(data.symbol) + "&interval=15");
        const chartSrc = "/api/token/" + encodeURIComponent(data.symbol) + "/chart.png?interval=15m&t=" + Date.now();

        container.innerHTML = \`
          <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2.5">
                <span class="text-lg font-bold text-white">\${escapeHtml(data.symbol)}</span>
                <span class="rounded-md border px-2.5 py-0.5 text-xs font-bold \${badgeClass}">\${escapeHtml(r.criticRisk.verdict)} (\${escapeHtml(r.criticRisk.confidenceScore)}/100)</span>
              </div>
              <div class="flex flex-wrap gap-3 font-mono text-xs">
                <span>Entry: <strong class="text-sky-300">\${escapeHtml(r.technician.entryPrice)}</strong></span>
                <span>TP1: <strong class="text-emerald-300">\${escapeHtml(r.technician.tp1Price ?? r.technician.takeProfitPrice)}</strong></span>
                <span>TP2: <strong class="text-emerald-400">\${escapeHtml(r.technician.takeProfitPrice)}</strong></span>
                <span>SL: <strong class="text-rose-400">\${escapeHtml(r.technician.stopLossPrice)}</strong></span>
              </div>
            </div>

            <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
              <img src="\${chartSrc}" alt="\${escapeHtml(data.symbol)} 15M Chart" class="w-full h-auto block" />
            </div>

            <div class="flex flex-wrap items-center gap-2.5">
              <button
                id="tokenDemoBuyBtn"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                <span>🛒</span>
                <span>Demoda sotib olish ($100)</span>
              </button>
              <a
                href="\${tvUrl}"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-400"
              >
                <span>📈</span>
                <span>TradingView (MEXC 15M)</span>
              </a>
              <button
                id="tokenBacktestBtn"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 transition hover:border-indigo-400 hover:bg-slate-700"
              >
                <span>🧪</span>
                <span>Backtest</span>
              </button>
              <span class="text-xs text-slate-400">RSI: \${escapeHtml(r.technician.rsi14)} | \${escapeHtml(r.macroFlow.regime)}</span>
            </div>

            <div id="tokenBacktestBox" class="hidden rounded-lg border border-slate-800 bg-slate-900/70 p-3"></div>
          </div>\`;

        document.getElementById("tokenDemoBuyBtn").addEventListener("click", () => {
          manualDemoBuy(data.symbol, 100);
        });
        document.getElementById("tokenBacktestBtn").addEventListener("click", () => {
          runDashboardBacktest(data.symbol);
        });
      } catch (err) {
        container.innerHTML = '<div class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">❌ ' + escapeHtml(err.message) + '</div>';
      } finally {
        btn.disabled = false;
        btn.textContent = "Tekshirish";
      }
    });

    async function refreshAgentsStatus() {
      try {
        const res = await fetch("/api/agents/status");
        if (res.ok) renderAgentsPanel(await res.json());
      } catch {}
    }

    async function refreshAll() {
      try {
        const [portRes, pipeRes, agentsRes] = await Promise.all([
          fetch("/api/portfolio"),
          fetch("/api/pipeline/latest"),
          fetch("/api/agents/status")
        ]);
        if (portRes.ok) renderPortfolio(await portRes.json());
        if (pipeRes.ok) renderPipeline(await pipeRes.json());
        if (agentsRes.ok) renderAgentsPanel(await agentsRes.json());
      } catch (err) {
        document.getElementById("pipelineMeta").textContent = "Yuklashda xatolik: " + err.message;
      }
    }

    async function loadPlans() {
      try {
        const res = await fetch("/api/plans");
        if (res.ok) renderPlans(await res.json());
      } catch {}
    }

    document.getElementById("refreshAgentsBtn").addEventListener("click", refreshAgentsStatus);

    document.getElementById("scanNowBtn").addEventListener("click", async () => {
      const btn = document.getElementById("scanNowBtn");
      const label = document.getElementById("scanBtnLabel");
      btn.disabled = true;
      label.textContent = "Skanerlanmoqda...";
      try {
        const res = await fetch("/api/pipeline/run", { method: "POST" });
        if (res.ok) {
          const snap = await res.json();
          renderPipeline(snap);
          if (snap.portfolioSummary) renderPortfolio(snap.portfolioSummary);
          await refreshAgentsStatus();
        }
      } finally {
        btn.disabled = false;
        label.textContent = "Hozir Skanerlash";
      }
    });

    loadPlans();
    refreshAll();
    setInterval(refreshAll, 30000);
  </script>
</body>
</html>`;
}
