import express from "express";
import { env } from "./config/env";
import { runMarketHealthChecks } from "./services/marketHealth.service";
import {
  getLatestPipelineSnapshot,
  getLatestScoutSnapshot,
  getSchedulerStats,
  startScoutScheduler,
  triggerPipelineRunNow,
  triggerScoutScanNow
} from "./services/scheduler.service";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    service: "cryptoquant-copilot",
    stage: "stage-2-five-agent-pipeline",
    status: "ok",
    scheduler: getSchedulerStats(),
    timestamp: new Date().toISOString()
  });
});

app.get("/health/markets", async (_req, res) => {
  const checks = await runMarketHealthChecks();
  const allOk = checks.every((c) => c.ok);
  res.status(allOk ? 200 : 207).json({
    allOk,
    checks,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/scout/latest", async (_req, res) => {
  try {
    const snapshot = getLatestScoutSnapshot() ?? (await triggerScoutScanNow());
    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scout scan error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/scout/scan", async (_req, res) => {
  try {
    const snapshot = await triggerScoutScanNow();
    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scout scan error";
    res.status(500).json({ error: message });
  }
});

app.get("/api/pipeline/latest", async (_req, res) => {
  try {
    const snapshot = getLatestPipelineSnapshot() ?? (await triggerPipelineRunNow());
    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline run error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/pipeline/run", async (_req, res) => {
  try {
    const snapshot = await triggerPipelineRunNow();
    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline run error";
    res.status(500).json({ error: message });
  }
});

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`[CryptoQuant-Copilot] Stage 2 server running on port ${env.PORT}`);
    startScoutScheduler(60_000);
  });
}

export { app };
