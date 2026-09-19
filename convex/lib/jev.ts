/**
 * Skill categorization via TypeSafe's Jev model (docs.typesafe.ai). One
 * request per skill: a yes/no per category plus a "pick one" main category.
 * `deriveTags` turns the answers into tags. About 8k input tokens (~$0.0003)
 * per skill. The SDK is fetch-based, runs in Convex's default runtime and
 * retries 429/529 itself.
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

/** Jev's accuracy drops as state fills with irrelevant text; the opening of
 *  a SKILL.md says what the skill is for. */
export const SKILL_CONTENT_CHARS = 6000;

const OTHER = "Other";

// Option names are part of what Jev reads, so options are labels, not keys.
const LABEL_TO_KEY = new Map<string, CategoryKey>(
  CATEGORY_KEYS.map((key) => [CATEGORY_LABELS[key], key]),
);

const QUESTIONS: Record<string, Question> = {
  primary: choice(
    "Which one category best describes what the skill in `skill` mainly helps with?",
    {
      // Both halves: with `counts` alone, the pick-one chose categories the
      // yes/no questions had ruled out.
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
  scores: Record<CategoryKey, number>;
  /** Undefined when the answer was "Other". */
  primary: CategoryKey | undefined;
  primaryConfidence: number;
  model: string;
};

/** Jev refused the input (400/422); retrying won't help. */
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
          skill_md: skill.content ?? "",
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
