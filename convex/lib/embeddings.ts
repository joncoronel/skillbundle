/**
 * OpenAI embeddings wrapper.
 *
 * Uses text-embedding-3-small (1536 dimensions) — cheap and good enough for
 * skill/repo similarity. Read the docs at https://platform.openai.com/docs/guides/embeddings.
 *
 * Reads OPENAI_API_KEY from the Convex environment. Set via:
 *   npx convex env set OPENAI_API_KEY sk-...
 */

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

/**
 * Per-input character cap. Most SKILL.md files tokenize at 2-4 chars/token,
 * but pathological content (base64, dense unicode, walls of identifiers) can
 * exceed 1 token/char. 6000 chars covers the long tail safely; the rare skill
 * that still exceeds the per-input limit gets caught by `embedSkillsBatch`
 * and marked unembeddable rather than killing the chain.
 */
const MAX_INPUT_CHARS = 6_000;

export const EMBEDDING_VERSION = 1;
export const EMBEDDING_DIMENSIONS = OPENAI_EMBEDDING_DIMENSIONS;

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Run: npx convex env set OPENAI_API_KEY sk-...",
    );
  }
  return key;
}

/** Truncate input to a safe length before sending to the embeddings API. */
export function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  return text.slice(0, MAX_INPUT_CHARS);
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

/** Embed a single text string. Returns a 1536-dimension vector. */
export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}

/** Parse "Please try again in 4.896s" out of a 429 body, returning ms (capped). */
function parseRetryAfterMs(body: string): number | null {
  const match = body.match(/try again in ([\d.]+)\s*s/i);
  if (!match) return null;
  const seconds = parseFloat(match[1]);
  if (Number.isNaN(seconds)) return null;
  // Cap at 60s to avoid pathological waits, add 500ms safety buffer
  return Math.min(60_000, Math.ceil(seconds * 1000) + 500);
}

/**
 * Thrown when OpenAI rejects a single input as too long. Carries the index of
 * the offending item so the caller can mark it unembeddable and retry the rest.
 */
export class EmbeddingInputTooLongError extends Error {
  constructor(public readonly badIndex: number) {
    super(`Embedding input[${badIndex}] exceeds the per-input token limit`);
    this.name = "EmbeddingInputTooLongError";
  }
}

const MAX_RETRIES = 3;

/**
 * Embed a batch of text strings in a single API call.
 * OpenAI accepts up to 2048 inputs per request. Caller should batch above that.
 *
 * Retries on 429 by parsing OpenAI's suggested wait time, up to MAX_RETRIES times.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > 2048) {
    throw new Error(
      `embedTexts received ${texts.length} inputs, max is 2048 per call`,
    );
  }

  const truncated = texts.map(truncateForEmbedding);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: truncated,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as EmbeddingResponse;
      // OpenAI returns embeddings in input order, but the docs say to sort by
      // index to be safe.
      const sorted = data.data.slice().sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    }

    const body = await res.text();

    // Retry rate limits with the suggested wait time
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryHeader = res.headers.get("retry-after");
      const headerMs = retryHeader ? parseFloat(retryHeader) * 1000 : null;
      const bodyMs = parseRetryAfterMs(body);
      const waitMs = headerMs ?? bodyMs ?? 5000 * (attempt + 1);
      console.warn(
        `OpenAI 429 (attempt ${attempt + 1}/${MAX_RETRIES + 1}), waiting ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    // Per-input length errors: parse the offending index so the caller can
    // mark just that one skill unembeddable and continue with the rest.
    if (res.status === 400) {
      const badIndexMatch = body.match(/Invalid 'input\[(\d+)\]'/);
      if (badIndexMatch) {
        throw new EmbeddingInputTooLongError(parseInt(badIndexMatch[1], 10));
      }
    }

    throw new Error(
      `OpenAI embeddings API error ${res.status}: ${body.slice(0, 500)}`,
    );
  }

  // Unreachable — the loop either returns or throws
  throw new Error("OpenAI embeddings: exhausted retries");
}
