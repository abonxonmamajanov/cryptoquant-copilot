import { NextFunction, Request, Response } from "express";

interface RateBucket {
  count: number;
  resetAt: number;
}

const generalBuckets = new Map<string, RateBucket>();
const heavyBuckets = new Map<string, RateBucket>();

function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function checkBucket(
  store: Map<string, RateBucket>,
  ip: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = store.get(ip);
  if (!existing || now >= existing.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowMs });
    // Prevent unbounded memory growth under IP-spoof DDoS
    if (store.size > 2000) {
      for (const [k, v] of store.entries()) {
        if (now >= v.resetAt) store.delete(k);
      }
    }
    return { allowed: true, retryAfterSec: 0 };
  }
  existing.count += 1;
  if (existing.count > maxRequests) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

export function createRateLimiter(maxRequests: number, windowMs: number, heavy = false) {
  const store = heavy ? heavyBuckets : generalBuckets;
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req);
    const check = checkBucket(store, ip, maxRequests, windowMs);
    if (!check.allowed) {
      res.setHeader("Retry-After", String(check.retryAfterSec));
      res.status(429).json({
        error: "Juda ko'p so'rov yuborildi (Rate limit). Biroz kuting.",
        retryAfterSec: check.retryAfterSec
      });
      return;
    }
    next();
  };
}

export function isSafeSymbolInput(raw: string): boolean {
  if (!raw || raw.length > 20) return false;
  const cleaned = raw.toUpperCase().trim().replace(/\/USDT$/, "");
  return /^[A-Z0-9]{2,15}$/.test(cleaned);
}

export function safeErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = (err as { status?: number; type?: string })?.status;
  if (status === 413 || (err as { type?: string })?.type === "entity.too.large") {
    res.status(413).json({ error: "So'rov hajmi ruxsat etilgan limitdan oshib ketdi (max 32KB)." });
    return;
  }
  if (status === 400) {
    res.status(400).json({ error: "Noto'g'ri JSON formati." });
    return;
  }
  // Never expose stack traces, file paths, or env vars in production errors
  res.status(500).json({ error: "Ichki server xatoligi. Iltimos keyinroq urinib ko'ring." });
}

export function resetRateLimitersForTest(): void {
  generalBuckets.clear();
  heavyBuckets.clear();
}
