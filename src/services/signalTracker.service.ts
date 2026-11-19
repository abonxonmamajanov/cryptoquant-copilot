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
  sentAt: string;
  closedAt: string | null;
  finalPnlPct: number | null;
}

export interface SignalMilestoneAlert {
  signal: TrackedSignalItem;
  eventType: "TP1_HIT" | "TP2_HIT" | "TP3_HIT" | "BREAKEVEN" | "SL_HIT" | "EXPIRED";
  livePrice: number;
  pnlPct: number;
  telegramText: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const TRACKER_FILE = path.join(DATA_DIR, "tracked_signals.json");
const MAX_HOLD_INTRADAY_MS = 24 * 60 * 60 * 1000;
const MAX_HOLD_SWING_MS = 5 * 24 * 60 * 60 * 1000;

interface TrackerState {
  active: TrackedSignalItem[];
  history: TrackedSignalItem[];
}

let state: TrackerState = loadState();

function loadState(): TrackerState {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TRACKER_FILE, "utf-8")) as TrackerState;
      if (Array.isArray(parsed.active) && Array.isArray(parsed.history)) return parsed;
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

export function registerDispatchedSignal(record: EvaluatedSignalRecord): TrackedSignalItem {
  // Replace any older active tracker for the same symbol to avoid duplicate alerts
  state.active = state.active.filter((s) => s.symbol !== record.scout.symbol);

  const entry = record.technician.entryPrice;
  const tp2 = record.technician.tp2Price ?? record.technician.takeProfitPrice;
  const risk = Math.max(entry - record.technician.stopLossPrice, entry * 0.005);
  const tp1 = record.technician.tp1Price ?? Number((entry + risk * 1.3).toFixed(5));
  const tp3 = record.technician.tp3Price ?? Number((entry + risk * 3.2).toFixed(5));

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
        telegramText: `🚀 *SIGNAL NATIJASI: ${sig.symbol} — TP3 (MAX) URILDI!*\n\n🎯 Kirish: \`${sig.entryPrice}\` → TP3: \`${sig.tp3Price}\`\n📈 Foyda: *+${sig.finalPnlPct}%* (${sig.tradeMode})`
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
        telegramText: `✅ *SIGNAL NATIJASI: ${sig.symbol} — TP2 URILDI!*\n\n🎯 Kirish: \`${sig.entryPrice}\` → TP2: \`${sig.tp2Price}\`\n📈 Foyda: *+${tp2Pct}%* | 🛡️ SL endi TP1 (\`${sig.tp1Price}\`) ga surildi`
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
        telegramText: `🎯 *SIGNAL NATIJASI: ${sig.symbol} — 1-TP (TP1) OLINDI!*\n\n🎯 Kirish: \`${sig.entryPrice}\` → TP1: \`${sig.tp1Price}\`\n📈 Foyda: *+${tp1Pct}%* | 🛡️ SL kirish narxiga (Breakeven: \`${sig.entryPrice}\`) surildi`
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
        telegramText: isBe
          ? `⚖️ *SIGNAL NATIJASI: ${sig.symbol} — BREAKEVEN (ZARARSIZ YOPILDI)*\n\n🎯 Kirish: \`${sig.entryPrice}\` → Yopilish: \`${sig.stopLossPrice}\` (TP1 avval olingan edi)`
          : `🛑 *SIGNAL NATIJASI: ${sig.symbol} — STOP-LOSS (SL) OLINDI*\n\n🎯 Kirish: \`${sig.entryPrice}\` → SL: \`${sig.stopLossPrice}\`\n📉 Natija: *${sig.finalPnlPct}%* (${sig.tradeMode})`
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
        telegramText: `⌛ *SIGNAL MUDDATI TUGADI: ${sig.symbol}*\n\n🎯 Kirish: \`${sig.entryPrice}\` → Hozirgi: \`${live}\` (${sign}${pnlPct}%)`
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
