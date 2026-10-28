import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { createRequire } from "node:module";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type {
  AfterSettleHook,
  AfterVerifyHook,
  BeforeSettleHook,
  BeforeVerifyHook,
  OnSettleFailureHook,
  OnVerifyFailureHook,
  RouteConfig,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { AppConfig } from "./config.js";
import { logger, redactAddress } from "./logger.js";
import { ROUTES, SERVICE_NAME, SERVICE_TAGS, type RouteDef } from "./registry.js";

/**
 * x402 payment gating (same stack as compute/search/scrapper: routes +
 * resource server + facilitator client). EVM-only `exact` scheme: fixed
 * price per route, so the quoted price is always the settled price.
 *
 * Everything below is derived from src/registry.ts — the 21 routes, their
 * prices, discovery extensions, and the /x402 manifest all share one table.
 *
 * Sequencing (verified against installed @x402/express + @x402/core source):
 * verify -> route handler runs (response BUFFERED, nothing sent) ->
 * `await processSettlement()` -> on success the buffered 200 is flushed,
 * on failure it is discarded and a 402 is sent instead. A handler returning
 * >= 400 (bad input, AI provider failure) is never charged.
 */

/** Minimal log sink (subset of src/logger). Injectable for tests. */
export interface SettlementSink {
  info(msg: string, fields: Record<string, unknown>): void;
  error(msg: string, fields: Record<string, unknown>): void;
  warn(msg: string, fields: Record<string, unknown>): void;
}

function summarizeRequirements(req: unknown): Record<string, unknown> {
  if (!req || typeof req !== "object") return { requirements: "unknown" };
  const r = req as Record<string, unknown>;
  return {
    scheme: typeof r.scheme === "string" ? r.scheme : "unknown",
    network: typeof r.network === "string" ? r.network : "unknown",
    amount: typeof r.amount === "string" ? r.amount : String(r.amount ?? "unknown"),
    asset: typeof r.asset === "string" ? r.asset : "unknown",
    payTo: typeof r.payTo === "string" ? redactAddress(r.payTo) : "unknown",
  };
}

function summarizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return { payload: "unknown" };
  const p = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {
    x402Version: (p as { x402Version?: unknown }).x402Version ?? "unknown",
  };
  const accepted = (p as { accepted?: unknown }).accepted;
  if (accepted && typeof accepted === "object") {
    const a = accepted as Record<string, unknown>;
    // Accept terms only (scheme/network/amount/asset/redacted payTo).
    // Signatures and nonces are never logged.
    out.accepted = {
      scheme: a.scheme ?? "unknown",
      network: a.network ?? "unknown",
      amount: a.amount ?? "unknown",
      asset: a.asset ?? "unknown",
      payTo: typeof a.payTo === "string" ? redactAddress(a.payTo) : "unknown",
    };
  }
  const inner = (p as { payload?: unknown }).payload;
  if (inner && typeof inner === "object") {
    // EIP-3009 nests the signed authorization one level down. Log its fields
    // (from/to/value/validAfter/validBefore/nonce — all destined for a public
    // chain) but NEVER the signature itself.
    const auth = ((inner as { authorization?: unknown }).authorization ?? inner) as Record<string, unknown>;
    const authOut: Record<string, unknown> = {};
    for (const k of ["from", "to", "value", "validAfter", "validBefore", "nonce"]) {
      if (auth[k] !== undefined) authOut[k] = auth[k];
    }
    if (Object.keys(authOut).length > 0) out.authorization = authOut;
  }
  if (typeof (p as { payer?: unknown }).payer === "string") {
    out.payer = redactAddress((p as { payer?: unknown }).payer as string);
  }
  return out;
}

