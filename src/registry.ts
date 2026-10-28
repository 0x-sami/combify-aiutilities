/**
 * Single source of truth for the 21 paid routes. Mirrors api-xpay.com's
 * live surface (their /x402 manifest + OpenAPI spec, probed 2026-10-27):
 * same paths, methods, request/response contracts, tags, and descriptions.
 * The only intentional difference: default prices are 80% of theirs.
 *
 * Everything derives from this table: the x402 paywall config, the HTTP
 * handlers (by id), the free /x402 manifest, the generated /openapi.json,
 * /info, /llms.txt, and the client's pricing table.
 */

export type RouteTag = "Utility" | "Data" | "Tools" | "Crypto" | "Payment" | "AI";

export interface RouteDef {
  /** Stable id, also the env price key suffix and the client chip key. */
  id: string;
  method: "GET" | "POST";
  path: string;
  tag: RouteTag;
  /** Discovery keywords (same arrays xpay advertises per resource). */
  tags: string[];
  title: string;
  description: string;
  /** Env var that overrides the price, e.g. PRICE_PING_USDC. */
  envVar: string;
  /** Default USDC price — 80% of api-xpay.com (see PLAN.md §2). */
  defaultPriceUsdc: string;
  /** Example request body for POST routes (discovery + OpenAPI + client). */
  input?: Record<string, unknown>;
  /** JSON-schema fragment for the POST body (discovery + OpenAPI). */
  inputSchema?: { properties: Record<string, unknown>; required?: string[] };
  /** Full example 200 response body (discovery output + OpenAPI). */
  outputExample: Record<string, unknown>;
}

const NET = "base";
const ASSET = "USDC";
const SERVICE = "AI Utilities";
const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYTO_EXAMPLE = "0x589a2314a2E05F45e40C4823Da3Ba58D421dB3d8";

/** Shared tail of most responses (matches xpay field-for-field). */
const tail = () => ({ network: NET, asset: ASSET });

export const SERVICE_NAME = SERVICE;
export const SERVICE_TAGLINE =
  "Pay-per-request utility APIs powered by x402 using USDC on Base.";
export const SERVICE_TAGS = ["x402", "payment", "usdc", "base", "api"];

const textBody = (required: string[] = ["text"]) => ({
  properties: {
    text: { type: "string", description: "Input text" },
  },
  required,
});

