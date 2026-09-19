/**
 * Skill categorization via TypeSafe's Jev model (docs.typesafe.ai).
 *
 * Jev doesn't write text. It reads a `state` and answers typed questions, so
 * one request per skill carries every question at once, answered in parallel:
 *   - one yes/no ("noul") per category: is this a significant part of what
 *     the skill does? Returns a probability.
 *   - one "pick one" (choice) over all categories plus "Other": the main
 *     category, with a confidence.
 * Code turns those into tags (`deriveTags` in categories.ts); nothing here
 * decides what counts as a tag.
 *
 * Billed on input tokens only (~5k per skill, so the whole catalog is a few
 * dollars). Runs in Convex's default runtime: the SDK is dependency-free and
 * built on fetch, and it retries 429/529 with backoff itself.
 */
import {
  BadRequestError,
  choice,
  noul,
  TypeSafeClient,
  UnprocessableEntityError,
  type Question,
} from "@typesafe-ai/sdk";
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  TAGS_MODEL,
  type CategoryKey,
} from "./categories";
import { CATEGORY_DEFINITIONS } from "./categoryDefinitions";

/** Jev's accuracy drops as state fills with material irrelevant to the
 *  question, and the opening of a SKILL.md says what the skill is for. */
const CONTENT_CHARS = 6000;

const OTHER = "Other";

// Option keys are the labels, not our internal keys: option names are part of
// what the model reads, and "Code quality & architecture" says more than
// "codeQuality". `LABEL_TO_KEY` maps the answer back.
const LABEL_TO_KEY = new Map<string, CategoryKey>(
  CATEGORY_KEYS.map((key) => [CATEGORY_LABELS[key], key]),
);

const QUESTIONS: Record<string, Question> = {
  primary: choice(
    "Which one category best describes what the skill in `skill` mainly helps with?",
    {
      // Both halves of each definition, not just `counts`. With only the
      // positive text, the pick-one kept choosing categories the yes/no
      // questions had already ruled out.
      ...Object.fromEntries(
        CATEGORY_KEYS.map((key) => [
          CATEGORY_LABELS[key],
          `${CATEGORY_DEFINITIONS[key].counts} ${CATEGORY_DEFINITIONS[key].doesNotCount}`,
        ]),
      ),
      [OTHER]:
        "None of the other categories describes what this skill mainly helps with.",
    },
  ),
  ...Object.fromEntries(
    CATEGORY_KEYS.map((key) => [
      `tag_${key}`,
      noul(
        `Is "${CATEGORY_LABELS[key]}" a significant part of what the skill in \`skill\` helps with? Judge from what the skill actually does, not from topics it only mentions.`,
        {
          true: CATEGORY_DEFINITIONS[key].counts,
          false: CATEGORY_DEFINITIONS[key].doesNotCount,
        },
      ),
    ]),
  ),
};

export type SkillCategorization = {
  /** Probability per category key that it applies. */
  scores: Record<CategoryKey, number>;
  /** Main category key, or undefined when the answer was "Other". */
  primary: CategoryKey | undefined;
  primaryConfidence: number;
  /** The versioned model that answered, e.g. "jev-1.13.0". */
  model: string;
};

/** Jev refused the input itself (400/422). Retrying the same skill won't help. */
export class TaggingInputRejectedError extends Error {}

let client: TypeSafeClient | undefined;

export function hasTypeSafeKey(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

export async function categorizeSkill(skill: {
  name: string;
  description?: string;
  content?: string;
}): Promise<SkillCategorization> {
  client ??= new TypeSafeClient({ defaultModel: TAGS_MODEL, timeout: 30_000 });

  let res;
  try {
    res = await client.systemOne({
      state: {
        skill: {
          name: skill.name,
          description: skill.description ?? "",
          skill_md: (skill.content ?? "").slice(0, CONTENT_CHARS),
        },
      },
      questions: QUESTIONS,
    });
  } catch (e) {
    if (e instanceof BadRequestError || e instanceof UnprocessableEntityError) {
      throw new TaggingInputRejectedError(e.message);
    }
    throw e;
  }

  const answers = res.answers as Record<
    string,
    { noul?: number; choice?: string; confidence?: number }
  >;
  const scores = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, answers[`tag_${key}`]?.noul ?? 0]),
  ) as Record<CategoryKey, number>;
  const primaryLabel = answers.primary?.choice;

  return {
    scores,
    primary: primaryLabel ? LABEL_TO_KEY.get(primaryLabel) : undefined,
    primaryConfidence: answers.primary?.confidence ?? 0,
    model: res.model,
  };
}
