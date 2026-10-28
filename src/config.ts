import dotenv from "dotenv";

dotenv.config();

import { ROUTES } from "./registry.js";

/**
 * Runtime configuration. Prices come from the registry (one env var per
 * route, default = 80% of api-xpay.com — see PLAN.md §2). The rest is the
 * same shape as compute/search/scrapper: env-only, validated at boot,
 * never mutated after load.
 */

export const NETWORKS = {
  base: {
    chainId: 8453,
    name: "base",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  "base-sepolia": {
    chainId: 84532,
    name: "base-sepolia",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

/** CAIP-2 network id, e.g. "eip155:8453" (Base) or "eip155:84532" (Base Sepolia). */
export type ChainId = `eip155:${number}`;

export function caip2(network: NetworkName): ChainId {
  return network === "base" ? "eip155:8453" : "eip155:84532";
}

export interface AppConfig {
  port: number;
  host: string;
  publicBaseUrl: string;
  network: NetworkName;
  evmChain: ChainId;
  chainId: number;
  usdcAddress: string;
  payToEvm: string;
  facilitatorUrl: string;
  facilitatorMode: "url" | "cdp";
  cdpKeyId: string;
  cdpKeySecret: string;
  /** Per-route USDC prices (decimal strings) keyed by registry route id. */
  prices: Record<string, string>;
  openai: {
    apiKey: string | null;
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  maxTextChars: number;
  maxBodyBytes: number;
  freeRateLimitPerMin: number;
  payerRateLimitPerMin: number;
}

/** Max chars accepted by the text-shaped AI/text routes. */
const DEFAULT_MAX_TEXT_CHARS = 20_000;
/** Global JSON body cap (the AI routes dominate; 256 KB ≈ 64k tokens+). */
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

const DEFAULT_FACILITATOR = "https://x402.org/facilitator";

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 1): number {
  const raw = env[key];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${key} must be a number >= ${min}, got "${raw}"`);
  }
  return Math.floor(n);
}

/** Validate a USDC decimal string (positive, <= 6 dp, no scientific notation). */
function usdcAmount(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const raw = env[key];
  const value = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : fallback;
  if (!/^\d+(\.\d{1,6})?$/.test(value) || Number(value) <= 0) {
    throw new Error(`${key} must be a positive USDC amount with at most 6 decimals, got "${value}"`);
  }
  return value;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const payToEvm = str(env, "PAYTO_EVM", "");
  if (!ADDRESS_RE.test(payToEvm)) {
    throw new Error("PAYTO_EVM must be a 0x-prefixed EVM address (20 bytes)");
  }

  const networkRaw = str(env, "NETWORK", "base-sepolia");
  if (!(networkRaw in NETWORKS)) {
    throw new Error(`NETWORK must be one of ${Object.keys(NETWORKS).join(", ")}, got "${networkRaw}"`);
  }
  const network = networkRaw as NetworkName;
  const { chainId, usdcAddress } = NETWORKS[network];

  // Mainnet settlement goes through the authenticated CDP facilitator
  // (compute precedent): the public x402.org facilitator is for testnet.
  const cdpKeyId = str(env, "CDP_API_KEY_ID", "");
  const cdpKeySecret = str(env, "CDP_API_KEY_SECRET", "");
  const facilitatorUrl = str(env, "FACILITATOR_URL", DEFAULT_FACILITATOR);
  const isMainnet = network === "base";
  if (isMainnet && (!cdpKeyId || !cdpKeySecret)) {
    throw new Error(
      "NETWORK=base requires CDP_API_KEY_ID and CDP_API_KEY_SECRET " +
        "(mainnet settlements run through the authenticated CDP facilitator). " +
        "Use NETWORK=base-sepolia for local/testnet runs.",
    );
  }
  const facilitatorMode: "url" | "cdp" = isMainnet ? "cdp" : "url";

  // Per-route prices: env override or the registry default (80% of xpay).
  const prices: Record<string, string> = {};
  for (const route of ROUTES) {
    prices[route.id] = usdcAmount(env, route.envVar, route.defaultPriceUsdc);
  }

  const port = int(env, "PORT", 8788);
  const host = str(env, "HOST", "0.0.0.0");
  const publicBaseUrl = str(env, "PUBLIC_BASE_URL", `http://localhost:${port}`).replace(/\/+$/, "");

  const openaiKey = env.OPENAI_API_KEY;
  const hasOpenaiKey = typeof openaiKey === "string" && openaiKey.trim() !== "";
  if (!hasOpenaiKey) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "OPENAI_API_KEY not set — the AI routes (/x402/summarize, /rewrite, /sentiment, /keywords, /classify, /outline) will answer 502 ai_not_configured",
      }),
    );
  }

  return {
    port,
    host,
    publicBaseUrl,
    network,
    evmChain: caip2(network),
    chainId,
    usdcAddress,
    payToEvm,
    facilitatorUrl,
    facilitatorMode,
    cdpKeyId,
    cdpKeySecret,
    prices,
    openai: {
      apiKey: hasOpenaiKey ? openaiKey!.trim() : null,
      baseUrl: str(env, "OPENAI_BASE_URL", "https://api.openai.com/v1"),
      model: str(env, "OPENAI_MODEL", "gpt-4o-mini"),
      timeoutMs: int(env, "OPENAI_TIMEOUT_MS", 30_000, 100),
    },
    maxTextChars: int(env, "MAX_TEXT_CHARS", DEFAULT_MAX_TEXT_CHARS, 100),
    maxBodyBytes: int(env, "MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES, 1024),
    freeRateLimitPerMin: int(env, "FREE_RATE_LIMIT_PER_MIN", 60),
    payerRateLimitPerMin: int(env, "PAYER_RATE_LIMIT_PER_MIN", 120),
  };
}
