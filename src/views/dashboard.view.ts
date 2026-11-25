import { LEGAL_DISCLAIMER_UZ } from "../services/subscription.service";

const BRAND_MOTTO = "Tez foyda emas — doimiy xotirjam, aniq savdo";

export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="uz" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>CryptoQuant-Copilot | Wall Street & Neon 5-Agent Quant Terminal</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    html, body {
      background-color: #050914 !important;
      color: #e2e8f0 !important;
      overflow-x: hidden;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    body {
      background:
        radial-gradient(circle at 12% 8%, rgba(14, 165, 233, 0.14) 0%, transparent 38%),
        radial-gradient(circle at 88% 12%, rgba(168, 85, 247, 0.13) 0%, transparent 36%),
        radial-gradient(circle at 50% 95%, rgba(16, 185, 129, 0.08) 0%, transparent 45%),
        #050914 !important;
    }
    .neon-card {
      background: rgba(10, 17, 34, 0.84);
      border: 1px solid rgba(56, 189, 248, 0.18);
      box-shadow: 0 0 22px rgba(14, 165, 233, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.04);
      backdrop-filter: blur(14px);
    }
    .neon-card-emerald {
      border-color: rgba(16, 185, 129, 0.32);
      box-shadow: 0 0 24px rgba(16, 185, 129, 0.12);
    }
    .neon-card-purple {
      border-color: rgba(168, 85, 247, 0.32);
      box-shadow: 0 0 24px rgba(168, 85, 247, 0.12);
    }
    .neon-card-amber {
      border-color: rgba(245, 158, 11, 0.34);
      box-shadow: 0 0 24px rgba(245, 158, 11, 0.12);
    }
    .clock-open {
      border-color: rgba(16, 185, 129, 0.65) !important;
      background: linear-gradient(135deg, rgba(6, 78, 59, 0.45), rgba(10, 17, 34, 0.92)) !important;
      box-shadow: 0 0 24px rgba(16, 185, 129, 0.25), inset 0 0 12px rgba(16, 185, 129, 0.14);
    }
    .clock-closed {
      border-color: rgba(71, 85, 105, 0.35) !important;
      background: rgba(10, 17, 34, 0.65) !important;
      opacity: 0.72;
    }
    .tab-btn-active {
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(99, 102, 241, 0.22));
      border-color: rgba(56, 189, 248, 0.65);
      color: #7dd3fc;
      box-shadow: 0 0 16px rgba(56, 189, 248, 0.22);
    }
    .tab-btn-idle {
      background: rgba(15, 23, 42, 0.65);
      border-color: rgba(51, 65, 85, 0.5);
      color: #94a3b8;
    }
    .tab-btn-idle:hover {
      border-color: rgba(56, 189, 248, 0.4);
      color: #e2e8f0;
    }
    .custom-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
    .custom-scroll::-webkit-scrollbar-track { background: #070d1d; }
    .custom-scroll::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 9999px; }
  </style>
