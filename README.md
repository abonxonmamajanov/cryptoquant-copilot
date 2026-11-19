# CryptoQuant-Copilot

5-Agent Crypto Signal Bot & Screener powered by Node.js, TypeScript, Prisma/PostgreSQL, and a Python technical analysis engine (MEXC / Binance / CoinGecko).

## Stage 0 — Foundation & Infrastructure

### Project Structure
- `src/` — Express API server, Zod environment validation, and live market health checks (`/health`, `/health/markets`)
- `prisma/schema.prisma` — PostgreSQL schema (`Signal`, `AgentLog`, `DemoPortfolio`, `DemoTrade`, `UserSubscription`)
- `python_engine/` — Python technical analysis engine scaffolding and health probe
- `scripts/e2e_stage0_verify.ts` — Automated Stage 0 E2E verification script
- `render.yaml` — Render Blueprint for one-click web service deployment

### Quick Start
1. Copy `.env.example` to `.env` and populate environment variables as needed.
2. Install dependencies and generate the Prisma client:
   ```bash
   npm install
   npx prisma generate
   ```
3. Build and verify:
   ```bash
   npm run typecheck
   npm run build
   npm run verify:stage0
   python python_engine/health.py
   ```
4. Run locally:
   ```bash
   npm run dev
   ```
