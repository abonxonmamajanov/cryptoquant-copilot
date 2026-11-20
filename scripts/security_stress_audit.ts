import http from "http";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { app } from "../src/index";
import { resetRateLimitersForTest } from "../src/middleware/security.middleware";
import { resetPriceAlertsForTest } from "../src/services/priceAlert.service";

interface VectorResult {
  id: number;
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceFiles(full));
    else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function main() {
  console.log("=========================================================================");
  console.log("=== CryptoQuant-Copilot Stage 5.8 — CYBER SECURITY & STRESS RED-TEAM ===");
  console.log("=========================================================================");

  const results: VectorResult[] = [];
  let peakRssMb = 0;

  const recordRss = () => {
    const mb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
    if (mb > peakRssMb) peakRssMb = mb;
    return mb;
  };

  resetRateLimitersForTest();
  resetPriceAlertsForTest();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind ephemeral server port");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // -----------------------------------------------------------------
    // VECTOR 1: Security Headers & Fingerprint Check
    // -----------------------------------------------------------------
    const hRes = await fetch(`${baseUrl}/`);
    const poweredBy = hRes.headers.get("x-powered-by");
    const nosniff = hRes.headers.get("x-content-type-options");
    const referrer = hRes.headers.get("referrer-policy");
    const hsts = hRes.headers.get("strict-transport-security");

    if (poweredBy !== null) {
      throw new Error(`x-powered-by header must be absent, got: ${poweredBy}`);
    }
    if (nosniff !== "nosniff" || referrer !== "no-referrer" || !hsts?.includes("max-age=")) {
      throw new Error(
        `Missing security headers: nosniff=${nosniff}, referrer=${referrer}, hsts=${hsts}`
      );
    }
    results.push({
      id: 1,
      name: "Security Headers & Fingerprint",
      status: "PASS",
      detail: "x-powered-by hidden; nosniff, no-referrer, HSTS verified"
    });
    console.log("[PASS] Vector 1: Security Headers & Fingerprint Check");

    // -----------------------------------------------------------------
    // VECTOR 2: XSS, SQL Injection & Path Traversal Attack Simulation
    // -----------------------------------------------------------------
    resetRateLimitersForTest();
    const maliciousPayloads = [
      "<script>alert(1)</script>",
      "BTC' OR '1'='1",
      "../../.env",
      "%00BTCUSDT"
    ];

    let blockedCount = 0;
    for (const payload of maliciousPayloads) {
      const encoded = encodeURIComponent(payload);
      const getTargets = [
        `${baseUrl}/api/check/${encoded}`,
        `${baseUrl}/api/chart/${encoded}.png`,
        `${baseUrl}/api/backtest?symbol=${encoded}`
      ];

      for (const url of getTargets) {
        const r = await fetch(url);
        const body = await r.text();
        if (r.status !== 400 && r.status !== 404) {
          throw new Error(`Attack GET ${url} returned HTTP ${r.status} (expected 400/404)`);
        }
        if (
          body.toLowerCase().includes("<script>") ||
          body.includes("at Object.") ||
          body.includes("TELEGRAM_BOT_TOKEN")
        ) {
          throw new Error(`Unsafe reflection or leak in response for ${url}: ${body.slice(0, 180)}`);
        }
        blockedCount++;
      }

      const postRes = await fetch(`${baseUrl}/api/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: payload, targetPrice: 100 })
      });
      const postBody = await postRes.text();
      if (postRes.status !== 400 && postRes.status !== 404) {
        throw new Error(`Attack POST /api/alerts (${payload}) returned HTTP ${postRes.status}`);
      }
      if (
        postBody.toLowerCase().includes("<script>") ||
        postBody.includes("at Object.") ||
        postBody.includes("TELEGRAM_BOT_TOKEN")
      ) {
        throw new Error(`Unsafe reflection or leak in POST /api/alerts: ${postBody.slice(0, 180)}`);
      }
      blockedCount++;
    }
    results.push({
      id: 2,
      name: "XSS / SQLi / Path Traversal Guard",
      status: "PASS",
      detail: `${blockedCount}/${blockedCount} malicious payloads blocked (400/404), 0 leaks`
    });
    console.log(`[PASS] Vector 2: ${blockedCount} XSS/SQLi/Path-Traversal attacks blocked cleanly`);

    // -----------------------------------------------------------------
    // VECTOR 3: Oversized JSON Payload DoS Attack (150KB > 32KB)
    // -----------------------------------------------------------------
    resetRateLimitersForTest();
    const oversizedBody = JSON.stringify({
      symbol: "BTCUSDT",
      amountUsd: 100,
      padding: "A".repeat(150 * 1024)
    });
    const dosRes = await fetch(`${baseUrl}/api/portfolio/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversizedBody
    });
    if (dosRes.status !== 413) {
      throw new Error(`Expected HTTP 413 for 150KB payload, got HTTP ${dosRes.status}`);
    }
    const pingAfterDos = await fetch(`${baseUrl}/ping`);
    if (pingAfterDos.status !== 200 || (await pingAfterDos.text()) !== "pong") {
      throw new Error("Server unhealthy after oversized JSON DoS attack");
    }
    results.push({
      id: 3,
      name: "Oversized JSON Payload DoS (150KB)",
      status: "PASS",
      detail: "Blocked with HTTP 413 (max 32KB); /ping healthy"
    });
    console.log("[PASS] Vector 3: Oversized 150KB JSON DoS blocked with HTTP 413");

    // -----------------------------------------------------------------
    // VECTOR 4: DDoS / Heavy-Endpoint Rate-Limit Flood Test
    // -----------------------------------------------------------------
    resetRateLimitersForTest();
    let ok200Count = 0;
    let blocked429Count = 0;
    let retryAfterPresent = false;

    for (let i = 1; i <= 22; i++) {
      const r = await fetch(`${baseUrl}/api/reports/pdf`);
      await r.arrayBuffer();
      if (i <= 18) {
        if (r.status !== 200) {
          throw new Error(`Heavy request #${i} expected 200, got ${r.status}`);
        }
        ok200Count++;
      } else {
        if (r.status !== 429) {
          throw new Error(`Heavy flood request #${i} expected 429, got ${r.status}`);
        }
        if (r.headers.get("retry-after")) retryAfterPresent = true;
        blocked429Count++;
      }
    }
    if (!retryAfterPresent) {
      throw new Error("Expected Retry-After header on HTTP 429 responses");
    }
    const pingUnderFlood = await fetch(`${baseUrl}/ping`);
    const pingFloodText = await pingUnderFlood.text();
    if (pingUnderFlood.status !== 200 || pingFloodText !== "pong") {
      throw new Error(`/ping must remain exempt from rate limiting, got ${pingUnderFlood.status}`);
    }
    results.push({
      id: 4,
      name: "DDoS / Heavy Rate-Limit Flood",
      status: "PASS",
      detail: `${ok200Count} allowed (200), ${blocked429Count} throttled (429 + Retry-After), /ping exempt`
    });
    console.log(
      `[PASS] Vector 4: Rate-Limit Flood verified (${ok200Count}x 200, ${blocked429Count}x 429 + Retry-After, /ping -> pong)`
    );

    // -----------------------------------------------------------------
    // VECTOR 5: Concurrent Stress & RAM Ceiling (Render 512MB check)
    // -----------------------------------------------------------------
    resetRateLimitersForTest();
    const stressUrls = [
      `${baseUrl}/api/agents/status`,
      `${baseUrl}/api/signals/report24h`,
      `${baseUrl}/api/logs/recent`,
      `${baseUrl}/api/portfolio`,
      `${baseUrl}/api/chart/BTCUSDT.png`,
      `${baseUrl}/api/reports/pdf`,
      `${baseUrl}/api/agents/status`,
      `${baseUrl}/api/signals/report24h`,
      `${baseUrl}/api/logs/recent`,
      `${baseUrl}/api/portfolio`
    ];
    const tStress = Date.now();
    const stressResponses = await Promise.all(
      stressUrls.map(async (u) => {
        const r = await fetch(u);
        const buf = Buffer.from(await r.arrayBuffer());
        return { u, status: r.status, bytes: buf.length };
      })
    );
    const stressMs = Date.now() - tStress;
    for (const s of stressResponses) {
      if (s.status !== 200 || s.bytes === 0) {
        throw new Error(`Concurrent stress failure: ${s.u} -> HTTP ${s.status} (${s.bytes}B)`);
      }
    }
    const rssMb = recordRss();
    if (rssMb >= 380) {
      throw new Error(`Peak RSS RAM ${rssMb} MB exceeded 380 MB ceiling`);
    }
    results.push({
      id: 5,
      name: "Concurrent Stress & RAM Ceiling",
      status: "PASS",
      detail: `10/10 HTTP 200 in ${stressMs}ms | Peak RSS: ${peakRssMb} MB (< 380 MB)`
    });
    console.log(
      `[PASS] Vector 5: 10/10 concurrent mixed requests HTTP 200 in ${stressMs}ms | Peak RSS: ${peakRssMb} MB`
    );

    // -----------------------------------------------------------------
    // VECTOR 6: Secret Leak & Git Hygiene Audit
    // -----------------------------------------------------------------
    const trackedFiles = execSync("git ls-files", { encoding: "utf8" })
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
    const forbiddenTracked = trackedFiles.filter(
      (f) => f === ".env" || (f.startsWith(".env.") && f !== ".env.example") || f.startsWith("data/")
    );
    if (forbiddenTracked.length > 0) {
      throw new Error(`Sensitive files tracked in Git: ${forbiddenTracked.join(", ")}`);
    }

    const srcFiles = walkSourceFiles(path.join(process.cwd(), "src"));
    const telegramTokenRe = /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/;
    const mexcKeyRe = /\bmx0v[a-zA-Z0-9]{12,}\b/;
    const pgCredsRe = /postgresql:\/\/(?!USER:PASSWORD@HOST)[^:\s'"]+:[^@\s'"]+@[^\s'"]+/i;

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (telegramTokenRe.test(content)) {
        throw new Error(`Hardcoded Telegram token found in ${file}`);
      }
      if (mexcKeyRe.test(content)) {
        throw new Error(`Hardcoded MEXC API secret found in ${file}`);
      }
      if (pgCredsRe.test(content)) {
        throw new Error(`Hardcoded PostgreSQL credentials found in ${file}`);
      }
    }
    results.push({
      id: 6,
      name: "Secret Leak & Git Hygiene",
      status: "PASS",
      detail: `0 leaks in ${srcFiles.length} src files; .env & data/ untracked`
    });
    console.log(`[PASS] Vector 6: 0 secrets in ${srcFiles.length} src files; .env & data/ untracked`);

    // -----------------------------------------------------------------
    // VECTOR 7: Live Render Security Probe
    // -----------------------------------------------------------------
    const renderPingUrl = "https://cryptoquant-copilot.onrender.com/ping";
    const tRender = Date.now();
    const renderRes = await fetch(renderPingUrl, { signal: AbortSignal.timeout(25000) });
    const renderMs = Date.now() - tRender;
    const renderText = (await renderRes.text()).trim();
    if (renderRes.status !== 200 || renderText !== "pong") {
      throw new Error(`Live Render probe failed: HTTP ${renderRes.status} (${renderText})`);
    }
    results.push({
      id: 7,
      name: "Live Render Security Probe",
      status: "PASS",
      detail: `HTTP 200 pong (${renderMs}ms)`
    });
    console.log(`[PASS] Vector 7: Live Render reachable -> HTTP 200 pong (${renderMs}ms)`);

    // Final Scorecard Summary
    recordRss();
    console.log("\n=========================================================================");
    console.log("=== STAGE 5.8 SECURITY & STRESS SCORECARD (7/7 PASS — 100%) ===");
    console.log("=========================================================================");
    for (const r of results) {
      console.log(`  [${r.status}] #${r.id} ${r.name}: ${r.detail}`);
    }
    console.log(`  Peak RSS Memory: ${peakRssMb} MB (Render 512MB Free Tier Safe)`);
  } finally {
    resetRateLimitersForTest();
    resetPriceAlertsForTest();
    server.close();
  }
}

main().catch((err) => {
  console.error("[FAIL] Stage 5.8 Security/Stress Audit Error:", err);
  process.exit(1);
});
