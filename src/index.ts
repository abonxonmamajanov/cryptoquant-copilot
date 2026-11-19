import express from "express";
import { env } from "./config/env";
import { runMarketHealthChecks } from "./services/marketHealth.service";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    service: "cryptoquant-copilot",
    stage: "stage-0-foundation",
    status: "ok",
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

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`[CryptoQuant-Copilot] Stage 0 server running on port ${env.PORT}`);
  });
}

export { app };
