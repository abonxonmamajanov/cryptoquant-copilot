import fs from "fs";
import path from "path";
import { EvaluatedSignalRecord } from "./pipeline.service";
import { CircuitBreakerStatus, getCircuitBreakerStatus } from "./cooldown.service";

export type TrackedSignalOutcome =
  | "ACTIVE"
  | "TP1_HIT"
  | "TP2_HIT"
  | "TP3_HIT"
  | "BREAKEVEN"
  | "SL_HIT"
  | "EXPIRED";

export interface TrackedSignalItem {
  id: string;
  symbol: string;
  tradeMode: "INTRADAY" | "SWING";
  entryPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  stopLossPrice: number;
  initialStopLossPrice: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  trailingStep2Active?: boolean;
  status: TrackedSignalOutcome;
  telegramMessageId: number | null;
  sentAt: string;
  closedAt: string | null;
  finalPnlPct: number | null;
  runnerPnlPct?: number | null;
}

export interface SignalMilestoneAlert {
  signal: TrackedSignalItem;
  eventType: "TP1_HIT" | "TP2_HIT" | "TP3_HIT" | "BREAKEVEN" | "SL_HIT" | "EXPIRED";
  livePrice: number;
  pnlPct: number;
  replyToMessageId: number | null;
  telegramText: string;
}

export interface Coin24hReportItem {
  symbol: string;
  tp: number;
  sl: number;
  be: number;
  netPnlPct: number;
}

export interface CoinAllTimeReportItem extends Coin24hReportItem {
  total: number;
}

export interface Signal24hReport {
  generatedAt: string;
  total: number;
  tpCount: number;
  slCount: number;
  beCount: number;
  accuracyPct: number;
  netPnlPct: number;
  byCoin: Coin24hReportItem[];
  summaryUz: string;
  formattedTelegramText: string;
}

interface ArchivedSignalTotals {
  closedCount: number;
  winsCount: number;
  tpCount: number;
  beCount: number;
  slCount: number;
  expiredCount: number;
  totalNetPnlPct: number;
  totalRunnerPnlPct: number;
  grossWinPct: number;
  grossLossPct: number;
}

