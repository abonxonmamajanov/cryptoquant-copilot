import fs from "fs";
import path from "path";
import { EvaluatedSignalRecord } from "./pipeline.service";
import type { TradeMode } from "../agents/technician.agent";

export type DemoTradeStatus =
  | "OPEN"
  | "TP_HIT"
  | "SL_HIT"
  | "BREAKEVEN_EXIT"
  | "EXPIRED"
  | "MANUAL_CLOSE";

export type DemoTradeSource = "AUTO" | "MANUAL";

export interface DemoTradeItem {
  id: string;
  symbol: string;
  exchange: "MEXC";
  source: DemoTradeSource;
  tradeMode: TradeMode;
  entryPrice: number;
  takeProfitPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  stopLossPrice: number;
  initialStopLossPrice?: number;
  tp1Hit: boolean;
  breakevenActive: boolean;
  trailingStep2Active?: boolean;
  convictionMultiplier?: 0.5 | 1.0 | 1.5;
  entryRsi: number;
  entryBtc1hPct: number;
  entrySpreadPct: number;
  slPostMortemReason: string | null;
  riskRewardRatio: number;
  confidenceScore: number;
  positionSizeUsd: number;
  status: DemoTradeStatus;
  exitPrice: number | null;
  pnlUsd: number | null;
  pnlPercent: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface ModeStats {
  total: number;
  wins: number;
  winRatePct: number;
}

export interface DemoPortfolioState {
  name: string;
  initialBalanceUsd: number;
  currentBalanceUsd: number;
  peakBalanceUsd: number;
  maxDrawdownPct: number;
  openTrades: DemoTradeItem[];
  closedTrades: DemoTradeItem[];
  updatedAt: string;
}

export interface DemoPortfolioSummary {
  name: string;
  initialBalanceUsd: number;
  currentBalanceUsd: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  openTradesCount: number;
  closedTradesCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  intradayStats: ModeStats;
  swingStats: ModeStats;
  slPostMortemBreakdown: Record<string, number>;
  openTrades: DemoTradeItem[];
  recentClosedTrades: DemoTradeItem[];
  updatedAt: string;
}

export interface ManualTradeActionResult {
  ok: boolean;
  trade?: DemoTradeItem;
  error?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "demo_portfolio.json");
const MAX_OPEN_TRADES = 5;
const POSITION_ALLOCATION_PCT = 0.1; // 10% base allocation per trade (scaled by 0.5x / 1.0x / 1.5x conviction)
const DEMO_TP1_WEIGHT = 0.6;
const DEMO_TP2_WEIGHT = 0.4;
const MAX_HOLD_INTRADAY_MS = 24 * 60 * 60 * 1000; // 24h expiry for intraday
const MAX_HOLD_SWING_MS = 72 * 60 * 60 * 1000; // 72h expiry for swing

function roundDemoPrice(price: number): number {
  if (price >= 100) return Number(price.toFixed(2));
  if (price >= 1) return Number(price.toFixed(4));
  if (price >= 0.01) return Number(price.toFixed(5));
  return Number(price.toFixed(7));
}

// Lazy optional Prisma client for non-blocking PostgreSQL sync
let prismaClientInstance: unknown = null;
let prismaInitAttempted = false;

function hasPostgresUrl(): boolean {
  const url = String(process.env.DATABASE_URL || "").trim();
  return url.startsWith("postgresql://") && !url.includes("USER:PASSWORD@HOST");
}

function getOptionalPrisma(): {
  signal: { create: (args: unknown) => Promise<unknown> };
} | null {
  if (!hasPostgresUrl()) return null;
  if (!prismaInitAttempted) {
    prismaInitAttempted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PrismaClient } = require("@prisma/client") as { PrismaClient: new () => unknown };
      prismaClientInstance = new PrismaClient();
    } catch {
      prismaClientInstance = null;
    }
  }
  return prismaClientInstance as {
    signal: { create: (args: unknown) => Promise<unknown> };
  } | null;
}

function syncSignalToPostgresNonBlocking(
  trade: DemoTradeItem,
  status: "APPROVED" | "TP_HIT" | "SL_HIT" | "EXPIRED"
): void {
  try {
    const prisma = getOptionalPrisma();
    if (!prisma) return;
    prisma.signal
      .create({
        data: {
          symbol: trade.symbol,
          exchange: trade.exchange,
          direction: "LONG",
          status,
          entryPrice: trade.entryPrice,
          takeProfitPrice: trade.takeProfitPrice,
          stopLossPrice: trade.stopLossPrice,
          riskRewardRatio: trade.riskRewardRatio,
          confidenceScore: trade.confidenceScore,
          rejectReason: trade.slPostMortemReason
        }
      })
      .catch(() => {
        // Non-blocking: never crash trading if DB is unreachable
      });
  } catch {
    // Non-fatal
  }
}

