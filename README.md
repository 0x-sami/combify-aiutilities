# combify-aiutilities

Pay-per-request utility + AI API for AI agents. Twenty-one endpoints, no
accounts, no API keys for callers: agents pay per request in USDC on Base
via the x402 protocol (`402 Payment Required`). A faithful replica of
api-xpay.com's surface — same paths, request/response contracts, tags, and
descriptions — with default prices at **80% of theirs** (see
[docs/PRICING.md](docs/PRICING.md)).

- `GET /x402/ping` — health check ping.
- `GET /x402/status` — service status and payment configuration.
- `GET /x402/time` — current server time in UTC (ISO + unix).
- `GET /x402/uuid` — a random UUID v4.
- `GET /x402/random` — 16 random bytes as hex, plus a derived integer.
- `GET /x402/ip` — the requester's IP address.
- `GET /x402/network` — Base chain id, USDC contract, payment metadata.
- `POST /x402/echo` — echo a JSON message back.
- `POST /x402/hash` — SHA-256 digest of text.
- `POST /x402/keccak` — Keccak-256 digest of text (Ethereum-style).
- `POST /x402/base64` — encode or decode Base64 text.
- `POST /x402/slug` — convert text into a URL-safe slug.
- `POST /x402/wordcount` — count words, characters, and lines.
- `GET /x402/payment` — payment receipt for the call that unlocked it.
- `GET /x402/quote` — price, asset, and merchant wallet before you pay.
- `POST /x402/summarize` — AI text summarization.
- `POST /x402/rewrite` — AI rewrite / paraphrase.
- `POST /x402/sentiment` — AI sentiment analysis (label + score).
- `POST /x402/keywords` — AI keyword extraction.
- `POST /x402/classify` — AI topic classification (category + confidence).
- `POST /x402/outline` — AI outline generation.
- `GET /health`, `GET /`, `GET /info` — free, liveness plus descriptor and prices.
- `GET /x402` — free manifest of all 21 routes with prices.
- `GET /openapi.json` — free OpenAPI 3.1 spec (generated from the same registry).
- `GET /llms.txt` — free agent guide: every route, prices, retry rules.

Same stack and layout as `compute/`, `search/`, and `scrapper/`: Express +
TypeScript, official `@x402/*` paywall (verify before handler, settle after
success), fail-loud env validation, structured JSON logs, Railway Dockerfile.

**One table drives everything.** `src/registry.ts` declares all 21 routes
(paths, methods, prices, tags, input schemas, example outputs); the x402
paywall config, the HTTP handlers, the `/x402` manifest, `/openapi.json`,
`/info`, `/llms.txt`, and the client's pricing table all derive from it, so
they cannot drift apart.

## Pricing

Default prices are exactly 80% of api-xpay.com's, in USDC per call:

| Group | Routes | xpay | Ours (default) |
|---|---|---|---|
| Utility / Data / Tools / Crypto / Payment | `ping`, `status`, `time`, `uuid`, `random`, `ip`, `network`, `echo`, `hash`, `keccak`, `base64`, `slug`, `wordcount`, `payment`, `quote` | $0.005 | **$0.004** |
| AI summarize | `summarize` | $0.01 | **$0.008** |
| AI rewrite / sentiment / keywords | `rewrite`, `sentiment`, `keywords` | $10 | **$8** |
| AI classify / outline | `classify`, `outline` | $20 | **$16** |

Every price is overridable per route via env (`PRICE_<ID>_USDC`) with no
code change. Full rationale and margin math in [docs/PRICING.md](docs/PRICING.md).

## How payment works here

Default x402 `exact` flow (verified against the installed SDK source):

1. Unpaid request → `402` with a `PAYMENT-REQUIRED` header (price quote).
   Nothing runs: no handler work, no AI call, no facilitator verify/settle.
2. Agent pays and retries with a `PAYMENT-SIGNATURE` header.
3. Server verifies via the facilitator, then runs the handler.
4. Handler returns `< 400` → payment settles, result returns with a
   `PAYMENT-RESPONSE` header. Handler returns `>= 400` (bad input, AI
   provider failure) → settlement is cancelled, **nothing is charged**.

Quoting needs a single facilitator `GET /supported` fetch per isolate cold
start (the SDK must learn capabilities before it can price); it is cached
afterwards. Unpaid requests still never touch verify, settle, or the AI
provider.

Limits are enforced twice: a 256 KB body cap **before** the paywall (`413`,
no quote) plus semantic limits in the handler (`400`, no settle). Rate
limits: 60 req/min per IP on free routes, 120 on paid.

## The AI routes

The six AI routes (`summarize`, `rewrite`, `sentiment`, `keywords`,
`classify`, `outline`) call any OpenAI-compatible `chat/completions`
endpoint via `OPENAI_BASE_URL` + `OPENAI_API_KEY` + `OPENAI_MODEL`
(default `gpt-4o-mini`). Temperature 0, JSON-mode where applicable, and
lenient parsing (bare object, fenced block, or prose-wrapped JSON).

Fail-closed: with no key set the process still boots (with a warning), and
the AI routes answer `502 ai_not_configured` — the payment is never taken
because the handler errors before returning `< 400`.

## Safe retries (Idempotency-Key)

Every x402 `exact` payment is single-use: a retry signs a FRESH payment
(new nonce). If a client times out or drops after paying — slow testnet
confirmation, proxy hiccup — a naive retry pays a second time for the same
work. Avoid that with `Idempotency-Key`:

```bash
curl -X POST http://localhost:8788/x402/summarize \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: agent-42-attempt-1' \
  -d '{"text":"Long text to summarize."}'
```

Send a unique key per logical request and reuse it on every retry of that
request (same key + same body, for 10 minutes). The first settled 200 is
stored under that key; replays return it with **no new payment required**
and nothing re-settled. Different body under the same key is a different
request and goes through payment normally. Failures are never stored, so a
retry after a real failure re-executes. (Same contract as search/scrapper.)

## Local dev

```bash
npm install
cp .env.example .env   # fill PAYTO_EVM; set OPENAI_API_KEY to exercise the AI routes
npm test               # hermetic tests (stubbed facilitator + OpenAI, no spend)
npm run dev            # tsx watch, http://localhost:8788
npm run build --prefix client   # optional: build the UI served at GET /
```

Smoke test with no wallet and no AI spend:

```bash
curl http://localhost:8788/health
curl http://localhost:8788/x402            # free manifest of all 21 routes
curl -i http://localhost:8788/x402/ping    # unpaid quote (402 + price, nothing runs)
curl -i -X POST http://localhost:8788/x402/echo \
  -H 'Content-Type: application/json' -d '{"message":"hello"}'
```

A full paid success locally needs a funded testnet wallet — see below.

## Deploy (Railway)

```bash
# This folder is its own repo; Railway auto-detects the Dockerfile.
```

1. Create a project → **New Service → GitHub Repo** → select this repo.
2. **Variables tab** — copy every value from your local `.env`
   (never commit `.env`; Railway variables are the production store):
   `PAYTO_EVM`, `NETWORK`, `CDP_API_KEY_ID/SECRET`, `OPENAI_API_KEY`,
   `OPENAI_BASE_URL`, `OPENAI_MODEL`, `PRICE_*`, `PUBLIC_BASE_URL`.
   (`PORT` is assigned automatically by Railway — do not set it.)
3. Keep `NETWORK=base-sepolia` in Variables **until mainnet day**.
4. Deploy, then verify: `GET /health`, unpaid `GET /x402/ping` → `402`.

Use one Railway replica: rate limiting is in-process memory.

## Test with a testnet x402 client

1. Fund a throwaway Base Sepolia wallet: test USDC from
   `https://faucet.circle.com`, Sepolia ETH for gas from a Base faucet.
   Never use a mainnet key. The receiving `PAYTO_EVM` must be a DIFFERENT
   address you control — the facilitator rejects self-sends.
2. Unpaid probe (expect `402` + price, no spend). Decode the
   `PAYMENT-REQUIRED` header and check `payTo` is your address, not the
   null address:
   ```bash
   curl -i http://localhost:8788/x402/ping
   curl -i -X POST http://localhost:8788/x402/slug \
     -H 'Content-Type: application/json' -d '{"text":"Hello World"}'
   ```
   (Through an HTTPS tunnel, use that URL instead — x402 clients refuse
   to discover payment requirements over plain `http:`.)
3. Paid call (atomic USDC, 6 decimals — match `--max-amount` to the price):
   ```bash
   # $0.004 utility route:
   npx awal x402 pay http://localhost:8788/x402/ping --max-amount 4000
   # slug ($0.004):
   npx awal x402 pay http://localhost:8788/x402/slug \
     -X POST -d '{"text":"Hello World"}' --max-amount 4000
   # AI summarize ($0.008):
   npx awal x402 pay http://localhost:8788/x402/summarize \
     -X POST -d '{"text":"Long text to summarize."}' --max-amount 8000
   # AI classify ($16):
   npx awal x402 pay http://localhost:8788/x402/classify \
     -X POST -d '{"text":"Pay the invoice with USDC."}' --max-amount 16000000
   ```
   Amounts are atomic USDC (6 decimals): `$0.004` = `4000`, `$0.008` =
   `8000`, `$8` = `8000000`, `$16` = `16000000`.
   Expect `200` with the result plus a `PAYMENT-RESPONSE` header.
   If settlement fails, the server logs say exactly why — look for the
   `verify_result` / `settlement_failed` lines (run with the paid call's
   `request_id`, printed as `X-Request-Id`).

## Switch to mainnet

Set in Railway Variables (or `.env`):

```bash
NETWORK=base
CDP_API_KEY_ID=your-cdp-api-key-id-here          # https://portal.cdp.coinbase.com
CDP_API_KEY_SECRET=your-cdp-api-key-secret-here
OPENAI_API_KEY=your-openai-api-key-here
```

Restart (without CDP keys it refuses to boot — by design), then make one
small mainnet payment yourself to confirm receipt at your address.

On `base`, every paid call settles real USDC. No refunds in code.

## List on the Bazaar

All 21 paid routes declare discovery metadata (`declareDiscoveryExtension`
with input schema + output example, derived from the registry). Listing is
not instant: the facilitator catalogs a resource only after a **settled**
payment whose payload echoes the extension. After your first real paid call
per route, the resource appears in facilitator discovery.

## Layout

```
src/registry.ts     single source of truth: 21 routes, prices, schemas
src/config.ts       env loading + fail-loud validation, price map
src/x402.ts         paywall, settlement hooks, manifest, OpenAPI generator
src/routes.ts       free surface + all 21 handlers (derived from registry)
src/ai.ts           OpenAI-compatible chat-completions client
src/server.ts       boot, middleware chain, route registration
src/lib/            rate limiting, idempotency, request hashing
client/             Vite + React UI (same design system as the other apps)
test/api.test.ts    hermetic tests: stubbed facilitator + OpenAI
```