export interface SignalTrackerSummary {
  activeCount: number;
  atRiskActiveCount: number;
  closedCount: number;
  winsCount: number;
  tpCount: number;
  beCount: number;
  slCount: number;
  expiredCount: number;
  signalWinRatePct: number;
  accuracyPct: number;
  totalNetPnlPct: number;
  totalRunnerPnlPct: number;
  grossWinPct: number;
  grossLossPct: number;
  profitFactor: number;
  avgPnlPct: number;
  maxDrawdownPct: number;
  bestSignal: { symbol: string; status: TrackedSignalOutcome; finalPnlPct: number; closedAt: string | null } | null;
  worstSignal: { symbol: string; status: TrackedSignalOutcome; finalPnlPct: number; closedAt: string | null } | null;
  byCoinAllTime: CoinAllTimeReportItem[];
  circuitBreaker: CircuitBreakerStatus;
  activeSignals: TrackedSignalItem[];
  recentHistory: TrackedSignalItem[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const TRACKER_FILE = path.join(DATA_DIR, "tracked_signals.json");
const MAX_HOLD_INTRADAY_MS = 24 * 60 * 60 * 1000;
const MAX_HOLD_SWING_MS = 5 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_RETAINED = 500;
const BRAND_MOTTO = "Tez foyda emas — doimiy xotirjam, aniq savdo";

// Stage 6.1 Wall Street Asymmetric Partial Take-Profit allocation:
// 60% booked at TP1 (remaining 40% SL -> -0.2R soft protection; -> +0.5R at 2.3R), 40% booked at TP2
const TP1_WEIGHT = 0.6;
const TP2_WEIGHT = 0.4;

function roundTrackerPrice(price: number): number {
  if (price >= 100) return Number(price.toFixed(2));
  if (price >= 1) return Number(price.toFixed(4));
  if (price >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(7));
}

interface TrackerState {
  active: TrackedSignalItem[];
  history: TrackedSignalItem[];
  archivedTotals: ArchivedSignalTotals;
}

function emptyArchivedTotals(): ArchivedSignalTotals {
  return {
    closedCount: 0,
    winsCount: 0,
    tpCount: 0,
    beCount: 0,
    slCount: 0,
    expiredCount: 0,
    totalNetPnlPct: 0,
    totalRunnerPnlPct: 0,
    grossWinPct: 0,
    grossLossPct: 0
  };
}

function formatTashkentTime(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const uzt = new Date(ms + 5 * 60 * 60 * 1000);
  const dd = String(uzt.getUTCDate()).padStart(2, "0");
  const mm = String(uzt.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(uzt.getUTCHours()).padStart(2, "0");
  const min = String(uzt.getUTCMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${min} (Toshkent)`;
}

function pctDiff(entry: number, target: number): number {
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  return ((target - entry) / entry) * 100;
}

function normalizeTrackedItem(raw: Partial<TrackedSignalItem>): TrackedSignalItem {
  const finalPnl = typeof raw.finalPnlPct === "number" ? raw.finalPnlPct : null;
  return {
    id: String(raw.id ?? `sig_${Date.now()}`),
    symbol: String(raw.symbol ?? ""),
    tradeMode: raw.tradeMode === "SWING" ? "SWING" : "INTRADAY",
    entryPrice: Number(raw.entryPrice ?? 0),
    tp1Price: Number(raw.tp1Price ?? 0),
    tp2Price: Number(raw.tp2Price ?? 0),
    tp3Price: Number(raw.tp3Price ?? 0),
    stopLossPrice: Number(raw.stopLossPrice ?? 0),
    initialStopLossPrice: Number(raw.initialStopLossPrice ?? raw.stopLossPrice ?? 0),
    tp1Hit: Boolean(raw.tp1Hit),
    tp2Hit: Boolean(raw.tp2Hit),
    tp3Hit: Boolean(raw.tp3Hit),
    trailingStep2Active: Boolean(raw.trailingStep2Active),
    status: (raw.status as TrackedSignalOutcome) ?? "ACTIVE",
    telegramMessageId: typeof raw.telegramMessageId === "number" ? raw.telegramMessageId : null,
    sentAt: String(raw.sentAt ?? new Date().toISOString()),
    closedAt: raw.closedAt ?? null,
    finalPnlPct: finalPnl,
    runnerPnlPct: typeof raw.runnerPnlPct === "number" ? raw.runnerPnlPct : finalPnl
  };
}

let state: TrackerState = loadState();

function loadState(): TrackerState {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TRACKER_FILE, "utf-8")) as Partial<TrackerState>;
      if (Array.isArray(parsed.active) && Array.isArray(parsed.history)) {
        return {
          active: parsed.active.map(normalizeTrackedItem),
          history: parsed.history.map(normalizeTrackedItem),
          archivedTotals: {
            ...emptyArchivedTotals(),
            ...(parsed.archivedTotals ?? {})
          }
        };
      }
    }
  } catch {
    // Fallback
  }
  return { active: [], history: [], archivedTotals: emptyArchivedTotals() };
}

function saveState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}

function archiveOverflowItem(sig: TrackedSignalItem): void {
  const pnl = sig.finalPnlPct ?? 0;
  const runner = sig.runnerPnlPct ?? pnl;
  const a = state.archivedTotals;
  a.closedCount += 1;
  a.totalNetPnlPct = Number((a.totalNetPnlPct + pnl).toFixed(2));
  a.totalRunnerPnlPct = Number((a.totalRunnerPnlPct + runner).toFixed(2));
  if (pnl > 0) a.grossWinPct = Number((a.grossWinPct + pnl).toFixed(2));
  else if (pnl < 0) a.grossLossPct = Number((a.grossLossPct + Math.abs(pnl)).toFixed(2));

  if (sig.tp1Hit || pnl > 0) a.winsCount += 1;
  if (sig.status === "SL_HIT") a.slCount += 1;
  else if (sig.status === "BREAKEVEN") a.beCount += 1;
  else if (sig.status === "TP1_HIT" || sig.status === "TP2_HIT" || sig.status === "TP3_HIT") a.tpCount += 1;
  else {
    a.expiredCount += 1;
    if (pnl > 0) a.tpCount += 1;
    else if (pnl < 0) a.slCount += 1;
    else a.beCount += 1;
  }
}

export function hasActiveSignal(symbol: string): boolean {
  const sym = symbol.toUpperCase().trim();
  return state.active.some((s) => s.symbol === sym);
}

export function getAtRiskActiveCount(): number {
  // Signals that already hit TP1 have SL moved to Breakeven (risk-free)
  return state.active.filter((s) => !s.tp1Hit).length;
}

export function registerDispatchedSignal(
  record: EvaluatedSignalRecord,
  telegramMessageId: number | null = null
): TrackedSignalItem {
  // Replace any older active tracker for the same symbol to avoid duplicate alerts
  state.active = state.active.filter((s) => s.symbol !== record.scout.symbol);

  const entry = record.technician.entryPrice;
  const tp2 = record.technician.tp2Price ?? record.technician.takeProfitPrice;
  const risk = Math.max(entry - record.technician.stopLossPrice, entry * 0.008);
  const tradeMode = record.criticRisk.tradeMode ?? "INTRADAY";
  const tp1 =
    record.technician.tp1Price ??
    roundTrackerPrice(entry + risk * (tradeMode === "SWING" ? 2.0 : 1.8));
  const tp3 =
    record.technician.tp3Price ??
    roundTrackerPrice(entry + risk * (tradeMode === "SWING" ? 4.6 : 4.0));

  const item: TrackedSignalItem = {
    id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol: record.scout.symbol,
    tradeMode,
    entryPrice: entry,
    tp1Price: tp1,
    tp2Price: tp2,
    tp3Price: tp3,
    stopLossPrice: record.technician.stopLossPrice,
    initialStopLossPrice: record.technician.stopLossPrice,
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    trailingStep2Active: false,
    status: "ACTIVE",
    telegramMessageId: typeof telegramMessageId === "number" ? telegramMessageId : null,
    sentAt: new Date().toISOString(),
    closedAt: null,
    finalPnlPct: null,
    runnerPnlPct: null
  };

  state.active.push(item);
  saveState();
  return item;
}

export function evaluateTrackedSignals(
  priceMap: Map<string, number>,
  now = Date.now()
): SignalMilestoneAlert[] {
  const alerts: SignalMilestoneAlert[] = [];
  const stillActive: TrackedSignalItem[] = [];
  let changed = false;

  for (const sig of state.active) {
    const live = priceMap.get(sig.symbol);
    if (!live || !Number.isFinite(live) || live <= 0) {
      stillActive.push(sig);
      continue;
    }

    const pnlPct = Number(pctDiff(sig.entryPrice, live).toFixed(2));
    const tp1Pct = pctDiff(sig.entryPrice, sig.tp1Price);
    const tp2Pct = pctDiff(sig.entryPrice, sig.tp2Price);
    const tp3Pct = pctDiff(sig.entryPrice, sig.tp3Price);
    const risk = Math.max(sig.entryPrice - sig.initialStopLossPrice, sig.entryPrice * 0.008);
    const softProtectionSl = roundTrackerPrice(sig.entryPrice - risk * 0.2); // -0.2R soft protection
    const trailTriggerPrice = sig.entryPrice + risk * 2.3; // +2.3R trail step-up
    const trailStep2Sl = roundTrackerPrice(sig.entryPrice + risk * 0.5); // +0.5R profit lock
    const tashkentSentTime = formatTashkentTime(sig.sentAt);

    // 1. Check TP2 / TP3 (Full 60/40 Win & Close — remaining 40% booked at TP2)
    if (live >= sig.tp2Price) {
      sig.tp1Hit = true;
      sig.tp2Hit = true;
      const reachedTp3 = live >= sig.tp3Price;
      sig.tp3Hit = reachedTp3;
      sig.status = reachedTp3 ? "TP3_HIT" : "TP2_HIT";
      sig.closedAt = new Date(now).toISOString();
      const weightedPnl = Number((TP1_WEIGHT * tp1Pct + TP2_WEIGHT * tp2Pct).toFixed(2));
      sig.finalPnlPct = weightedPnl;
      sig.runnerPnlPct = Number((reachedTp3 ? tp3Pct : tp2Pct).toFixed(2));
      state.history.unshift(sig);
      changed = true;
      alerts.push({
        signal: sig,
        eventType: reachedTp3 ? "TP3_HIT" : "TP2_HIT",
        livePrice: live,
        pnlPct: sig.finalPnlPct,
        replyToMessageId: sig.telegramMessageId,
        telegramText: [
          reachedTp3
            ? `🚀 *SIGNAL NATIJASI: ${sig.symbol} — TP2/TP3 TO'LIQ YOPILDI!*`
            : `✅ *SIGNAL NATIJASI: ${sig.symbol} — TP2 (TO'LIQ FOYDA) URILDI!*`,
          ``,
          `🕒 Signal vaqti: \`${tashkentSentTime}\``,
          `🎯 Kirish: \`${sig.entryPrice}\` → TP2: \`${sig.tp2Price}\``,
          `💰 Joriy narx: \`${live}\``,
          `📈 Sof foyda (60/40): *+${sig.finalPnlPct}%* (Runner +${sig.runnerPnlPct}% | ${sig.tradeMode})`
        ].join("\n")
      });
      continue;
    }

