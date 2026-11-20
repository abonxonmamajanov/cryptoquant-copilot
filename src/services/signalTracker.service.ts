import fs from "fs";
import path from "path";
import { EvaluatedSignalRecord } from "./pipeline.service";

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
  status: TrackedSignalOutcome;
  telegramMessageId: number | null;
  sentAt: string;
  closedAt: string | null;
  finalPnlPct: number | null;
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

const DATA_DIR = path.join(process.cwd(), "data");
const TRACKER_FILE = path.join(DATA_DIR, "tracked_signals.json");
const MAX_HOLD_INTRADAY_MS = 24 * 60 * 60 * 1000;
const MAX_HOLD_SWING_MS = 5 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BRAND_MOTTO = "Tez foyda emas — doimiy xotirjam, aniq savdo";

interface TrackerState {
  active: TrackedSignalItem[];
  history: TrackedSignalItem[];
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

function normalizeTrackedItem(raw: Partial<TrackedSignalItem>): TrackedSignalItem {
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
    status: (raw.status as TrackedSignalOutcome) ?? "ACTIVE",
    telegramMessageId: typeof raw.telegramMessageId === "number" ? raw.telegramMessageId : null,
    sentAt: String(raw.sentAt ?? new Date().toISOString()),
    closedAt: raw.closedAt ?? null,
    finalPnlPct: typeof raw.finalPnlPct === "number" ? raw.finalPnlPct : null
  };
}

let state: TrackerState = loadState();

function loadState(): TrackerState {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TRACKER_FILE, "utf-8")) as TrackerState;
      if (Array.isArray(parsed.active) && Array.isArray(parsed.history)) {
        return {
          active: parsed.active.map(normalizeTrackedItem),
          history: parsed.history.map(normalizeTrackedItem)
        };
      }
    }
  } catch {
    // Fallback
  }
  return { active: [], history: [] };
}

function saveState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}

