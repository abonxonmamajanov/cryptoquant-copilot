import fs from "fs";
import path from "path";
import { isFilteredOutSymbol } from "../agents/scout.agent";

export interface PriceAlertItem {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: "ABOVE" | "BELOW";
  createdAt: string;
}

export interface TriggeredPriceAlert {
  alert: PriceAlertItem;
  livePrice: number;
  telegramText: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const ALERTS_FILE = path.join(DATA_DIR, "price_alerts.json");
let alerts: PriceAlertItem[] = loadAlerts();

function loadAlerts(): PriceAlertItem[] {
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf-8"));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Fallback
  }
  return [];
}

function saveAlerts(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}

export function addPriceAlert(
  rawSymbol: string,
  targetPrice: number,
  currentPrice: number
): { ok: boolean; alert?: PriceAlertItem; error?: string } {
  const clean = rawSymbol.toUpperCase().trim().replace("/USDT", "");
  const symbol = clean.endsWith("USDT") ? clean : `${clean}USDT`;
  if (isFilteredOutSymbol(symbol)) {
    return { ok: false, error: `${symbol} stablecoin yoki ruxsat etilmagan juftlik.` };
  }
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    return { ok: false, error: "Maqsadli narx musbat son bo'lishi kerak." };
  }
  const direction: "ABOVE" | "BELOW" = targetPrice >= currentPrice ? "ABOVE" : "BELOW";
  const item: PriceAlertItem = {
    id: `pa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    targetPrice,
    direction,
    createdAt: new Date().toISOString()
  };
  alerts.unshift(item);
  saveAlerts();
  return { ok: true, alert: item };
}

export function listPriceAlerts(): PriceAlertItem[] {
  return [...alerts];
}

export function removePriceAlert(id: string): boolean {
  const before = alerts.length;
  alerts = alerts.filter((a) => a.id !== id);
  if (alerts.length !== before) {
    saveAlerts();
    return true;
  }
  return false;
}

export function evaluatePriceAlerts(priceMap: Map<string, number>): TriggeredPriceAlert[] {
  const triggered: TriggeredPriceAlert[] = [];
  const remaining: PriceAlertItem[] = [];

  for (const a of alerts) {
    const live = priceMap.get(a.symbol);
    if (!live || !Number.isFinite(live) || live <= 0) {
      remaining.push(a);
      continue;
    }
    const hit =
      (a.direction === "ABOVE" && live >= a.targetPrice) ||
      (a.direction === "BELOW" && live <= a.targetPrice);

    if (hit) {
      triggered.push({
        alert: a,
        livePrice: live,
        telegramText: `🔔 *SHAXSIY NARX ESLATMASI: ${a.symbol}*\n\n🎯 Maqsad: \`${a.targetPrice}\` (${a.direction === "ABOVE" ? "yuqoriga o'tdi 📈" : "pastga tushdi 📉"})\n💰 Hozirgi narx: \`${live}\``
      });
    } else {
      remaining.push(a);
    }
  }

  if (triggered.length > 0) {
    alerts = remaining;
    saveAlerts();
  }
  return triggered;
}

export function resetPriceAlertsForTest(): void {
  alerts = [];
}