    // 2. Check TP1 (Milestone Alert + Lock 60% + Move remaining 40% SL to -0.2R soft protection, or +0.5R if >= 2.3R)
    if (!sig.tp1Hit && live >= sig.tp1Price) {
      sig.tp1Hit = true;
      if (live >= trailTriggerPrice) {
        sig.trailingStep2Active = true;
        sig.stopLossPrice = trailStep2Sl;
      } else {
        sig.stopLossPrice = softProtectionSl;
      }
      sig.status = "TP1_HIT";
      changed = true;
      const tp1Rounded = Number(tp1Pct.toFixed(2));
      const slModeLabel = sig.trailingStep2Active
        ? `+0.5R (\`${sig.stopLossPrice}\`) foyda himoyasiga`
        : `-0.2R (\`${sig.stopLossPrice}\`) yumshoq himoyaga (2.3R da +0.5R)`;
      alerts.push({
        signal: sig,
        eventType: "TP1_HIT",
        livePrice: live,
        pnlPct: tp1Rounded,
        replyToMessageId: sig.telegramMessageId,
        telegramText: [
          `🎯 *SIGNAL NATIJASI: ${sig.symbol} — 1-TP (TP1) OLINDI!*`,
          ``,
          `🕒 Signal vaqti: \`${tashkentSentTime}\``,
          `🎯 Kirish: \`${sig.entryPrice}\` → TP1: \`${sig.tp1Price}\``,
          `💰 Joriy narx: \`${live}\``,
          `📈 Foyda: *+${tp1Rounded}%* (60% yopildi) | 🛡️ Qolgan 40% SL ${slModeLabel} surildi`
        ].join("\n")
      });
      stillActive.push(sig);
      continue;
    }