function createDefaultState(): DemoPortfolioState {
  return {
    name: "CryptoQuant-Copilot Demo Portfel",
    initialBalanceUsd: 1000,
    currentBalanceUsd: 1000,
    peakBalanceUsd: 1000,
    maxDrawdownPct: 0,
    openTrades: [],
    closedTrades: [],
    updatedAt: new Date().toISOString()
  };
}

let portfolioState: DemoPortfolioState = loadStateFromDisk();

function normalizeLoadedTrade(t: Partial<DemoTradeItem>): DemoTradeItem {
  const entry = Number(t.entryPrice ?? 0);
  const tp = Number(t.takeProfitPrice ?? entry);
  const sl = Number(t.stopLossPrice ?? entry);
  const conv = t.convictionMultiplier === 0.5 || t.convictionMultiplier === 1.5 ? t.convictionMultiplier : 1.0;
  return {
    id: String(t.id ?? `demo_${Date.now()}`),
    symbol: String(t.symbol ?? ""),
    exchange: "MEXC",
    source: t.source === "MANUAL" ? "MANUAL" : "AUTO",
    tradeMode: t.tradeMode === "SWING" ? "SWING" : "INTRADAY",
    entryPrice: entry,
    takeProfitPrice: tp,
    tp1Price: Number(t.tp1Price ?? entry + (tp - entry) * 0.6),
    tp2Price: Number(t.tp2Price ?? tp),
    tp3Price: Number(t.tp3Price ?? entry + (tp - entry) * 1.35),
    stopLossPrice: sl,
    initialStopLossPrice: Number(t.initialStopLossPrice ?? sl),
    tp1Hit: Boolean(t.tp1Hit),
    breakevenActive: Boolean(t.breakevenActive),
    trailingStep2Active: Boolean(t.trailingStep2Active),
    convictionMultiplier: conv,
    entryRsi: Number(t.entryRsi ?? 50),
    entryBtc1hPct: Number(t.entryBtc1hPct ?? 0),
    entrySpreadPct: Number(t.entrySpreadPct ?? 0),
    slPostMortemReason: t.slPostMortemReason ?? null,
    riskRewardRatio: Number(t.riskRewardRatio ?? 2),
    confidenceScore: Number(t.confidenceScore ?? 60),
    positionSizeUsd: Number(t.positionSizeUsd ?? 100),
    status: (t.status as DemoTradeStatus) ?? "OPEN",
    exitPrice: t.exitPrice ?? null,
    pnlUsd: t.pnlUsd ?? null,
    pnlPercent: t.pnlPercent ?? null,
    openedAt: String(t.openedAt ?? new Date().toISOString()),
    closedAt: t.closedAt ?? null
  };
}

function loadStateFromDisk(): DemoPortfolioState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as DemoPortfolioState;
      if (parsed && typeof parsed.currentBalanceUsd === "number") {
        parsed.openTrades = (parsed.openTrades || []).map(normalizeLoadedTrade);
        parsed.closedTrades = (parsed.closedTrades || []).map(normalizeLoadedTrade);
        return parsed;
      }
    }
  } catch {
    // Fallback to clean state
  }
  return createDefaultState();
}

function persistState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    portfolioState.updatedAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(portfolioState, null, 2), "utf-8");
  } catch {
    // Non-fatal on ephemeral filesystems
  }
}

function classifySlPostMortem(trade: DemoTradeItem): string {
  if (trade.entryRsi > 70) return "RSI yuqori edi";
  if (trade.entrySpreadPct > 0.25) return "Spread keng edi";
  if (trade.entryBtc1hPct < -0.5) return "BTC bosimi";
  return "Bozor volatilligi / soxta impuls";
}

