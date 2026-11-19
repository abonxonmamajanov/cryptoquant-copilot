import http from "http";
import { app } from "../src/index";
import {
  getSubscriberCount,
  resetSubscribersForTest,
  updateSubscriberRisk,
  upsertSubscriber
} from "../src/services/subscription.service";

async function main() {
  console.log("=== Stage 4 (Product Dashboard, Bot Cabinet & Subscriptions) E2E Verification Started ===");

  // 1. Test Subscriber & Risk Profile store
  resetSubscribersForTest();
  const user = upsertSubscriber("123456789", "test_trader", "Test");
  if (user.tier !== "FREE" || user.riskProfile !== "MODERATE") {
    throw new Error(`Unexpected default subscriber state: ${JSON.stringify(user)}`);
  }
  const updated = updateSubscriberRisk("123456789", "CONSERVATIVE");
  if (updated.riskProfile !== "CONSERVATIVE" || getSubscriberCount() !== 1) {
    throw new Error("Failed to update subscriber risk profile");
  }
  console.log("[PASS] Subscriber cabinet & risk profile store verified");

  // 2. Test HTTP endpoints (GET /, GET /api/plans, GET /health)
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const dashRes = await fetch(`${baseUrl}/`);
  const dashHtml = await dashRes.text();
  if (
    dashRes.status !== 200 ||
    !dashHtml.includes("CryptoQuant-Copilot") ||
    !dashHtml.includes("Moliyaviy maslahat emas")
  ) {
    throw new Error(`GET / Dashboard check failed (status=${dashRes.status})`);
  }
  console.log(`[PASS] GET / Live Web Dashboard HTML verified (${dashHtml.length} chars)`);

  const plansRes = await fetch(`${baseUrl}/api/plans`);
  const plansBody = await plansRes.json();
  if (plansRes.status !== 200 || !Array.isArray(plansBody.plans) || plansBody.plans.length !== 3) {
    throw new Error(`GET /api/plans failed: ${JSON.stringify(plansBody)}`);
  }
  console.log("[PASS] GET /api/plans returned FREE, PRO, VIP plans");

  const healthRes = await fetch(`${baseUrl}/health`);
  const healthBody = await healthRes.json();
  if (healthRes.status !== 200 || healthBody.stage !== "stage-4-product-dashboard-bot") {
    throw new Error(`GET /health mismatch: ${JSON.stringify(healthBody)}`);
  }
  console.log("[PASS] GET /health confirmed stage-4-product-dashboard-bot");

  resetSubscribersForTest();
  server.close();
  console.log("=== Stage 4 E2E Verification Completed Successfully ===");
}

main().catch((err) => {
  console.error("[FAIL] Stage 4 Verification Error:", err);
  process.exit(1);
});
