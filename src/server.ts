import express from "express";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig, type AppConfig } from "./config.js";
import { logger, redactAddress } from "./logger.js";
import { buildFreeRouter, buildHandlers, idemFastPath } from "./routes.js";
import { sizeGuard, payerLimiter } from "./lib/ratelimit.js";
import { buildCdpProbeHeaders, buildPaymentMiddleware, checkFacilitatorHealth } from "./x402.js";
import { ROUTES, SERVICE_NAME } from "./registry.js";

export function buildApp(config: AppConfig): { app: express.Express; facilitatorUrl: string } {
  const app = express();
  app.disable("x-powered-by");
  // Trust ONE hosting proxy hop's X-Forwarded-* headers. Behind Railway's
  // TLS-terminating proxy this keeps req.ip accurate for per-IP rate
  // limiting. Exactly 1 (not `true`): trusting all hops would let clients
  // spoof req.ip via X-Forwarded-For and dodge rate limits. No IP-based
  // auth decisions exist, so this is safe.
  app.set("trust proxy", 1);
  app.use((req, _res, next) => {
    (req as unknown as { id?: string }).id = "req_" + randomUUID().replace(/-/g, "").slice(0, 12);
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("X-Request-Id", (req as unknown as { id?: string }).id ?? "");
    next();
  });
  // Body cap covers the largest paid body (text routes at 20k chars, plus
  // base64 headroom). Oversize JSON never reaches the paywall: body-parser
  // throws first and the error middleware below answers 413.
  const bodyLimit = config.maxBodyBytes;
  app.use(express.json({
    limit: bodyLimit,
    verify: (_req, _res, buf) => {
      if (buf.length > bodyLimit) {
        const e = new Error("body too large") as Error & { status?: number; code?: string };
        e.status = 413; e.code = "body_too_large";
        throw e;
      }
    },
  }));
  // Fallback for clients that POST JSON without `Content-Type: application/json`
  // (notably curl's `-d` path): express.json() skips those, leaving
  // req.body empty. body-parser skips already-parsed requests, so this never
  // clobbers real JSON bodies. Handlers JSON-parse string bodies themselves.
  app.use(express.text({ type: "*/*", limit: bodyLimit }));

  const free = buildFreeRouter(config);

  // UI (additive only): serve built Vite app if present.
  // Built via `npm run build --prefix client` → client/dist/. Ignored when absent.
  // index:false so GET / still hits the negotiation handler; static only serves /assets/*.
  const uiDir = path.join(process.cwd(), "client", "dist");
  if (fs.existsSync(path.join(uiDir, "index.html"))) {
    app.use(express.static(uiDir, { index: false }));
  }

  // FREE routes bypass the paywall: mounted before paymentMiddleware.
  app.use(free);

  // ---- x402 paywall (verify before handler, settle after success) ----
  const { middleware: paywall, facilitatorUrl } = buildPaymentMiddleware(config);

  // Paid routes, cheapest guard first: per-route body cap (413 before any
  // quote) -> payer limiter (429) -> idempotency replay (settled result,
  // no new payment) -> paywall (402/verify) -> handler.
  // Handlers run only after payment verifies; any status >= 400 they return
  // cancels settlement, so bad input and AI failures are never charged.
  const handlers = buildHandlers(config);
  for (const route of ROUTES) {
    const handler = handlers.get(route.id);
    if (!handler) throw new Error(`missing handler for route "${route.id}" (${route.method} ${route.path})`);
    // GETs have no body, so the size guard only applies to POSTs.
    const guards: express.RequestHandler[] = [
      ...(route.method === "POST" ? [sizeGuard(bodyLimit)] : []),
      payerLimiter(config.payerRateLimitPerMin),
      idemFastPath,
      paywall as unknown as express.RequestHandler,
    ];
    const register = route.method === "GET" ? app.get.bind(app) : app.post.bind(app);
    register(route.path, ...guards, handler as express.RequestHandler);
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { status?: number; code?: string; message?: string; type?: string };
    if (e?.type === "entity.too.large" || e?.status === 413) {
      res.status(413).json({ error: { code: "body_too_large", message: `body over ${bodyLimit} bytes` }, request_id: (req as unknown as { id?: string }).id });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Stack stays server-side (response body is intentionally generic).
    logger.error("request error", {
      method: req.method,
      route: req.path,
      error: msg.slice(0, 500),
      stack: err instanceof Error && err.stack ? err.stack.split("\n").slice(0, 5).join(" | ").slice(0, 1000) : undefined,
    });
    if ((e as { type?: string })?.type === "entity.parse.failed" || err instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    if (/facilitator|verify|settlement|settle|payment/i.test(msg)) {
      res.status(502).json({
        error: "Payment verification failed",
        detail: "The facilitator could not verify/settle this payment. Check balance, network, and facilitator status, then retry.",
      });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  });

  return { app, facilitatorUrl };
}

// ---- boot (runs only when executed directly, not when imported by tests) ----
const isMain = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  process.on("uncaughtException", (err) => {
    try {
      logger.error("uncaught exception", { event: "uncaught_exception", error: String(err?.message ?? err).slice(0, 1000) });
    } finally {
      process.exit(1);
    }
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled rejection", { event: "unhandled_rejection", error: String((reason as Error)?.message ?? reason).slice(0, 1000) });
    process.exit(1);
  });
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    // Fail loudly: never boot a paywalled server with bad config.
    console.error(`[startup] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const { app, facilitatorUrl } = buildApp(config);
  void checkFacilitatorHealth(facilitatorUrl, logger, 8000).then(async () => {
    if (config.facilitatorMode === "cdp") {
      const probeHeaders = await buildCdpProbeHeaders(config);
      await checkFacilitatorHealth(facilitatorUrl, logger, 8000, {
        headers: probeHeaders,
        authenticated: Object.keys(probeHeaders).length > 0,
      });
    }
  });
  const server = app.listen(config.port, () => {
    logger.info("server listening", {
      service: "aiutilities-api",
      port: config.port,
      network: config.network,
      evmChain: config.evmChain,
      routes: ROUTES.length,
      facilitatorMode: config.facilitatorMode,
      facilitator: facilitatorUrl,
      aiConfigured: config.openai.apiKey !== null,
      // Never print full pay-to addresses or keys.
      payToEvm: redactAddress(config.payToEvm),
    });
    if (config.network === "base") {
      logger.warn("LIVE MAINNET: all paid routes charge REAL USDC per request.", {
        service: SERVICE_NAME,
        routes: ROUTES.length,
        pricesUsdc: config.prices,
      });
    }
  });
  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