function buildDemoTradeItem(
  record: EvaluatedSignalRecord,
  positionSizeUsd: number,
  source: DemoTradeSource
): DemoTradeItem {
  const entry = record.technician.entryPrice;
  const tp2 = record.technician.tp2Price ?? record.technician.takeProfitPrice;
  const risk = Math.max(entry - record.technician.stopLossPrice, entry * 0.008);
  const tradeMode: TradeMode =
    record.criticRisk.tradeMode ?? record.technician.tradeMode ?? "INTRADAY";
  const tp1 =
    record.technician.tp1Price ??
    roundDemoPrice(entry + risk * (tradeMode === "SWING" ? 2.0 : 1.8));
  const tp3 =
    record.technician.tp3Price ??
    roundDemoPrice(entry + risk * (tradeMode === "SWING" ? 4.6 : 4.0));
  const convictionMultiplier = record.criticRisk.suggestedSizeMultiplier ?? 1.0;

  return {
    id: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    symbol: record.scout.symbol,
    exchange: "MEXC",
    source,
    tradeMode,
    entryPrice: entry,
    takeProfitPrice: tp2,
    tp1Price: tp1,
    tp2Price: tp2,
    tp3Price: tp3,
    stopLossPrice: record.technician.stopLossPrice,
    initialStopLossPrice: record.technician.stopLossPrice,
    tp1Hit: false,
    breakevenActive: false,
    trailingStep2Active: false,
    convictionMultiplier,
    entryRsi: record.technician.rsi14,
    entryBtc1hPct: record.macroFlow.btcChange1hPct,
    entrySpreadPct: record.macroFlow.spreadPct,
    slPostMortemReason: null,
    riskRewardRatio: record.technician.riskRewardRatio,
    confidenceScore: record.criticRisk.confidenceScore,
    positionSizeUsd,
    status: "OPEN",
    exitPrice: null,
    pnlUsd: null,
    pnlPercent: null,
    openedAt: new Date().toISOString(),
    closedAt: null
  };
}

