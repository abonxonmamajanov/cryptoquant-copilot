import fs from "fs";
import path from "path";

export type CircuitBreakerOutcome = "WIN" | "BE" | "SL";

export interface WallStreetCircuitBreakerStatus {
  active: boolean;
  consecutiveLosses: number;
  threshold: number;
  remainingMin: number;
  pausedUntil: string | null;
  reasonUz: string | null;
}

export interface RecordOutcomeResult {
  triggeredNow: boolean;
  reasonUz: string | null;
  status: WallStreetCircuitBreakerStatus;
}

interface PersistedCircuitBreakerState {
  consecutiveLosses: number;
  pausedUntilMs: number;
  totalTriggers: number;
  updatedAt: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const CB_FILE = path.join(DATA_DIR, "circuit_breaker.json");
const CONSECUTIVE_SL_THRESHOLD = 3;
const PAUSE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours pause
const TRIGGER_REASON_UZ =
  "🛡️ WALL STREET CIRCUIT BREAKER: Ketma-ket 3 ta SL urildi — bozor tinchiguncha 4 soat yangi signallar pauza qilindi.";

function createDefaultState(): PersistedCircuitBreakerState {
  return {
    consecutiveLosses: 0,
    pausedUntilMs: 0,
    totalTriggers: 0,
    updatedAt: new Date().toISOString()
  };
}

let state: PersistedCircuitBreakerState = loadState();

function loadState(): PersistedCircuitBreakerState {
  try {
    if (fs.existsSync(CB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CB_FILE, "utf-8")) as Partial<PersistedCircuitBreakerState>;
      return {
        consecutiveLosses:
          typeof parsed.consecutiveLosses === "number" && Number.isFinite(parsed.consecutiveLosses)
            ? Math.max(0, Math.floor(parsed.consecutiveLosses))
            : 0,
        pausedUntilMs:
          typeof parsed.pausedUntilMs === "number" && Number.isFinite(parsed.pausedUntilMs)
            ? parsed.pausedUntilMs
            : 0,
        totalTriggers:
          typeof parsed.totalTriggers === "number" && Number.isFinite(parsed.totalTriggers)
            ? parsed.totalTriggers
            : 0,
        updatedAt: String(parsed.updatedAt ?? new Date().toISOString())
      };
    }
  } catch {
    // Fallback to clean state
  }
  return createDefaultState();
}

function saveState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(CB_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Non-fatal on ephemeral filesystems
  }
}

export function getCircuitBreakerStatus(now = Date.now()): WallStreetCircuitBreakerStatus {
  // Automatically reset once the 4-hour cooldown expires
  if (state.pausedUntilMs > 0 && state.pausedUntilMs <= now) {
    state.pausedUntilMs = 0;
    state.consecutiveLosses = 0;
    saveState();
  }

  const active = state.pausedUntilMs > now;
  const remainingMin = active ? Math.max(1, Math.ceil((state.pausedUntilMs - now) / 60_000)) : 0;

  return {
    active,
    consecutiveLosses: state.consecutiveLosses,
    threshold: CONSECUTIVE_SL_THRESHOLD,
    remainingMin,
    pausedUntil: active ? new Date(state.pausedUntilMs).toISOString() : null,
    reasonUz: active
      ? `🛡️ WALL STREET CIRCUIT BREAKER FAOL: Ketma-ket ${state.consecutiveLosses} ta SL — ${remainingMin} daqiqa pauza.`
      : null
  };
}

export function recordSignalOutcome(
  outcome: CircuitBreakerOutcome,
  now = Date.now()
): RecordOutcomeResult {
  // Refresh expiry check before applying new outcome
  if (state.pausedUntilMs > 0 && state.pausedUntilMs <= now) {
    state.pausedUntilMs = 0;
    state.consecutiveLosses = 0;
  }

  if (outcome === "WIN") {
    state.consecutiveLosses = 0;
    state.pausedUntilMs = 0;
    saveState();
    return {
      triggeredNow: false,
      reasonUz: null,
      status: getCircuitBreakerStatus(now)
    };
  }

  if (outcome === "BE") {
    // Breakeven is risk-free (not a loss, does not break or worsen pause)
    saveState();
    return {
      triggeredNow: false,
      reasonUz: null,
      status: getCircuitBreakerStatus(now)
    };
  }

  // outcome === "SL"
  state.consecutiveLosses += 1;
  let triggeredNow = false;
  let reasonUz: string | null = null;

  if (state.consecutiveLosses >= CONSECUTIVE_SL_THRESHOLD) {
    const wasActive = state.pausedUntilMs > now;
    state.pausedUntilMs = now + PAUSE_DURATION_MS;
    if (!wasActive) {
      state.totalTriggers += 1;
      triggeredNow = true;
      reasonUz = TRIGGER_REASON_UZ;
    }
  }

  saveState();
  return {
    triggeredNow,
    reasonUz,
    status: getCircuitBreakerStatus(now)
  };
}

export function resetCircuitBreakerForTest(): void {
  state = createDefaultState();
  saveState();
}