/** Response size marker for log correlation — never the content itself. */
function responseMarker(body: unknown): number | string {
  try {
    let parsed: unknown = body;
    if (Buffer.isBuffer(parsed)) parsed = JSON.parse(parsed.toString("utf8"));
    else if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (parsed && typeof parsed === "object") {
      // AI routes carry the interesting payload under these keys.
      for (const key of ["summary", "rewritten", "text", "slug", "hash", "echo"]) {
        const v = (parsed as Record<string, unknown>)[key];
        if (typeof v === "string") return v.length;
      }
      for (const key of ["keywords", "outline"]) {
        const v = (parsed as Record<string, unknown>)[key];
        if (Array.isArray(v)) return v.length;
      }
      return Object.keys(parsed as object).length;
    }
  } catch {
    // fall through
  }
  return "unknown";
}

function transportResponseBody(ctx: { transportContext?: unknown }): unknown {
  if (ctx.transportContext && typeof ctx.transportContext === "object") {
    return (ctx.transportContext as { responseBody?: unknown }).responseBody;
  }
  return undefined;
}

/**
 * Boot-time facilitator reachability probe (log-only, never fatal).
 * In cdp mode the probe carries real CDP auth, so a 401 genuinely means
 * rejected credentials; without auth a 401 would prove nothing.
 */
