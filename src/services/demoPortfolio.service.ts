import fs from "fs";
import path from "path";
import { EvaluatedSignalRecord } from "./pipeline.service";

export type DemoTradeStatus = "OPEN" | "TP_HIT" | "SL_HIT" | "EXPIRED";

export interface DemoTradeItem {
  id: string;
  symbol: string;
  exchange: "MEXC";
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
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
  openTrades: DemoTradeItem[];
  recentClosedTrades: DemoTradeItem[];
  updatedAt: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "demo_portfolio.json");
const MAX_OPEN_TRADES = 5;
const POSITION_ALLOCATION_PCT = 0.1; // 10% per trade
const MAX_HOLD_MS = 24 * 60 * 60 * 1000; // 24h expiry

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

function loadStateFromDisk(): DemoPortfolioState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as DemoPortfolioState;
      if (parsed && typeof parsed.currentBalanceUsd === "number") {
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

export function openDemoTradeFromSignal(record: EvaluatedSignalRecord): DemoTradeItem | null {
  if (record.criticRisk.verdict !== "APPROVE") return null;

  const alreadyOpen = portfolioState.openTrades.some((t) => t.symbol === record.scout.symbol);
  if (alreadyOpen) return null;
  if (portfolioState.openTrades.length >= MAX_OPEN_TRADES) return null;

  const positionSizeUsd = Number(
    Math.max(25, portfolioState.currentBalanceUsd * POSITION_ALLOCATION_PCT).toFixed(2)
  );

  const trade: DemoTradeItem = {
    id: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    symbol: record.scout.symbol,
    exchange: "MEXC",
    entryPrice: record.technician.entryPrice,
    takeProfitPrice: record.technician.takeProfitPrice,
    stopLossPrice: record.technician.stopLossPrice,
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

  portfolioState.openTrades.push(trade);
  persistState();
  return trade;
}

export function evaluateOpenDemoTrades(
  priceMap: Map<string, number>,
  now = Date.now()
): DemoTradeItem[] {
  const newlyClosed: DemoTradeItem[] = [];
  const stillOpen: DemoTradeItem[] = [];

  for (const trade of portfolioState.openTrades) {
    const livePrice = priceMap.get(trade.symbol);
    if (!livePrice || !Number.isFinite(livePrice) || livePrice <= 0) {
      stillOpen.push(trade);
      continue;
    }

    let closeStatus: DemoTradeStatus | null = null;
    let exitPrice = livePrice;

    if (livePrice >= trade.takeProfitPrice) {
      closeStatus = "TP_HIT";
      exitPrice = trade.takeProfitPrice;
    } else if (livePrice <= trade.stopLossPrice) {
      closeStatus = "SL_HIT";
      exitPrice = trade.stopLossPrice;
    } else if (now - new Date(trade.openedAt).getTime() >= MAX_HOLD_MS) {
      closeStatus = "EXPIRED";
      exitPrice = livePrice;
    }

    if (!closeStatus) {
      stillOpen.push(trade);
      continue;
    }

    const pnlPercent = Number((((exitPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2));
    const pnlUsd = Number(((trade.positionSizeUsd * pnlPercent) / 100).toFixed(2));

    trade.status = closeStatus;
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
    newlyClosed.push(trade);
  }

  portfolioState.openTrades = stillOpen;
  if (newlyClosed.length > 0) {
    persistState();
  }
  return newlyClosed;
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
    openTrades: portfolioState.openTrades,
    recentClosedTrades: closed.slice(0, 20),
    updatedAt: portfolioState.updatedAt
  };
}

export function resetDemoPortfolioForTest(): void {
  portfolioState = createDefaultState();
}
