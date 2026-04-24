/**
 * Voyage AI embeddings wrapper.
 *
 * Uses voyage-code-3 at 512 dimensions — purpose-built for code and
 * programming documentation, with retrieval-optimized input_type support.
 * Read the docs at https://docs.voyageai.com/docs/embeddings.
 *
 * Reads VOYAGE_API_KEY from the Convex environment. Set via:
 *   npx convex env set VOYAGE_API_KEY pa-...
 */

const VOYAGE_EMBEDDING_MODEL = "voyage-code-3";
const VOYAGE_EMBEDDING_DIMENSIONS = 512;
const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

/**
 * Per-input character cap. Voyage 4 Lite has a 32K token context, so this is
 * far more generous than the old 6,000 cap (which was constrained by OpenAI's
 * 8K limit). At 2-4 chars/token, 16,000 chars ≈ 4-8K tokens — well within the
 * 32K limit even for pathological content.
 */
const MAX_INPUT_CHARS = 16_000;

export const EMBEDDING_VERSION = 3;
export const EMBEDDING_DIMENSIONS = VOYAGE_EMBEDDING_DIMENSIONS;

function getApiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) {
    throw new Error(
      "VOYAGE_API_KEY is not set. Run: npx convex env set VOYAGE_API_KEY pa-...",
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
  usage: { total_tokens: number };
}

/**
 * Embed a single text string. Returns a 512-dimension vector.
 *
 * @param inputType - "document" for content being indexed (skills),
 *                    "query" for search queries (repo fingerprints).
 *                    Voyage prepends retrieval-optimized prompts per type.
 */
export async function embedText(
  text: string,
  inputType?: "document" | "query",
): Promise<number[]> {
  const [vector] = await embedTexts([text], inputType);
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
 * Thrown when the API rejects a single input as too long. Carries the index of
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
 * Voyage accepts up to 1000 inputs per request. Caller should batch above that.
 *
 * @param inputType - "document" for content being indexed,
 *                    "query" for search queries.
 *
 * Retries on 429 by parsing the suggested wait time, up to MAX_RETRIES times.
 */
export async function embedTexts(
  texts: string[],
  inputType?: "document" | "query",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > 1000) {
    throw new Error(
      `embedTexts received ${texts.length} inputs, max is 1000 per call`,
    );
  }

  const truncated = texts.map(truncateForEmbedding);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(VOYAGE_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: VOYAGE_EMBEDDING_MODEL,
        input: truncated,
        output_dimension: VOYAGE_EMBEDDING_DIMENSIONS,
        ...(inputType && { input_type: inputType }),
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as EmbeddingResponse;
      // Sort by index to be safe, same as before.
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
        `Voyage 429 (attempt ${attempt + 1}/${MAX_RETRIES + 1}), waiting ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    // Per-input length errors: parse the offending index so the caller can
    // mark just that one skill unembeddable and continue with the rest.
    // Guard the generic `input[N]` fallback on a length-related keyword so
    // an unrelated 400 that happens to mention `input[0]` doesn't get
    // misclassified as a too-long error.
    if (res.status === 400) {
      const indexMatch =
        body.match(/Invalid 'input\[(\d+)\]'/) ??
        body.match(/input\[(\d+)\]/);
      const looksLikeLength =
        /too long|exceeds?|maximum|length|token/i.test(body);
      if (indexMatch && looksLikeLength) {
        throw new EmbeddingInputTooLongError(parseInt(indexMatch[1], 10));
      }
    }

    throw new Error(
      `Voyage embeddings API error ${res.status}: ${body.slice(0, 500)}`,
    );
  }

  // Unreachable — the loop either returns or throws
  throw new Error("Voyage embeddings: exhausted retries");
}
