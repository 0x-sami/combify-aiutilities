import { createHash } from "node:crypto";

/**
 * Stable key-sorted JSON for request hashing (key order must not matter).
 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * Stable hash of the normalized request (path + canonical body). The
 * after-settle hook stores settled 200s under this hash; Idempotency-Key
 * replays with the same key + hash skip payment entirely.
 */
export function requestHash(path: string, body: unknown): string {
  return "sha256:" + createHash("sha256").update(`${path}:${stableStringify(body)}`).digest("hex");
}