</head>
<body class="min-h-screen text-slate-100 antialiased selection:bg-cyan-500/30">
  <!-- TOP HEADER -->
  <header class="sticky top-0 z-40 border-b border-cyan-500/20 bg-[#050914]/92 backdrop-blur-lg">
    <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <div class="flex items-center gap-3">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-600 text-lg font-black text-slate-950 shadow-lg shadow-cyan-500/30">
          CQ
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-base font-extrabold tracking-tight text-white sm:text-lg">CryptoQuant-Copilot</h1>
            <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              <span class="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
              PRO 6.2 • Spot + 1x Hedge
            </span>
          </div>
          <p class="text-[11px] font-medium italic text-cyan-300/90 sm:text-xs">
            "${BRAND_MOTTO}"
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <a
          href="/api/reports/pdf"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-400/60 hover:text-white"
        >
          <span>📄</span>
          <span>PDF</span>
        </a>
        <button
          id="scanNowBtn"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-md shadow-cyan-500/25 transition hover:brightness-110 disabled:opacity-60"
        >
          <span>🔍</span>
          <span id="scanBtnLabel">Hozir Skanerlash</span>
        </button>
      </div>
    </div>

    <!-- 4-TAB NAVIGATION BAR -->
    <div class="border-t border-slate-800/80 bg-[#070d1c]/90">
      <div class="custom-scroll mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6">
        <button id="tabBtn_office" type="button" onclick="switchTab('office')" class="tab-btn-active shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition sm:text-sm">
          <span>🏛️</span><span>Wall Street Quant Ofisi</span>
        </button>
        <button id="tabBtn_analytics" type="button" onclick="switchTab('analytics')" class="tab-btn-idle shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition sm:text-sm">
          <span>📊</span><span>Neon Analitika &amp; Demo</span>
        </button>
        <button id="tabBtn_signals" type="button" onclick="switchTab('signals')" class="tab-btn-idle shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition sm:text-sm">
          <span>🎯</span><span>24s Signal Natijalari</span>
        </button>
        <button id="tabBtn_tools" type="button" onclick="switchTab('tools')" class="tab-btn-idle shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition sm:text-sm">
          <span>🧰</span><span>Treyder Asboblari</span>
        </button>
      </div>
    </div>
  </header>

  <main class="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
    <!-- Action Toast -->
    <div id="actionToast" class="hidden rounded-xl border px-4 py-3 text-xs font-semibold"></div>

    <!-- Live Status Ribbon -->
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-950/80 px-4 py-2 text-xs text-slate-400">
      <div class="flex flex-wrap items-center gap-3">
        <span>Holat: <strong id="pipelineMeta" class="text-cyan-300">5-agent ulanmoqda...</strong></span>
        <span id="marketPulseBadge" class="inline-flex items-center gap-1 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-300">
          🧭 Bozor Pulsi: 🟢 LONG / 🔴 SHORT 1x
        </span>
        <span id="newsShieldBadge" class="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
          🛡️ News Shield: SOKIN
        </span>
      </div>
      <div>Oxirgi yangilanish: <span id="lastUpdated" class="font-mono text-slate-200">—</span></div>
    </div>

    <!-- ================================================================== -->
    <!-- TAB 1: WALL STREET QUANT OFISI -->
    <!-- ================================================================== -->
    <section id="tabPanel_office" class="space-y-5">
      <!-- 3 Live World Session Clocks -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div id="clockCard_TOKYO" class="neon-card clock-closed rounded-2xl border p-4 transition-all">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold tracking-wider text-slate-200">🇯🇵 TOKYO</span>
            <span id="clockStatus_TOKYO" class="rounded-full px-2 py-0.5 text-[10px] font-bold">○ YOPIQ</span>
          </div>
          <div id="clockTime_TOKYO" class="mt-2 font-mono text-2xl font-black tracking-wider text-white">00:00:00</div>
          <div class="mt-1 text-[11px] text-slate-400">Osiyo sessiyasi (00:00 – 09:00 UTC)</div>
        </div>

        <div id="clockCard_LONDON" class="neon-card clock-closed rounded-2xl border p-4 transition-all">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold tracking-wider text-slate-200">🇬🇧 LONDON</span>
            <span id="clockStatus_LONDON" class="rounded-full px-2 py-0.5 text-[10px] font-bold">○ YOPIQ</span>
          </div>
          <div id="clockTime_LONDON" class="mt-2 font-mono text-2xl font-black tracking-wider text-white">00:00:00</div>
          <div class="mt-1 text-[11px] text-slate-400">Yevropa sessiyasi (07:00 – 16:00 UTC)</div>
        </div>

        <div id="clockCard_NEW_YORK" class="neon-card clock-closed rounded-2xl border p-4 transition-all">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold tracking-wider text-slate-200">🇺🇸 NEW YORK</span>
            <span id="clockStatus_NEW_YORK" class="rounded-full px-2 py-0.5 text-[10px] font-bold">○ YOPIQ</span>
          </div>
          <div id="clockTime_NEW_YORK" class="mt-2 font-mono text-2xl font-black tracking-wider text-white">00:00:00</div>
          <div class="mt-1 text-[11px] text-slate-400">Wall Street (12:00 – 21:00 UTC)</div>
        </div>
      </div>

      <!-- Wall Street Trading Floor HTML5 Canvas -->
      <div class="neon-card overflow-hidden rounded-2xl border border-cyan-500/30">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/90 bg-slate-950/75 px-4 py-3">
          <div>
            <h2 class="text-sm font-extrabold text-white sm:text-base">🏛️ Wall Street Quant Trading Floor — 5-Agent Jonli Ofisi</h2>
            <p class="text-[11px] text-slate-400">DESK 01–05: Scout, Technician, Macro &amp; Flow, Critic &amp; Risk, Executive • Real API ma'lumotlari</p>
          </div>
          <div class="flex items-center gap-2">
            <span id="sessionOverlapBadge" class="hidden rounded-full border border-amber-400/50 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300">
              🔥 Oltin soat (London + NY)
            </span>
            <button
              id="toggleAnimBtn"
              type="button"
              class="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/25"
            >
              ⚡ Animatsiya: ON
            </button>
          </div>
        </div>
        <div class="relative w-full bg-[#040812]">
          <canvas id="wallStreetCanvas" width="1160" height="470" class="block h-auto w-full"></canvas>
        </div>
      </div>

      <!-- 5-Agent Compact Telemetry Cards -->
      <div id="agentsCompactGrid" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"></div>

      <!-- Live Activity Log Stream -->
      <div class="neon-card overflow-hidden rounded-2xl">
        <div class="flex items-center justify-between border-b border-slate-800/90 px-4 py-3">
          <div>
            <h3 class="text-sm font-bold text-white">📡 Jonli Agentlar Faoliyat Jurnali (/api/logs/recent)</h3>
            <p class="text-[11px] text-slate-400">Har bir skanerlash, filtr, tracker va narx eslatmasi real vaqtda</p>
          </div>
          <button type="button" onclick="refreshLogs()" class="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-cyan-400/50 hover:text-white">
            🔄 Yangilash
          </button>
        </div>
        <div id="activityLogsList" class="custom-scroll max-h-72 divide-y divide-slate-800/60 overflow-y-auto px-4 py-2 font-mono text-xs">
          <div class="py-4 text-center text-slate-500">Jurnal yuklanmoqda...</div>
        </div>
      </div>
    </section>

    <!-- ================================================================== -->
    <!-- TAB 2: NEON ANALITIKA & DEMO -->
    <!-- ================================================================== -->
    <section id="tabPanel_analytics" class="hidden space-y-5">
      <!-- 6 Glowing Neon KPI Cards -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div class="neon-card rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Demo Balans</div>
          <div id="kpiBalance" class="mt-1.5 text-xl font-black text-white">$1,000.00</div>
          <div id="kpiPnlUsd" class="mt-1 text-[11px] text-slate-400">PnL: $0.00</div>
        </div>
        <div class="neon-card neon-card-emerald rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Umumiy PnL</div>
          <div id="kpiPnlPct" class="mt-1.5 text-xl font-black text-emerald-400">0.00%</div>
          <div class="mt-1 text-[11px] text-slate-400">Qo'lda Demo Portfel</div>
        </div>
        <div class="neon-card rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-sky-400">Win Rate</div>
          <div id="kpiWinRate" class="mt-1.5 text-xl font-black text-sky-300">0%</div>
          <div id="kpiWinLoss" class="mt-1 text-[11px] text-slate-400">0 foyda / 0 zarar</div>
        </div>
        <div class="neon-card neon-card-purple rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-purple-400">Profit Factor</div>
          <div id="kpiProfitFactor" class="mt-1.5 text-xl font-black text-purple-300">0.00</div>
          <div class="mt-1 text-[11px] text-slate-400">Min R:R 1:2.2</div>
        </div>
        <div class="neon-card rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Ochiq / Yopilgan</div>
          <div id="kpiTrades" class="mt-1.5 text-xl font-black text-white">0 / 0</div>
          <div id="kpiModes" class="mt-1 text-[11px] text-slate-400">Intraday 0% | Swing 0%</div>
        </div>
        <div class="neon-card neon-card-amber rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-amber-400">Max Drawdown</div>
          <div id="kpiDrawdown" class="mt-1.5 text-xl font-black text-amber-300">0%</div>
          <div class="mt-1 text-[11px] text-slate-400">TP1 → Breakeven</div>
        </div>
      </div>

      <!-- 3 Neon Charts Row -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div class="neon-card rounded-2xl p-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-cyan-300">🌊 Equity &amp; PnL Wave Trend</h3>
          <div class="mt-3 h-52"><canvas id="chartWaveTrend"></canvas></div>
        </div>
        <div class="neon-card rounded-2xl p-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-rose-300">🍩 SL / Rad Etish Sabablari</h3>
          <div class="mt-3 h-52"><canvas id="chartReasonsDonut"></canvas></div>
        </div>
        <div class="neon-card rounded-2xl p-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-purple-300">📶 Swing vs Intraday Natija</h3>
          <div class="mt-3 h-52"><canvas id="chartModeCompare"></canvas></div>
        </div>
      </div>

      <!-- Simplified 3-Line Token Search + Manual Demo Buy -->
      <div class="neon-card rounded-2xl p-4 sm:p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-bold text-white">🔎 Tezkor Koin Tahlili (3-Qatorli Xulosa + 15M Grafik + Demo Xarid)</h2>
            <p class="text-xs text-slate-400">Istalgan MEXC Spot juftligini kiriting (masalan: BTC, SOL, SUI, AVAX)</p>
          </div>
          <form id="tokenSearchForm" class="flex w-full gap-2 sm:w-auto">
            <input
              id="tokenSearchInput"
              type="text"
              placeholder="SOL, BTC, SUI..."
              class="w-full rounded-lg border border-cyan-500/30 bg-slate-950/90 px-3.5 py-2 text-sm uppercase text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none sm:w-48"
            />
            <button
              id="tokenSearchBtn"
              type="submit"
              class="shrink-0 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              Tekshirish
            </button>
          </form>
        </div>
        <div id="tokenSearchResult" class="mt-4 hidden"></div>
      </div>

      <!-- Open & Closed Demo Trades -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div class="neon-card overflow-hidden rounded-2xl">
          <div class="border-b border-slate-800 px-4 py-3.5">
            <h3 class="text-sm font-bold text-white">📂 Ochiq Demo Pozitsiyalar (100% Qo'lda)</h3>
            <p class="text-[11px] text-slate-400">Avtomatik TP1/BE/TP2/SL kuzatuvi + bir klikda 🔴 Yopish</p>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-800/80 text-left text-xs">
              <thead class="bg-slate-950/70 uppercase tracking-wider text-slate-400">
                <tr>
                  <th class="px-4 py-2.5">Juftlik</th>
                  <th class="px-3 py-2.5">Entry</th>
                  <th class="px-3 py-2.5">TP1 / TP2 / SL</th>
                  <th class="px-3 py-2.5">Hajm</th>
                  <th class="px-3 py-2.5 text-right">Amal</th>
                </tr>
              </thead>
              <tbody id="openTradesBody" class="divide-y divide-slate-800/60 text-slate-200">
                <tr><td colspan="5" class="px-4 py-6 text-center text-slate-500">Hozircha ochiq pozitsiyalar yo'q.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="neon-card overflow-hidden rounded-2xl">
          <div class="border-b border-slate-800 px-4 py-3.5">
            <h3 class="text-sm font-bold text-white">🏁 So'nggi Yopilgan Demo Savdolar</h3>
            <p class="text-[11px] text-slate-400">TP_HIT, BREAKEVEN_EXIT, MANUAL_CLOSE va SL_HIT tarixi</p>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-800/80 text-left text-xs">
              <thead class="bg-slate-950/70 uppercase tracking-wider text-slate-400">
                <tr>
                  <th class="px-4 py-2.5">Juftlik</th>
                  <th class="px-3 py-2.5">Holat</th>
                  <th class="px-3 py-2.5">Entry → Exit</th>
                  <th class="px-3 py-2.5">PnL (%)</th>
                  <th class="px-3 py-2.5">PnL ($)</th>
                </tr>
              </thead>
              <tbody id="closedTradesBody" class="divide-y divide-slate-800/60 text-slate-200">
                <tr><td colspan="5" class="px-4 py-6 text-center text-slate-500">Hali yopilgan savdolar yo'q.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Latest 5-Agent Pipeline Table -->
      <div class="neon-card overflow-hidden rounded-2xl">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3.5">
          <div>
            <h3 class="text-sm font-bold text-white">🧠 Oxirgi 5-Agent Pipeline Tahlili</h3>
            <p class="text-[11px] text-slate-400">Erta Breakout (+1.5%..+14%) &amp; FOMO himoya intizomi</p>
          </div>
          <div id="pipelineCounts" class="text-xs font-semibold text-cyan-300">—</div>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-800/80 text-left text-xs">
            <thead class="bg-slate-950/70 uppercase tracking-wider text-slate-400">
              <tr>
                <th class="px-4 py-2.5">Juftlik</th>
                <th class="px-3 py-2.5">Qaror</th>
                <th class="px-3 py-2.5">Ishonch / ⭐</th>
                <th class="px-3 py-2.5">RSI</th>
                <th class="px-3 py-2.5">R:R</th>
                <th class="px-3 py-2.5">Entry / TP1 / TP2 / SL</th>
                <th class="px-3 py-2.5">1H / 4H</th>
              </tr>
            </thead>
            <tbody id="pipelineTableBody" class="divide-y divide-slate-800/60 text-slate-200">
              <tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">Ma'lumotlar yuklanmoqda...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ================================================================== -->
    <!-- TAB 3: 24S & UMUMIY SIGNAL NATIJALARI -->
    <!-- ================================================================== -->
    <section id="tabPanel_signals" class="hidden space-y-5">
      <!-- All-Time Overall Net Signal KPI Strip -->
      <div class="neon-card neon-card-emerald rounded-2xl p-4">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
          <div>
            <h2 class="text-sm font-extrabold text-white">🏆 Umumiy Signal Tracker Sof Natijasi (Barcha Vaqt)</h2>
            <p class="text-[11px] text-slate-400">40% TP1 / 35% TP2 / 25% TP3 realizatsiya modeli + SL Circuit Breaker himoyasi</p>
          </div>
          <span id="allTimeCbBadge" class="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
            🛡️ Circuit Breaker: SOKIN
          </span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-xl border border-slate-800/90 bg-slate-950/75 p-3">
            <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Umumiy Sof PnL</div>
            <div id="allTimeNetPnl" class="mt-1 font-mono text-2xl font-black text-emerald-400">0%</div>
            <div id="allTimeAvgPnl" class="mt-0.5 text-[11px] text-slate-400">O'rtacha: 0% / signal</div>
          </div>
          <div class="rounded-xl border border-slate-800/90 bg-slate-950/75 p-3">
            <div class="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Jami Yopilgan</div>
            <div id="allTimeClosed" class="mt-1 font-mono text-2xl font-black text-white">0</div>
            <div id="allTimeSplit" class="mt-0.5 text-[11px] text-slate-400">0 TP • 0 BE • 0 SL</div>
          </div>
          <div class="rounded-xl border border-slate-800/90 bg-slate-950/75 p-3">
            <div class="text-[10px] font-bold uppercase tracking-wider text-sky-400">Umumiy Aniqlik</div>
            <div id="allTimeAccuracy" class="mt-1 font-mono text-2xl font-black text-sky-300">0%</div>
            <div id="allTimeRiskSlots" class="mt-0.5 text-[11px] text-slate-400">Risk ostida: 0 / 4</div>
          </div>
          <div class="rounded-xl border border-slate-800/90 bg-slate-950/75 p-3">
            <div class="text-[10px] font-bold uppercase tracking-wider text-purple-400">Profit Factor</div>
            <div id="allTimePf" class="mt-1 font-mono text-2xl font-black text-purple-300">0.00</div>
            <div id="allTimeMaxDd" class="mt-0.5 text-[11px] text-slate-400">MaxDD: 0%</div>
          </div>
        </div>
      </div>

      <!-- 4 Neon 24h KPI Cards -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="neon-card rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-cyan-400">24s Jami Signallar</div>
          <div id="r24Total" class="mt-1.5 text-2xl font-black text-white">0</div>
          <div class="mt-1 text-[11px] text-slate-400">Yopilgan + TP1 urilgan</div>
        </div>
        <div class="neon-card neon-card-emerald rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">24s Aniqlik</div>
          <div id="r24Accuracy" class="mt-1.5 text-2xl font-black text-emerald-400">0%</div>
          <div class="mt-1 text-[11px] text-slate-400">TP + Breakeven ulushi</div>
        </div>
        <div class="neon-card neon-card-purple rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-purple-400">TP / BE / SL</div>
          <div id="r24Breakdown" class="mt-1.5 text-2xl font-black text-purple-300">0 / 0 / 0</div>
          <div class="mt-1 text-[11px] text-slate-400">Natijalar taqsimoti</div>
        </div>
        <div class="neon-card neon-card-amber rounded-2xl p-4">
          <div class="text-[10px] font-bold uppercase tracking-wider text-amber-400">24s Sof Natija</div>
          <div id="r24NetPnl" class="mt-1.5 text-2xl font-black text-amber-300">0%</div>
          <div class="mt-1 text-[11px] text-slate-400">Koinlar bo'yicha yig'indi</div>
        </div>
      </div>

      <!-- Summary Banner -->
      <div class="neon-card rounded-2xl border-cyan-500/30 p-4">
        <div class="text-xs font-bold uppercase tracking-wider text-cyan-300">📝 24 Soatlik Qisqa Xulosa</div>
        <p id="r24SummaryUz" class="mt-1.5 text-sm text-slate-200">Hisobot yuklanmoqda...</p>
      </div>

      <!-- 2 Charts -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div class="neon-card rounded-2xl p-4 lg:col-span-2">
          <h3 class="text-xs font-bold uppercase tracking-wider text-cyan-300">📊 24s Koinlar Bo'yicha Natija (%)</h3>
          <div class="mt-3 h-56"><canvas id="chart24hCoins"></canvas></div>
        </div>
        <div class="neon-card rounded-2xl p-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-emerald-300">🎯 TP / BE / SL Ulushi</h3>
          <div class="mt-3 h-56"><canvas id="chart24hDonut"></canvas></div>
        </div>
      </div>

      <!-- Coin-by-Coin Neon List & Active Signal Tracker Cards -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div class="neon-card rounded-2xl p-4">
          <h3 class="text-sm font-bold text-white">🪙 Koinlar Kesimida (So'nggi 24 Soat)</h3>
          <div id="r24CoinList" class="mt-3 space-y-2 text-xs">
            <div class="text-slate-500">Hozircha 24s signal natijalari yo'q.</div>
          </div>
        </div>

        <div class="neon-card rounded-2xl p-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-white">📡 Faol Signal Tracker Kartalari</h3>
            <span id="trackerActiveBadge" class="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-bold text-cyan-300">0 faol</span>
          </div>
          <div id="activeTrackerCards" class="mt-3 space-y-2.5 text-xs">
            <div class="text-slate-500">Hozircha faol kuzatuvdagi signallar yo'q.</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ================================================================== -->
    <!-- TAB 4: TREYDER ASBOBLARI -->
    <!-- ================================================================== -->
    <section id="tabPanel_tools" class="hidden space-y-5">
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <!-- 1. Position & Risk Calculator -->
        <div class="neon-card rounded-2xl p-5">
          <h2 class="text-base font-bold text-white">🧮 Pozitsiya &amp; Risk Kalkulyatori</h2>
          <p class="mt-1 text-xs text-slate-400">Depozitingiz va stop-loss masofasiga qarab xavfsiz pozitsiya hajmini real vaqtda hisoblang</p>

          <div class="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label class="text-[11px] font-semibold text-slate-400">Depozit ($ USD)</label>
              <input id="calcDeposit" type="number" value="500" min="10" step="10" oninput="updateRiskCalc()" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none" />
            </div>
            <div>
              <label class="text-[11px] font-semibold text-slate-400">Risk (%)</label>
              <input id="calcRiskPct" type="number" value="2" min="0.1" max="20" step="0.5" oninput="updateRiskCalc()" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none" />
            </div>
            <div>
              <label class="text-[11px] font-semibold text-slate-400">Kirish Narxi (Entry)</label>
              <input id="calcEntry" type="number" value="100" min="0.000001" step="any" oninput="updateRiskCalc()" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none" />
            </div>
            <div>
              <label class="text-[11px] font-semibold text-slate-400">Stop-Loss (SL)</label>
              <input id="calcSl" type="number" value="96" min="0.000001" step="any" oninput="updateRiskCalc()" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white focus:border-cyan-400 focus:outline-none" />
            </div>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-cyan-500/25 bg-slate-950/80 p-3.5">
            <div>
              <div class="text-[10px] uppercase text-slate-400">Maksimal Zarar</div>
              <div id="calcOutMaxLoss" class="mt-0.5 font-mono text-lg font-black text-rose-400">$10.00</div>
            </div>
            <div>
              <div class="text-[10px] uppercase text-slate-400">Stop Masofasi</div>
              <div id="calcOutStopDist" class="mt-0.5 font-mono text-lg font-black text-amber-300">4.00%</div>
            </div>
            <div>
              <div class="text-[10px] uppercase text-slate-400">Pozitsiya Hajmi</div>
              <div id="calcOutPosSize" class="mt-0.5 font-mono text-lg font-black text-emerald-400">$250.00</div>
            </div>
            <div>
              <div class="text-[10px] uppercase text-slate-400">Koin Miqdori</div>
              <div id="calcOutCoinQty" class="mt-0.5 font-mono text-lg font-black text-cyan-300">2.5000</div>
            </div>
          </div>
        </div>

        <!-- 2. Custom Price Alerts -->
        <div class="neon-card rounded-2xl p-5">
          <h2 class="text-base font-bold text-white">🔔 Shaxsiy Narx Eslatmalari</h2>
          <p class="mt-1 text-xs text-slate-400">Narx maqsadga yetganda Telegramga darhol bildirishnoma yuboriladi (stablecoinlar bloklangan)</p>

          <form id="alertCreateForm" class="mt-4 flex flex-wrap gap-2">
            <input id="alertSymbolInput" type="text" placeholder="BTC, SOL..." required class="w-28 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none" />
            <input id="alertPriceInput" type="number" step="any" min="0.000001" placeholder="Maqsad narx" required class="w-36 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none" />
            <button id="alertAddBtn" type="submit" class="rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-500 px-4 py-2 text-xs font-extrabold text-slate-950 transition hover:brightness-110">
              + Qo'shish
            </button>
          </form>

          <div id="alertsListContainer" class="custom-scroll mt-4 max-h-56 space-y-2 overflow-y-auto text-xs">
            <div class="text-slate-500">Eslatmalar yuklanmoqda...</div>
          </div>
        </div>
      </div>

      <!-- 3. All 11 Bot Hot Commands -->
      <div class="neon-card rounded-2xl p-5">
        <h2 class="text-base font-bold text-white">⚡ Bot Qaynoq Buyruqlari (11 ta tezkor buyruq)</h2>
        <p class="mt-1 text-xs text-slate-400">Istalgan buyruqni 1 bosishda nusxalab Telegram botga yuboring</p>
        <div id="hotCommandsGrid" class="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"></div>
      </div>
    </section>
  </main>

  <!-- FOOTER -->
  <footer class="mt-10 border-t border-slate-800/80 bg-[#040711]">
    <div class="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <p class="text-xs leading-relaxed text-slate-400">
        ${LEGAL_DISCLAIMER_UZ} <span class="font-semibold text-slate-300">Moliyaviy maslahat emas.</span>
      </p>
      <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>© ${new Date().getFullYear()} CryptoQuant-Copilot PRO 6.2 • <em>"${BRAND_MOTTO}"</em></span>
        <span>100% MEXC Spot + 1x Hedge • Stablecoinlar filtrlangan • Manual Demo</span>
      </div>
    </div>
  </footer>

  <script>
    // Telegram Mini App dark-mode enforcement
    if (window.Telegram && window.Telegram.WebApp) {
      try {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
        if (window.Telegram.WebApp.setHeaderColor) window.Telegram.WebApp.setHeaderColor("#050914");
        if (window.Telegram.WebApp.setBackgroundColor) window.Telegram.WebApp.setBackgroundColor("#050914");
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
        ? "rounded-xl border border-rose-500/50 bg-rose-500/15 px-4 py-3 text-xs font-semibold text-rose-200"
        : "rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-4 py-3 text-xs font-semibold text-emerald-200";
      setTimeout(() => { el.className = "hidden"; }, 5500);
    }

    // ==================== 4-TAB SWITCHER ====================
    const TAB_IDS = ["office", "analytics", "signals", "tools"];
    let currentTab = "office";

    function switchTab(tab) {
      currentTab = tab;
      TAB_IDS.forEach((id) => {
        const panel = document.getElementById("tabPanel_" + id);
        const btn = document.getElementById("tabBtn_" + id);
        if (!panel || !btn) return;
        if (id === tab) {
          panel.classList.remove("hidden");
          btn.className = "tab-btn-active shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition sm:text-sm";
        } else {
          panel.classList.add("hidden");
          btn.className = "tab-btn-idle shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition sm:text-sm";
        }
      });
      if (tab === "signals") refreshSignals24h();
      if (tab === "tools") refreshAlerts();
      if (tab === "analytics") {
        setTimeout(() => {
          if (waveChart) waveChart.resize();
          if (reasonsChart) reasonsChart.resize();
          if (modeChart) modeChart.resize();
        }, 60);
      }
    }
    window.switchTab = switchTab;

    // ==================== 3 WORLD SESSION CLOCKS ====================
    function formatZoneTime(date, tz) {
      try {
        return new Intl.DateTimeFormat("en-GB", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        }).format(date);
      } catch {
        return date.toISOString().slice(11, 19);
      }
    }

    function updateWorldClocks() {
      const now = new Date();
      const utcH = now.getUTCHours();
      const zones = [
        { key: "TOKYO", tz: "Asia/Tokyo", open: utcH >= 0 && utcH < 9 },
        { key: "LONDON", tz: "Europe/London", open: utcH >= 7 && utcH < 16 },
        { key: "NEW_YORK", tz: "America/New_York", open: utcH >= 12 && utcH < 21 }
      ];

      zones.forEach((z) => {
        const tEl = document.getElementById("clockTime_" + z.key);
        const sEl = document.getElementById("clockStatus_" + z.key);
        const cEl = document.getElementById("clockCard_" + z.key);
        if (tEl) tEl.textContent = formatZoneTime(now, z.tz);
        if (sEl && cEl) {
          if (z.open) {
            cEl.className = "neon-card clock-open rounded-2xl border p-4 transition-all";
            sEl.className = "rounded-full bg-emerald-400/20 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-300";
            sEl.textContent = "● OCHIQ";
          } else {
            cEl.className = "neon-card clock-closed rounded-2xl border p-4 transition-all";
            sEl.className = "rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-bold text-slate-400";
            sEl.textContent = "○ YOPIQ";
          }
        }
      });

      const overlap = utcH >= 12 && utcH < 16;
      const ovBadge = document.getElementById("sessionOverlapBadge");
      if (ovBadge) ovBadge.classList.toggle("hidden", !overlap);
    }
    updateWorldClocks();
    setInterval(updateWorldClocks, 1000);

    // ==================== WALL STREET CANVAS ENGINE ====================
    let animEnabled = true;
    let floorTick = 0;
    let tickerOffset = 0;
    let liveTickerItems = [
      { symbol: "BTCUSDT", price: 0, chg: 0 },
      { symbol: "ETHUSDT", price: 0, chg: 0 },
      { symbol: "SOLUSDT", price: 0, chg: 0 }
    ];
    let liveAgentsData = null;
    let liveNewsShield = { active: false, eventTitle: null, reason: null };

    document.getElementById("toggleAnimBtn").addEventListener("click", () => {
      animEnabled = !animEnabled;
      const btn = document.getElementById("toggleAnimBtn");
      btn.textContent = animEnabled ? "⚡ Animatsiya: ON" : "⚡ Animatsiya: OFF";
      btn.className = animEnabled
        ? "rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/25"
        : "rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-400 transition hover:text-white";
      if (!animEnabled) drawWallStreetFloor();
    });

    function drawRoundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawMiniCandles(ctx, x, y, w, h, seed, accentColor, label) {
      drawRoundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = "#061022";
      ctx.fill();
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Header bar
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.fillRect(x + 2, y + 2, w - 4, 18);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 10px monospace";
      ctx.fillText(label, x + 8, y + 14);

      // Grid lines
      ctx.strokeStyle = "rgba(56, 189, 248, 0.08)";
      ctx.lineWidth = 1;
      for (let g = 1; g <= 3; g++) {
        const gy = y + 22 + ((h - 28) / 4) * g;
        ctx.beginPath();
        ctx.moveTo(x + 6, gy);
        ctx.lineTo(x + w - 6, gy);
        ctx.stroke();
      }

      // Live animated candlesticks
      const count = 18;
      const step = (w - 20) / count;
      const phase = animEnabled ? floorTick * 0.04 : 0;
      for (let i = 0; i < count; i++) {
        const v1 = Math.sin(i * 0.55 + seed + phase) * 0.32 + Math.cos(i * 0.25 + seed) * 0.2;
        const v2 = Math.sin((i + 1) * 0.55 + seed + phase) * 0.32 + Math.cos((i + 0.5) * 0.25 + seed) * 0.2;
        const midY = y + h * 0.58;
        const amp = (h - 36) * 0.65;
        const openY = midY - v1 * amp;
        const closeY = midY - v2 * amp;
        const bull = closeY <= openY;
        const cx = x + 12 + i * step;
        const highY = Math.min(openY, closeY) - 6 - ((i * 7) % 5);
        const lowY = Math.max(openY, closeY) + 6 + ((i * 5) % 5);

        ctx.strokeStyle = bull ? "#10b981" : "#f43f5e";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, Math.max(y + 23, highY));
        ctx.lineTo(cx, Math.min(y + h - 5, lowY));
        ctx.stroke();

        ctx.fillStyle = bull ? "#10b981" : "#f43f5e";
        const bodyTop = Math.min(openY, closeY);
        const bodyH = Math.max(3, Math.abs(closeY - openY));
        ctx.fillRect(cx - 3.2, bodyTop, 6.4, bodyH);
      }
    }

    function drawPottedPlant(ctx, x, y) {
      // Pot
      ctx.fillStyle = "#334155";
      ctx.beginPath();
      ctx.moveTo(x - 14, y);
      ctx.lineTo(x + 14, y);
      ctx.lineTo(x + 10, y + 24);
      ctx.lineTo(x - 10, y + 24);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#475569";
      ctx.stroke();

      // Leaves
      const leafAngles = [-0.7, -0.35, 0, 0.35, 0.7];
      leafAngles.forEach((a, idx) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + (animEnabled ? Math.sin(floorTick * 0.03 + idx) * 0.04 : 0));
        ctx.fillStyle = idx % 2 === 0 ? "#059669" : "#10b981";
        ctx.beginPath();
        ctx.ellipse(0, -18, 6, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    function drawServerRack(ctx, x, y) {
      drawRoundRect(ctx, x, y, 76, 140, 8);
      ctx.fillStyle = "#0b1326";
      ctx.fill();
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 8px monospace";
      ctx.fillText("QUANT RACK", x + 10, y + 14);

      for (let slot = 0; slot < 6; slot++) {
        const sy = y + 22 + slot * 18;
        ctx.fillStyle = "#111c36";
        ctx.fillRect(x + 7, sy, 62, 13);
        for (let led = 0; led < 4; led++) {
          const blink = animEnabled ? ((Math.floor(floorTick / 8) + slot + led) % 3 !== 0) : true;
          ctx.fillStyle = led === 3
            ? (liveNewsShield.active ? "#f43f5e" : "#f59e0b")
            : (blink ? "#10b981" : "#064e3b");
          ctx.beginPath();
          ctx.arc(x + 15 + led * 10, sy + 6.5, 2.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function drawGoldenBull(ctx, x, y) {
      // Pedestal
      drawRoundRect(ctx, x - 36, y + 18, 72, 22, 5);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Golden Bull silhouette + glow
      const shimmer = animEnabled ? 0.85 + Math.sin(floorTick * 0.08) * 0.15 : 1;
      ctx.save();
      ctx.shadowColor = "rgba(245, 158, 11, 0.65)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "rgba(251, 191, 36, " + shimmer.toFixed(2) + ")";
      // Body
      ctx.beginPath();
      ctx.ellipse(x, y + 3, 22, 12, -0.08, 0, Math.PI * 2);
      ctx.fill();
      // Head & horns
      ctx.beginPath();
      ctx.arc(x + 21, y - 3, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x + 23, y - 9);
      ctx.quadraticCurveTo(x + 31, y - 16, x + 28, y - 20);
      ctx.moveTo(x + 19, y - 9);
      ctx.quadraticCurveTo(x + 26, y - 18, x + 21, y - 21);
      ctx.stroke();
      // Legs
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#f59e0b";
      [-14, -5, 7, 15].forEach((lx) => {
        ctx.beginPath();
        ctx.moveTo(x + lx, y + 10);
        ctx.lineTo(x + lx + 2, y + 19);
        ctx.stroke();
      });
      ctx.restore();

      ctx.fillStyle = "#fde68a";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("🐂 BULL", x, y + 33);
      ctx.textAlign = "left";
    }

    function drawQuantDesk(ctx, x, y, deskNum, title, subtitle, color, metricText, isAlert) {
      // Desk glow shadow
      drawRoundRect(ctx, x, y, 200, 148, 12);
      ctx.fillStyle = isAlert ? "rgba(127, 29, 29, 0.35)" : "rgba(10, 18, 36, 0.92)";
      ctx.fill();
      ctx.strokeStyle = isAlert ? "#f43f5e" : color;
      ctx.lineWidth = isAlert ? 2.2 : 1.5;
      ctx.stroke();

      // Desk header badge
      ctx.fillStyle = isAlert ? "#fb7185" : color;
      ctx.font = "bold 10px monospace";
      ctx.fillText("DESK 0" + deskNum + " • " + title, x + 10, y + 17);

      // Triple monitors
      for (let m = 0; m < 3; m++) {
        const mx = x + 14 + m * 58;
        const my = y + 25;
        drawRoundRect(ctx, mx, my, 52, 30, 4);
        ctx.fillStyle = "#030a18";
        ctx.fill();
        ctx.strokeStyle = isAlert ? "#fb7185" : color;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Sparkline on monitor
        ctx.strokeStyle = m === 1 ? "#10b981" : color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let px = 0; px < 42; px += 6) {
          const py = my + 16 + Math.sin((px + floorTick * (animEnabled ? 1.5 : 0)) * 0.14 + deskNum + m) * 7;
          if (px === 0) ctx.moveTo(mx + 5 + px, py);
          else ctx.lineTo(mx + 5 + px, py);
        }
        ctx.stroke();
      }

      // Desk surface
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(x + 12, y + 60, 176, 8);

      // Suited Quant Trader avatar
      const bob = animEnabled ? Math.sin(floorTick * 0.08 + deskNum * 1.3) * 1.8 : 0;
      const tx = x + 100;
      const ty = y + 84 + bob;
      // Suit shoulders
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(tx, ty + 18, 22, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // White collar + neon tie
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(tx - 6, ty + 4);
      ctx.lineTo(tx + 6, ty + 4);
      ctx.lineTo(tx, ty + 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = isAlert ? "#f43f5e" : color;
      ctx.fillRect(tx - 1.5, ty + 6, 3, 12);
      // Head
      ctx.fillStyle = "#fcd34d";
      ctx.beginPath();
      ctx.arc(tx, ty - 4, 9.5, 0, Math.PI * 2);
      ctx.fill();

      // Status pulse dot
      const pulse = animEnabled ? 0.55 + Math.abs(Math.sin(floorTick * 0.1 + deskNum)) * 0.45 : 1;
      ctx.fillStyle = isAlert ? "rgba(244, 63, 94, " + pulse + ")" : "rgba(16, 185, 129, " + pulse + ")";
      ctx.beginPath();
      ctx.arc(x + 185, y + 13, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Metric bar at bottom of desk
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px sans-serif";
      ctx.fillText(subtitle.slice(0, 29), x + 10, y + 122);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 10.5px monospace";
      ctx.fillText(metricText.slice(0, 28), x + 10, y + 138);
    }

    function drawWallStreetFloor() {
      const canvas = document.getElementById("wallStreetCanvas");
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;

      // Deep dark trading floor background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, "#050b18");
      bgGrad.addColorStop(0.55, "#071124");
      bgGrad.addColorStop(1, "#040812");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Perspective floor grid
      ctx.strokeStyle = "rgba(56, 189, 248, 0.06)";
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= W; gx += 58) {
        ctx.beginPath();
        ctx.moveTo(gx, 180);
        ctx.lineTo(gx, H);
        ctx.stroke();
      }
      for (let gy = 200; gy <= H; gy += 36) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
        ctx.stroke();
      }

      // 1. LIVE SCROLLING TICKER TAPE (TOP)
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, W, 32);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
      ctx.beginPath();
      ctx.moveTo(0, 32);
      ctx.lineTo(W, 32);
      ctx.stroke();

      ctx.font = "bold 12px monospace";
      const tapeList = liveTickerItems.length > 0 ? liveTickerItems : [{ symbol: "BTCUSDT", price: 0, chg: 0 }];
      const segmentW = 215;
      const totalTapeW = tapeList.length * segmentW;
      if (animEnabled) tickerOffset = (tickerOffset + 1.1) % Math.max(totalTapeW, 215);

      for (let copy = 0; copy < 2; copy++) {
        tapeList.forEach((item, idx) => {
          const tx = idx * segmentW - tickerOffset + copy * totalTapeW + 20;
          if (tx < -220 || tx > W + 20) return;
          const up = Number(item.chg) >= 0;
          ctx.fillStyle = "#e2e8f0";
          ctx.fillText(item.symbol, tx, 20);
          ctx.fillStyle = up ? "#34d399" : "#fb7185";
          const sign = up ? "+" : "";
          ctx.fillText("$" + item.price + " (" + sign + item.chg + "%)", tx + 78, 20);
        });
      }

      // 2. QUANT SERVER RACK (LEFT) + 3 PANORAMIC WALL SCREENS + GOLDEN BULL (RIGHT)
      drawServerRack(ctx, 18, 46);

      const topSym = liveTickerItems[0]?.symbol || "BTCUSDT";
      const secondSym = liveTickerItems[1]?.symbol || "SOLUSDT";
      const thirdSym = liveTickerItems[2]?.symbol || "ETHUSDT";
      drawMiniCandles(ctx, 112, 46, 290, 140, 1.1, "#38bdf8", "📈 " + topSym + " • 15M LIVE");
      drawMiniCandles(ctx, 418, 46, 290, 140, 2.7, "#10b981", "🚀 " + secondSym + " • BREAKOUT");
      drawMiniCandles(ctx, 724, 46, 290, 140, 4.3, "#a855f7", "⚡ " + thirdSym + " • FLOW");

      drawGoldenBull(ctx, 1085, 138);
      drawPottedPlant(ctx, 1060, 425);
      drawPottedPlant(ctx, 1125, 425);

      // 3. CPI NEWS SHIELD ALARM BANNER (if active)
      if (liveNewsShield && liveNewsShield.active) {
        const flash = animEnabled ? (Math.floor(floorTick / 12) % 2 === 0) : true;
        ctx.fillStyle = flash ? "rgba(225, 29, 72, 0.88)" : "rgba(159, 18, 57, 0.72)";
        drawRoundRect(ctx, 260, 196, 640, 32, 8);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          "🚨 CPI / USD MACRO NEWS SHIELD ALARM: " + (liveNewsShield.eventTitle || "SAVDO VAQTINCHA BLOKLANDI"),
          W / 2,
          216
        );
        ctx.textAlign = "left";
      } else {
        ctx.fillStyle = "rgba(56, 189, 248, 0.75)";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          '🏛️ WALL STREET QUANT FLOOR • 5-AGENT REAL-TIME ENGINE • "${BRAND_MOTTO}"',
          W / 2,
          214
        );
        ctx.textAlign = "left";
      }

      // 4. FIVE QUANT TRADERS AT TRIPLE-MONITOR DESKS (DESK 01-05)
      const s = liveAgentsData?.scout;
      const t = liveAgentsData?.technician;
      const m = liveAgentsData?.macroFlow;
      const c = liveAgentsData?.criticRisk;
      const e = liveAgentsData?.executive;

      const desks = [
        {
          num: 1,
          title: "SCOUT",
          sub: "Erta breakout skaneri",
          color: "#38bdf8",
          metric: s ? (s.liquidEligibleCount + " juftlik | " + s.anomaliesDetected + " anom") : "Skaner tayyor",
          alert: false
        },
        {
          num: 2,
          title: "TECHNICIAN",
          sub: "RSI 44-64 • R:R >= 1:2.2",
          color: "#818cf8",
          metric: t ? (t.analyzedCount + " tahlil | " + t.avgLatencyMs + "ms") : "EMA9/21 & ATR",
          alert: false
        },
        {
          num: 3,
          title: "MACRO FLOW",
          sub: "MEXC+Binance & 1H/4H",
          color: "#f59e0b",
          metric: m ? ("BTC 1s: " + (m.btcChange1hPct >= 0 ? "+" : "") + m.btcChange1hPct + "%") : "Order Book Flow",
          alert: false
        },
        {
          num: 4,
          title: "CRITIC RISK",
          sub: "5 Hard Filter + Stars",
          color: "#fb7185",
          metric: c ? ("OK:" + c.approvedCount + " / RAD:" + c.rejectedCount) : "Risk Guard",
          alert: Boolean(liveNewsShield?.active)
        },
        {
          num: 5,
          title: "EXECUTIVE",
          sub: "Telegram + Reply Tracker",
          color: "#10b981",
          metric: e ? (e.activeMode + " | $" + Number(e.currentBalanceUsd || 1000).toFixed(0)) : "Dispatch Ready",
          alert: false
        }
      ];

      desks.forEach((d, i) => {
        const dx = 24 + i * 224;
        const dy = 240;
        drawQuantDesk(ctx, dx, dy, d.num, d.title, d.sub, d.color, d.metric, d.alert);
      });

      // Corner potted plant left
      drawPottedPlant(ctx, 42, 425);
    }

    function animateFloor() {
      if (animEnabled) {
        floorTick++;
        drawWallStreetFloor();
      }
      requestAnimationFrame(animateFloor);
    }
    drawWallStreetFloor();
    requestAnimationFrame(animateFloor);

    // ==================== CHART.JS NEON CHARTS ====================
    let waveChart = null;
    let reasonsChart = null;
    let modeChart = null;
    let coins24Chart = null;
    let donut24Chart = null;

    function updateAnalyticsCharts(portfolio, pipeline) {
      if (typeof Chart === "undefined") return;

      // 1. Dual Glowing Wave Trend Chart
      const closed = (portfolio?.recentClosedTrades || []).slice().reverse();
      const labels = closed.length > 0 ? closed.map((t, i) => t.symbol.replace("USDT", "") + "#" + (i + 1)) : ["Start", "Live"];
      let bal = Number(portfolio?.initialBalanceUsd || 1000);
      const eqData = closed.length > 0 ? closed.map((t) => { bal += Number(t.pnlUsd || 0); return Number(bal.toFixed(2)); }) : [1000, Number(portfolio?.currentBalanceUsd || 1000)];
      const pnlData = closed.length > 0 ? closed.map((t) => Number(t.pnlPercent || 0)) : [0, Number(portfolio?.totalPnlPct || 0)];

      const waveCtx = document.getElementById("chartWaveTrend");
      if (waveCtx) {
        if (waveChart) waveChart.destroy();
        waveChart = new Chart(waveCtx, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "Balans ($)",
                data: eqData,
                borderColor: "#38bdf8",
                backgroundColor: "rgba(56, 189, 248, 0.16)",
                fill: true,
                tension: 0.42,
                borderWidth: 2.5,
                yAxisID: "y"
              },
              {
                label: "Savdo PnL (%)",
                data: pnlData,
                borderColor: "#10b981",
                backgroundColor: "rgba(16, 185, 129, 0.12)",
                fill: true,
                tension: 0.42,
                borderWidth: 2,
                yAxisID: "y1"
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 10 } } } },
            scales: {
              x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(148,163,184,0.08)" } },
              y: { position: "left", ticks: { color: "#38bdf8", font: { size: 10 } }, grid: { color: "rgba(148,163,184,0.08)" } },
              y1: { position: "right", ticks: { color: "#34d399", font: { size: 10 } }, grid: { drawOnChartArea: false } }
            }
          }
        });
      }

      // 2. Neon Donut (SL / Rejection Reasons)
      const reasonMap = Object.assign({}, portfolio?.slPostMortemBreakdown || {});
      (pipeline?.records || []).forEach((r) => {
        if (r.criticRisk?.verdict === "REJECT" && r.criticRisk.reasons?.[0]) {
          const shortReason = r.criticRisk.reasons[0].slice(0, 26);
          reasonMap[shortReason] = (reasonMap[shortReason] || 0) + 1;
        }
      });
      const rKeys = Object.keys(reasonMap);
      const rVals = rKeys.map((k) => reasonMap[k]);
      const reasonsCtx = document.getElementById("chartReasonsDonut");
      if (reasonsCtx) {
        if (reasonsChart) reasonsChart.destroy();
        reasonsChart = new Chart(reasonsCtx, {
          type: "doughnut",
          data: {
            labels: rKeys.length > 0 ? rKeys : ["Sog'lom (Xatolik yo'q)"],
            datasets: [{
              data: rVals.length > 0 ? rVals : [1],
              backgroundColor: rKeys.length > 0 ? ["#f43f5e", "#f59e0b", "#a855f7", "#38bdf8", "#10b981"] : ["#10b981"],
              borderColor: "#050914",
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
            plugins: { legend: { position: "bottom", labels: { color: "#cbd5e1", font: { size: 10 }, boxWidth: 10 } } }
          }
        });
      }

      // 3. Gradient Bar Chart (Swing vs Intraday)
      const intra = portfolio?.intradayStats || { winRatePct: 0, total: 0 };
      const swing = portfolio?.swingStats || { winRatePct: 0, total: 0 };
      const modeCtx = document.getElementById("chartModeCompare");
      if (modeCtx) {
        if (modeChart) modeChart.destroy();
        modeChart = new Chart(modeCtx, {
          type: "bar",
          data: {
            labels: ["⚡ INTRADAY (15M)", "🏔️ SWING (4H)"],
            datasets: [{
              label: "Win Rate (%)",
              data: [intra.winRatePct || 0, swing.winRatePct || 0],
              backgroundColor: ["rgba(56, 189, 248, 0.78)", "rgba(168, 85, 247, 0.82)"],
              borderColor: ["#38bdf8", "#c084fc"],
              borderWidth: 1.5,
              borderRadius: 8
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 10 } } } },
            scales: {
              x: { ticks: { color: "#e2e8f0", font: { size: 11 } }, grid: { display: false } },
              y: { beginAtZero: true, max: 100, ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(148,163,184,0.08)" } }
            }
          }
        });
      }
    }

    function update24hCharts(rep) {
      if (typeof Chart === "undefined") return;
      const byCoin = rep?.byCoin || [];
      const barCtx = document.getElementById("chart24hCoins");
      if (barCtx) {
        if (coins24Chart) coins24Chart.destroy();
        coins24Chart = new Chart(barCtx, {
          type: "bar",
          data: {
            labels: byCoin.length > 0 ? byCoin.map((c) => c.symbol.replace("USDT", "")) : ["Kutilmoqda"],
            datasets: [{
              label: "Sof PnL (%)",
              data: byCoin.length > 0 ? byCoin.map((c) => c.netPnlPct) : [0],
              backgroundColor: byCoin.length > 0
                ? byCoin.map((c) => c.netPnlPct >= 0 ? "rgba(16, 185, 129, 0.82)" : "rgba(244, 63, 94, 0.82)")
                : ["rgba(56, 189, 248, 0.4)"],
              borderRadius: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 10 } } } },
            scales: {
              x: { ticks: { color: "#e2e8f0", font: { size: 10 } }, grid: { display: false } },
              y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(148,163,184,0.08)" } }
            }
          }
        });
      }

      const dCtx = document.getElementById("chart24hDonut");
      if (dCtx) {
        if (donut24Chart) donut24Chart.destroy();
        const hasAny = (rep?.tpCount || 0) + (rep?.beCount || 0) + (rep?.slCount || 0) > 0;
        donut24Chart = new Chart(dCtx, {
          type: "doughnut",
          data: {
            labels: hasAny ? ["TP (Foyda)", "Breakeven (0)", "SL (Zarar)"] : ["Hali yopilmagan"],
            datasets: [{
              data: hasAny ? [rep.tpCount, rep.beCount, rep.slCount] : [1],
              backgroundColor: hasAny ? ["#10b981", "#38bdf8", "#f43f5e"] : ["#334155"],
              borderColor: "#050914",
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
            plugins: { legend: { position: "bottom", labels: { color: "#cbd5e1", font: { size: 10 } } } }
          }
        });
      }
    }

    // ==================== RENDER FUNCTIONS ====================
    function renderCompactAgents(data) {
      liveAgentsData = data;
      const grid = document.getElementById("agentsCompactGrid");
      if (!grid || !data) return;
      const cards = [
        { tag: "DESK 01", name: data.scout.name, color: "text-cyan-300 border-cyan-500/30", val: data.scout.liquidEligibleCount + " likvid", sub: data.scout.anomaliesDetected + " erta anomaliya" },
        { tag: "DESK 02", name: data.technician.name, color: "text-indigo-300 border-indigo-500/30", val: data.technician.analyzedCount + " tahlil", sub: "RSI 44–64 | R:R >= 2.2" },
        { tag: "DESK 03", name: data.macroFlow.name, color: "text-amber-300 border-amber-500/30", val: "BTC " + (data.macroFlow.btcChange1hPct >= 0 ? "+" : "") + data.macroFlow.btcChange1hPct + "%", sub: (data.macroFlow.exchanges || []).join("+") },
        { tag: "DESK 04", name: data.criticRisk.name, color: "text-rose-300 border-rose-500/30", val: data.criticRisk.approvedCount + " OK / " + data.criticRisk.rejectedCount + " RAD", sub: data.criticRisk.newsShieldActive ? "🚨 Shield FAOL" : "🛡️ Shield Sokin" },
        { tag: "DESK 05", name: data.executive.name, color: "text-emerald-300 border-emerald-500/30", val: data.executive.activeMode, sub: "$" + Number(data.executive.currentBalanceUsd || 1000).toFixed(2) + " Demo" }
      ];
      grid.innerHTML = cards.map((c) =>
        '<div class="neon-card rounded-xl border p-3 ' + c.color + '">' +
        '<div class="flex items-center justify-between text-[10px] font-bold"><span class="opacity-80">' + escapeHtml(c.tag) + '</span><span class="text-emerald-400">● LIVE</span></div>' +
        '<div class="mt-1 text-xs font-extrabold text-white">' + escapeHtml(c.name) + '</div>' +
        '<div class="mt-1 font-mono text-sm font-black">' + escapeHtml(c.val) + '</div>' +
        '<div class="mt-0.5 text-[10px] text-slate-400">' + escapeHtml(c.sub) + '</div>' +
        '</div>'
      ).join("");
      drawWallStreetFloor();
    }

    function renderActivityLogs(logs) {
      const box = document.getElementById("activityLogsList");
      if (!box) return;
      if (!logs || logs.length === 0) {
        box.innerHTML = '<div class="py-4 text-center text-slate-500">Hozircha agent loglari yozilmagan. "Hozir Skanerlash" tugmasini bosing.</div>';
        return;
      }
      box.innerHTML = logs.map((l) => {
        const badgeCls = l.level === "SUCCESS"
          ? "bg-emerald-500/20 text-emerald-300"
          : l.level === "ALERT"
            ? "bg-rose-500/25 text-rose-300"
            : l.level === "WARN"
              ? "bg-amber-500/20 text-amber-300"
              : "bg-cyan-500/20 text-cyan-300";
        const timeStr = new Date(l.ts).toLocaleTimeString("uz-UZ");
        return '<div class="flex flex-wrap items-center gap-2 py-2">' +
          '<span class="text-slate-500">' + escapeHtml(timeStr) + '</span>' +
          '<span class="rounded px-1.5 py-0.5 text-[10px] font-bold ' + badgeCls + '">' + escapeHtml(l.agent) + '</span>' +
          '<span class="text-slate-200">' + escapeHtml(l.message) + '</span>' +
          '</div>';
      }).join("");
    }

    function renderPortfolio(p) {
      if (!p) return;
      const sign = p.totalPnlUsd >= 0 ? "+" : "";
      document.getElementById("kpiBalance").textContent = "$" + Number(p.currentBalanceUsd).toFixed(2);
      document.getElementById("kpiPnlUsd").textContent = "PnL: " + sign + "$" + Number(p.totalPnlUsd).toFixed(2);
      const pctEl = document.getElementById("kpiPnlPct");
      pctEl.textContent = sign + Number(p.totalPnlPct).toFixed(2) + "%";
      pctEl.className = "mt-1.5 text-xl font-black " + (p.totalPnlUsd >= 0 ? "text-emerald-400" : "text-rose-400");
      document.getElementById("kpiWinRate").textContent = p.winRatePct + "%";
      document.getElementById("kpiWinLoss").textContent = p.winningTrades + " foyda / " + p.losingTrades + " zarar";
      document.getElementById("kpiProfitFactor").textContent = String(p.profitFactor);
      document.getElementById("kpiTrades").textContent = p.openTradesCount + " / " + p.closedTradesCount;
      if (p.intradayStats && p.swingStats) {
        document.getElementById("kpiModes").textContent =
          "Intraday " + p.intradayStats.winRatePct + "% | Swing " + p.swingStats.winRatePct + "%";
      }
      document.getElementById("kpiDrawdown").textContent = p.maxDrawdownPct + "%";

      const openBody = document.getElementById("openTradesBody");
      if (!p.openTrades || p.openTrades.length === 0) {
        openBody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-slate-500">Hozircha ochiq pozitsiyalar yo\\'q.</td></tr>';
      } else {
        openBody.innerHTML = p.openTrades.map((t) => {
          const be = t.breakevenActive ? ' <span class="rounded bg-emerald-500/20 px-1 text-[10px] text-emerald-300">BE</span>' : "";
          const dirPill = t.direction === "SHORT"
            ? ' <span class="rounded bg-rose-500/20 px-1 text-[10px] font-bold text-rose-300">SHORT 1x</span>'
            : ' <span class="rounded bg-emerald-500/20 px-1 text-[10px] font-bold text-emerald-300">LONG</span>';
          return '<tr class="hover:bg-slate-800/40">' +
            '<td class="px-4 py-2.5 font-bold text-white">' + escapeHtml(t.symbol) + dirPill + be + '<div class="text-[10px] text-slate-400">' + escapeHtml(t.tradeMode) + '</div></td>' +
            '<td class="px-3 py-2.5 font-mono">' + escapeHtml(t.entryPrice) + '</td>' +
            '<td class="px-3 py-2.5 font-mono text-[11px]"><span class="text-emerald-300">' + escapeHtml(t.tp1Price) + '</span> / <span class="text-emerald-400">' + escapeHtml(t.tp2Price) + '</span> / <span class="text-rose-400">' + escapeHtml(t.stopLossPrice) + '</span></td>' +
            '<td class="px-3 py-2.5 font-mono">$' + escapeHtml(t.positionSizeUsd) + '</td>' +
            '<td class="px-3 py-2.5 text-right"><button type="button" onclick="manualDemoClose(\\'' + escapeHtml(t.symbol) + '\\')" class="rounded-md border border-rose-500/50 bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/30">🔴 Yopish</button></td>' +
            '</tr>';
        }).join("");
      }

      const closedBody = document.getElementById("closedTradesBody");
      if (!p.recentClosedTrades || p.recentClosedTrades.length === 0) {
        closedBody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-slate-500">Hali yopilgan savdolar yo\\'q.</td></tr>';
      } else {
        closedBody.innerHTML = p.recentClosedTrades.map((t) => {
          const pos = (t.pnlUsd ?? 0) >= 0;
          const s = pos ? "+" : "";
          const dTag = t.direction === "SHORT" ? " (SHORT 1x)" : " (LONG)";
          return '<tr class="hover:bg-slate-800/40">' +
            '<td class="px-4 py-2.5 font-bold text-white">' + escapeHtml(t.symbol) + '<span class="text-[10px] text-slate-400">' + dTag + '</span></td>' +
            '<td class="px-3 py-2.5"><span class="rounded border px-1.5 py-0.5 text-[10px] font-bold ' + (pos ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-rose-500/40 bg-rose-500/15 text-rose-300') + '">' + escapeHtml(t.status) + '</span></td>' +
            '<td class="px-3 py-2.5 font-mono">' + escapeHtml(t.entryPrice) + ' → ' + escapeHtml(t.exitPrice ?? "-") + '</td>' +
            '<td class="px-3 py-2.5 font-mono ' + (pos ? 'text-emerald-400' : 'text-rose-400') + '">' + s + escapeHtml(t.pnlPercent ?? 0) + '%</td>' +
            '<td class="px-3 py-2.5 font-mono ' + (pos ? 'text-emerald-400' : 'text-rose-400') + '">' + s + '$' + escapeHtml(t.pnlUsd ?? 0) + '</td>' +
            '</tr>';
        }).join("");
      }
    }

    function renderPipeline(snap) {
      if (!snap || !Array.isArray(snap.records)) return;
      document.getElementById("pipelineCounts").textContent =
        "Tahlil: " + snap.evaluatedCount + " | ✅ Tasdiq: " + snap.approvedCount + " | ❌ Rad: " + snap.rejectedCount;
      document.getElementById("pipelineMeta").textContent =
        "Mirror: " + (snap.scoutSummary?.activeMirror || "MEXC") +
        " | Skaner: " + (snap.scoutSummary?.liquidEligibleCount || 0) + " likvid (" + snap.durationMs + "ms)";
      document.getElementById("lastUpdated").textContent = new Date(snap.runAt).toLocaleTimeString("uz-UZ");

      const pulseEl = document.getElementById("marketPulseBadge");
      if (pulseEl && snap.marketPulse?.biasUz) {
        pulseEl.textContent = "🧭 Bozor Pulsi: " + snap.marketPulse.biasUz;
      }

      const tbody = document.getElementById("pipelineTableBody");
      if (snap.records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">Hozircha nomzod juftliklar topilmadi.</td></tr>';
        return;
      }
      tbody.innerHTML = snap.records.map((r) => {
        const ok = r.criticRisk.verdict === "APPROVE";
        const dirBadge = r.technician.direction === "SHORT"
          ? '<span class="ml-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">🔴 SHORT 1x</span>'
          : r.technician.direction === "LONG"
            ? '<span class="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">🟢 LONG</span>'
            : '<span class="ml-1 rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">SKIP</span>';
        return '<tr class="hover:bg-slate-800/40">' +
          '<td class="px-4 py-2.5"><div class="font-bold text-white">' + escapeHtml(r.scout.symbol) + dirBadge + '</div><div class="text-[10px] text-slate-400">' + escapeHtml(r.criticRisk.tradeMode || "INTRADAY") + ' | 24s: ' + (r.scout.priceChange24hPct >= 0 ? "+" : "") + escapeHtml(r.scout.priceChange24hPct) + '%</div></td>' +
          '<td class="px-3 py-2.5"><span class="rounded border px-2 py-0.5 text-[10px] font-bold ' + (ok ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-rose-500/40 bg-rose-500/15 text-rose-300') + '">' + escapeHtml(r.criticRisk.verdict) + '</span></td>' +
          '<td class="px-3 py-2.5 font-mono">' + escapeHtml(r.criticRisk.confidenceScore) + '/100 <div class="text-[10px] text-amber-300">' + escapeHtml(r.criticRisk.longTermStars?.label || "") + '</div></td>' +
          '<td class="px-3 py-2.5 font-mono">' + escapeHtml(r.technician.rsi14) + '</td>' +
          '<td class="px-3 py-2.5 font-mono">1:' + escapeHtml(r.technician.riskRewardRatio) + '</td>' +
          '<td class="px-3 py-2.5 font-mono text-[11px]">E:' + escapeHtml(r.technician.entryPrice) + ' | TP1:<span class="text-emerald-300">' + escapeHtml(r.technician.tp1Price ?? r.technician.takeProfitPrice) + '</span> | SL:<span class="text-rose-400">' + escapeHtml(r.technician.stopLossPrice) + '</span></td>' +
          '<td class="px-3 py-2.5 text-[11px] font-bold text-cyan-300">' + escapeHtml(r.macroFlow.trend1h || r.macroFlow.regime) + '/' + escapeHtml(r.macroFlow.trend4h || r.macroFlow.regime) + '</td>' +
          '</tr>';
      }).join("");
    }

    function render24hSignals(rep, tracker) {
      if (rep) {
        document.getElementById("r24Total").textContent = String(rep.total);
        document.getElementById("r24Accuracy").textContent = rep.accuracyPct + "%";
        document.getElementById("r24Breakdown").textContent = rep.tpCount + " / " + rep.beCount + " / " + rep.slCount;
        const netSign = rep.netPnlPct >= 0 ? "+" : "";
        const netEl = document.getElementById("r24NetPnl");
        netEl.textContent = netSign + rep.netPnlPct + "%";
        netEl.className = "mt-1.5 text-2xl font-black " + (rep.netPnlPct >= 0 ? "text-emerald-400" : "text-rose-400");
        document.getElementById("r24SummaryUz").textContent = rep.summaryUz;

        const coinBox = document.getElementById("r24CoinList");
        if (!rep.byCoin || rep.byCoin.length === 0) {
          coinBox.innerHTML = '<div class="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-center text-slate-500">So\\'nggi 24 soatda yopilgan yoki TP1 ga yetgan signal yo\\'q.</div>';
        } else {
          coinBox.innerHTML = rep.byCoin.map((c) => {
            const pos = c.netPnlPct >= 0;
            return '<div class="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/75 px-3.5 py-2.5">' +
              '<div><span class="font-mono font-bold text-white">' + escapeHtml(c.symbol) + '</span>' +
              '<span class="ml-2 text-[11px] text-slate-400">✅ ' + c.tp + ' TP • ⚖️ ' + c.be + ' BE • 🛑 ' + c.sl + ' SL</span></div>' +
              '<span class="font-mono font-black ' + (pos ? 'text-emerald-400' : 'text-rose-400') + '">' + (pos ? "+" : "") + c.netPnlPct + '%</span>' +
              '</div>';
          }).join("");
        }
        update24hCharts(rep);
      }

      if (tracker) {
        const netVal = Number(tracker.totalNetPnlPct || 0);
        const avgVal = Number(tracker.avgPnlPct || 0);
        const allNetEl = document.getElementById("allTimeNetPnl");
        if (allNetEl) {
          allNetEl.textContent = (netVal >= 0 ? "+" : "") + netVal + "%";
          allNetEl.className = "mt-1 font-mono text-2xl font-black " + (netVal >= 0 ? "text-emerald-400" : "text-rose-400");
        }
        const allAvgEl = document.getElementById("allTimeAvgPnl");
        if (allAvgEl) allAvgEl.textContent = "O'rtacha: " + (avgVal >= 0 ? "+" : "") + avgVal + "% / signal";
        const allClosedEl = document.getElementById("allTimeClosed");
        if (allClosedEl) allClosedEl.textContent = String(tracker.closedCount || 0);
        const allSplitEl = document.getElementById("allTimeSplit");
        if (allSplitEl) allSplitEl.textContent = (tracker.tpCount || 0) + " TP • " + (tracker.beCount || 0) + " BE • " + (tracker.slCount || 0) + " SL";
        const allAccEl = document.getElementById("allTimeAccuracy");
        if (allAccEl) allAccEl.textContent = (tracker.accuracyPct ?? tracker.signalWinRatePct ?? 0) + "%";
        const allRiskEl = document.getElementById("allTimeRiskSlots");
        if (allRiskEl) allRiskEl.textContent = "Risk ostida: " + (tracker.atRiskActiveCount ?? tracker.activeCount ?? 0) + " / 4";
        const allPfEl = document.getElementById("allTimePf");
        if (allPfEl) allPfEl.textContent = Number(tracker.profitFactor || 0).toFixed(2);
        const allDdEl = document.getElementById("allTimeMaxDd");
        if (allDdEl) allDdEl.textContent = "MaxDD: -" + Number(tracker.maxDrawdownPct || 0) + "%";

        const cbEl = document.getElementById("allTimeCbBadge");
        if (cbEl && tracker.circuitBreaker) {
          if (tracker.circuitBreaker.active) {
            cbEl.className = "inline-flex items-center gap-1 rounded-full border border-rose-500/60 bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-bold text-rose-300 animate-pulse";
            cbEl.textContent = "🚨 Circuit Breaker: PAUZA (" + Math.ceil((tracker.circuitBreaker.remainingSec || 0) / 60) + " daq)";
          } else {
            cbEl.className = "inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300";
            cbEl.textContent = "🛡️ Circuit Breaker: SOKIN (" + (tracker.circuitBreaker.recentSlCount || 0) + "/" + (tracker.circuitBreaker.threshold || 3) + " SL)";
          }
        }

        const badge = document.getElementById("trackerActiveBadge");
        if (badge) badge.textContent = tracker.activeCount + " faol";
        const box = document.getElementById("activeTrackerCards");
        if (!tracker.activeSignals || tracker.activeSignals.length === 0) {
          box.innerHTML = '<div class="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-center text-slate-500">Hozircha faol kuzatuvdagi signallar yo\\'q.</div>';
        } else {
          box.innerHTML = tracker.activeSignals.map((s) => {
            const isSh = s.direction === "SHORT";
            const dTag = isSh
              ? '<span class="ml-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">SHORT 1x</span>'
              : '<span class="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">LONG</span>';
            return (
              '<div class="rounded-xl border border-cyan-500/30 bg-slate-950/80 p-3">' +
              '<div class="flex items-center justify-between"><span class="font-mono font-bold text-white">' + escapeHtml(s.symbol) + ' (' + escapeHtml(s.tradeMode) + ')' + dTag + '</span><span class="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">' + escapeHtml(s.status) + '</span></div>' +
              '<div class="mt-1.5 grid grid-cols-2 gap-1 font-mono text-[11px] text-slate-300">' +
              '<span>Entry: <strong class="text-white">' + escapeHtml(s.entryPrice) + '</strong></span>' +
              '<span>SL: <strong class="text-rose-400">' + escapeHtml(s.stopLossPrice) + '</strong></span>' +
              '<span>TP1: <strong class="text-emerald-300">' + escapeHtml(s.tp1Price) + '</strong></span>' +
              '<span>TP2/3: <strong class="text-emerald-400">' + escapeHtml(s.tp2Price) + ' / ' + escapeHtml(s.tp3Price) + '</strong></span>' +
              '</div></div>'
            );
          }).join("");
        }
      }
    }

    // ==================== MANUAL DEMO BUY / CLOSE ====================
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
        const dirWord = data.trade.direction === "SHORT" ? "SHORT 1x ochildi" : "sotib olindi";
        showToast("✅ " + data.trade.symbol + " demoda " + dirWord + " ($" + data.trade.positionSizeUsd + " @ " + data.trade.entryPrice + ")", false);
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
    window.manualDemoBuy = manualDemoBuy;
    window.manualDemoClose = manualDemoClose;

    // ==================== TOKEN SEARCH (3-LINE SUMMARY) ====================
    document.getElementById("tokenSearchForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("tokenSearchInput");
      const btn = document.getElementById("tokenSearchBtn");
      const box = document.getElementById("tokenSearchResult");
      const raw = (input.value || "").trim();
      if (!raw) return;

      btn.disabled = true;
      btn.textContent = "Tahlil...";
      box.classList.remove("hidden");
      box.innerHTML = '<div class="rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-xs text-slate-400">🔍 5-agent va 15M grafik tayyorlanmoqda...</div>';

      try {
        const res = await fetch("/api/check/" + encodeURIComponent(raw));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Tekshiruvda xatolik");

        const r = data.record;
        const ok = r.criticRisk.verdict === "APPROVE";
        const isShort = r.technician.direction === "SHORT";
        const dirBadge = isShort
          ? '<span class="rounded bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-300">🔴 SHORT (1x)</span>'
          : r.technician.direction === "LONG"
            ? '<span class="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">🟢 LONG</span>'
            : '<span class="rounded bg-slate-700/40 px-2 py-0.5 text-xs font-bold text-slate-400">⚪ SKIP</span>';
        const demoBtnLabel = isShort ? "🛒 Demoda SHORT (1x) ochish ($100)" : "🛒 Demoda sotib olish ($100)";
        const rsi = Math.round(r.technician.rsi14);
        const rsiLabel = rsi < 40 ? "Sotilgan" : rsi <= 64 ? "Sog'lom" : rsi <= 72 ? "Faol" : "Qizigan";
        const buyerLabel = r.macroFlow.bidAskRatio >= 1.25 ? "Xaridorlar ustun" : r.macroFlow.bidAskRatio >= 0.9 ? "Muvozanatli" : "Sotuv bosimi";
        const exStr = (r.macroFlow.exchanges || ["MEXC"]).join("+");
        const fundBadge = r.fundamental?.badgeUz || "✅ Sog'lom";
        const softNote = (r.criticRisk.softWarnings && r.criticRisk.softWarnings[0]) ? r.criticRisk.softWarnings[0] : "Erta breakout qoidalari tekshirildi";
        const chartSrc = "/api/chart/" + encodeURIComponent(data.symbol) + ".png?t=" + Date.now();
        const tvUrl = data.tradingViewUrl || ("https://www.tradingview.com/chart/?symbol=MEXC:" + encodeURIComponent(data.symbol) + "&interval=15");

        box.innerHTML =
          '<div class="rounded-xl border border-cyan-500/30 bg-slate-950/90 p-4 space-y-3">' +
          '<div class="flex flex-wrap items-center justify-between gap-2">' +
            '<div class="flex items-center gap-2">' +
              '<span class="text-lg font-black text-white">' + escapeHtml(data.symbol) + '</span>' +
              dirBadge +
              '<span class="rounded-md border px-2 py-0.5 text-xs font-bold ' + (ok ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-rose-500/40 bg-rose-500/15 text-rose-300') + '">' + escapeHtml(r.criticRisk.verdict) + ' (' + escapeHtml(r.criticRisk.confidenceScore) + '/100)</span>' +
              '<span class="text-xs text-amber-300">' + escapeHtml(r.criticRisk.longTermStars?.label || "") + '</span>' +
            '</div>' +
            '<div class="flex flex-wrap gap-3 font-mono text-xs">' +
              '<span>Entry: <strong class="text-cyan-300">' + escapeHtml(r.technician.entryPrice) + '</strong></span>' +
              '<span>TP1: <strong class="text-emerald-300">' + escapeHtml(r.technician.tp1Price ?? r.technician.takeProfitPrice) + '</strong></span>' +
              '<span>TP2: <strong class="text-emerald-400">' + escapeHtml(r.technician.takeProfitPrice) + '</strong></span>' +
              '<span>SL: <strong class="text-rose-400">' + escapeHtml(r.technician.stopLossPrice) + '</strong></span>' +
            '</div>' +
          '</div>' +
          '<div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs space-y-1 text-slate-200">' +
            '<div>• <strong class="text-cyan-300">Trend:</strong> 15M/' + escapeHtml(r.macroFlow.trend1h || r.macroFlow.regime) + '/' + escapeHtml(r.macroFlow.trend4h || r.macroFlow.regime) + ' | RSI: ' + rsi + ' (' + rsiLabel + ')</div>' +
            '<div>• <strong class="text-emerald-300">Bozor:</strong> ' + buyerLabel + ' (' + escapeHtml(r.macroFlow.bidAskRatio) + 'x, ' + escapeHtml(exStr) + ') | Fundamental: ' + escapeHtml(fundBadge) + '</div>' +
            '<div>• <strong class="text-amber-300">Eslatma:</strong> ' + escapeHtml(softNote) + '</div>' +
          '</div>' +
          '<div class="overflow-hidden rounded-xl border border-slate-800"><img src="' + chartSrc + '" alt="15M Chart" class="block w-full h-auto" /></div>' +
          '<div class="flex flex-wrap gap-2">' +
            '<button type="button" onclick="manualDemoBuy(\\'' + escapeHtml(data.symbol) + '\\', 100)" class="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400">' + demoBtnLabel + '</button>' +
            '<a href="' + tvUrl + '" target="_blank" rel="noopener" class="rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400">📈 TradingView (MEXC 15M)</a>' +
          '</div>' +
          '</div>';
      } catch (err) {
        box.innerHTML = '<div class="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">❌ ' + escapeHtml(err.message) + '</div>';
      } finally {
        btn.disabled = false;
        btn.textContent = "Tekshirish";
      }
    });

    // ==================== TAB 4: RISK CALCULATOR, ALERTS & 11 HOT COMMANDS ====================
    function updateRiskCalc() {
      const deposit = Number(document.getElementById("calcDeposit")?.value || 0);
      const riskPct = Number(document.getElementById("calcRiskPct")?.value || 0);
      const entry = Number(document.getElementById("calcEntry")?.value || 0);
      const sl = Number(document.getElementById("calcSl")?.value || 0);
      const maxLoss = Number(((deposit * riskPct) / 100).toFixed(2));
      const stopDist = entry > 0 ? Math.abs((entry - sl) / entry) * 100 : 0;
      const posSize = stopDist > 0 ? Number(Math.min(deposit, maxLoss / (stopDist / 100)).toFixed(2)) : 0;
      const qty = entry > 0 ? Number((posSize / entry).toFixed(4)) : 0;

      document.getElementById("calcOutMaxLoss").textContent = "$" + maxLoss.toFixed(2);
      document.getElementById("calcOutStopDist").textContent = stopDist.toFixed(2) + "%";
      document.getElementById("calcOutPosSize").textContent = "$" + posSize.toFixed(2);
      document.getElementById("calcOutCoinQty").textContent = qty.toFixed(4);
    }
    window.updateRiskCalc = updateRiskCalc;
    updateRiskCalc();

    async function refreshAlerts() {
      try {
        const res = await fetch("/api/alerts");
        const data = await res.json();
        const box = document.getElementById("alertsListContainer");
        if (!box) return;
        const items = data.alerts || [];
        if (items.length === 0) {
          box.innerHTML = '<div class="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-center text-slate-500">Hozircha faol narx eslatmalari yo\\'q.</div>';
          return;
        }
        box.innerHTML = items.map((a) =>
          '<div class="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2">' +
            '<div><span class="font-mono font-bold text-white">' + escapeHtml(a.symbol) + '</span> ' +
            '<span class="font-mono text-cyan-300">' + (a.direction === "ABOVE" ? "📈 >=" : "📉 <=") + ' ' + escapeHtml(a.targetPrice) + '</span></div>' +
            '<button type="button" onclick="deletePriceAlert(\\'' + escapeHtml(a.id) + '\\')" class="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/30">🗑️ O\\'chirish</button>' +
          '</div>'
        ).join("");
      } catch {}
    }

    async function deletePriceAlert(id) {
      try {
        await fetch("/api/alerts/" + encodeURIComponent(id), { method: "DELETE" });
        showToast("🗑️ Narx eslatmasi o'chirildi", false);
        refreshAlerts();
      } catch (err) {
        showToast("❌ " + err.message, true);
      }
    }
    window.deletePriceAlert = deletePriceAlert;

    document.getElementById("alertCreateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const sym = document.getElementById("alertSymbolInput").value.trim();
      const price = Number(document.getElementById("alertPriceInput").value);
      const btn = document.getElementById("alertAddBtn");
      btn.disabled = true;
      try {
        const res = await fetch("/api/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym, targetPrice: price })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Saqlashda xatolik");
        document.getElementById("alertSymbolInput").value = "";
        document.getElementById("alertPriceInput").value = "";
        showToast("🔔 Eslatma saqlandi: " + data.alert.symbol + " → " + data.alert.targetPrice, false);
        refreshAlerts();
      } catch (err) {
        showToast("❌ " + err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    const HOT_COMMANDS = [
      { cmd: "/start", desc: "Asosiy menyu va Mini App Dashboard" },
      { cmd: "/scan", desc: "5-agent jonli bozor skanerlash" },
      { cmd: "/check SOL", desc: "Istalgan koinni 15M grafik + 5-agent tekshirish" },
      { cmd: "/buy SOL 100", desc: "Demo portfelda qo'lda pozitsiya ochish" },
      { cmd: "/positions", desc: "Ochiq demo savdolar va jonli PnL" },
      { cmd: "/mode", desc: "HYBRID / INTRADAY / SWING rejimini tanlash" },
      { cmd: "/news", desc: "USD Macro News Shield (CPI/FOMC) holati" },
      { cmd: "/summary", desc: "24 soatlik koinma-koin signal hisoboti" },
      { cmd: "/pdf", desc: "PDF Demo Portfel hisobotini yuklash" },
      { cmd: "/alert BTC 95000", desc: "Shaxsiy narx eslatmasi o'rnatish (/alerts)" },
      { cmd: "/calc 500 2 100 96", desc: "Pozitsiya va risk kalkulyatori" }
    ];

    function copyCmd(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast("📋 Nusxalandi: " + text, false)).catch(() => {});
      } else {
        showToast("📋 Buyruq: " + text, false);
      }
    }
    window.copyCmd = copyCmd;

    document.getElementById("hotCommandsGrid").innerHTML = HOT_COMMANDS.map((item) =>
      '<div class="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">' +
        '<div><div class="font-mono text-xs font-bold text-cyan-300">' + escapeHtml(item.cmd) + '</div>' +
        '<div class="mt-0.5 text-[11px] text-slate-400">' + escapeHtml(item.desc) + '</div></div>' +
        '<button type="button" onclick="copyCmd(\\'' + escapeHtml(item.cmd) + '\\')" class="shrink-0 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/25">Nusxa</button>' +
      '</div>'
    ).join("");

    // ==================== LIVE POLLING & DATA LOADERS ====================
    async function refreshLogs() {
      try {
        const res = await fetch("/api/logs/recent");
        if (res.ok) {
          const d = await res.json();
          renderActivityLogs(d.logs || []);
        }
      } catch {}
    }
    window.refreshLogs = refreshLogs;

    async function refreshSignals24h() {
      try {
        const [r1, r2] = await Promise.all([fetch("/api/signals/report24h"), fetch("/api/signals/tracker")]);
        const rep = r1.ok ? await r1.json() : null;
        const trk = r2.ok ? await r2.json() : null;
        render24hSignals(rep, trk);
      } catch {}
    }

    async function refreshAll() {
      try {
        const [agRes, newsRes, portRes, pipeRes, scoutRes, logsRes] = await Promise.all([
          fetch("/api/agents/status"),
          fetch("/api/macro/news"),
          fetch("/api/portfolio"),
          fetch("/api/pipeline/latest"),
          fetch("/api/scout/latest"),
          fetch("/api/logs/recent")
        ]);

        if (newsRes.ok) {
          liveNewsShield = await newsRes.json();
          const nb = document.getElementById("newsShieldBadge");
          if (nb) {
            if (liveNewsShield.active) {
              nb.className = "inline-flex items-center gap-1 rounded-full border border-rose-500/60 bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-bold text-rose-300 animate-pulse";
              nb.textContent = "🚨 News Shield: " + (liveNewsShield.eventTitle || "FAOL");
            } else {
              nb.className = "inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300";
              nb.textContent = "🛡️ News Shield: SOKIN";
            }
          }
        }

        if (scoutRes.ok) {
          const scout = await scoutRes.json();
          if (scout?.candidates?.length > 0) {
            liveTickerItems = scout.candidates.slice(0, 10).map((c) => ({
              symbol: c.symbol,
              price: c.lastPrice,
              chg: c.priceChange24hPct
            }));
          }
        }

        const portfolio = portRes.ok ? await portRes.json() : null;
        const pipeline = pipeRes.ok ? await pipeRes.json() : null;
        if (agRes.ok) renderCompactAgents(await agRes.json());
        if (logsRes.ok) renderActivityLogs((await logsRes.json()).logs || []);
        if (portfolio) renderPortfolio(portfolio);
        if (pipeline) renderPipeline(pipeline);
        updateAnalyticsCharts(portfolio, pipeline);
      } catch {}
    }

    document.getElementById("scanNowBtn").addEventListener("click", async () => {
      const btn = document.getElementById("scanNowBtn");
      const lbl = document.getElementById("scanBtnLabel");
      btn.disabled = true;
      lbl.textContent = "Skanerlanmoqda...";
      try {
        const res = await fetch("/api/pipeline/run", { method: "POST" });
        if (!res.ok) throw new Error("Skanerlashda xatolik");
        await refreshAll();
        await refreshSignals24h();
        showToast("✅ 5-agent jonli skanerlash muvaffaqiyatli tugadi!", false);
      } catch (err) {
        showToast("❌ " + err.message, true);
      } finally {
        btn.disabled = false;
        lbl.textContent = "Hozir Skanerlash";
      }
    });

    refreshAll();
    refreshSignals24h();
    refreshAlerts();
    setInterval(refreshAll, 30000);
  </script>
</body>
</html>`;
}
