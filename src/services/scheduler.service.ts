import { runScoutScan, ScoutScanSnapshot } from "../agents/scout.agent";
import { PipelineRunSnapshot, runFiveAgentPipeline } from "./pipeline.service";

let latestSnapshot: ScoutScanSnapshot | null = null;
let latestPipeline: PipelineRunSnapshot | null = null;
let isScanning = false;
let totalScans = 0;
let totalPipelineRuns = 0;
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

export async function triggerPipelineRunNow(): Promise<PipelineRunSnapshot> {
  if (isScanning && latestPipeline) {
    return latestPipeline;
  }
  isScanning = true;
  try {
    const { scoutSnapshot, pipelineSnapshot } = await runFiveAgentPipeline();
    latestSnapshot = scoutSnapshot;
    latestPipeline = pipelineSnapshot;
    totalScans++;
    totalPipelineRuns++;
    lastError = null;
    console.log(
      `[5-Agent Pipeline] Run #${totalPipelineRuns} done in ${pipelineSnapshot.durationMs}ms | Evaluated: ${pipelineSnapshot.evaluatedCount} | Approved: ${pipelineSnapshot.approvedCount} | Rejected: ${pipelineSnapshot.rejectedCount} | Mirror: ${scoutSnapshot.activeMirror}`
    );
    return pipelineSnapshot;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Unknown pipeline error";
    console.error("[5-Agent Pipeline] Run failed:", lastError);
    throw err;
  } finally {
    isScanning = false;
  }
}

export function getLatestScoutSnapshot(): ScoutScanSnapshot | null {
  return latestSnapshot;
}

export function getLatestPipelineSnapshot(): PipelineRunSnapshot | null {
  return latestPipeline;
}

export function getSchedulerStats() {
  return {
    isScanning,
    totalScans,
    totalPipelineRuns,
    lastScanAt: latestSnapshot?.scannedAt ?? null,
    lastPipelineRunAt: latestPipeline?.runAt ?? null,
    lastApprovedCount: latestPipeline?.approvedCount ?? 0,
    activeMirror: latestSnapshot?.activeMirror ?? null,
    lastError
  };
}

export function startScoutScheduler(intervalMs = 60_000): void {
  if (intervalHandle) return;
  // Fire initial full 5-agent pipeline cycle in background
  triggerPipelineRunNow().catch(() => {});
  intervalHandle = setInterval(() => {
    triggerPipelineRunNow().catch(() => {});
  }, intervalMs);
}

export function stopScoutScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