export function registerDispatchedSignal(
  record: EvaluatedSignalRecord,
  telegramMessageId: number | null = null
): TrackedSignalItem {
  // Replace any older active tracker for the same symbol to avoid duplicate alerts
  state.active = state.active.filter((s) => s.symbol !== record.scout.symbol);

  const entry = record.technician.entryPrice;
  const tp2 = record.technician.tp2Price ?? record.technician.takeProfitPrice;
  const risk = Math.max(entry - record.technician.stopLossPrice, entry * 0.005);
  const tp1 = record.technician.tp1Price ?? Number((entry + risk * 1.35).toFixed(5));
  const tp3 = record.technician.tp3Price ?? Number((entry + risk * 3.4).toFixed(5));

  const item: TrackedSignalItem = {
    id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol: record.scout.symbol,
    tradeMode: record.criticRisk.tradeMode ?? "INTRADAY",
    entryPrice: entry,
    tp1Price: tp1,
    tp2Price: tp2,
    tp3Price: tp3,
    stopLossPrice: record.technician.stopLossPrice,
    initialStopLossPrice: record.technician.stopLossPrice,
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    status: "ACTIVE",
    telegramMessageId: typeof telegramMessageId === "number" ? telegramMessageId : null,
    sentAt: new Date().toISOString(),
    closedAt: null,
    finalPnlPct: null
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

    const pnlPct = Number((((live - sig.entryPrice) / sig.entryPrice) * 100).toFixed(2));
    const sign = pnlPct >= 0 ? "+" : "";
    const tashkentSentTime = formatTashkentTime(sig.sentAt);

    // Check TP3 (Full Win & Close)
    if (live >= sig.tp3Price) {
      sig.tp1Hit = true;
      sig.tp2Hit = true;
      sig.tp3Hit = true;
      sig.status = "TP3_HIT";
      sig.closedAt = new Date(now).toISOString();
      sig.finalPnlPct = Number((((sig.tp3Price - sig.entryPrice) / sig.entryPrice) * 100).toFixed(2));
      state.history.unshift(sig);
      changed = true;
      alerts.push({
        signal: sig,
        eventType: "TP3_HIT",
        livePrice: live,
        pnlPct: sig.finalPnlPct,
        replyToMessageId: sig.telegramMessageId,
        telegramText: [
          `🚀 *SIGNAL NATIJASI: ${sig.symbol} — TP3 (MAX) URILDI!*`,
          ``,
          `🕒 Signal vaqti: \`${tashkentSentTime}\``,
          `🎯 Kirish: \`${sig.entryPrice}\` → TP3: \`${sig.tp3Price}\``,
          `💰 Joriy narx: \`${live}\``,
          `📈 Foyda: *+${sig.finalPnlPct}%* (${sig.tradeMode})`
        ].join("\n")
      });
      continue;
    }

    // Check TP2 (Milestone Alert, keep tracking toward TP3)
    if (!sig.tp2Hit && live >= sig.tp2Price) {
      sig.tp1Hit = true;
      sig.tp2Hit = true;
      sig.stopLossPrice = sig.tp1Price; // Trail SL up to TP1
      sig.status = "TP2_HIT";
      changed = true;
      const tp2Pct = Number((((sig.tp2Price - sig.entryPrice) / sig.entryPrice) * 100).toFixed(2));
      alerts.push({
        signal: sig,
        eventType: "TP2_HIT",
        livePrice: live,
        pnlPct: tp2Pct,
        replyToMessageId: sig.telegramMessageId,
        telegramText: [
          `✅ *SIGNAL NATIJASI: ${sig.symbol} — TP2 URILDI!*`,
          ``,
          `🕒 Signal vaqti: \`${tashkentSentTime}\``,
          `🎯 Kirish: \`${sig.entryPrice}\` → TP2: \`${sig.tp2Price}\``,
          `💰 Joriy narx: \`${live}\``,
          `📈 Foyda: *+${tp2Pct}%* | 🛡️ SL endi TP1 (\`${sig.tp1Price}\`) ga surildi`
        ].join("\n")
      });
      stillActive.push(sig);
      continue;
    }

    // Check TP1 (Milestone Alert + Move SL to Breakeven)
    if (!sig.tp1Hit && live >= sig.tp1Price) {
      sig.tp1Hit = true;
      sig.stopLossPrice = sig.entryPrice;
      sig.status = "TP1_HIT";
      changed = true;
      const tp1Pct = Number((((sig.tp1Price - sig.entryPrice) / sig.entryPrice) * 100).toFixed(2));
      alerts.push({
        signal: sig,
        eventType: "TP1_HIT",
        livePrice: live,
        pnlPct: tp1Pct,
        replyToMessageId: sig.telegramMessageId,
        telegramText: [
          `🎯 *SIGNAL NATIJASI: ${sig.symbol} — 1-TP (TP1) OLINDI!*`,
          ``,
          `🕒 Signal vaqti: \`${tashkentSentTime}\``,
          `🎯 Kirish: \`${sig.entryPrice}\` → TP1: \`${sig.tp1Price}\``,
          `💰 Joriy narx: \`${live}\``,
          `📈 Foyda: *+${tp1Pct}%* | 🛡️ SL kirish narxiga (Breakeven: \`${sig.entryPrice}\`) surildi`
        ].join("\n")
      });
      stillActive.push(sig);
      continue;
    }

    // Check SL / Breakeven Exit
    if (live <= sig.stopLossPrice) {
      const isBe = sig.tp1Hit;
      sig.status = isBe ? "BREAKEVEN" : "SL_HIT";
      sig.closedAt = new Date(now).toISOString();
      sig.finalPnlPct = Number((((sig.stopLossPrice - sig.entryPrice) / sig.entryPrice) * 100).toFixed(2));
      state.history.unshift(sig);
      changed = true;
      alerts.push({
        signal: sig,
        eventType: isBe ? "BREAKEVEN" : "SL_HIT",
        livePrice: live,
        pnlPct: sig.finalPnlPct,
        replyToMessageId: sig.telegramMessageId,
        telegramText: isBe
          ? [
              `⚖️ *SIGNAL NATIJASI: ${sig.symbol} — BREAKEVEN (ZARARSIZ YOPILDI)*`,
              ``,
              `🕒 Signal vaqti: \`${tashkentSentTime}\``,
              `🎯 Kirish: \`${sig.entryPrice}\` → Yopilish: \`${sig.stopLossPrice}\` (TP1 avval olingan edi)`,
              `💰 Joriy narx: \`${live}\``
            ].join("\n")
          : [
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

    // Check Expiry
    const maxHold = sig.tradeMode === "SWING" ? MAX_HOLD_SWING_MS : MAX_HOLD_INTRADAY_MS;
    if (now - new Date(sig.sentAt).getTime() >= maxHold) {
      sig.status = "EXPIRED";
      sig.closedAt = new Date(now).toISOString();
      sig.finalPnlPct = pnlPct;
      state.history.unshift(sig);
      changed = true;
      alerts.push({
        signal: sig,
        eventType: "EXPIRED",
        livePrice: live,
        pnlPct,
        replyToMessageId: sig.telegramMessageId,
        telegramText: [
          `⌛ *SIGNAL MUDDATI TUGADI: ${sig.symbol}*`,
          ``,
          `🕒 Signal vaqti: \`${tashkentSentTime}\``,
          `🎯 Kirish: \`${sig.entryPrice}\` → Hozirgi: \`${live}\` (${sign}${pnlPct}%)`,
          `💰 Joriy narx: \`${live}\``
        ].join("\n")
      });
      continue;
    }

    stillActive.push(sig);
  }

  state.active = stillActive;
  if (state.history.length > 100) state.history = state.history.slice(0, 100);
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
        const milestonePrice = s.tp2Hit ? s.tp2Price : s.tp1Price;
        pnl = s.entryPrice > 0 ? Number((((milestonePrice - s.entryPrice) / s.entryPrice) * 100).toFixed(2)) : 0;
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
    `🎯 *Jami signallar:* ${total} ta | *Aniqlik:* ${accuracyPct}%`,
    `✅ *TP:* ${tpCount} | ⚖️ *Breakeven:* ${beCount} | 🛑 *SL:* ${slCount}`,
    `💰 *Jami sof natija:* ${netSign}${netPnlPct}%`,
    ``,
    `🪙 *Koinlar kesimida:*`,
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

export function getSignalTrackerSummary() {
  const closed = state.history;
  const wins = closed.filter((s) => s.tp1Hit || (s.finalPnlPct ?? 0) > 0).length;
  const slCount = closed.filter((s) => s.status === "SL_HIT").length;
  const winRatePct = closed.length > 0 ? Number(((wins / closed.length) * 100).toFixed(1)) : 0;
  return {
    activeCount: state.active.length,
    closedCount: closed.length,
    winsCount: wins,
    slCount,
    signalWinRatePct: winRatePct,
    activeSignals: state.active,
    recentHistory: closed.slice(0, 20)
  };
}

export function resetSignalTrackerForTest(): void {
  state = { active: [], history: [] };
}
