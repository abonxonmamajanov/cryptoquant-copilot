import { runScoutScan, ScoutScanSnapshot } from "../agents/scout.agent";

let latestSnapshot: ScoutScanSnapshot | null = null;
let isScanning = false;
let totalScans = 0;
let lastError: string | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

export async function triggerScoutScanNow(): Promise<ScoutScanSnapshot> {
  if (isScanning && latestSnapshot) {
    return latestSnapshot;
  }
  isScanning = true;
  try {
    const snapshot = await runScoutScan();
    latestSnapshot = snapshot;
    totalScans++;
    lastError = null;
    console.log(
      `[Scout Agent] Scan #${totalScans} done in ${snapshot.durationMs}ms | Eligible: ${snapshot.liquidEligibleCount} | Anomalies: ${snapshot.anomaliesDetected} | Mirror: ${snapshot.activeMirror}`
    );
    return snapshot;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Unknown scan error";
    console.error("[Scout Agent] Scan failed:", lastError);
    throw err;
  } finally {
    isScanning = false;
  }
}

export function getLatestScoutSnapshot(): ScoutScanSnapshot | null {
  return latestSnapshot;
}

export function getSchedulerStats() {
  return {
    isScanning,
    totalScans,
    lastScanAt: latestSnapshot?.scannedAt ?? null,
    activeMirror: latestSnapshot?.activeMirror ?? null,
    lastError
  };
}

export function startScoutScheduler(intervalMs = 60_000): void {
  if (intervalHandle) return;
  // Fire initial scan in background
  triggerScoutScanNow().catch(() => {});
  intervalHandle = setInterval(() => {
    triggerScoutScanNow().catch(() => {});
  }, intervalMs);
}

export function stopScoutScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
