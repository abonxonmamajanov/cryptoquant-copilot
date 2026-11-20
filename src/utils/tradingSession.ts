export interface ActiveSessionInfo {
  labelUz: string;
  activeZones: Array<"TOKYO" | "LONDON" | "NEW_YORK">;
  isOverlap: boolean;
}

export function getCurrentTradingSession(date = new Date()): ActiveSessionInfo {
  const utcH = date.getUTCHours();
  const activeZones: Array<"TOKYO" | "LONDON" | "NEW_YORK"> = [];
  if (utcH >= 0 && utcH < 9) activeZones.push("TOKYO");
  if (utcH >= 7 && utcH < 16) activeZones.push("LONDON");
  if (utcH >= 12 && utcH < 21) activeZones.push("NEW_YORK");

  const isOverlap = activeZones.includes("LONDON") && activeZones.includes("NEW_YORK");
  let labelUz = "🌙 Tinch sessiya";
  if (isOverlap) labelUz = "🔥 London + Nyu-York (Oltin soat)";
  else if (activeZones.includes("NEW_YORK")) labelUz = "🇺🇸 Nyu-York sessiyasi";
  else if (activeZones.includes("LONDON")) labelUz = "🇬🇧 London sessiyasi";
  else if (activeZones.includes("TOKYO")) labelUz = "🇯🇵 Osiyo (Tokio) sessiyasi";

  return { labelUz, activeZones, isOverlap };
}

export function calculatePositionRisk(
  depositUsd: number,
  riskPct: number,
  entryPrice: number,
  stopLossPrice: number
) {
  const maxLossUsd = Number(((depositUsd * riskPct) / 100).toFixed(2));
  const stopDistPct = entryPrice > 0 ? Math.abs((entryPrice - stopLossPrice) / entryPrice) * 100 : 0;
  const positionSizeUsd =
    stopDistPct > 0 ? Number(Math.min(depositUsd, maxLossUsd / (stopDistPct / 100)).toFixed(2)) : 0;
  const coinQty = entryPrice > 0 ? Number((positionSizeUsd / entryPrice).toFixed(4)) : 0;
  return {
    depositUsd,
    riskPct,
    maxLossUsd,
    stopDistPct: Number(stopDistPct.toFixed(2)),
    positionSizeUsd,
    coinQty
  };
}
