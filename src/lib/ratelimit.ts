import type { NextFunction, Request, Response } from "express";
import { take } from "./buckets.js";

function reqId(req: Request): string {
  return (req as unknown as { id?: string }).id ?? "req_unknown";
}

/**
 * Per-route body cap BEFORE the paywall (the global JSON parser cap only
 * covers the largest body). Prefers content-length; measures the parsed
 * body when the header is missing (chunked). Conservative either way.
 */
export function sizeGuard(max: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = req.headers["content-length"];
    let n: number | undefined;
    if (typeof raw === "string" && raw !== "") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) n = parsed;
    }
    if (n === undefined) {
      try {
        n = Buffer.byteLength(JSON.stringify(req.body ?? ""));
      } catch {
        n = max + 1;
      }
    }
    if (n > max) {
      res.status(413).json({ error: { code: "body_too_large", message: `body over ${max} bytes` }, request_id: reqId(req) });
      return;
    }
    next();
  };
}

export function ipLimiter(perMin: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? "unknown";
    if (!take(`ip:${req.path}:${ip}`, perMin)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: { code: "rate_limited", message: "too many requests" }, request_id: reqId(req) });
      return;
    }
    next();
  };
}

export function payerLimiter(perMin: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Bucket by client IP only. X-Payer-Address is an unverified,
    // client-controlled header: mixing it into the key would let anyone mint
    // fresh buckets by rotating the header. (Shared-NAT over-limiting is the
    // accepted tradeoff; paid abuse is bounded by real cost.)
    const ip = req.ip ?? "unknown";
    if (!take(`payer:${ip}`, perMin)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: { code: "rate_limited", message: "payer rate exceeded" }, request_id: reqId(req) });
      return;
    }
    next();
  };
}
