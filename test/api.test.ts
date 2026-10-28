import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import { loadConfig } from "../src/config.js";
import { resetBuckets } from "../src/lib/buckets.js";
import { resetIdem } from "../src/lib/idempotency.js";
import { buildApp } from "../src/server.js";
import { ROUTES } from "../src/registry.js";
import { atomicAmount, slugify } from "../src/routes.js";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const FACILITATOR = "https://x402.org/facilitator";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PAYTO_EVM: PAY_TO,
    NETWORK: "base-sepolia",
    OPENAI_API_KEY: "test-openai-key",
    FREE_RATE_LIMIT_PER_MIN: "1000",
    PAYER_RATE_LIMIT_PER_MIN: "1000",
    ...extra,
  };
}

let verifyCalls = 0;
let settleCalls = 0;
let supportedCalls = 0;
let aiCalls = 0;
let lastAiBody: unknown = undefined;
let aiHandler: (url: string) => Response = () => {
  throw new Error("ai handler not set for this test");
};

// Minimal live-shaped /supported stub: advertises exact on Base Sepolia.
const SUPPORTED = {
  kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
  extensions: [],
  signers: {},
};

const VERIFY_OK = { isValid: true, payer: "0x2222222222222222222222222222222222222222" };
const VERIFY_BAD = { isValid: false, invalidReason: "test-invalid" };
const SETTLE_OK = { success: true, transaction: `0x${"cc".repeat(32)}`, network: "eip155:84532" };

const realFetch = globalThis.fetch;

/** OpenAI chat-completions stub returning the given message content. */
const chatJson = (content: string) => () =>
  Response.json({ choices: [{ message: { content } }] });

/**
 * Stub facilitator + OpenAI traffic; everything else (including the test's
 * own HTTP calls to the ephemeral server) passes through for real.
 */
function stubOutbound(verifyBody: object, settleBody: object): void {
  verifyCalls = 0;
  settleCalls = 0;
  supportedCalls = 0;
  aiCalls = 0;
  lastAiBody = undefined;
  vi.stubGlobal("fetch", async (input: unknown, init?: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : String((input as Request).url);
    if (url.startsWith(`${FACILITATOR}/supported`)) {
      supportedCalls++;
      return Response.json(SUPPORTED);
    }
    if (url.startsWith(`${FACILITATOR}/verify`)) {
      verifyCalls++;
      return Response.json(verifyBody);
    }
    if (url.startsWith(`${FACILITATOR}/settle`)) {
      settleCalls++;
      return Response.json(settleBody);
    }
    if (url.startsWith(OPENAI_URL)) {
      aiCalls++;
      try {
        lastAiBody = JSON.parse(String((init as { body?: unknown })?.body ?? "{}"));
      } catch {
        lastAiBody = undefined;
      }
      return aiHandler(url);
    }
    return realFetch(input as never, init as never);
  });
}

function decodePaymentRequired(res: Response): { accepts: Array<Record<string, unknown>> } {
  const header = res.headers.get("payment-required");
  expect(header).toBeTruthy();
  return JSON.parse(atob(header as string));
}

/** Build a payment header by echoing the server's own quoted terms. */
function paymentHeader(accepts0: Record<string, unknown>): string {
  return btoa(
    JSON.stringify({
      x402Version: 2,
      accepted: accepts0,
      payload: {
        signature: `0x${"11".repeat(32)}`,
        authorization: {
          from: "0x2222222222222222222222222222222222222222",
          to: accepts0["payTo"],
          value: accepts0["amount"],
          validAfter: "0",
          validBefore: "9999999999",
          nonce: `0x${"ab".repeat(32)}`,
        },
      },
    }),
  );
}

async function startApp(env: NodeJS.ProcessEnv): Promise<{ base: string; close: () => Promise<void> }> {
  const config = loadConfig(env);
  const { app } = buildApp(config);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))) };
}