    // 2b. Once TP1 is hit and price crosses +2.3R, upgrade remaining 40% SL from -0.2R to +0.5R
    if (sig.tp1Hit && !sig.trailingStep2Active && live >= trailTriggerPrice) {
      sig.trailingStep2Active = true;
      sig.stopLossPrice = trailStep2Sl;
      changed = true;
      stillActive.push(sig);
      continue;
    }

    // 3. Check SL / Soft-Protection (-0.2R) / +0.5R Trail Exit
    if (live <= sig.stopLossPrice) {
      sig.closedAt = new Date(now).toISOString();
      const rawSlPnl = Number(pctDiff(sig.entryPrice, sig.stopLossPrice).toFixed(2));
      sig.runnerPnlPct = rawSlPnl;

      if (sig.tp1Hit) {
        // 60% booked at TP1, remaining 40% closed at -0.2R soft SL or +0.5R trail SL
        const weightedPnl = Number((TP1_WEIGHT * tp1Pct + TP2_WEIGHT * rawSlPnl).toFixed(2));
        sig.finalPnlPct = weightedPnl;
        sig.status = weightedPnl > 0 ? "TP1_HIT" : "BREAKEVEN";
        state.history.unshift(sig);
        changed = true;
        const winSign = weightedPnl >= 0 ? "+" : "";
        const exitDesc = sig.trailingStep2Active
          ? "+0.5R TRAILING FOYDA"
          : "TP1 60% FOYDA + -0.2R HIMOYA";
        alerts.push({
          signal: sig,
          eventType: sig.status === "TP1_HIT" ? "TP1_HIT" : "BREAKEVEN",
          livePrice: live,
          pnlPct: sig.finalPnlPct,
          replyToMessageId: sig.telegramMessageId,
          telegramText: [
            `✅ *SIGNAL NATIJASI: ${sig.symbol} — FOYDA BILAN YOPILDI (${exitDesc})*`,
            ``,
            `🕒 Signal vaqti: \`${tashkentSentTime}\``,
            `🎯 Kirish: \`${sig.entryPrice}\` → Qolgan 40% yopilish: \`${sig.stopLossPrice}\``,
            `💰 Joriy narx: \`${live}\``,
            `📈 Sof foyda (60/40): *${winSign}${sig.finalPnlPct}%*`
          ].join("\n")
        });
        continue;
      }

      // Direct Stop-Loss before TP1
      sig.status = "SL_HIT";
      sig.finalPnlPct = rawSlPnl;
      state.history.unshift(sig);
      changed = true;
      alerts.push({
        signal: sig,
        eventType: "SL_HIT",
        livePrice: live,
        pnlPct: sig.finalPnlPct,
        replyToMessageId: sig.telegramMessageId,
        telegramText: [
          `🛑 *SIGNAL NATIJASI: ${sig.symbol} — STOP-LOSS (SL) OLINDI*`,
          ``,
          `🕒 Signal vaqti: \`${tashkentSentTime}\``,
          `🎯 Kirish: \`${sig.entryPrice}\` → SL: \`${sig.stopLossPrice}\``,
          `💰 Joriy narx: \`${live}\``,
          `📉 Natija: *${sig.finalPnlPct}%* (${sig.tradeMode})`
        ].join("\n")
      });
      continue;
    }

