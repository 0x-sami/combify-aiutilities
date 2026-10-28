import type { NextFunction, Request, Response } from "express";

/**
 * In-memory sliding-window buckets (same perMin semantics as
 * scrapper's lib/buckets: at most `perMin` takes per key per 60s).
 * Single-instance only — that is the whole deployment (one Railway
 * replica), so no shared store is needed.
 */
const hits = new Map<string, number[]>();

export function take(key: string, perMin: number): boolean {
  const now = Date.now();
  const window = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (window.length >= perMin) {
    hits.set(key, window);
    return false;
  }
  window.push(now);
  hits.set(key, window);
  return true;
}

/** Test hook: reset all buckets. */
export function resetBuckets(): void {
  hits.clear();
}
