import { LEGAL_DISCLAIMER_UZ } from "../services/subscription.service";

export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="uz" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CryptoQuant-Copilot — 5-Agent MEXC Spot Signal & Demo Portfel</title>
  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <style>
    body {
      background: radial-gradient(circle at top left, #0f172a 0%, #020617 60%);
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
    <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 text-lg font-extrabold text-slate-950 shadow-lg shadow-sky-500/20">
          CQ
        </div>
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-lg font-bold tracking-tight text-white">CryptoQuant-Copilot</h1>
            <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
              <span class="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
              Jonli (MEXC Spot)
            </span>
          </div>
          <p class="text-xs text-slate-400">5-Agent Kripto-Tahlil, Signal & Demo Portfel Ekotizimi</p>
        </div>
      </div>

      <div class="flex items-center gap-2.5">
        <a
          href="/api/reports/pdf"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-sm font-medium text-slate-200 transition hover:border-sky-500/50 hover:bg-slate-800 hover:text-white"
        >
          <span>📄</span>
          <span>PDF Hisobot</span>
        </a>
        <button
          id="scanNowBtn"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-md shadow-sky-500/20 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span id="scanBtnIcon">🔍</span>
          <span id="scanBtnLabel">Hozir Skanerlash</span>
        </button>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
    <!-- Status Banner -->
    <div id="statusBar" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-400">
      <div>Holat: <span id="pipelineMeta" class="font-medium text-slate-200">Ma'lumotlar yuklanmoqda...</span></div>
      <div>Avto-yangilanish: har 30 soniyada | Oxirgi yangilanish: <span id="lastUpdated" class="text-slate-200">—</span></div>
    </div>

    <!-- KPI Cards -->
    <section aria-label="Demo Portfel KPI">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-base font-semibold text-white">📊 Demo Portfel Ko'rsatkichlari</h2>
        <span class="text-xs text-slate-400">Boshlang'ich balans: $1,000.00 (10% / savdo)</span>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div class="glass-card rounded-2xl p-5">
          <div class="text-xs font-medium uppercase tracking-wider text-slate-400">Joriy Balans</div>
          <div id="kpiBalance" class="mt-2 text-2xl font-bold text-white">$1,000.00</div>
          <div id="kpiPnlUsd" class="mt-1 text-xs text-slate-400">PnL: $0.00</div>
        </div>
        <div class="glass-card rounded-2xl p-5">
          <div class="text-xs font-medium uppercase tracking-wider text-slate-400">Umumiy PnL (%)</div>
          <div id="kpiPnlPct" class="mt-2 text-2xl font-bold text-emerald-400">0.00%</div>
          <div id="kpiProfitFactor" class="mt-1 text-xs text-slate-400">Profit Factor: 0</div>
        </div>
        <div class="glass-card rounded-2xl p-5">
          <div class="text-xs font-medium uppercase tracking-wider text-slate-400">Win Rate</div>
          <div id="kpiWinRate" class="mt-2 text-2xl font-bold text-sky-400">0%</div>
          <div id="kpiWinLoss" class="mt-1 text-xs text-slate-400">0 foyda / 0 zarar</div>
        </div>
        <div class="glass-card rounded-2xl p-5">
          <div class="text-xs font-medium uppercase tracking-wider text-slate-400">Ochiq / Yopilgan</div>
          <div id="kpiTrades" class="mt-2 text-2xl font-bold text-white">0 / 0</div>
          <div class="mt-1 text-xs text-slate-400">Maks. 5 ta ochiq pozitsiya</div>
        </div>
        <div class="glass-card rounded-2xl p-5">
          <div class="text-xs font-medium uppercase tracking-wider text-slate-400">Max Drawdown</div>
          <div id="kpiDrawdown" class="mt-2 text-2xl font-bold text-amber-400">0%</div>
          <div class="mt-1 text-xs text-slate-400">2 soatlik anti-spam himoya</div>
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
              <th class="px-5 py-3">Juftlik</th>
              <th class="px-4 py-3">Qaror (Verdict)</th>
              <th class="px-4 py-3">Ishonch</th>
              <th class="px-4 py-3">RSI (14)</th>
              <th class="px-4 py-3">R:R</th>
              <th class="px-4 py-3">Entry / TP / SL</th>
              <th class="px-4 py-3">Macro Rejim</th>
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

    <!-- Open & Closed Demo Trades -->
    <section class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- Open Trades -->
      <div class="glass-card overflow-hidden rounded-2xl">
        <div class="border-b border-slate-800 px-5 py-4">
          <h2 class="text-base font-semibold text-white">📂 Ochiq Demo Pozitsiyalar</h2>
          <p class="text-xs text-slate-400">Jonli MEXC narxlari asosida TP/SL kuzatilmoqda</p>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-800/80 text-left text-xs">
            <thead class="bg-slate-900/70 uppercase tracking-wider text-slate-400">
              <tr>
                <th class="px-4 py-3">Juftlik</th>
                <th class="px-3 py-3">Entry</th>
                <th class="px-3 py-3">TP / SL</th>
                <th class="px-3 py-3">R:R</th>
                <th class="px-3 py-3">Hajm</th>
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
          <p class="text-xs text-slate-400">TP_HIT, SL_HIT va EXPIRED demo natijalari</p>
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

    <!-- Subscription Plans -->
    <section aria-label="Obuna Tariflari">
      <div class="mb-4">
        <h2 class="text-lg font-bold text-white">💎 Obuna Tariflari (Free / Pro / VIP)</h2>
        <p class="text-xs text-slate-400">Telegram Bot kabineti orqali boshqariladi — Telegram Stars to'lovlariga tayyor</p>
      </div>
      <div id="plansGrid" class="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div class="glass-card rounded-2xl p-6 text-sm text-slate-400">Tariflar yuklanmoqda...</div>
      </div>
    </section>
  </main>

  <!-- Legal Disclaimer Footer -->
  <footer class="mt-12 border-t border-slate-800/80 bg-slate-950/90">
    <div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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
    function escapeHtml(val) {
      return String(val ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function renderPortfolio(p) {
      const sign = p.totalPnlUsd >= 0 ? "+" : "";
      const pnlColor = p.totalPnlUsd >= 0 ? "text-emerald-400" : "text-rose-400";

      document.getElementById("kpiBalance").textContent = "$" + Number(p.currentBalanceUsd).toFixed(2);
      document.getElementById("kpiPnlUsd").textContent = "PnL: " + sign + "$" + Number(p.totalPnlUsd).toFixed(2);
      const pnlPctEl = document.getElementById("kpiPnlPct");
      pnlPctEl.textContent = sign + Number(p.totalPnlPct).toFixed(2) + "%";
      pnlPctEl.className = "mt-2 text-2xl font-bold " + pnlColor;

      document.getElementById("kpiProfitFactor").textContent = "Profit Factor: " + p.profitFactor;
      document.getElementById("kpiWinRate").textContent = p.winRatePct + "%";
      document.getElementById("kpiWinLoss").textContent = p.winningTrades + " foyda / " + p.losingTrades + " zarar";
      document.getElementById("kpiTrades").textContent = p.openTradesCount + " / " + p.closedTradesCount;
      document.getElementById("kpiDrawdown").textContent = p.maxDrawdownPct + "%";

      const openBody = document.getElementById("openTradesBody");
      if (!p.openTrades || p.openTrades.length === 0) {
        openBody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">Hozircha ochiq pozitsiyalar yo\\'q.</td></tr>';
      } else {
        openBody.innerHTML = p.openTrades.map((t) => \`
          <tr class="hover:bg-slate-800/40">
            <td class="px-4 py-3 font-semibold text-white">\${escapeHtml(t.symbol)}</td>
            <td class="px-3 py-3 font-mono">\${escapeHtml(t.entryPrice)}</td>
            <td class="px-3 py-3 font-mono"><span class="text-emerald-400">\${escapeHtml(t.takeProfitPrice)}</span> / <span class="text-rose-400">\${escapeHtml(t.stopLossPrice)}</span></td>
            <td class="px-3 py-3">1:\${escapeHtml(t.riskRewardRatio)}</td>
            <td class="px-3 py-3 font-mono">$\${escapeHtml(t.positionSizeUsd)}</td>
          </tr>\`).join("");
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
              <td class="px-3 py-3"><span class="rounded border px-2 py-0.5 text-[11px] font-semibold \${badge}">\${escapeHtml(t.status)}</span></td>
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
        "Tahlil: " + snap.evaluatedCount + " | ✅ Tasdiqlangan: " + snap.approvedCount + " | ❌ Rad: " + snap.rejectedCount;
      document.getElementById("pipelineMeta").textContent =
        "Mirror: " + (snap.scoutSummary?.activeMirror || "MEXC") +
        " | Skaner: " + (snap.scoutSummary?.totalUsdtPairs || 0) + " USDT juftlik (" + snap.durationMs + "ms)";
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
            <td class="px-5 py-3.5">
              <div class="font-semibold text-white">\${escapeHtml(r.scout.symbol)}</div>
              <div class="text-xs text-slate-400">24s: \${r.scout.priceChange24hPct >= 0 ? "+" : ""}\${escapeHtml(r.scout.priceChange24hPct)}% | 15m: \${escapeHtml(r.scout.volumeSpikeRatio15m)}x</div>
            </td>
            <td class="px-4 py-3.5">
              <span class="inline-flex rounded-md border px-2.5 py-1 text-xs font-bold \${verdictBadge}">\${escapeHtml(r.criticRisk.verdict)}</span>
            </td>
            <td class="px-4 py-3.5 font-mono font-semibold">\${escapeHtml(r.criticRisk.confidenceScore)}/100</td>
            <td class="px-4 py-3.5 font-mono">\${escapeHtml(r.technician.rsi14)}</td>
            <td class="px-4 py-3.5 font-mono">1:\${escapeHtml(r.technician.riskRewardRatio)}</td>
            <td class="px-4 py-3.5 font-mono text-xs">
              <div>E: <span class="text-white">\${escapeHtml(r.technician.entryPrice)}</span></div>
              <div>TP: <span class="text-emerald-400">\${escapeHtml(r.technician.takeProfitPrice)}</span> | SL: <span class="text-rose-400">\${escapeHtml(r.technician.stopLossPrice)}</span></div>
            </td>
            <td class="px-4 py-3.5 font-semibold \${regimeColor}">\${escapeHtml(r.macroFlow.regime)}</td>
          </tr>\`;
      }).join("");
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
          <div class="glass-card flex flex-col justify-between rounded-2xl border p-6 \${highlight}">
            <div>
              <div class="flex items-center justify-between">
                <span class="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold tracking-wider text-sky-300">\${escapeHtml(plan.tier)}</span>
                <span class="text-xs text-slate-400">\${escapeHtml(plan.billingCycleUz)}</span>
              </div>
              <h3 class="mt-4 text-lg font-bold text-white">\${escapeHtml(plan.titleUz)}</h3>
              <div class="mt-1 text-2xl font-extrabold text-sky-400">\${escapeHtml(priceLabel)}</div>
              <ul class="mt-4 space-y-2 text-xs text-slate-300">
                \${plan.featuresUz.map((f) => '<li class="flex items-start gap-2"><span class="text-emerald-400">✓</span><span>' + escapeHtml(f) + '</span></li>').join("")}
              </ul>
            </div>
            <div class="mt-6 rounded-lg border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-center text-xs text-slate-300">
              Telegram Bot orqali /plans buyrug'i
            </div>
          </div>\`;
      }).join("");
    }

    async function refreshAll() {
      try {
        const [portRes, pipeRes] = await Promise.all([
          fetch("/api/portfolio"),
          fetch("/api/pipeline/latest")
        ]);
        if (portRes.ok) renderPortfolio(await portRes.json());
        if (pipeRes.ok) renderPipeline(await pipeRes.json());
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