export async function checkFacilitatorHealth(
  url: string,
  sink: SettlementSink = logger,
  timeoutMs = 8000,
  opts: { headers?: Record<string, string>; authenticated?: boolean } = {},
): Promise<void> {
  const headers = opts.headers ?? {};
  const authenticated = opts.authenticated ?? Object.keys(headers).length > 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/supported`, {
      headers: { "Content-Type": "application/json", ...headers },
      signal: controller.signal,
    });
    sink.info("facilitator health check", {
      event: "facilitator_health",
      facilitator: url,
      status: res.status,
      ok: res.ok,
      authenticated,
    });
    if ((res.status === 401 || res.status === 403) && authenticated) {
      sink.error("facilitator rejected credentials", {
        event: "facilitator_auth_rejected",
        facilitator: url,
        status: res.status,
        detail: "CDP_API_KEY_ID/CDP_API_KEY_SECRET were not accepted. Until fixed, all paid routes fail. Generate a fresh key pair at https://portal.cdp.coinbase.com and update the env vars, then restart.",
      });
    } else if (!res.ok && res.status !== 401 && res.status !== 403) {
      sink.error("facilitator health check failed", {
        event: "facilitator_health_failed",
        facilitator: url,
        status: res.status,
      });
    }
  } catch (err) {
    sink.error("facilitator unreachable at boot", {
      event: "facilitator_health_failed",
      facilitator: url,
      error: String(err instanceof Error ? err.message : err).slice(0, 300),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build CDP auth headers for the boot health probe (cdp mode only).
 * Returns {} when keys are missing/malformed — the probe then degrades to
 * a reachability check and skips the credentials verdict.
 */
export async function buildCdpProbeHeaders(config: AppConfig): Promise<Record<string, string>> {
  if (config.facilitatorMode !== "cdp" || !config.cdpKeyId || !config.cdpKeySecret) {
    return {};
  }
  try {
    // ESM-safe lazy require (this package is "type": "module", where bare
    // require() does not exist). Testnet mode never reaches this line.
    const require = createRequire(import.meta.url);
    const { createCdpAuthHeaders } = require("@coinbase/x402") as {
      createCdpAuthHeaders: (
        apiKeyId?: string,
        apiKeySecret?: string,
      ) => () => Promise<Record<string, Record<string, string>>>;
    };
    const all = await createCdpAuthHeaders(config.cdpKeyId, config.cdpKeySecret)();
    const scoped = all.supported;
    if (scoped && typeof scoped === "object") return { ...(scoped as Record<string, string>) };
  } catch {
    // Malformed keys etc: fall through to an unauthenticated probe.
  }
  return {};
}

export function createBeforeVerifyHook(sink: SettlementSink = logger): BeforeVerifyHook {
  return async (ctx) => {
    const c = ctx as { paymentPayload?: unknown; requirements?: unknown };
    sink.info("verify_started", {
      event: "verify_started",
      requirements: summarizeRequirements(c.requirements),
      payment: summarizePayload(c.paymentPayload),
    });
  };
}

export function createAfterVerifyHook(sink: SettlementSink = logger): AfterVerifyHook {
  return async (ctx) => {
    const c = ctx as {
      result?: Record<string, unknown>;
      paymentPayload?: unknown;
      requirements?: unknown;
    };
    const result = (c.result ?? {}) as Record<string, unknown>;
    const isValid = result.isValid === true;
    const fields: Record<string, unknown> = {
      event: "verify_result",
      isValid,
      invalidReason:
        typeof result.invalidReason === "string" && result.invalidReason.length > 0
          ? String(result.invalidReason).slice(0, 500)
          : undefined,
      payer: typeof result.payer === "string" ? redactAddress(result.payer) : (result.payer ?? "unknown"),
      requirements: summarizeRequirements(c.requirements),
      payment: summarizePayload(c.paymentPayload),
    };
    if (isValid) sink.info("verify_result_valid", fields);
    else sink.error("verify_result_invalid", fields);
  };
}

export function createOnVerifyFailureHook(sink: SettlementSink = logger): OnVerifyFailureHook {
  return async (ctx) => {
    const c = ctx as { error?: unknown; paymentPayload?: unknown; requirements?: unknown };
    const err = c.error as (Error & { statusCode?: unknown; invalidReason?: unknown }) | undefined;
    sink.error("verify_failed", {
      event: "verify_failed",
      errorName: err?.name ?? "unknown",
      errorMessage: String(err?.message ?? "unknown verify error").slice(0, 1000),
      statusCode: typeof err?.statusCode === "number" ? err.statusCode : undefined,
      requirements: summarizeRequirements(c.requirements),
      payment: summarizePayload(c.paymentPayload),
    });
  };
}

export function createBeforeSettleHook(sink: SettlementSink = logger): BeforeSettleHook {
  return async (ctx) => {
    const c = ctx as { paymentPayload?: unknown; requirements?: unknown; phase?: unknown };
    sink.info("settle_started", {
      event: "settle_started",
      phase: typeof c.phase === "string" ? c.phase : "unknown",
      requirements: summarizeRequirements(c.requirements),
      payment: summarizePayload(c.paymentPayload),
    });
  };
}

/** Fires after the facilitator confirms settlement. Source of truth for revenue. */
export function createAfterSettleHook(sink: SettlementSink = logger): AfterSettleHook {
  return async (ctx) => {
    const result = (ctx.result ?? {}) as Record<string, unknown>;
    const c = ctx as { requirements?: unknown; paymentPayload?: unknown };
    const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    sink.info("settlement_confirmed", {
      event: "settlement_confirmed",
      network: asString(result.network) ?? "unknown",
      transaction: asString(result.transaction) ?? "",
      amount: asString(result.amount) ?? "unknown",
      payer: typeof result.payer === "string" ? redactAddress(result.payer) : "unknown",
      responseMarker: responseMarker(transportResponseBody(ctx)),
      requirements: summarizeRequirements(c.requirements),
    });
    // Store settled 200s for Idempotency-Key replays: a client that timed
    // out or dropped after paying can retry with the same key + same body
    // and get this result without spending a second payment. The hash is
    // computed from the REQUEST (path + body), matching the fast path in
    // src/routes.ts, so response bodies stay exactly xpay-shaped. Best-
    // effort: hook throws are contained by the SDK and never break flow.
    try {
      const adapter = (ctx as { transportContext?: { request?: { adapter?: { getHeader?: (n: string) => string | undefined; getPath?: () => string; getBody?: () => unknown } } } }).transportContext?.request?.adapter;
      const idemKey = adapter?.getHeader?.("Idempotency-Key") ?? adapter?.getHeader?.("idempotency-key");
      const rb = transportResponseBody(ctx);
      if (typeof idemKey === "string" && idemKey && rb !== undefined && adapter?.getPath) {
        let parsed: unknown = rb;
        if (typeof parsed !== "object" || parsed === null || Buffer.isBuffer(parsed)) {
          try {
            parsed = JSON.parse(Buffer.isBuffer(parsed) ? parsed.toString("utf8") : String(parsed ?? ""));
          } catch {
            parsed = undefined;
          }
        }
        if (parsed && typeof parsed === "object") {
          const { requestHash } = await import("./lib/hash.js");
          const { idemStore } = await import("./lib/idempotency.js");
          idemStore(idemKey, requestHash(adapter.getPath!(), adapter.getBody?.() ?? {}), 200, parsed);
        }
      }
    } catch {
      // replay stays best-effort
    }
  };
}

export function createOnSettleFailureHook(sink: SettlementSink = logger): OnSettleFailureHook {
  return async (ctx) => {
    const err = ctx.error as Error & { errorReason?: unknown };
    const reason =
      typeof err?.errorReason === "string" && err.errorReason.length > 0
        ? err.errorReason
        : (err?.message ?? "unknown settlement error");
    let network = "unknown";
    const reqs = (ctx as { requirements?: unknown }).requirements;
    if (reqs && typeof reqs === "object") {
      const net = (reqs as { network?: unknown }).network;
      if (typeof net === "string") network = net;
    }
    sink.error("settlement_failed", {
      event: "settlement_failed",
      network,
      errorReason: String(reason).slice(0, 1000),
      errorMessage:
        typeof (err as { errorMessage?: unknown })?.errorMessage === "string"
          ? String((err as { errorMessage?: unknown }).errorMessage).slice(0, 1000)
          : undefined,
      responseMarker: responseMarker(transportResponseBody(ctx)),
      requirements: summarizeRequirements((ctx as { requirements?: unknown }).requirements),
      payment: summarizePayload((ctx as { paymentPayload?: unknown }).paymentPayload),
    });
  };
}

/**
 * Derive a response JSON schema from the route's example 200 body
 * (registry outputExample). Coarse on purpose: x402 discovery consumers
 * want shapes, not validation. Arrays become string arrays unless empty.
 */
function schemaFromExample(example: Record<string, unknown>): Record<string, unknown> {
  const typeOf = (v: unknown): Record<string, unknown> => {
    if (typeof v === "string") return { type: "string" };
    if (typeof v === "number") return { type: "number" };
    if (typeof v === "boolean") return { type: "boolean" };
    if (Array.isArray(v)) {
      return { type: "array", items: v.length > 0 ? typeOf(v[0]) : { type: "string" } };
    }
    if (v && typeof v === "object") {
      return { type: "object", properties: schemaFromExample(v as Record<string, unknown>).properties };
    }
    return {};
  };
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(example).map(([k, v]) => [k, typeOf(v)])),
  };
}

/**
 * Discovery extension per route: POST routes advertise a JSON body
 * (bodyType "json" → body discovery), GET routes advertise query params
 * (none of ours take any → query discovery with empty input). Both carry
 * the route's example 200 response as the output example.
 */
function discoveryExtensionFor(route: RouteDef): Record<string, unknown> {
  const common = {
    input: (route.input ?? {}) as Record<string, string>,
    inputSchema: {
      properties: route.inputSchema?.properties ?? {},
      ...(route.inputSchema?.required ? { required: route.inputSchema.required } : {}),
    },
    output: { example: route.outputExample },
  };
  if (route.method === "POST") {
    return { ...declareDiscoveryExtension({ ...common, bodyType: "json" as const }) };
  }
  return { ...declareDiscoveryExtension(common) };
}

/** Rich agent-facing description (same style as compute's routes). */
export function describeRoute(route: RouteDef, priceUsdc: string): string {
  const suffix = "Unpaid calls get 402; paid calls settle only on success.";
  const inputPart =
    route.method === "POST"
      ? `POST JSON body {${Object.entries(route.inputSchema?.properties ?? {})
          .map(([name, schema]) => {
            const required = route.inputSchema?.required?.includes(name);
            const desc = (schema as { description?: string }).description;
            return `${name}${required ? " (required" : " (optional"}${desc ? `, ${desc}` : ""})`;
          })
          .join(", ")}}. `
      : "No request body or query parameters. ";
  return `${route.description} (${route.title}), fixed price $${priceUsdc} USDC. Tags: ${route.tags.join(", ")}. ${inputPart}Returns ${JSON.stringify(route.outputExample)}. ${suffix}`;
}

export function buildPaymentMiddleware(config: AppConfig): {
  middleware: ReturnType<typeof paymentMiddleware>;
  facilitatorUrl: string;
} {
  let facilitatorClient: HTTPFacilitatorClient;
  let facilitatorUrl: string;
  if (config.facilitatorMode === "cdp") {
    // Mainnet: authenticated CDP hosted facilitator via the official SDK's
    // own config object (correct root URL + path-bound JWT auth headers).
    // Lazy-required so testnet mode never loads the CDP SDK.
    // ESM-safe: bare require() does not exist in "type": "module".
    const require = createRequire(import.meta.url);
    const { createFacilitatorConfig } = require("@coinbase/x402") as {
      createFacilitatorConfig: (
        apiKeyId?: string,
        apiKeySecret?: string,
      ) => { url: string; createAuthHeaders: NonNullable<ConstructorParameters<typeof HTTPFacilitatorClient>[0]>["createAuthHeaders"] };
    };
    const facilitator = createFacilitatorConfig(config.cdpKeyId, config.cdpKeySecret);
    facilitatorClient = new HTTPFacilitatorClient({
      url: facilitator.url,
      createAuthHeaders: facilitator.createAuthHeaders,
    });
    facilitatorUrl = facilitator.url;
  } else {
    facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
    facilitatorUrl = config.facilitatorUrl;
  }

  const server = new x402ResourceServer(facilitatorClient);
  // Explicit Bazaar extension registration. The middleware would lazy-register
  // this itself on first need, but explicit registration at boot removes that
  // async failure mode.
  server.registerExtension(bazaarResourceServerExtension);
  server.register(config.evmChain, new ExactEvmScheme());

  server.onBeforeVerify(createBeforeVerifyHook());
  server.onAfterVerify(createAfterVerifyHook());
  server.onVerifyFailure(createOnVerifyFailureHook());
  server.onBeforeSettle(createBeforeSettleHook());
  server.onAfterSettle(createAfterSettleHook());
  server.onSettleFailure(createOnSettleFailureHook());

  // Static prices: one price per route means the quoted price is always the
  // settled price. Fresh objects per route (never share route-config objects).
  const acceptsFor = (priceUsdc: string) => [
    { scheme: "exact", price: `$${priceUsdc}`, network: config.evmChain, payTo: config.payToEvm as `0x${string}` },
  ];

  const routes: Record<string, RouteConfig> = {};
  for (const route of ROUTES) {
    const price = config.prices[route.id];
    routes[`${route.method} ${route.path}`] = {
      accepts: acceptsFor(price),
      serviceName: SERVICE_NAME,
      tags: [...route.tags, ...SERVICE_TAGS],
      description: describeRoute(route, price),
      mimeType: "application/json",
      extensions: { ...discoveryExtensionFor(route) },
    };
  }

  const middleware = paymentMiddleware(routes, server);

  logger.info("x402 routes configured", {
    protected: ROUTES.map((r) => `${r.method} ${r.path}`),
    free: ["GET /", "GET /health", "GET /info", "GET /llms.txt", "GET /x402", "GET /openapi.json"],
    pricesUsdc: config.prices,
    evmChain: config.evmChain,
    facilitatorMode: config.facilitatorMode,
    facilitator: facilitatorUrl,
  });
  return { middleware, facilitatorUrl };
}

/**
 * Free `/x402` manifest — field-for-field the same shape as xpay's live
 * manifest (service/protocol/network/asset/resources[]/tags): consumers
 * discover paths and prices without hitting a 402.
 */
export function buildManifest(config: AppConfig): Record<string, unknown> {
  return {
    service: SERVICE_NAME,
    protocol: "x402",
    network: config.network,
    asset: "USDC",
    resources: ROUTES.map((route) => ({
      method: route.method,
      path: route.path,
      price: `${config.prices[route.id]} USDC`,
      description: route.description,
      tag: route.tag,
      tags: route.tags,
    })),
    tags: SERVICE_TAGS,
  };
}
