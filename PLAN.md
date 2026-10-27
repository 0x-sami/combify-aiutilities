# AIUtilities — Replication Plan

**Goal:** Replicate [api-xpay.com ("X Pay")](https://www.api-xpay.com) as **AIUtilities**, the 5th Combify app.
Same endpoints, same request/response contracts, same x402 behavior — with **default prices set to 80% of
X Pay's prices**. Deployed on **Railway**, same design system and `.env` conventions as
`compute/`, `search/`, `scrapper/`, `lander/`.

Plan date: 2026-10-27. Sources: `https://www.api-xpay.com` (live site, OpenAPI, x402 manifest, live 402 probes)
and `https://agentic.market/services/www-api-xpay-com`.

---

## 1. Research findings (what exists on X Pay)

### 1.1 Service identity
| Field | Value |
|---|---|
| Name | `X Pay` (we: **AI Utilities** / `AIUtilities`) |
| Tagline | "Pay-per-request utility APIs powered by x402 using USDC on Base." |
| Hosts | `api-xpay.com` → `www.api-xpay.com` (canonical; apex is unreachable from some networks) |
| Logo / favicon | `/logo.png` (512×512 PNG), `/favicon.ico` |
| Network / asset | **Base mainnet** (`eip155:8453`), **USDC** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Protocol | x402 **v2**, scheme **`exact`**, facilitator via CDP, **Bazaar discovery extension** |
| Their payTo | `0x589a2314a2E05F45e40C4823Da3Ba58D421dB3d8` (ours: our own `PAYTO_EVM`) |
| Hosting | **Railway** (observed headers: `server: railway-hikari`, `x-railway-request-id`) |
| Stack | Same `@x402/express` middleware family the Combify apps already use |

### 1.2 Free surface (no payment)
| Route | Behavior |
|---|---|
| `GET /` | Plain HTML landing (title, tagline, links to OpenAPI + Resources). With `Accept: application/json`: service descriptor `{"name","description","network","asset","protocol","logo","tags","openapi","resources"}` — **same content negotiation pattern as our other apps** |
| `GET /health` | `{"status":"ok","service":"xpay-api"}` (we: `{"status":"ok","service":"aiutilities-api"}`) |
| `GET /robots.txt` | `User-agent: * / Allow: / / Sitemap: …/sitemap.xml` |
| `GET /sitemap.xml` | present |
| `GET /openapi.json` | Full OpenAPI 3.1 spec (all 21 routes, request/response schemas) |
| `GET /x402` | **x402 resource manifest** — JSON list of `{method, path, price, description, tag, tags[]}` (this is what Agentic Market indexes) |

No `/llms.txt`, no `/info`, no `/terms` (all 404). *Decision: keep parity for the xpay-mirrored routes,
but add the Combify house free routes (`/llms.txt`, `/info`) since they are additive and required by our
house pattern — see §6 "Deviations".*

### 1.3 Payment behavior (probed live)
Unpaid request to any paid route returns **HTTP 402** with:
```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://www.api-xpay.com/x402/ping",
    "description": "Health check ping",
    "mimeType": "application/json",
    "serviceName": "X Pay",
    "iconUrl": "https://www.api-xpay.com/logo.png",
    "tags": ["health","ping","monitoring","uptime","latency"]
  },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "amount": "5000",              // atomic USDC units, 6 decimals → 0.005 USDC
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0x589a…B3d8",
    "maxTimeoutSeconds": 60,
    "resource": "https://www.api-xpay.com/x402/ping",
    "extra": { "name": "USD Coin", "version": "2" }
  }],
  "extensions": { "bazaar": { "info": { "input": {...}, "output": {...} }, "schema": {...} } }
}
```
This is exactly what `@x402/express` v2 + `declareDiscoveryExtension` / `bazaarResourceServerExtension`
produce — the same code path as `compute/src/x402.ts` and `search/src/x402.ts`.

### 1.4 Agentic Market listing
- Category: **SERVICE**, Network: **Base**, Avg/request: **$0.005 – $20.00**, Endpoints: **14**,
  price list in the listing: `$20, $0.005, $10, $0.005, $20, $0.005×4, $10, $10, $0.005×3`.
- ⚠️ The market indexed an **older snapshot (14 routes)**. The **live site has 21 paid routes**
  (the 14 above plus `/hash`, `/keccak`, `/base64`, `/slug`, `/wordcount`, `/quote`, `/summarize` etc.
  resolved against the live `/x402` manifest). **The live manifest is authoritative — we replicate all 21.**

---

## 2. Endpoint & pricing matrix (the contract to replicate 1:1)

21 paid routes, all under `/x402/*`. Prices: X Pay default → **AIUtilities default = 80%**.
All amounts are USDC on Base; env-overridable (§4).

| # | Route | Method | Tag | X Pay | **AIUtilities (80%)** |
|---|---|---|---|---|---|
| 1 | `/x402/ping` | GET | Utility | $0.005 | **$0.004** |
| 2 | `/x402/status` | GET | Utility | $0.005 | **$0.004** |
| 3 | `/x402/time` | GET | Data | $0.005 | **$0.004** |
| 4 | `/x402/uuid` | GET | Tools | $0.005 | **$0.004** |
| 5 | `/x402/random` | GET | Tools | $0.005 | **$0.004** |
| 6 | `/x402/ip` | GET | Data | $0.005 | **$0.004** |
| 7 | `/x402/network` | GET | Crypto | $0.005 | **$0.004** |
| 8 | `/x402/echo` | POST | Tools | $0.005 | **$0.004** |
| 9 | `/x402/hash` | POST | Crypto | $0.005 | **$0.004** |
| 10 | `/x402/keccak` | POST | Crypto | $0.005 | **$0.004** |
| 11 | `/x402/base64` | POST | Tools | $0.005 | **$0.004** |
| 12 | `/x402/slug` | POST | Tools | $0.005 | **$0.004** |
| 13 | `/x402/wordcount` | POST | Data | $0.005 | **$0.004** |
| 14 | `/x402/payment` | GET | Payment | $0.005 | **$0.004** |
| 15 | `/x402/quote` | GET | Payment | $0.005 | **$0.004** |
| 16 | `/x402/summarize` | POST | AI | $0.01 | **$0.008** |
| 17 | `/x402/rewrite` | POST | AI | $10 | **$8.00** |
| 18 | `/x402/sentiment` | POST | AI | $10 | **$8.00** |
| 19 | `/x402/keywords` | POST | AI | $10 | **$8.00** |
| 20 | `/x402/classify` | POST | AI | $20 | **$16.00** |
| 21 | `/x402/outline` | POST | AI | $20 | **$16.00** |

Every paid response body includes the common fields `"success": true, "network": "base", "asset": "USDC"`
(except `/payment` and `/quote`, which use nested `payment{}` / `quote{}` objects — reproduced exactly).

### 2.1 Request / response contracts (from their OpenAPI 3.1 spec)

| Route | Request body | 200 response (fields + examples) |
|---|---|---|
| `GET /ping` | — | `{success:true, message:"pong", network:"base", asset:"USDC", service:"X Pay"}` |
| `GET /status` | — | `{success:true, service:"X Pay", status:"operational", payments:{network:"base", asset:"USDC", protocol:"x402"}}` |
| `GET /time` | — | `{success:true, utc:"2026-09-11T12:00:00.000Z", unix:1757592000, network, asset}` |
| `GET /uuid` | — | `{success:true, uuid:"550e8400-e29b-41d4-a716-446655440000", network, asset}` |
| `GET /random` | — | `{success:true, integer:123456789, hex:"a1b2c3…", bytes:16, network, asset}` |
| `GET /ip` | — | `{success:true, ip:"203.0.113.10", network, asset}` |
| `GET /network` | — | `{success:true, network:"eip155:8453", chainId:8453, asset:"USDC", usdc:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", protocol:"x402", service:"X Pay"}` |
| `POST /echo` | `{message: string}` req | `{success:true, echo:"hello", network, asset}` |
| `POST /hash` | `{text: string}` | `{success:true, algorithm:"sha256", hash:"…", network, asset}` |
| `POST /keccak` | `{text: string}` | `{success:true, algorithm:"keccak256", hash:"…", network, asset}` |
| `POST /base64` | `{text, action?: "encode"\|"decode" (default encode)}` | `{success:true, action:"encode", result:"aGVsbG8=", network, asset}` |
| `POST /slug` | `{text: string}` | `{success:true, slug:"hello-world", network, asset}` |
| `POST /wordcount` | `{text: string}` | `{success:true, words:2, characters:11, charactersNoSpaces:10, lines:1, network, asset}` |
| `GET /payment` | — | `{success:true, service:"X Pay", payment:{requestId, amount:"0.005", asset:"USDC", network:"base", payer, receiver, transactionHash}}` |
| `GET /quote` | — | `{success:true, service:"X Pay", quote:{amount:"0.005", asset:"USDC", network:"base", payTo, protocol:"x402", requestId}}` |
| `POST /summarize` | `{text}` | `{success:true, summary:"…", network, asset}` |
| `POST /rewrite` | `{text}` | `{success:true, rewritten:"…", network, asset}` |
| `POST /sentiment` | `{text}` | `{success:true, label:"positive", score:0.8, network, asset}` |
| `POST /keywords` | `{text}` | `{success:true, keywords:["payments","base","usdc"], network, asset}` |
| `POST /classify` | `{text}` | `{success:true, category:"finance", confidence:0.33, network, asset}` |
| `POST /outline` | `{text}` | `{success:true, outline:["First point","Second point"], network, asset}` |

Notes:
- `service` string becomes **"AI Utilities"** in responses (branding parity otherwise preserved).
- `/payment` fills `payer` / `receiver` / `transactionHash` / `requestId` from the **settlement data**
  captured by the after-settle hook (xpay does the same — it is the receipt for the payment that just
  unlocked this very response).
- `/quote` fills `payTo` from `PAYTO_EVM` and `amount` from the route's live price.
- Error shapes: unpaid → the 402 body above; invalid body → `400 {"error": …}`; unknown route → `404 {"error":"Not found"}`.

### 2.2 `/x402` resource manifest format (exact)
```json
{
  "service": "X Pay",
  "protocol": "x402",
  "network": "base",
  "asset": "USDC",
  "resources": [
    { "method":"GET", "path":"/x402/ping", "price":"0.005 USDC",
      "description":"Health check ping", "tag":"Utility",
      "tags":["health","ping","monitoring","uptime","latency"] },
    …
  ],
  "tags": ["x402","payment","usdc","base","api"]
}
```
We generate this from the same central route table (`service: "AI Utilities"`, prices = our defaults,
`iconUrl`/`logo` → our `logo.png`). Note `price` is a **display string** ("0.004 USDC"), independent of
the atomic `amount` in 402 bodies.

### 2.3 Bazaar discovery extension
Each route declares `declareDiscoveryExtension` input/output schemas (GET → `type:"http"`,
POST → JSON input schema + output example) exactly like `compute/src/x402.ts`, so Agentic Market /
Bazaar can index AIUtilities the same way it indexed X Pay.

---

## 3. Architecture — mirror `compute/` (the house pattern)

```
AIUtilities/
├── src/
│   ├── server.ts        buildApp(config): express, trust proxy, static client, free router,
│   │                    per-route paid chain (sizeGuard → payerLimiter → idemFastPath → paywall → handler),
│   │                    404 + error middleware, isMain boot, SIGTERM/SIGINT graceful shutdown
│   ├── routes.ts        buildFreeRouter( GET /  /health  /info  /llms.txt  /robots.txt  /sitemap.xml
│   │                                      /openapi.json  /x402 )  +  paid handlers for all 21 routes
│   ├── registry.ts      ★ single source of truth: 21-entry route table (id, method, path, tag, tags[],
│   │                    description, defaultPriceUsdc, inputSchema, outputExample) — feeds x402.ts,
│   │                    routes.ts, the /x402 manifest, /openapi.json, /info and the client pricing table
│   ├── x402.ts          buildPaymentMiddleware(): paymentMiddleware routes, acceptsFor(price),
│   │                    declareDiscoveryExtension, settlement hooks (settlement_confirmed/failed,
│   │                    redactAddress), CDP probe — ported from compute/src/x402.ts
│   ├── ai.ts            upstream LLM client for the 6 AI routes (OpenAI-compatible; env-configurable)
│   ├── config.ts        loadConfig(): fail-loud validation, PAYTO_EVM, NETWORK, FACILITATOR_URL,
│   │                    CDP keys, PRICE_<ROUTE>_USDC (21 vars, defaults = 80% table), limits, PORT
│   ├── logger.ts        structured JSON logger + redactAddress (identical to compute/search)
│   └── lib/             buckets.ts ratelimit.ts idempotency.ts   (copied from compute)
├── client/              Vite + React 18 SPA — same design system (styles.css copied byte-identical
│                        from compute/client), sections: hero → stats → #pricing → #endpoints →
│                        #how → #faq → footer; ENDPOINTS[] + DEFAULT_PRICES generated from registry
├── test/                vitest hermetic suite (stubbed facilitator + stubbed LLM upstream)
├── public/              logo.png, favicon.ico (AIUtilities-branded, same sizes as xpay)
├── Dockerfile           multi-stage node:22-slim, builds API + client, EXPOSE 8788, HEALTHCHECK /health
├── .dockerignore .gitignore .env.example
├── package.json         @x402/express @x402/core @x402/evm @x402/extensions @coinbase/x402 (match
│                        compute's versions), express 4, dotenv, zod; scripts: dev/build/start/test
├── tsconfig.json        same as compute (ESM, Node20 target, test/ excluded)
└── README.md PLAN.md    (this file)
```

**Port:** `8788` (compute=8787, search=3000, scrapper=8080 → next free). Railway injects `PORT` anyway.

**Utility route implementations** (`/ping /status /time /uuid /random /ip /network /echo /hash /keccak
/base64 /slug /wordcount`) are pure Node — `crypto.randomUUID()`, `crypto.randomBytes()`,
`createHash("sha256")`, `keccak` via `js-sha3` (or `@noble/hashes/sha3`), `Buffer` base64, slugify via a
small deterministic normalizer (lowercase, NFKD, strip diacritics, non-alnum → `-`, collapse dashes).
No upstream cost — 100% margin routes.

**AI routes** (`/summarize /rewrite /sentiment /keywords /classify /outline`): single OpenAI-compatible
upstream (chat completions) with per-route system prompts, JSON-mode output parsing, and defensive
fallbacks (e.g. sentiment → `label` + numeric `score`, classify → `category` + `confidence`).
Upstream cost recorded per request via `UPSTREAM_COST_*` env (house margin-logging pattern). Their
$8–16 prices are simply the market rate for agentic AI calls; our upstream cost is cents.

**Payment-receipt routes** (`/payment /quote`): served from settlement context captured in the
after-settle hook (mirrors how xpay returns the receipt of the payment that unlocked the response).

---

## 4. `.env` structure (same shape as the siblings)

`PAYTO_EVM, NETWORK, FACILITATOR_URL, CDP_API_KEY_ID, CDP_API_KEY_SECRET, PORT` identical to
`compute/.env.example`, plus per-route price vars (default = 80% of xpay):

```dotenv
# ---- payments (same as compute/search/scrapper) ----
PAYTO_EVM=0x...                       # our USDC receiving address on Base
PAYTO_SOL=                            # omitted — AIUtilities is Base-only, like compute/xpay
NETWORK=base-sepolia                  # base-sepolia (test) | base (mainnet, requires CDP keys)
FACILITATOR_URL=https://x402.org/facilitator
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=

# ---- prices (USDC per call; defaults = 80% of api-xpay.com) ----
PRICE_PING_USDC=0.004
PRICE_STATUS_USDC=0.004
PRICE_TIME_USDC=0.004
PRICE_UUID_USDC=0.004
PRICE_RANDOM_USDC=0.004
PRICE_IP_USDC=0.004
PRICE_NETWORK_USDC=0.004
PRICE_ECHO_USDC=0.004
PRICE_HASH_USDC=0.004
PRICE_KECCAK_USDC=0.004
PRICE_BASE64_USDC=0.004
PRICE_SLUG_USDC=0.004
PRICE_WORDCOUNT_USDC=0.004
PRICE_PAYMENT_USDC=0.004
PRICE_QUOTE_USDC=0.004
PRICE_SUMMARIZE_USDC=0.008
PRICE_REWRITE_USDC=8
PRICE_SENTIMENT_USDC=8
PRICE_KEYWORDS_USDC=8
PRICE_CLASSIFY_USDC=16
PRICE_OUTLINE_USDC=16

# ---- upstream (AI routes) ----
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
UPSTREAM_COST_SUMMARIZE_USD=0.0004
UPSTREAM_COST_REWRITE_USD=0.0006
UPSTREAM_COST_SENTIMENT_USD=0.0003
UPSTREAM_COST_KEYWORDS_USD=0.0004
UPSTREAM_COST_CLASSIFY_USD=0.0004
UPSTREAM_COST_OUTLINE_USD=0.0008

# ---- limits / ops (house defaults) ----
MAX_TEXT_CHARS=20000
FREE_RATE_LIMIT_PER_MIN=60
PAYER_RATE_LIMIT_PER_MIN=120
LOG_LEVEL=info
PORT=8788
```

Boot validation: mainnet (`NETWORK=base`) without CDP keys → refuse to start (house rule).

---

## 5. Railway deployment

- **Own git repo** `AIUtilities/` (done: `git init -b main`), pushed to GitHub under `0x-sami`
  (suggested name: `combify-aiutilities`), then connected to a new Railway service — same as the other four.
- **Root `Dockerfile`** auto-detected by Railway (no railway.json anywhere in the family):
  stage 1 `node:22-slim` → `npm ci` + `tsc` for API, `npm run build --prefix client`, prune devDeps;
  stage 2 `USER node`, `EXPOSE 8788`, `ENV PORT=8788`, `HEALTHCHECK CMD curl -f http://localhost:8788/health`,
  `CMD ["node","dist/server.js"]`.
- Railway env vars mirror `.env.example` (only secrets + `PAYTO_EVM` + `NETWORK=base` in prod).
- Target hostname (house convention): `aiutilities.combify.app` (or `util.combify.app`).
- CDP keys required for mainnet settlement facilitator (same CDP account used by compute/search/scrapper).

---

## 6. Design & cross-app integration

- **Client**: copy `compute/client` → adapt copy/branding to "AI Utilities"; reuse the shared design
  system (`styles.css` byte-identical: lime `#c6f135`, Inter/Outfit/JetBrains Mono, dark theme,
  `BinStrip`, `Reveal`, `CliPill`, `FaqItem`, `badge-paid/free`, `price-tag`, `hiw-flow`).
  Section order: hero → stats → `#pricing` (21-row table grouped by tag: Utility / Data / Tools /
  Crypto / Payment / AI, each with `price-tag` + free-rows for `/health / /openapi.json /x402`) →
  `#endpoints` (cards with copy-paste curl) → `#how` → `#faq` → footer
  (`© 2026 Combify · priced in USDC, settled on Base`).
  Prices hardcoded in `DEFAULT_PRICES` then refreshed live from `GET /` (`Accept: application/json`)
  and/or `/x402` — same live-refresh pattern as compute/search.
- **Content negotiation** for `GET /`: browser → our SPA (house design, NOT xpay's bare HTML);
  `Accept: application/json` → the same JSON descriptor shape xpay returns.
- **Add to lander**: `APPS` array in `lander/src/App.tsx` (~line 516) + a line in `lander/public/llms.txt`.
- **README**: same structure as `compute/README.md` (what it is, endpoint table, pricing, env, run,
  deploy). Add `docs/PRICING.md` (xpay-vs-us table) for transparency.

### Deviations (deliberate, additive)
1. **Prices 20% lower** everywhere (user requirement) — including `/summarize` at $0.008.
2. Branding: "AI Utilities" / `service:"aiutilities-api"` in `/health`.
3. Added Combify house free routes `/info` + `/llms.txt` (agents expect them; xpay lacks them).
4. `/sitemap.xml` + `/robots.txt` kept for parity, pointing at our host.
5. Their AI upstream is OpenAI-tagged; ours is env-configurable (OpenAI-compatible endpoint) — same
   response contracts, swappable provider.
6. Agentic Market shows 14 endpoints/$0.005–$20 because it indexed an older snapshot; we replicate the
   **live 21-route** surface. When we publish to Bazaar, ours will show the full 21.

---

## 7. Test plan (vitest, hermetic — same style as `compute/test/api.test.ts`)

- Free routes: `/health`, `/` HTML vs JSON negotiation, `/x402` manifest shape (21 resources, prices
  = 80% defaults), `/openapi.json` validity (21 paths), `/robots.txt`.
- 402 gate: every paid route without signature → 402, correct atomic `amount` (e.g. ping = "4000",
  classify = "16000000"), `payTo`/`asset`/`network` fields, bazaar extension present.
- Each utility route (with stubbed facilitator): exact response field names/types as §2.1.
- `/base64` both actions + invalid action; `/wordcount` multiline; `/slug` unicode/diacritics;
  `/keccak` known vector (`"hello"` → `1c8aff950685c2ed4bcf151b926d1a2d5a1a2a1a…` verified against lib).
- `/payment` + `/quote`: receipt/quote reflect settlement context and current price.
- AI routes with stubbed upstream: happy path per route, malformed upstream JSON → 502 mapping,
  oversized text → 413.
- Idempotency replay, rate-limit headers, 404 shape, request-id header.

---

## 8. Build order (milestones)

1. **Scaffold** — dir layout, package.json, tsconfig, Dockerfile, .env.example, git repo *(dir+git done)*.
2. **Core** — `registry.ts` (21 routes), `config.ts`, `logger.ts`, `lib/*`.
3. **x402 layer** — port `x402.ts` from compute; accepts + discovery extension per route; settlement hooks.
4. **Handlers** — 13 utility + 2 payment-context + 6 AI routes; `ai.ts` upstream.
5. **Free surface** — `/` negotiation, `/health`, `/x402`, `/openapi.json` (generated from registry),
   `/info`, `/llms.txt`, `/robots.txt`, `/sitemap.xml`.
6. **Client** — copy compute/client, rebrand, 21-row pricing table with 80% prices, endpoint cards,
   playground-lite (curl examples), FAQ.
7. **Tests** — §7 suite green.
8. **Docs & integration** — README, PRICING.md, lander APPS entry + llms.txt line.
9. **Deploy** — push repo, Railway service, mainnet env, smoke-test a paid call on Base,
   publish/verify on Agentic Market (Bazaar discovery).

---

## 9. Open items / decisions needed from Sami
- [ ] `PAYTO_EVM` for AIUtilities (reuse compute's merchant wallet or a fresh address?)
- [ ] GitHub repo name (`combify-aiutilities`?) and Railway service name
- [ ] Hostname: `aiutilities.combify.app` vs `util.combify.app`
- [ ] AI upstream: OpenAI key directly, or Cloudflare Workers AI (compute's provider) for consistency?