export const ROUTES: readonly RouteDef[] = [
  // ---- Utility ----
  {
    id: "ping",
    method: "GET",
    path: "/x402/ping",
    tag: "Utility",
    tags: ["health", "ping", "monitoring", "uptime", "latency"],
    title: "Ping",
    description: "Health check ping",
    envVar: "PRICE_PING_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: { success: true, message: "pong", ...tail(), service: SERVICE },
  },
  {
    id: "status",
    method: "GET",
    path: "/x402/status",
    tag: "Utility",
    tags: ["status", "health", "ops", "availability", "service"],
    title: "Status",
    description: "Service status and payment configuration",
    envVar: "PRICE_STATUS_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: {
      success: true,
      service: SERVICE,
      status: "operational",
      payments: { network: NET, asset: ASSET, protocol: "x402" },
    },
  },
  // ---- Data ----
  {
    id: "time",
    method: "GET",
    path: "/x402/time",
    tag: "Data",
    tags: ["time", "datetime", "utc", "clock", "timestamp"],
    title: "Server Time",
    description: "Current server time in UTC",
    envVar: "PRICE_TIME_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: { success: true, utc: "2026-09-11T12:00:00.000Z", unix: 1757592000, ...tail() },
  },
  // ---- Tools ----
  {
    id: "uuid",
    method: "GET",
    path: "/x402/uuid",
    tag: "Tools",
    tags: ["uuid", "id", "generator", "unique", "identifier"],
    title: "UUID Generator",
    description: "Generate a random UUID v4",
    envVar: "PRICE_UUID_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: { success: true, uuid: "550e8400-e29b-41d4-a716-446655440000", ...tail() },
  },
  {
    id: "random",
    method: "GET",
    path: "/x402/random",
    tag: "Tools",
    tags: ["random", "bytes", "entropy", "hex", "generator"],
    title: "Random Bytes",
    description: "Generate a random integer and hex bytes",
    envVar: "PRICE_RANDOM_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: {
      success: true,
      integer: 123456789,
      hex: "a1b2c3d4e5f6789012345678abcdef01",
      bytes: 16,
      ...tail(),
    },
  },
  // ---- Data ----
  {
    id: "ip",
    method: "GET",
    path: "/x402/ip",
    tag: "Data",
    tags: ["ip", "client", "geo", "address", "network"],
    title: "Client IP",
    description: "Return the requester IP address",
    envVar: "PRICE_IP_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: { success: true, ip: "203.0.113.10", ...tail() },
  },
  // ---- Crypto ----
  {
    id: "network",
    method: "GET",
    path: "/x402/network",
    tag: "Crypto",
    tags: ["base", "usdc", "chain", "eip155", "x402"],
    title: "Network Info",
    description: "Base network and USDC payment metadata",
    envVar: "PRICE_NETWORK_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: {
      success: true,
      network: "eip155:8453",
      chainId: 8453,
      asset: ASSET,
      usdc: USDC_MAINNET,
      protocol: "x402",
      service: SERVICE,
    },
  },
  // ---- Tools ----
  {
    id: "echo",
    method: "POST",
    path: "/x402/echo",
    tag: "Tools",
    tags: ["echo", "json", "debug", "mirror", "message"],
    title: "Echo",
    description: "Echo a JSON message back",
    envVar: "PRICE_ECHO_USDC",
    defaultPriceUsdc: "0.004",
    input: { message: "hello" },
    inputSchema: {
      properties: { message: { type: "string", description: "Message to echo back" } },
      required: ["message"],
    },
    outputExample: { success: true, echo: "hello", ...tail() },
  },
  // ---- Crypto ----
  {
    id: "hash",
    method: "POST",
    path: "/x402/hash",
    tag: "Crypto",
    tags: ["hash", "sha256", "digest", "checksum", "crypto"],
    title: "SHA-256 Hash",
    description: "Compute a SHA-256 hash of text",
    envVar: "PRICE_HASH_USDC",
    defaultPriceUsdc: "0.004",
    input: { text: "hello" },
    inputSchema: textBody(),
    outputExample: {
      success: true,
      algorithm: "sha256",
      hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      ...tail(),
    },
  },
  {
    id: "keccak",
    method: "POST",
    path: "/x402/keccak",
    tag: "Crypto",
    tags: ["keccak", "ethereum", "web3", "hash", "evm"],
    title: "Keccak-256 Hash",
    description: "Compute a Keccak-256 hash of text",
    envVar: "PRICE_KECCAK_USDC",
    defaultPriceUsdc: "0.004",
    input: { text: "hello" },
    inputSchema: textBody(),
    outputExample: {
      success: true,
      algorithm: "keccak256",
      // Verified vector: keccak256("hello").
      hash: "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
      ...tail(),
    },
  },
  // ---- Tools ----
  {
    id: "base64",
    method: "POST",
    path: "/x402/base64",
    tag: "Tools",
    tags: ["base64", "encode", "decode", "codec", "binary"],
    title: "Base64 Codec",
    description: "Encode or decode Base64 text",
    envVar: "PRICE_BASE64_USDC",
    defaultPriceUsdc: "0.004",
    input: { text: "hello", action: "encode" },
    inputSchema: {
      properties: {
        text: { type: "string", description: "Text to encode or decode" },
        action: { type: "string", enum: ["encode", "decode"], description: "Default: encode" },
      },
      required: ["text"],
    },
    outputExample: { success: true, action: "encode", result: "aGVsbG8=", ...tail() },
  },
  {
    id: "slug",
    method: "POST",
    path: "/x402/slug",
    tag: "Tools",
    tags: ["slug", "url", "seo", "normalize", "text"],
    title: "Slugify",
    description: "Convert text into a URL-safe slug",
    envVar: "PRICE_SLUG_USDC",
    defaultPriceUsdc: "0.004",
    input: { text: "Hello World" },
    inputSchema: textBody(),
    outputExample: { success: true, slug: "hello-world", ...tail() },
  },
  // ---- Data ----
  {
    id: "wordcount",
    method: "POST",
    path: "/x402/wordcount",
    tag: "Data",
    tags: ["wordcount", "analytics", "text", "tokens", "metrics"],
    title: "Word Count",
    description: "Count words, characters, and lines in text",
    envVar: "PRICE_WORDCOUNT_USDC",
    defaultPriceUsdc: "0.004",
    input: { text: "Hello World" },
    inputSchema: textBody(),
    outputExample: {
      success: true,
      words: 2,
      characters: 11,
      charactersNoSpaces: 10,
      lines: 1,
      ...tail(),
    },
  },
  // ---- Payment ----
  {
    id: "payment",
    method: "GET",
    path: "/x402/payment",
    tag: "Payment",
    tags: ["payment", "receipt", "usdc", "transaction", "settlement"],
    title: "Payment Receipt",
    description: "Payment receipt with transaction details",
    envVar: "PRICE_PAYMENT_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: {
      success: true,
      service: SERVICE,
      payment: {
        requestId: "req_abc123",
        amount: "0.004",
        asset: ASSET,
        network: NET,
        payer: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        receiver: PAYTO_EXAMPLE,
        transactionHash:
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      },
    },
  },
  {
    id: "quote",
    method: "GET",
    path: "/x402/quote",
    tag: "Payment",
    tags: ["payment", "quote", "pricing", "merchant", "invoice"],
    title: "Payment Quote",
    description: "Payment quote with amount, asset, and merchant wallet",
    envVar: "PRICE_QUOTE_USDC",
    defaultPriceUsdc: "0.004",
    outputExample: {
      success: true,
      service: SERVICE,
      quote: {
        amount: "0.004",
        asset: ASSET,
        network: NET,
        payTo: PAYTO_EXAMPLE,
        protocol: "x402",
        requestId: "req_abc123",
      },
    },
  },
  // ---- AI ----
  {
    id: "summarize",
    method: "POST",
    path: "/x402/summarize",
    tag: "AI",
    tags: ["ai", "summary", "llm", "nlp", "openai"],
    title: "AI Summarize",
    description: "AI text summarization",
    envVar: "PRICE_SUMMARIZE_USDC",
    defaultPriceUsdc: "0.008",
    input: { text: "Text that should be summarized." },
    inputSchema: textBody(),
    outputExample: {
      success: true,
      summary: "A short summary of the input text.",
      ...tail(),
    },
  },
  {
    id: "rewrite",
    method: "POST",
    path: "/x402/rewrite",
    tag: "AI",
    tags: ["ai", "rewrite", "paraphrase", "llm", "nlp"],
    title: "AI Rewrite",
    description: "AI rewrite of input text",
    envVar: "PRICE_REWRITE_USDC",
    defaultPriceUsdc: "8",
    input: { text: "Make this text sound better." },
    inputSchema: textBody(),
    outputExample: { success: true, rewritten: "Make this text sound better.", ...tail() },
  },
  {
    id: "sentiment",
    method: "POST",
    path: "/x402/sentiment",
    tag: "AI",
    tags: ["ai", "sentiment", "nlp", "classify", "llm"],
    title: "AI Sentiment",
    description: "AI sentiment analysis of text",
    envVar: "PRICE_SENTIMENT_USDC",
    defaultPriceUsdc: "8",
    input: { text: "This product is great." },
    inputSchema: textBody(),
    outputExample: { success: true, label: "positive", score: 0.8, ...tail() },
  },
  {
    id: "keywords",
    method: "POST",
    path: "/x402/keywords",
    tag: "AI",
    tags: ["ai", "keywords", "extract", "nlp", "llm"],
    title: "AI Keywords",
    description: "AI keyword extraction from text",
    envVar: "PRICE_KEYWORDS_USDC",
    defaultPriceUsdc: "8",
    input: { text: "AI payments on Base with USDC." },
    inputSchema: textBody(),
    outputExample: { success: true, keywords: ["payments", "base", "usdc"], ...tail() },
  },
  {
    id: "classify",
    method: "POST",
    path: "/x402/classify",
    tag: "AI",
    tags: ["ai", "classify", "topics", "nlp", "llm"],
    title: "AI Classify",
    description: "AI topic classification of text",
    envVar: "PRICE_CLASSIFY_USDC",
    defaultPriceUsdc: "16",
    input: { text: "Pay the invoice with USDC." },
    inputSchema: textBody(),
    outputExample: { success: true, category: "finance", confidence: 0.33, ...tail() },
  },
  {
    id: "outline",
    method: "POST",
    path: "/x402/outline",
    tag: "AI",
    tags: ["ai", "outline", "summary", "nlp", "llm"],
    title: "AI Outline",
    description: "AI outline generated from text",
    envVar: "PRICE_OUTLINE_USDC",
    defaultPriceUsdc: "16",
    input: { text: "First point. Second point." },
    inputSchema: textBody(),
    outputExample: { success: true, outline: ["First point", "Second point"], ...tail() },
  },
];

export const ROUTE_BY_ID: Readonly<Record<string, RouteDef>> = Object.freeze(
  Object.fromEntries(ROUTES.map((r) => [r.id, r])),
);

export const PAID_ROUTES: readonly RouteDef[] = ROUTES;

export const FREE_PATHS = [
  "GET /",
  "GET /health",
  "GET /info",
  "GET /llms.txt",
  "GET /x402",
  "GET /openapi.json",
  "GET /robots.txt",
  "GET /sitemap.xml",
] as const;
