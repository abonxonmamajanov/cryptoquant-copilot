import fs from "fs";
import path from "path";

const SIGNAL_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours standard anti-spam per symbol
const SL_FIRST_LOCK_MS = 6 * 60 * 60 * 1000; // 6 hours backoff after 1st Stop-Loss on symbol
const SL_REPEAT_LOCK_MS = 24 * 60 * 60 * 1000; // 24 hours lockout after >=2 Stop-Losses on same symbol in 24h
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const CIRCUIT_BREAKER_WINDOW_MS = 2 * 60 * 60 * 1000; // 2-hour rolling SL streak window
const CIRCUIT_BREAKER_THRESHOLD = 3; // 3+ SLs within 2 hours triggers market dump pause
const CIRCUIT_BREAKER_PAUSE_MS = 2 * 60 * 60 * 1000; // 2-hour global dispatch pause

const DATA_DIR = path.join(process.cwd(), "data");
const COOLDOWN_FILE = path.join(DATA_DIR, "cooldown_state.json");

interface PersistedCooldownState {
  dispatchedAt: Record<string, number>;
  symbolBlockedUntil: Record<string, number>;
  symbolSlHistory: Record<string, number[]>;
  globalSlTimestamps: number[];
  circuitBreakerPausedUntil: number;
}

export interface CircuitBreakerStatus {
  active: boolean;
  recentSlCount: number;
  threshold: number;
  pausedUntil: string | null;
  remainingSec: number;
  reason: string | null;
}

export interface DispatchGuardStatus {
  allowed: boolean;
  reason: string | null;
  remainingSec: number;
}

function createEmptyState(): PersistedCooldownState {
  return {
    dispatchedAt: {},
    symbolBlockedUntil: {},
    symbolSlHistory: {},
    globalSlTimestamps: [],
    circuitBreakerPausedUntil: 0
  };
}

let state: PersistedCooldownState = loadState();

function loadState(): PersistedCooldownState {
  try {
    if (fs.existsSync(COOLDOWN_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(COOLDOWN_FILE, "utf-8")) as Partial<PersistedCooldownState>;
      return {
        dispatchedAt: parsed.dispatchedAt && typeof parsed.dispatchedAt === "object" ? parsed.dispatchedAt : {},
        symbolBlockedUntil:
          parsed.symbolBlockedUntil && typeof parsed.symbolBlockedUntil === "object"
            ? parsed.symbolBlockedUntil
            : {},
        symbolSlHistory:
          parsed.symbolSlHistory && typeof parsed.symbolSlHistory === "object" ? parsed.symbolSlHistory : {},
        globalSlTimestamps: Array.isArray(parsed.globalSlTimestamps) ? parsed.globalSlTimestamps : [],
        circuitBreakerPausedUntil:
          typeof parsed.circuitBreakerPausedUntil === "number" ? parsed.circuitBreakerPausedUntil : 0
      };
    }
  } catch {
    // Fallback to clean state
  }
  return createEmptyState();
}

function saveState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Non-fatal on ephemeral disks
  }
}

export function getCircuitBreakerStatus(now = Date.now()): CircuitBreakerStatus {
  state.globalSlTimestamps = state.globalSlTimestamps.filter((ts) => now - ts <= CIRCUIT_BREAKER_WINDOW_MS);
  const active = state.circuitBreakerPausedUntil > now;
  const remainingSec = active ? Math.ceil((state.circuitBreakerPausedUntil - now) / 1000) : 0;
  return {
    active,
    recentSlCount: state.globalSlTimestamps.length,
    threshold: CIRCUIT_BREAKER_THRESHOLD,
    pausedUntil: active ? new Date(state.circuitBreakerPausedUntil).toISOString() : null,
    remainingSec,
    reason: active
      ? `Global SL Circuit Breaker faol (${CIRCUIT_BREAKER_THRESHOLD}+ SL / 2 soatda) — ${Math.ceil(remainingSec / 60)} daqiqa pauza`
      : null
  };
}

export function recordSymbolStopLoss(symbol: string, now = Date.now()): CircuitBreakerStatus {
  const sym = symbol.toUpperCase().trim();
  const prev = (state.symbolSlHistory[sym] ?? []).filter((ts) => now - ts <= ONE_DAY_MS);
  prev.push(now);
  state.symbolSlHistory[sym] = prev;

  // Adaptive per-symbol SL backoff: 6h after 1st SL, 24h after >=2 SLs in 24h
  const lockMs = prev.length >= 2 ? SL_REPEAT_LOCK_MS : SL_FIRST_LOCK_MS;
  state.symbolBlockedUntil[sym] = Math.max(state.symbolBlockedUntil[sym] ?? 0, now + lockMs);

  // Rolling global SL streak check
  state.globalSlTimestamps = state.globalSlTimestamps.filter((ts) => now - ts <= CIRCUIT_BREAKER_WINDOW_MS);
  state.globalSlTimestamps.push(now);

  if (state.globalSlTimestamps.length >= CIRCUIT_BREAKER_THRESHOLD) {
    state.circuitBreakerPausedUntil = Math.max(state.circuitBreakerPausedUntil, now + CIRCUIT_BREAKER_PAUSE_MS);
  }

  saveState();
  return getCircuitBreakerStatus(now);
}

export function getDispatchGuardStatus(symbol: string, now = Date.now()): DispatchGuardStatus {
  const sym = symbol.toUpperCase().trim();

  const cb = getCircuitBreakerStatus(now);
  if (cb.active) {
    return {
      allowed: false,
      reason: cb.reason,
      remainingSec: cb.remainingSec
    };
  }

  const slUntil = state.symbolBlockedUntil[sym] ?? 0;
  if (slUntil > now) {
    const remainingSec = Math.ceil((slUntil - now) / 1000);
    const slCount24h = (state.symbolSlHistory[sym] ?? []).filter((ts) => now - ts <= ONE_DAY_MS).length;
    return {
      allowed: false,
      reason: `SL backoff faol (${slCount24h} ta SL / 24s) — ${Math.ceil(remainingSec / 60)} daq kutish`,
      remainingSec
    };
  }

  const last = state.dispatchedAt[sym];
  if (last && now - last < SIGNAL_COOLDOWN_MS) {
    const remainingSec = Math.ceil((SIGNAL_COOLDOWN_MS - (now - last)) / 1000);
    return {
      allowed: false,
      reason: `Cooldown faol — ${Math.ceil(remainingSec / 60)} daqiqadan keyin ruxsat`,
      remainingSec
    };
  }

  return { allowed: true, reason: null, remainingSec: 0 };
}

export function canDispatchSignal(symbol: string, now = Date.now()): boolean {
  return getDispatchGuardStatus(symbol, now).allowed;
}

export function markSignalDispatched(symbol: string, now = Date.now()): void {
  const sym = symbol.toUpperCase().trim();
  state.dispatchedAt[sym] = now;
  saveState();
}

export function getCooldownRemainingSec(symbol: string, now = Date.now()): number {
  return getDispatchGuardStatus(symbol, now).remainingSec;
}

export function resetCooldownsForTest(): void {
  state = createEmptyState();
  saveState();
}
