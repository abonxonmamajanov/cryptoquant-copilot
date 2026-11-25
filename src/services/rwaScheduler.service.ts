import {
  getLatestRwaSnapshot,
  isRwaEnabled,
  runRwaStockScan,
  RwaScanSnapshot
} from "./rwaStocks.service";

// =============================================================================
// STAGE 7.0 — ISOLATED 5-MINUTE RWA STOCKS SCHEDULER
// Completely independent from the 60-second Stage 6.2 Crypto Scheduler.
// =============================================================================

let rwaIntervalHandle: NodeJS.Timeout | null = null;
let rwaInitDelayHandle: NodeJS.Timeout | null = null;
let isRwaScanning = false;
let totalRwaScans = 0;
let lastRwaError: string | null = null;

export async function triggerRwaScanNow(): Promise<RwaScanSnapshot> {
  if (isRwaScanning) {
    const cached = getLatestRwaSnapshot();
    if (cached) return cached;
  }
  isRwaScanning = true;
  try {
    const snapshot = await runRwaStockScan();
    totalRwaScans += 1;
    lastRwaError = null;
    console.log(
      `[RWA Stocks] Scan #${totalRwaScans} done in ${snapshot.durationMs}ms | Universe: ${snapshot.totalUniverseCount} | Scanned: ${snapshot.deepScannedCount} | Approved: ${snapshot.approvedCount} | Enabled: ${snapshot.rwaEnabled} | US: ${snapshot.marketStatus.isOpenForAutoSignals ? "OPEN" : "CLOSED"}`
    );
    return snapshot;
  } catch (err) {
    lastRwaError = err instanceof Error ? err.message : "Unknown RWA scan error";
    console.error("[RWA Stocks] Isolated scan failed (crypto unaffected):", lastRwaError);
    throw err;
  } finally {
    isRwaScanning = false;
  }
}

export function getRwaSchedulerStats() {
  const latest = getLatestRwaSnapshot();
  return {
    rwaEnabled: isRwaEnabled(),
    isScanning: isRwaScanning,
    totalScans: totalRwaScans,
    lastScanAt: latest?.scannedAt ?? null,
    totalUniverseCount: latest?.totalUniverseCount ?? 0,
    approvedCount: latest?.approvedCount ?? 0,
    lastError: lastRwaError
  };
}

export function startRwaScheduler(intervalMs = 300_000): void {
  if (rwaIntervalHandle || rwaInitDelayHandle) return;

  // Delay initial scan by 12s so Crypto Scout warms the shared 24h ticker cache first (0 extra 24hr API calls)
  rwaInitDelayHandle = setTimeout(() => {
    rwaInitDelayHandle = null;
    triggerRwaScanNow().catch(() => {});
  }, 12_000);
  rwaInitDelayHandle.unref();

  rwaIntervalHandle = setInterval(() => {
    triggerRwaScanNow().catch(() => {});
  }, intervalMs);
  rwaIntervalHandle.unref();
}

export function stopRwaScheduler(): void {
  if (rwaInitDelayHandle) {
    clearTimeout(rwaInitDelayHandle);
    rwaInitDelayHandle = null;
  }
  if (rwaIntervalHandle) {
    clearInterval(rwaIntervalHandle);
    rwaIntervalHandle = null;
  }
}