function applyClosedTradePnl(
  trade: DemoTradeItem,
  exitPrice: number,
  status: DemoTradeStatus,
  now = Date.now()
): void {
  // Stage 6.1 Wall Street 60% / 40% partial exit math:
  // If TP1 was hit, 60% was already locked at TP1 and remaining 40% closes at exitPrice!
  let pnlPercent: number;
  if (trade.tp1Hit) {
    const tp1Pct = ((trade.tp1Price - trade.entryPrice) / trade.entryPrice) * 100;
    const remPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
    pnlPercent = Number((DEMO_TP1_WEIGHT * tp1Pct + DEMO_TP2_WEIGHT * remPct).toFixed(2));
  } else {
    pnlPercent = Number((((exitPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2));
  }
  const pnlUsd = Number(((trade.positionSizeUsd * pnlPercent) / 100).toFixed(2));

  trade.status = status;
  trade.exitPrice = exitPrice;
  trade.pnlPercent = pnlPercent;
  trade.pnlUsd = pnlUsd;
  trade.closedAt = new Date(now).toISOString();

  portfolioState.currentBalanceUsd = Number((portfolioState.currentBalanceUsd + pnlUsd).toFixed(2));
  if (portfolioState.currentBalanceUsd > portfolioState.peakBalanceUsd) {
    portfolioState.peakBalanceUsd = portfolioState.currentBalanceUsd;
  }
  const dd =
    portfolioState.peakBalanceUsd > 0
      ? ((portfolioState.peakBalanceUsd - portfolioState.currentBalanceUsd) /
          portfolioState.peakBalanceUsd) *
        100
      : 0;
  if (dd > portfolioState.maxDrawdownPct) {
    portfolioState.maxDrawdownPct = Number(dd.toFixed(2));
  }

  portfolioState.closedTrades.unshift(trade);
}

export function openDemoTradeFromSignal(record: EvaluatedSignalRecord): DemoTradeItem | null {
  if (record.criticRisk.verdict !== "APPROVE") return null;

  const alreadyOpen = portfolioState.openTrades.some((t) => t.symbol === record.scout.symbol);
  if (alreadyOpen) return null;
  if (portfolioState.openTrades.length >= MAX_OPEN_TRADES) return null;

  const convictionMult = record.criticRisk.suggestedSizeMultiplier ?? 1.0;
  const rawSize = portfolioState.currentBalanceUsd * POSITION_ALLOCATION_PCT * convictionMult;
  const positionSizeUsd = Number(
    Math.max(25, Math.min(portfolioState.currentBalanceUsd * 0.25, rawSize)).toFixed(2)
  );

  const trade = buildDemoTradeItem(record, positionSizeUsd, "AUTO");
  portfolioState.openTrades.push(trade);
  persistState();
  syncSignalToPostgresNonBlocking(trade, "APPROVED");
  return trade;
}

export function openManualDemoTrade(
  record: EvaluatedSignalRecord,
  customSizeUsd?: number
): ManualTradeActionResult {
  const symbol = record.scout.symbol.toUpperCase().trim();
  const alreadyOpen = portfolioState.openTrades.some((t) => t.symbol === symbol);
  if (alreadyOpen) {
    return {
      ok: false,
      error: "Bu koin allaqachon ochiq pozitsiyada bor"
    };
  }

  if (portfolioState.currentBalanceUsd < 10) {
    return {
      ok: false,
      error: `Demo balans yetarli emas ($${portfolioState.currentBalanceUsd.toFixed(2)} < $10)`
    };
  }

  let positionSizeUsd: number;
  if (customSizeUsd !== undefined && customSizeUsd !== null) {
    const parsed = Number(customSizeUsd);
    if (!Number.isFinite(parsed) || parsed < 10 || parsed > portfolioState.currentBalanceUsd) {
      return {
        ok: false,
        error: `Pozitsiya hajmi $10 dan $${portfolioState.currentBalanceUsd.toFixed(2)} gacha bo'lishi kerak`
      };
    }
    positionSizeUsd = Number(parsed.toFixed(2));
  } else {
    // Stage 6.1 Star-Rating Conviction Sizing default (3★=$50, 4★=$100, 5★=$150)
    const convictionMult = record.criticRisk.suggestedSizeMultiplier ?? 1.0;
    positionSizeUsd = Number(
      Math.max(10, Math.min(portfolioState.currentBalanceUsd, 100 * convictionMult)).toFixed(2)
    );
  }

  const trade = buildDemoTradeItem(record, positionSizeUsd, "MANUAL");
  portfolioState.openTrades.push(trade);
  persistState();
  syncSignalToPostgresNonBlocking(trade, "APPROVED");
  return { ok: true, trade };
}

export function closeDemoTradeManually(
  tradeIdOrSymbol: string,
  livePrice: number
): ManualTradeActionResult {
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return { ok: false, error: "Jonli narx noto'g'ri" };
  }

  const key = tradeIdOrSymbol.trim();
  const upperKey = key.toUpperCase();
  const normalizedSym = upperKey.endsWith("USDT") ? upperKey : `${upperKey}USDT`;

  const idx = portfolioState.openTrades.findIndex(
    (t) => t.id === key || t.symbol === upperKey || t.symbol === normalizedSym
  );

  if (idx === -1) {
    return {
      ok: false,
      error: `Ochiq demo pozitsiya topilmadi: ${upperKey}`
    };
  }

  const [trade] = portfolioState.openTrades.splice(idx, 1);
  applyClosedTradePnl(trade, livePrice, "MANUAL_CLOSE");
  persistState();
  syncSignalToPostgresNonBlocking(trade, (trade.pnlUsd ?? 0) >= 0 ? "TP_HIT" : "SL_HIT");

  return { ok: true, trade };
}

export function evaluateOpenDemoTrades(
  priceMap: Map<string, number>,
  now = Date.now(),
  tp1EventsOut?: DemoTradeItem[]
): DemoTradeItem[] {
  const newlyClosed: DemoTradeItem[] = [];
  const stillOpen: DemoTradeItem[] = [];
  let mutated = false;

  for (const trade of portfolioState.openTrades) {
    const livePrice = priceMap.get(trade.symbol);
    if (!livePrice || !Number.isFinite(livePrice) || livePrice <= 0) {
      stillOpen.push(trade);
      continue;
    }

    const baseSl = trade.initialStopLossPrice ?? trade.stopLossPrice;
    const risk = Math.max(trade.entryPrice - baseSl, trade.entryPrice * 0.008);
    const softProtectionSl = roundDemoPrice(trade.entryPrice - risk * 0.2); // -0.2R soft protection
    const trailTriggerPrice = trade.entryPrice + risk * 2.3; // +2.3R profit trail trigger
    const trailStep2Sl = roundDemoPrice(trade.entryPrice + risk * 0.5); // +0.5R profit lock

    // 1. Check TP1 60% Partial Exit + Soft -0.2R SL protection (or instant +0.5R if >= 2.3R)
    if (!trade.tp1Hit && livePrice >= trade.tp1Price && livePrice < trade.takeProfitPrice) {
      trade.tp1Hit = true;
      trade.breakevenActive = true;
      if (livePrice >= trailTriggerPrice) {
        trade.trailingStep2Active = true;
        trade.stopLossPrice = trailStep2Sl;
      } else {
        trade.stopLossPrice = softProtectionSl;
      }
      mutated = true;
      if (tp1EventsOut) tp1EventsOut.push({ ...trade });
      stillOpen.push(trade);
      continue;
    }

    // 1b. Upgrade remaining 40% SL from -0.2R to +0.5R once price crosses +2.3R
    if (trade.tp1Hit && !trade.trailingStep2Active && livePrice >= trailTriggerPrice && livePrice < trade.takeProfitPrice) {
      trade.trailingStep2Active = true;
      trade.stopLossPrice = trailStep2Sl;
      mutated = true;
      stillOpen.push(trade);
      continue;
    }

    let closeStatus: DemoTradeStatus | null = null;
    let exitPrice = livePrice;
    const maxHoldMs = trade.tradeMode === "SWING" ? MAX_HOLD_SWING_MS : MAX_HOLD_INTRADAY_MS;

    if (livePrice >= trade.takeProfitPrice) {
      trade.tp1Hit = true;
      closeStatus = "TP_HIT";
      exitPrice = trade.takeProfitPrice;
    } else if (livePrice <= trade.stopLossPrice) {
      if (trade.tp1Hit) {
        closeStatus = trade.trailingStep2Active ? "TP_HIT" : "BREAKEVEN_EXIT";
        exitPrice = trade.stopLossPrice;
      } else {
        closeStatus = "SL_HIT";
        exitPrice = trade.stopLossPrice;
        trade.slPostMortemReason = classifySlPostMortem(trade);
      }
    } else if (now - new Date(trade.openedAt).getTime() >= maxHoldMs) {
      closeStatus = "EXPIRED";
      exitPrice = livePrice;
    }

    if (!closeStatus) {
      stillOpen.push(trade);
      continue;
    }

    applyClosedTradePnl(trade, exitPrice, closeStatus, now);
    newlyClosed.push(trade);
    mutated = true;

    const prismaStatus =
      closeStatus === "TP_HIT" ? "TP_HIT" : closeStatus === "SL_HIT" ? "SL_HIT" : "EXPIRED";
    syncSignalToPostgresNonBlocking(trade, prismaStatus);
  }

  portfolioState.openTrades = stillOpen;
  if (mutated) {
    persistState();
  }
  return newlyClosed;
}

function calcModeStats(trades: DemoTradeItem[], mode: TradeMode): ModeStats {
  const filtered = trades.filter((t) => (t.tradeMode ?? "INTRADAY") === mode);
  const wins = filtered.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const winRatePct = filtered.length > 0 ? Number(((wins / filtered.length) * 100).toFixed(1)) : 0;
  return { total: filtered.length, wins, winRatePct };
}

export function getDemoPortfolioSummary(): DemoPortfolioSummary {
  const closed = portfolioState.closedTrades;
  const winningTrades = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const losingTrades = closed.filter((t) => (t.pnlUsd ?? 0) < 0).length;
  const winRatePct = closed.length > 0 ? Number(((winningTrades / closed.length) * 100).toFixed(1)) : 0;

  const grossProfit = closed.reduce((sum, t) => sum + Math.max(0, t.pnlUsd ?? 0), 0);
  const grossLoss = closed.reduce((sum, t) => sum + Math.abs(Math.min(0, t.pnlUsd ?? 0)), 0);
  const profitFactor =
    grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99 : 0;

  const totalPnlUsd = Number(
    (portfolioState.currentBalanceUsd - portfolioState.initialBalanceUsd).toFixed(2)
  );
  const totalPnlPct = Number(
    ((totalPnlUsd / portfolioState.initialBalanceUsd) * 100).toFixed(2)
  );

  const slPostMortemBreakdown: Record<string, number> = {};
  for (const t of closed) {
    if (t.status === "SL_HIT" && t.slPostMortemReason) {
      slPostMortemBreakdown[t.slPostMortemReason] =
        (slPostMortemBreakdown[t.slPostMortemReason] ?? 0) + 1;
    }
  }

  return {
    name: portfolioState.name,
    initialBalanceUsd: portfolioState.initialBalanceUsd,
    currentBalanceUsd: portfolioState.currentBalanceUsd,
    totalPnlUsd,
    totalPnlPct,
    openTradesCount: portfolioState.openTrades.length,
    closedTradesCount: closed.length,
    winningTrades,
    losingTrades,
    winRatePct,
    profitFactor,
    maxDrawdownPct: portfolioState.maxDrawdownPct,
    intradayStats: calcModeStats(closed, "INTRADAY"),
    swingStats: calcModeStats(closed, "SWING"),
    slPostMortemBreakdown,
    openTrades: portfolioState.openTrades,
    recentClosedTrades: closed.slice(0, 20),
    updatedAt: portfolioState.updatedAt
  };
}

export function resetDemoPortfolioForTest(): void {
  portfolioState = createDefaultState();
}
