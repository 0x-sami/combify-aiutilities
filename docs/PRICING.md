# Pricing

Every route has a flat price in USDC per call, charged on Base via x402.
Defaults are **80% of api-xpay.com's live prices** (probed 2026-10-27 from
their `/x402` manifest and `/openapi.json`); each is overridable via env
with no code change.

## The matrix

| Route | Category | xpay price | Our default (80%) | Env var | Atomic (6 dp) |
|---|---|---|---|---|---|
| `GET /x402/ping` | Utility | $0.005 | **$0.004** | `PRICE_PING_USDC` | `4000` |
| `GET /x402/status` | Utility | $0.005 | **$0.004** | `PRICE_STATUS_USDC` | `4000` |
| `GET /x402/time` | Data | $0.005 | **$0.004** | `PRICE_TIME_USDC` | `4000` |
| `GET /x402/uuid` | Tools | $0.005 | **$0.004** | `PRICE_UUID_USDC` | `4000` |
| `GET /x402/random` | Tools | $0.005 | **$0.004** | `PRICE_RANDOM_USDC` | `4000` |
| `GET /x402/ip` | Data | $0.005 | **$0.004** | `PRICE_IP_USDC` | `4000` |
| `GET /x402/network` | Crypto | $0.005 | **$0.004** | `PRICE_NETWORK_USDC` | `4000` |
| `POST /x402/echo` | Tools | $0.005 | **$0.004** | `PRICE_ECHO_USDC` | `4000` |
| `POST /x402/hash` | Crypto | $0.005 | **$0.004** | `PRICE_HASH_USDC` | `4000` |
| `POST /x402/keccak` | Crypto | $0.005 | **$0.004** | `PRICE_KECCAK_USDC` | `4000` |
| `POST /x402/base64` | Tools | $0.005 | **$0.004** | `PRICE_BASE64_USDC` | `4000` |
| `POST /x402/slug` | Tools | $0.005 | **$0.004** | `PRICE_SLUG_USDC` | `4000` |
| `POST /x402/wordcount` | Data | $0.005 | **$0.004** | `PRICE_WORDCOUNT_USDC` | `4000` |
| `GET /x402/payment` | Payment | $0.005 | **$0.004** | `PRICE_PAYMENT_USDC` | `4000` |
| `GET /x402/quote` | Payment | $0.005 | **$0.004** | `PRICE_QUOTE_USDC` | `4000` |
| `POST /x402/summarize` | AI | $0.01 | **$0.008** | `PRICE_SUMMARIZE_USDC` | `8000` |
| `POST /x402/rewrite` | AI | $10 | **$8** | `PRICE_REWRITE_USDC` | `8000000` |
| `POST /x402/sentiment` | AI | $10 | **$8** | `PRICE_SENTIMENT_USDC` | `8000000` |
| `POST /x402/keywords` | AI | $10 | **$8** | `PRICE_KEYWORDS_USDC` | `8000000` |
| `POST /x402/classify` | AI | $20 | **$16** | `PRICE_CLASSIFY_USDC` | `16000000` |
| `POST /x402/outline` | AI | $20 | **$16** | `PRICE_OUTLINE_USDC` | `16000000` |

"Atomic" is the 6-decimal USDC integer that appears in 402 bodies and
`x-payment-info.amount` (`$0.004` = `4000`, `$16` = `16000000`).

## Cost basis (the 15 non-AI routes)

`ping`, `status`, `time`, `uuid`, `random`, `ip`, `network`, `echo`,
`hash`, `keccak`, `base64`, `slug`, `wordcount`, `payment`, and `quote`
are pure computation: Node built-ins (`node:crypto` for SHA-256 and random
bytes, `@noble/hashes` for Keccak-256, `Buffer` for Base64) plus in-memory
work. Upstream cost is zero — the price covers liveness, rate limiting,
and the payment rail itself. At $0.004 these are impulse-priced for agent
loops that call them thousands of times a day.

## Cost basis (the 6 AI routes)

The AI routes bill an OpenAI-compatible provider at whatever
`OPENAI_BASE_URL`/`OPENAI_MODEL` you configure. With the default
`gpt-4o-mini` (verified OpenAI list pricing: $0.15 / 1M input tokens,
$0.60 / 1M output tokens) and the enforced 20,000-char input cap
(≈ 5,000 tokens worst case):

| Route | Worst-case input | Worst-case output | Upstream ceiling | Our price | Margin floor |
|---|---|---|---|---|---|
| `summarize` | 20k chars (~5k tokens) | 300 tokens | ~$0.00095 | **$0.008** | ~8x |
| `rewrite` | 20k chars (~5k tokens) | 2,000 tokens | ~$0.00195 | **$8** | ~4,000x |
| `sentiment` | 20k chars (~5k tokens) | 100 tokens | ~$0.00081 | **$8** | ~10,000x |
| `keywords` | 20k chars (~5k tokens) | 200 tokens | ~$0.00087 | **$8** | ~9,000x |
| `classify` | 20k chars (~5k tokens) | 100 tokens | ~$0.00081 | **$16** | ~20,000x |
| `outline` | 20k chars (~5k tokens) | 500 tokens | ~$0.00105 | **$16** | ~15,000x |

Typical calls are far smaller (a tweet, a paragraph), so real margins are
higher still. The AI-route prices deliberately mirror xpay's tiering
($0.01 / $10 / $20 → ours at 80%) rather than cost-plus: they sit where the
market for paid agent inference sits, and the spread funds the free
discovery surface plus the utility routes' near-zero marginal cost.

A different model changes the math proportionally — a $3/1M-output model
(`gpt-4o` class) raises the `summarize` ceiling to ~$0.002 and still clears
$0.008 with 4x. Re-check margins after any `OPENAI_MODEL` change.

## What's free

`GET /`, `/health`, `/info`, `/llms.txt`, `/x402`, `/openapi.json`,
`/robots.txt`, `/sitemap.xml` never require payment. The `/x402` manifest
and `/openapi.json` exist precisely so a price-check costs one free request
instead of a 402 round-trip.

## Changing a price

Set the env var and restart (Railway Variables or local `.env`):

```bash
PRICE_CLASSIFY_USDC=12
```

Validation is strict at boot: a price must be a positive decimal with at
most 6 decimals (`0.004`, `8`, `12.5` are valid; `free`, `-1`, and
`0.0000001` are refused with a loud startup error). The change shows up
everywhere at once — 402 quotes, the `/x402` manifest, `/openapi.json`
`x-payment-info`, `/llms.txt`, `/info`, and the client's price table —
because all of them read the same registry-driven price map.
