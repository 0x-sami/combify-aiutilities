/**
 * OpenAI-compatible chat-completions client for the 6 `/x402/{summarize,
 * rewrite, sentiment, keywords, classify, outline}` routes. Any
 * OpenAI-compatible endpoint works (OpenAI itself, OpenRouter, a local
 * vLLM/Ollama server, ...) via OPENAI_BASE_URL + OPENAI_API_KEY.
 *
 * Fail-closed: with no key configured the routes answer 502
 * `ai_not_configured` (the payment is never taken — the paywall's
 * after-settle hook only stores settled responses, and the paywall
 * returns 402 before running the handler if settlement would not be
 * possible; the handler itself also errors before mutating anything).
 */

import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";

export interface AiConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/** Thrown for every upstream/validation failure; mapped to 502/400 in routes. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

const MAX_TEXT_CHARS_DEFAULT = 20_000;

function requireText(text: unknown, maxChars = MAX_TEXT_CHARS_DEFAULT): string {
  if (typeof text !== "string" || text.trim() === "") {
    throw new AiError("text is required and must be a non-empty string", 400, "invalid_request");
  }
  if (text.length > maxChars) {
    throw new AiError(`text over ${maxChars} characters`, 400, "text_too_long");
  }
  return text;
}

/**
 * Single chat-completions call, temperature 0 for deterministic utility
 * output, `response_format: json_object` when we ask for JSON so the
 * parsers below can rely on valid JSON (OpenAI-compatible servers that
 * ignore the flag still get parsed leniently — see parseJson).
 */
async function chat(
  cfg: AiConfig,
  system: string,
  user: string,
  opts: { json?: boolean; maxTokens?: number } = {},
): Promise<string> {
  if (!cfg.apiKey) {
    throw new AiError("AI provider is not configured (set OPENAI_API_KEY)", 502, "ai_not_configured");
  }
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 512,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      logger.warn("ai upstream error", { status: res.status, model: cfg.model, body });
      throw new AiError(`AI provider returned ${res.status}`, 502, "ai_upstream_error");
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content === "") {
      throw new AiError("AI provider returned an empty completion", 502, "ai_upstream_error");
    }
    return content.trim();
  } catch (err) {
    if (err instanceof AiError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new AiError(`AI provider timed out after ${cfg.timeoutMs}ms`, 502, "ai_timeout");
    }
    logger.warn("ai fetch failed", { error: (err as Error).message });
    throw new AiError("AI provider request failed", 502, "ai_upstream_error");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lenient JSON extraction: the model may return a bare object, a fenced
 * ```json block, or prose around the object. Pull the outermost `{...}`
 * and parse; any failure becomes a 502 (the payment was legitimate, so we
 * never answer 400 for provider misbehaviour).
 */
function parseJson(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("not an object");
  } catch {
    throw new AiError("AI provider returned unparseable JSON", 502, "ai_bad_response");
  }
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function clampScore(n: number): number {
  return Math.max(-1, Math.min(1, Math.round(n * 100) / 100));
}

// ---------------------------------------------------------------- routes

export async function summarizeText(cfg: AiConfig, text: unknown): Promise<{ summary: string }> {
  const input = requireText(text);
  const out = await chat(
    cfg,
    "You are a precise summarizer. Reply with JSON only, of the form {\"summary\": string}. Summarize the user's text in one or two sentences. Never invent facts.",
    input,
    { json: true, maxTokens: 300 },
  );
  return { summary: asString(parseJson(out).summary, out.replace(/^["']|["']$/g, "")) };
}

export async function rewriteText(cfg: AiConfig, text: unknown): Promise<{ rewritten: string }> {
  const input = requireText(text);
  const out = await chat(
    cfg,
    "You are an expert editor. Rewrite the user's text to be clearer and more polished while preserving its meaning and language. Reply with the rewritten text only — no preamble, no quotes, no markdown fences.",
    input,
    { maxTokens: 2_000 },
  );
  return { rewritten: out.replace(/^["']|["']$/g, "") };
}

export async function analyzeSentiment(
  cfg: AiConfig,
  text: unknown,
): Promise<{ label: string; score: number }> {
  const input = requireText(text);
  const out = await chat(
    cfg,
    'Analyze the sentiment of the user\'s text. Reply with JSON only: {"label": "positive" | "neutral" | "negative", "score": number between -1 (most negative) and 1 (most positive)}.',
    input,
    { json: true, maxTokens: 100 },
  );
  const parsed = parseJson(out);
  const rawScore = Number(parsed.score);
  const score = Number.isFinite(rawScore) ? clampScore(rawScore) : 0;
  const label = asString(parsed.label, score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral");
  return { label, score };
}

export async function extractKeywords(
  cfg: AiConfig,
  text: unknown,
): Promise<{ keywords: string[] }> {
  const input = requireText(text);
  const out = await chat(
    cfg,
    'Extract the most relevant keywords from the user\'s text. Reply with JSON only: {"keywords": string[]}, 3 to 8 lowercase keywords, most important first, no duplicates, no stop words.',
    input,
    { json: true, maxTokens: 200 },
  );
  const raw = parseJson(out).keywords;
  const keywords = Array.isArray(raw)
    ? raw.filter((k): k is string => typeof k === "string" && k.trim() !== "").map((k) => k.trim())
    : [];
  if (keywords.length === 0) throw new AiError("AI provider returned no keywords", 502, "ai_bad_response");
  return { keywords: keywords.slice(0, 12) };
}

export async function classifyText(
  cfg: AiConfig,
  text: unknown,
): Promise<{ category: string; confidence: number }> {
  const input = requireText(text);
  const out = await chat(
    cfg,
    'Classify the user\'s text into the single best-fitting topic category. Reply with JSON only: {"category": string (1-3 lowercase words), "confidence": number between 0 and 1}.',
    input,
    { json: true, maxTokens: 100 },
  );
  const parsed = parseJson(out);
  const rawConf = Number(parsed.confidence);
  const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, Math.round(rawConf * 100) / 100)) : 0.5;
  const category = asString(parsed.category, "general");
  return { category: category.toLowerCase().slice(0, 64), confidence };
}

export async function buildOutline(cfg: AiConfig, text: unknown): Promise<{ outline: string[] }> {
  const input = requireText(text);
  const out = await chat(
    cfg,
    'Turn the user\'s text into a concise outline. Reply with JSON only: {"outline": string[]}, where each item is a short heading or bullet (3 to 10 items), in logical order.',
    input,
    { json: true, maxTokens: 500 },
  );
  const raw = parseJson(out).outline;
  const outline = Array.isArray(raw)
    ? raw.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];
  if (outline.length === 0) throw new AiError("AI provider returned no outline", 502, "ai_bad_response");
  return { outline: outline.slice(0, 20) };
}

/** Local request id for /x402/payment receipts (same shape as xpay's). */
export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
