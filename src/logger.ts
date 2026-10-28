/**
 * Structured JSON console logger (same shape as compute/search/scrapper:
 * call sites only use logger.info/warn/error). Swap-in point for pino/winston.
 */

function base(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { ts: new Date().toISOString(), ...fields };
}

export const logger = {
  info: (msg: string, fields: Record<string, unknown> = {}): void => {
    console.log(JSON.stringify(base({ level: "info", msg, ...fields })));
  },
  warn: (msg: string, fields: Record<string, unknown> = {}): void => {
    console.warn(JSON.stringify(base({ level: "warn", msg, ...fields })));
  },
  error: (msg: string, fields: Record<string, unknown> = {}): void => {
    console.error(JSON.stringify(base({ level: "error", msg, ...fields })));
  },
};

/** Redact an address for logs: keep first 6 + last 4 chars only. */
export function redactAddress(address: string): string {
  if (typeof address !== "string" || address.length < 10) return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