    // 4. Check Expiry
    const maxHold = sig.tradeMode === "SWING" ? MAX_HOLD_SWING_MS : MAX_HOLD_INTRADAY_MS;
    if (now - new Date(sig.sentAt).getTime() >= maxHold) {
      sig.status = "EXPIRED";
      sig.closedAt = new Date(now).toISOString();
      sig.runnerPnlPct = pnlPct;
      if (sig.tp1Hit) {
        sig.finalPnlPct = Number((TP1_WEIGHT * tp1Pct + TP2_WEIGHT * pnlPct).toFixed(2));
      } else {
        sig.finalPnlPct = pnlPct;
      }
      state.history.unshift(sig);
      changed = true;
      const expSign = sig.finalPnlPct >= 0 ? "+" : "";
      alerts.push({
        signal: sig,
        eventType: "EXPIRED",
        livePrice: live,
        pnlPct: sig.finalPnlPct,
        replyToMessageId: sig.telegramMessageId,
        telegramText: [
          `⌛ *SIGNAL MUDDATI TUGADI: ${sig.symbol}*`,
          ``,
          `🕒 Signal vaqti: \`${tashkentSentTime}\``,
          `🎯 Kirish: \`${sig.entryPrice}\` → Hozirgi: \`${live}\` (${expSign}${sig.finalPnlPct}%)`,
          `💰 Joriy narx: \`${live}\``
        ].join("\n")
      });
      continue;
    }

