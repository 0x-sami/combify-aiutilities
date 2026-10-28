/**
 * Idempotency store (same contract as scrapper's lib/idempotency).
 *
 * Why this exists: x402 `exact` payments are single-use authorizations —
 * every retry signs a FRESH payment (new nonce). If a client times out or
 * drops after paying (slow testnet confirmation, proxy hiccup), its retry
 * would otherwise pay a second time for the same work. With Idempotency-Key,
 * the replay returns the stored settled response without requiring (or
 * spending) a new payment.
 *
 * Entries expire after 10 min. Only settled 200s are stored (see the
 * after-settle hook in src/x402.ts); failures are never stored, so a retry
 * after a real failure re-executes normally.
 */
const seen = new Map<string, { response: unknown; status: number; at: number }>();

export function idemLookup(key: string, hash: string): { status: number; response: unknown } | undefined {
  const e = seen.get(key + ":" + hash);
  if (!e) return undefined;
  if (Date.now() - e.at > 10 * 60 * 1000) { seen.delete(key + ":" + hash); return undefined; }
  return { status: e.status, response: e.response };
}

export function idemStore(key: string, hash: string, status: number, response: unknown): void {
  // Lazy sweep: entries expire after 10 min; drop the expired ones on write
  // so rotating keys can't grow the map unboundedly.
  if (seen.size > 5000) {
    const now = Date.now();
    for (const [k, v] of seen) if (now - v.at > 10 * 60 * 1000) seen.delete(k);
  }
  seen.set(key + ":" + hash, { response, status, at: Date.now() });
}

/** Test hook: reset the store. */
export function resetIdem(): void {
  seen.clear();
}