async function call(
  base: string,
  method: "GET" | "POST",
  path: string,
  body?: object,
  sig?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return realFetch(`${base}${path}`, {
    method,
    headers: {
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      ...(sig ? { "payment-signature": sig } : {}),
      ...extraHeaders,
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}

const post = (base: string, path: string, body: object, sig?: string, extraHeaders: Record<string, string> = {}) =>
  call(base, "POST", path, body, sig, extraHeaders);

const get = (base: string, path: string, sig?: string, extraHeaders: Record<string, string> = {}) =>
  call(base, "GET", path, undefined, sig, extraHeaders);

/** Probe unpaid (expect 402), then pay and call for real. */
async function paid(
  base: string,
  method: "GET" | "POST",
  path: string,
  probeBody: object,
  body: object,
  extraHeaders: Record<string, string> = {},
): Promise<{ probe: Response; res: Response }> {
  const probe = await call(base, method, path, probeBody);
  expect(probe.status).toBe(402);
  const { accepts } = decodePaymentRequired(probe);
  const res = await call(base, method, path, body, paymentHeader(accepts[0] as Record<string, unknown>), extraHeaders);
  return { probe, res };
}

/** Convenience for POST routes. */
const paidPost = (base: string, path: string, probeBody: object, body: object, extraHeaders: Record<string, string> = {}) =>
  paid(base, "POST", path, probeBody, body, extraHeaders);

beforeEach(() => {
  vi.unstubAllGlobals();
  resetBuckets();
  resetIdem();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("config", () => {
  it("refuses to boot on bad payment config", () => {
    expect(() => loadConfig(testEnv({ PAYTO_EVM: "nope" }))).toThrow(/PAYTO_EVM/);
    expect(() => loadConfig(testEnv({ NETWORK: "mainnet" }))).toThrow(/NETWORK/);
    expect(() => loadConfig(testEnv({ PRICE_PING_USDC: "free" }))).toThrow(/PRICE_PING_USDC/);
    expect(() => loadConfig(testEnv({ PRICE_SUMMARIZE_USDC: "-0.01" }))).toThrow(/PRICE_SUMMARIZE_USDC/);
  });

  it("NETWORK=base without CDP credentials is refused (mainnet rule)", () => {
    expect(() => loadConfig(testEnv({ NETWORK: "base" }))).toThrow(/CDP_API_KEY_ID/);
    expect(() =>
      loadConfig(testEnv({ NETWORK: "base", CDP_API_KEY_ID: "k", CDP_API_KEY_SECRET: "s" })),
    ).not.toThrow();
  });

  it("loads the 21 default prices (80% of xpay) and sane defaults", () => {
    const c = loadConfig(testEnv());
    expect(c.port).toBe(8788);
    expect(c.evmChain).toBe("eip155:84532");
    expect(c.chainId).toBe(84532);
    expect(c.maxTextChars).toBe(20000);
    expect(Object.keys(c.prices)).toHaveLength(21);
    // 15 utility/data/tools/crypto/payment routes at $0.004.
    for (const id of ["ping", "status", "time", "uuid", "random", "ip", "network", "echo", "hash", "keccak", "base64", "slug", "wordcount", "payment", "quote"]) {
      expect(c.prices[id]).toBe("0.004");
    }
    expect(c.prices.summarize).toBe("0.008");
    expect(c.prices.rewrite).toBe("8");
    expect(c.prices.sentiment).toBe("8");
    expect(c.prices.keywords).toBe("8");
    expect(c.prices.classify).toBe("16");
    expect(c.prices.outline).toBe("16");
    expect(c.openai.model).toBe("gpt-4o-mini");
  });

  it("warns (does not fail) when OPENAI_API_KEY is missing", () => {
    const c = loadConfig(testEnv({ OPENAI_API_KEY: "" }));
    expect(c.openai.apiKey).toBeNull();
  });
});

describe("free surface", () => {
  it("GET /health is the xpay-shaped liveness reply", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const res = await realFetch(`${base}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok", service: "aiutilities-api" });
      expect(aiCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("GET /x402 is a free manifest of all 21 resources with 80%-of-xpay prices", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const res = await realFetch(`${base}/x402`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        service: string;
        protocol: string;
        network: string;
        asset: string;
        resources: Array<{ method: string; path: string; price: string; tag: string; tags: string[] }>;
        tags: string[];
      };
      expect(body.service).toBe("AI Utilities");
      expect(body.protocol).toBe("x402");
      expect(body.network).toBe("base-sepolia");
      expect(body.asset).toBe("USDC");
      expect(body.resources).toHaveLength(21);
      expect(body.tags).toContain("x402");
      const ping = body.resources.find((r) => r.path === "/x402/ping");
      expect(ping).toEqual({
        method: "GET",
        path: "/x402/ping",
        price: "0.004 USDC",
        description: "Health check ping",
        tag: "Utility",
        tags: ["health", "ping", "monitoring", "uptime", "latency"],
      });
      const summarize = body.resources.find((r) => r.path === "/x402/summarize");
      expect(summarize?.price).toBe("0.008 USDC");
      const classify = body.resources.find((r) => r.path === "/x402/classify");
      expect(classify?.price).toBe("16 USDC");
      // Every registry route appears exactly once, in registry order.
      expect(body.resources.map((r) => r.path)).toEqual(ROUTES.map((r) => r.path));
    } finally {
      await close();
    }
  });

  it("GET /openapi.json documents all 21 paths with payment info", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const res = await realFetch(`${base}/openapi.json`);
      expect(res.status).toBe(200);
      const spec = (await res.json()) as {
        openapi: string;
        info: { title: string };
        servers: Array<{ url: string }>;
        paths: Record<string, Record<string, {
          operationId: string;
          "x-category": string;
          "x-payment-info": { amount: string; network: string; asset: string };
          responses: Record<string, unknown>;
          requestBody?: unknown;
        }>>;
        components: { securitySchemes: Record<string, unknown> };
      };
      expect(spec.openapi).toBe("3.1.0");
      expect(spec.info.title).toBe("AI Utilities");
      expect(Object.keys(spec.paths)).toHaveLength(21);
      const ping = spec.paths["/x402/ping"]!["get"]!;
      expect(ping.operationId).toBe("ping");
      expect(ping["x-category"]).toBe("Utility");
      // $0.004 -> 4000 atomic (6 decimals).
      expect(ping["x-payment-info"].amount).toBe("4000");
      expect(ping["x-payment-info"].network).toBe("eip155:84532");
      expect(ping["x-payment-info"].asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
      expect(ping.responses).toHaveProperty("200");
      expect(ping.responses).toHaveProperty("402");
      const classify = spec.paths["/x402/classify"]!["post"]!;
      // $16 -> 16000000 atomic.
      expect(classify["x-payment-info"].amount).toBe("16000000");
      expect(classify.requestBody).toBeTruthy();
      expect(spec.components.securitySchemes).toHaveProperty("X402Payment");
      // GET routes carry no requestBody; POST routes do.
      expect(spec.paths["/x402/quote"]!["get"]!.requestBody).toBeUndefined();
      expect(spec.paths["/x402/echo"]!["post"]!.requestBody).toBeTruthy();
    } finally {
      await close();
    }
  });

  it("GET /llms.txt names every route with its price", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const res = await realFetch(`${base}/llms.txt`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      for (const r of ROUTES) {
        expect(text).toContain(`${r.method} ${r.path} ($`);
      }
      expect(text).toContain("Idempotency-Key");
      expect(text).toContain("$0.004");
      expect(text).toContain("$16");
    } finally {
      await close();
    }
  });

  it("GET /info and GET / list prices and all 21 protected routes", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      for (const p of ["/info", "/"]) {
        const res = await realFetch(`${base}${p}`, { headers: { Accept: "application/json" } });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          name: string;
          protected: string[];
          pricesUsdc: Record<string, string>;
        };
        expect(body.name).toBe("aiutilities-api");
        expect(body.protected).toHaveLength(21);
        expect(body.pricesUsdc.ping).toBe("0.004");
        expect(body.pricesUsdc.outline).toBe("16");
      }
    } finally {
      await close();
    }
  });

  it("robots.txt and sitemap.xml are served free", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const robots = await realFetch(`${base}/robots.txt`);
      expect(robots.status).toBe(200);
      expect(await robots.text()).toContain("User-agent: *");
      const sitemap = await realFetch(`${base}/sitemap.xml`);
      expect(sitemap.status).toBe(200);
      const xml = await sitemap.text();
      expect(xml).toContain("<urlset");
      expect(xml).toContain("/x402/outline");
    } finally {
      await close();
    }
  });
});

describe("unpaid requests", () => {
  const AMOUNTS: Record<string, string> = {
    // 15 utility/data/tools/crypto/payment routes: $0.004 -> 4000
    ping: "4000", status: "4000", time: "4000", uuid: "4000", random: "4000",
    ip: "4000", network: "4000", echo: "4000", hash: "4000", keccak: "4000",
    base64: "4000", slug: "4000", wordcount: "4000", payment: "4000", quote: "4000",
    // AI routes
    summarize: "8000", // $0.008
    rewrite: "8000000", sentiment: "8000000", keywords: "8000000", // $8
    classify: "16000000", outline: "16000000", // $16
  };

  it.each(ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s without payment returns 402 with the exact atomic price",
    async (_label, route) => {
      stubOutbound(VERIFY_OK, SETTLE_OK);
      const { base, close } = await startApp(testEnv());
      try {
        const res = await call(base, route.method, route.path, route.input ?? {});
        expect(res.status).toBe(402);
        const terms = decodePaymentRequired(res);
        expect(terms.accepts[0]["amount"]).toBe(AMOUNTS[route.id]);
        expect(terms.accepts[0]["asset"]).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
        expect(terms.accepts[0]["network"]).toBe("eip155:84532");
        expect(terms.accepts[0]["payTo"]).toBe(PAY_TO);
        expect(aiCalls).toBe(0);
        expect(verifyCalls).toBe(0); // quoted with no verify/settle round-trip
        expect(settleCalls).toBe(0);
        expect(supportedCalls).toBeGreaterThanOrEqual(1);
      } finally {
        await close();
      }
    },
  );
});

describe("limits enforced before any spend", () => {
  it("oversized POST body is rejected 413 pre-paywall (no 402, no verify)", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const res = await post(base, "/x402/echo", { message: "x".repeat(300 * 1024) });
      expect(res.status).toBe(413);
      expect(res.headers.get("payment-required")).toBeNull();
      expect(aiCalls).toBe(0);
      expect(verifyCalls).toBe(0);
      expect(settleCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("rate-limited free requests get 429 without touching the facilitator", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv({ FREE_RATE_LIMIT_PER_MIN: "1" }));
    try {
      expect((await realFetch(`${base}/health`)).status).toBe(200);
      const res = await realFetch(`${base}/health`);
      expect(res.status).toBe(429);
      expect(verifyCalls).toBe(0);
    } finally {
      await close();
    }
  });
});

describe("utility routes (paid)", () => {
  it("paid ping returns pong with the xpay response shape", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paid(base, "GET", "/x402/ping", {}, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        message: "pong",
        network: "base-sepolia",
        asset: "USDC",
        service: "AI Utilities",
      });
      expect(res.headers.get("payment-response")).toBeTruthy();
      expect(verifyCalls).toBe(1);
      expect(settleCalls).toBe(1);
      expect(aiCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("paid time returns utc + unix", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paid(base, "GET", "/x402/time", {}, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; utc: string; unix: number };
      expect(body.success).toBe(true);
      expect(new Date(body.utc).toISOString()).toBe(body.utc);
      expect(Math.abs(body.unix * 1000 - Date.now())).toBeLessThan(5000);
    } finally {
      await close();
    }
  });

  it("paid uuid returns a v4 UUID; paid random returns 16 hex bytes", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res: u } = await paid(base, "GET", "/x402/uuid", {}, {});
      expect(u.status).toBe(200);
      const uuid = ((await u.json()) as { uuid: string }).uuid;
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      const { res: r } = await paid(base, "GET", "/x402/random", {}, {});
      const rb = (await r.json()) as { integer: number; hex: string; bytes: number };
      expect(rb.bytes).toBe(16);
      expect(rb.hex).toMatch(/^[0-9a-f]{32}$/);
      expect(Number.isInteger(rb.integer)).toBe(true);
    } finally {
      await close();
    }
  });

  it("paid ip reflects the caller's address", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paid(base, "GET", "/x402/ip", {}, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; ip: string };
      expect(body.success).toBe(true);
      expect(body.ip).toBe("127.0.0.1");
    } finally {
      await close();
    }
  });

  it("paid network returns the CAIP-2 id, chainId, and USDC contract (xpay quirk)", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paid(base, "GET", "/x402/network", {}, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        network: "eip155:84532",
        chainId: 84532,
        asset: "USDC",
        usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        protocol: "x402",
        service: "AI Utilities",
      });
    } finally {
      await close();
    }
  });

  it("paid echo mirrors the message", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/echo", { message: "x" }, { message: "hello agents" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        echo: "hello agents",
        network: "base-sepolia",
        asset: "USDC",
      });
    } finally {
      await close();
    }
  });

  it("paid hash returns sha256 hex; paid keccak returns the verified keccak256 vector", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res: h } = await paidPost(base, "/x402/hash", { text: "x" }, { text: "hello" });
      expect(h.status).toBe(200);
      expect(await h.json()).toMatchObject({
        success: true,
        algorithm: "sha256",
        hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      });

      const { res: k } = await paidPost(base, "/x402/keccak", { text: "x" }, { text: "hello" });
      expect(k.status).toBe(200);
      const kb = (await k.json()) as { algorithm: string; hash: string };
      expect(kb.algorithm).toBe("keccak256");
      // Cross-check against the library directly (the vector in the registry
      // and the OpenAPI/discovery examples derive from this same value).
      expect(kb.hash).toBe(Buffer.from(keccak_256(new TextEncoder().encode("hello"))).toString("hex"));
      expect(kb.hash).toBe("1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8");
    } finally {
      await close();
    }
  });

  it("paid base64 encodes and decodes", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res: enc } = await paidPost(base, "/x402/base64", { text: "x" }, { text: "hello" });
      expect(enc.status).toBe(200);
      expect(await enc.json()).toMatchObject({ success: true, action: "encode", result: "aGVsbG8=" });

      const { res: dec } = await paidPost(base, "/x402/base64", { text: "x" }, { text: "aGVsbG8=", action: "decode" });
      expect(dec.status).toBe(200);
      expect(await dec.json()).toMatchObject({ success: true, action: "decode", result: "hello" });
    } finally {
      await close();
    }
  });

  it("paid base64 with invalid base64 input returns 400 and is NOT charged", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/base64", { text: "x" }, { text: "!!not-base64!!", action: "decode" });
      expect(res.status).toBe(400);
      expect(settleCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("paid slug url-encodes text; paid wordcount counts words/chars/lines", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res: s } = await paidPost(base, "/x402/slug", { text: "x" }, { text: "Hello World" });
      expect(s.status).toBe(200);
      expect(await s.json()).toMatchObject({ success: true, slug: "hello-world" });

      const { res: w } = await paidPost(base, "/x402/wordcount", { text: "x" }, { text: "Hello World" });
      expect(w.status).toBe(200);
      expect(await w.json()).toEqual({
        success: true,
        words: 2,
        characters: 11,
        charactersNoSpaces: 10,
        lines: 1,
        network: "base-sepolia",
        asset: "USDC",
      });
    } finally {
      await close();
    }
  });
});

describe("payment routes (paid)", () => {
  it("paid /payment decodes PAYMENT-SIGNATURE into a receipt", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paid(base, "GET", "/x402/payment", {}, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        service: string;
        payment: { requestId: string; amount: string; asset: string; network: string; payer: string; receiver: string; transactionHash: string };
      };
      expect(body.success).toBe(true);
      expect(body.service).toBe("AI Utilities");
      expect(body.payment.amount).toBe("0.004");
      expect(body.payment.asset).toBe("USDC");
      expect(body.payment.network).toBe("base-sepolia");
      expect(body.payment.payer).toBe("0x2222222222222222222222222222222222222222");
      expect(body.payment.receiver).toBe(PAY_TO);
      expect(body.payment.transactionHash).toBe(`0x${"11".repeat(32)}`);
      expect(body.payment.requestId).toMatch(/^req_[0-9a-f]{12}$/);
    } finally {
      await close();
    }
  });

  it("paid /quote returns this route's price and the merchant wallet", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paid(base, "GET", "/x402/quote", {}, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { quote: Record<string, unknown> };
      expect(body.quote).toEqual({
        amount: "0.004",
        asset: "USDC",
        network: "base-sepolia",
        payTo: PAY_TO,
        protocol: "x402",
        requestId: expect.stringMatching(/^req_[0-9a-f]{12}$/),
      });
    } finally {
      await close();
    }
  });

  it("quote respects a PRICE_QUOTE_USDC override", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv({ PRICE_QUOTE_USDC: "0.01" }));
    try {
      const { res } = await paid(base, "GET", "/x402/quote", {}, {});
      expect(((await res.json()) as { quote: { amount: string } }).quote.amount).toBe("0.01");
    } finally {
      await close();
    }
  });
});

describe("AI routes (paid)", () => {
  it("paid summarize returns a summary and sends the text to the model", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"summary": "A short summary."}');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/summarize", { text: "x" }, { text: "Long text here." });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        summary: "A short summary.",
        network: "base-sepolia",
        asset: "USDC",
      });
      expect(aiCalls).toBe(1);
      expect(settleCalls).toBe(1);
      const sent = lastAiBody as { model: string; temperature: number; messages: Array<{ role: string; content: string }> };
      expect(sent.model).toBe("gpt-4o-mini");
      expect(sent.temperature).toBe(0);
      expect(sent.messages[1]?.content).toBe("Long text here.");
    } finally {
      await close();
    }
  });

  it("paid rewrite returns rewritten text", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson("A polished rewrite.");
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/rewrite", { text: "x" }, { text: "Make this better." });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, rewritten: "A polished rewrite." });
    } finally {
      await close();
    }
  });

  it("paid sentiment parses label + clamped score", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"label": "positive", "score": 0.87}');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/sentiment", { text: "x" }, { text: "This product is great." });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, label: "positive", score: 0.87 });
    } finally {
      await close();
    }
  });

  it("paid keywords parses a string array", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"keywords": ["payments", "base", "usdc"]}');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/keywords", { text: "x" }, { text: "AI payments on Base with USDC." });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, keywords: ["payments", "base", "usdc"] });
    } finally {
      await close();
    }
  });

  it("paid classify parses category + confidence", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"category": "finance", "confidence": 0.91}');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/classify", { text: "x" }, { text: "Pay the invoice with USDC." });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, category: "finance", confidence: 0.91 });
    } finally {
      await close();
    }
  });

  it("paid outline parses an outline array", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"outline": ["First point", "Second point"]}');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/outline", { text: "x" }, { text: "First point. Second point." });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, outline: ["First point", "Second point"] });
    } finally {
      await close();
    }
  });

  it("tolerates markdown-fenced JSON from the model", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('```json\n{"summary": "Fenced summary."}\n```');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/summarize", { text: "x" }, { text: "Some text." });
      expect(res.status).toBe(200);
      expect((await res.json() as { summary: string }).summary).toBe("Fenced summary.");
    } finally {
      await close();
    }
  });

  it("unconfigured AI (no OPENAI_API_KEY) returns 502 and is NOT charged", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const { base, close } = await startApp(testEnv({ OPENAI_API_KEY: "" }));
    try {
      const { res } = await paidPost(base, "/x402/summarize", { text: "x" }, { text: "Some text." });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("ai_not_configured");
      expect(aiCalls).toBe(0);
      expect(verifyCalls).toBe(1); // verified...
      expect(settleCalls).toBe(0); // ...but never settled
    } finally {
      await close();
    }
  });

  it("upstream AI failure is NOT charged (502, settle never called)", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = () => new Response("upstream down", { status: 500 });
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/summarize", { text: "x" }, { text: "Some text." });
      expect(res.status).toBe(502);
      expect(aiCalls).toBe(1);
      expect(settleCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("unparseable model JSON is 502 and NOT charged", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson("I refuse to answer in JSON.");
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/sentiment", { text: "x" }, { text: "hi" });
      expect(res.status).toBe(502);
      expect(settleCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("empty text on an AI route is 400 and NOT charged", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"summary": "nope"}');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/summarize", { text: "x" }, { text: "   " });
      expect(res.status).toBe(400);
      expect(aiCalls).toBe(0);
      expect(settleCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("text over MAX_TEXT_CHARS is 400 and NOT charged", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"summary": "nope"}');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/summarize", { text: "x" }, { text: "y".repeat(20001) });
      expect(res.status).toBe(400);
      expect(aiCalls).toBe(0);
      expect(settleCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it("paid sentiment with a bad verify is rejected 402 without calling AI", async () => {
    stubOutbound(VERIFY_BAD, SETTLE_OK);
    aiHandler = chatJson('{"label": "positive", "score": 1}');
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, "/x402/sentiment", { text: "x" }, { text: "hi" });
      expect(res.status).toBe(402);
      expect(aiCalls).toBe(0);
      expect(settleCalls).toBe(0);
    } finally {
      await close();
    }
  });
});

describe("bad input on paid non-AI routes", () => {
  it.each([
    ["/x402/echo", {}, "message is required"],
    ["/x402/hash", {}, "text is required"],
    ["/x402/hash", { text: "  " }, "text is required"],
    ["/x402/keccak", {}, "text is required"],
    ["/x402/slug", {}, "text is required"],
    ["/x402/wordcount", {}, "text is required"],
    ["/x402/base64", { text: "x", action: "rotate" }, "action must be"],
  ])("paid POST %s with bad input returns 400 and is NOT charged (%s)", async (path, body) => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    const probeBody = path === "/x402/echo" ? { message: "x" } : path === "/x402/base64" ? { text: "x" } : { text: "x" };
    const { base, close } = await startApp(testEnv());
    try {
      const { res } = await paidPost(base, path, probeBody, body);
      expect(res.status).toBe(400);
      expect(settleCalls).toBe(0);
    } finally {
      await close();
    }
  });
});

describe("idempotency replays", () => {
  it("replay with same key + same body returns the settled result with no new payment", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"summary": "Settled once."}');
    const { base, close } = await startApp(testEnv());
    try {
      const key = { "Idempotency-Key": "replay-1" };
      const { res } = await paidPost(base, "/x402/summarize", { text: "x" }, { text: "Same text." }, key);
      expect(res.status).toBe(200);
      const first = await res.json();
      expect(verifyCalls).toBe(1);
      expect(settleCalls).toBe(1);
      expect(aiCalls).toBe(1);

      // Replay: same key + same body, NO payment header at all.
      const replay = await post(base, "/x402/summarize", { text: "Same text." }, undefined, key);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(first);
      expect(verifyCalls).toBe(1); // no new verification
      expect(settleCalls).toBe(1); // no second charge
      expect(aiCalls).toBe(1); // model ran only once
    } finally {
      await close();
    }
  });

  it("same key + different body still requires payment", async () => {
    stubOutbound(VERIFY_OK, SETTLE_OK);
    aiHandler = chatJson('{"summary": "ok"}');
    const { base, close } = await startApp(testEnv());
    try {
      const key = { "Idempotency-Key": "replay-2" };
      const { res } = await paidPost(base, "/x402/summarize", { text: "x" }, { text: "first" }, key);
      expect(res.status).toBe(200);
      expect(settleCalls).toBe(1);

      const other = await post(base, "/x402/summarize", { text: "something else" }, undefined, key);
      expect(other.status).toBe(402); // different request hash: not a replay
      expect(settleCalls).toBe(1);
    } finally {
      await close();
    }
  });
});

describe("registry + helpers", () => {
  it("registry has exactly 21 routes, all under /x402, unique ids/paths", () => {
    expect(ROUTES).toHaveLength(21);
    const ids = new Set(ROUTES.map((r) => r.id));
    const paths = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    expect(ids.size).toBe(21);
    expect(paths.size).toBe(21);
    for (const r of ROUTES) {
      expect(r.path.startsWith("/x402/")).toBe(true);
      expect(r.tags.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it("atomicAmount converts to 6-decimal atomic USDC", () => {
    expect(atomicAmount("0.004")).toBe("4000");
    expect(atomicAmount("0.008")).toBe("8000");
    expect(atomicAmount("8")).toBe("8000000");
    expect(atomicAmount("16")).toBe("16000000");
    expect(atomicAmount("0.000001")).toBe("1");
  });

  it("slugify normalizes to url-safe form", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("  Café  Au Lait!  ")).toBe("cafe-au-lait");
    expect(slugify("---")).toBe("");
  });
});