    stillActive.push(sig);
  }

  state.active = stillActive;
  while (state.history.length > MAX_HISTORY_RETAINED) {
    const oldest = state.history.pop();
    if (oldest) archiveOverflowItem(oldest);
  }
  if (changed) saveState();
  return alerts;
}

export function get24hSignalReport(now = Date.now()): Signal24hReport {
  const cutoff = now - ONE_DAY_MS;
  const closed24h = state.history.filter((s) => {
    const ts = new Date(s.closedAt || s.sentAt).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
  const activeTp24h = state.active.filter((s) => {
    const ts = new Date(s.sentAt).getTime();
    return s.tp1Hit && Number.isFinite(ts) && ts >= cutoff;
  });

  const combined = [...closed24h, ...activeTp24h];
  let tpCount = 0;
  let slCount = 0;
  let beCount = 0;
  let totalPnl = 0;

  const coinMap = new Map<string, Coin24hReportItem>();

  for (const s of combined) {
    let pnl = s.finalPnlPct ?? 0;
    let bucket: "TP" | "SL" | "BE" = "BE";

    if (s.status === "BREAKEVEN") {
      bucket = "BE";
      beCount++;
      pnl = s.finalPnlPct ?? 0;
    } else if (s.status === "SL_HIT") {
      bucket = "SL";
      slCount++;
      pnl = s.finalPnlPct ?? 0;
    } else if (s.status === "TP3_HIT" || s.status === "TP2_HIT" || s.status === "TP1_HIT") {
      bucket = "TP";
      tpCount++;
      if (s.finalPnlPct !== null) {
        pnl = s.finalPnlPct;
      } else {
        const tp1P = pctDiff(s.entryPrice, s.tp1Price);
        const tp2P = pctDiff(s.entryPrice, s.tp2Price);
        pnl = Number((s.tp2Hit ? TP1_WEIGHT * tp1P + TP2_WEIGHT * tp2P : TP1_WEIGHT * tp1P).toFixed(2));
      }
    } else {
      // EXPIRED
      if (pnl > 0) {
        bucket = "TP";
        tpCount++;
      } else if (pnl < 0) {
        bucket = "SL";
        slCount++;
      } else {
        bucket = "BE";
        beCount++;
      }
    }

    totalPnl += pnl;
    const entry = coinMap.get(s.symbol) ?? {
      symbol: s.symbol,
      tp: 0,
      sl: 0,
      be: 0,
      netPnlPct: 0
    };
    if (bucket === "TP") entry.tp += 1;
    else if (bucket === "SL") entry.sl += 1;
    else entry.be += 1;
    entry.netPnlPct = Number((entry.netPnlPct + pnl).toFixed(2));
    coinMap.set(s.symbol, entry);
  }

  const total = combined.length;
  const accuracyPct = total > 0 ? Number((((tpCount + beCount) / total) * 100).toFixed(1)) : 0;
  const netPnlPct = Number(totalPnl.toFixed(2));
  const byCoin = Array.from(coinMap.values()).sort((a, b) => b.netPnlPct - a.netPnlPct);

  const allTime = getSignalTrackerSummary(now);
  const allTimeSign = allTime.totalNetPnlPct >= 0 ? "+" : "";

  let summaryUz: string;
  if (total === 0) {
    summaryUz =
      "So'nggi 24 soatda yopilgan yoki TP1 ga yetgan signallar qayd etilmadi. 5-agent tizimi bozorni faol kuzatmoqda.";
  } else {
    const leader = byCoin[0];
    const leaderSign = leader.netPnlPct >= 0 ? "+" : "";
    summaryUz = `So'nggi 24 soatda ${total} ta signal natijasi qayd etildi: ${tpCount} TP, ${beCount} BE va ${slCount} SL (${accuracyPct}% aniqlik). Eng yaxshi ko'rsatkich ${leader.symbol} (${leaderSign}${leader.netPnlPct}%) juftligida kuzatildi.`;
  }

  const netSign = netPnlPct >= 0 ? "+" : "";
  const coinLines =
    byCoin.length > 0
      ? byCoin
          .slice(0, 12)
          .map((c) => {
            const s = c.netPnlPct >= 0 ? "+" : "";
            return `• \`${c.symbol}\`: ✅ ${c.tp} TP | ⚖️ ${c.be} BE | 🛑 ${c.sl} SL (*${s}${c.netPnlPct}%*)`;
          })
      : ["• _So'nggi 24 soatda yopilgan signal yo'q._"];

  const formattedTelegramText = [
    `📊 *CRYPTOQUANT-COPILOT — 24 SOATLIK SIGNAL HISOBOTI*`,
    ``,
    `🎯 *24s signallar:* ${total} ta | *Aniqlik:* ${accuracyPct}%`,
    `✅ *TP:* ${tpCount} | ⚖️ *Breakeven:* ${beCount} | 🛑 *SL:* ${slCount}`,
    `💰 *24s sof natija:* ${netSign}${netPnlPct}%`,
    `🏆 *Umumiy (barcha vaqt):* ${allTime.closedCount} signal | *Sof PnL:* ${allTimeSign}${allTime.totalNetPnlPct}% | *PF:* ${allTime.profitFactor}`,
    ``,
    `🪙 *Koinlar kesimida (24s):*`,
    ...coinLines,
    ``,
    `📝 *Xulosa:* ${summaryUz}`,
    ``,
    `_"${BRAND_MOTTO}"_`
  ].join("\n");

  return {
    generatedAt: new Date(now).toISOString(),
    total,
    tpCount,
    slCount,
    beCount,
    accuracyPct,
    netPnlPct,
    byCoin,
    summaryUz,
    formattedTelegramText
  };
}

export function getSignalTrackerSummary(now = Date.now()): SignalTrackerSummary {
  const closed = state.history;
  const a = state.archivedTotals;

  let tpCount = a.tpCount;
  let beCount = a.beCount;
  let slCount = a.slCount;
  let expiredCount = a.expiredCount;
  let winsCount = a.winsCount;
  let totalNet = a.totalNetPnlPct;
  let totalRunner = a.totalRunnerPnlPct;
  let grossWin = a.grossWinPct;
  let grossLoss = a.grossLossPct;

  let bestSignal: SignalTrackerSummary["bestSignal"] = null;
  let worstSignal: SignalTrackerSummary["worstSignal"] = null;
  const coinMap = new Map<string, CoinAllTimeReportItem>();

  for (const s of closed) {
    const pnl = s.finalPnlPct ?? 0;
    const runner = s.runnerPnlPct ?? pnl;
    totalNet += pnl;
    totalRunner += runner;
    if (pnl > 0) grossWin += pnl;
    else if (pnl < 0) grossLoss += Math.abs(pnl);

    if (s.tp1Hit || pnl > 0) winsCount += 1;

    let bucket: "TP" | "BE" | "SL" = "BE";
    if (s.status === "SL_HIT") {
      slCount += 1;
      bucket = "SL";
    } else if (s.status === "BREAKEVEN") {
      beCount += 1;
      bucket = "BE";
    } else if (s.status === "TP1_HIT" || s.status === "TP2_HIT" || s.status === "TP3_HIT") {
      tpCount += 1;
      bucket = "TP";
    } else {
      expiredCount += 1;
      if (pnl > 0) {
        tpCount += 1;
        bucket = "TP";
      } else if (pnl < 0) {
        slCount += 1;
        bucket = "SL";
      } else {
        beCount += 1;
        bucket = "BE";
      }
    }

    if (!bestSignal || pnl > bestSignal.finalPnlPct) {
      bestSignal = { symbol: s.symbol, status: s.status, finalPnlPct: pnl, closedAt: s.closedAt };
    }
    if (!worstSignal || pnl < worstSignal.finalPnlPct) {
      worstSignal = { symbol: s.symbol, status: s.status, finalPnlPct: pnl, closedAt: s.closedAt };
    }

    const coin = coinMap.get(s.symbol) ?? { symbol: s.symbol, total: 0, tp: 0, be: 0, sl: 0, netPnlPct: 0 };
    coin.total += 1;
    if (bucket === "TP") coin.tp += 1;
    else if (bucket === "SL") coin.sl += 1;
    else coin.be += 1;
    coin.netPnlPct = Number((coin.netPnlPct + pnl).toFixed(2));
    coinMap.set(s.symbol, coin);
  }

  // Compute max cumulative drawdown chronologically (oldest -> newest)
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    equity += closed[i].finalPnlPct ?? 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }

  const closedCount = closed.length + a.closedCount;
  const signalWinRatePct = closedCount > 0 ? Number(((winsCount / closedCount) * 100).toFixed(1)) : 0;
  const accuracyPct = closedCount > 0 ? Number((((tpCount + beCount) / closedCount) * 100).toFixed(1)) : 0;
  const totalNetPnlPct = Number(totalNet.toFixed(2));
  const totalRunnerPnlPct = Number(totalRunner.toFixed(2));
  const grossWinPct = Number(grossWin.toFixed(2));
  const grossLossPct = Number(grossLoss.toFixed(2));
  const profitFactor =
    grossLossPct > 0 ? Number((grossWinPct / grossLossPct).toFixed(2)) : grossWinPct > 0 ? 99 : 0;
  const avgPnlPct = closedCount > 0 ? Number((totalNetPnlPct / closedCount).toFixed(2)) : 0;
  const byCoinAllTime = Array.from(coinMap.values()).sort((a1, b1) => b1.netPnlPct - a1.netPnlPct);

  return {
    activeCount: state.active.length,
    atRiskActiveCount: getAtRiskActiveCount(),
    closedCount,
    winsCount,
    tpCount,
    beCount,
    slCount,
    expiredCount,
    signalWinRatePct,
    accuracyPct,
    totalNetPnlPct,
    totalRunnerPnlPct,
    grossWinPct,
    grossLossPct,
    profitFactor,
    avgPnlPct,
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    bestSignal,
    worstSignal,
    byCoinAllTime,
    circuitBreaker: getCircuitBreakerStatus(now),
    activeSignals: state.active,
    recentHistory: closed.slice(0, 20)
  };
}

export function formatAllTimeTrackerTelegramText(now = Date.now()): string {
  const s = getSignalTrackerSummary(now);
  const sign = s.totalNetPnlPct >= 0 ? "+" : "";
  const avgSign = s.avgPnlPct >= 0 ? "+" : "";
  const cbText = s.circuitBreaker.active
    ? `🚨 FAOL (${Math.ceil(s.circuitBreaker.remainingSec / 60)} daq pauza)`
    : `✅ SOKIN (${s.circuitBreaker.recentSlCount}/${s.circuitBreaker.threshold} SL / 2s)`;

  const lines = [
    `🏆 *UMUMIY SIGNAL TRACKER NATIJALARI (BARCHA VAQT)*`,
    `• *Jami yopilgan:* ${s.closedCount} ta | *Faol:* ${s.activeCount} ta (Risk ostida: ${s.atRiskActiveCount})`,
    `• *Taqsimot:* ✅ ${s.tpCount} TP | ⚖️ ${s.beCount} BE | 🛑 ${s.slCount} SL`,
    `• *Aniqlik (TP+BE):* ${s.accuracyPct}% | *Profit Factor:* ${s.profitFactor}`,
    `• *Umumiy Sof Natija:* *${sign}${s.totalNetPnlPct}%* (O'rtacha: ${avgSign}${s.avgPnlPct}% | MaxDD: -${s.maxDrawdownPct}%)`,
    `• *SL Circuit Breaker:* ${cbText}`
  ];

  if (s.bestSignal) {
    const bs = s.bestSignal.finalPnlPct >= 0 ? "+" : "";
    lines.push(`• *Eng yaxshi signal:* \`${s.bestSignal.symbol}\` (*${bs}${s.bestSignal.finalPnlPct}%*)`);
  }

  return lines.join("\n");
}

export function resetSignalTrackerForTest(): void {
  state = { active: [], history: [], archivedTotals: emptyArchivedTotals() };
  saveState();
}
