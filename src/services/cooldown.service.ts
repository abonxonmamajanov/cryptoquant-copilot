const SIGNAL_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours per symbol anti-spam
const dispatchedAtMap = new Map<string, number>();

export function canDispatchSignal(symbol: string, now = Date.now()): boolean {
  const last = dispatchedAtMap.get(symbol);
  if (!last) return true;
  return now - last >= SIGNAL_COOLDOWN_MS;
}

export function markSignalDispatched(symbol: string, now = Date.now()): void {
  dispatchedAtMap.set(symbol, now);
}

export function getCooldownRemainingSec(symbol: string, now = Date.now()): number {
  const last = dispatchedAtMap.get(symbol);
  if (!last) return 0;
  const remaining = SIGNAL_COOLDOWN_MS - (now - last);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function resetCooldownsForTest(): void {
  dispatchedAtMap.clear();
}
