/**
 * When two questions are the same question.
 *
 * One definition, used in two places: the workbook importer reports overlaps
 * with it, and generation drops duplicates with it. If they each had their own
 * copy they would drift, and then the preview would promise one thing and
 * generation would do another.
 *
 * Imported by scripts/import-questions.mjs, which is why this file must stay
 * free of framework imports. Node strips the types and runs it directly.
 */

/** Case, punctuation and spacing are noise. Words are the signal. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, "'")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How alike two questions are, from 0 to 1, comparing the words they use.
 *
 * Deliberately simple. A cleverer measure would be harder to predict, and the
 * cost of being wrong here is asymmetric: a missed duplicate is an annoying
 * repeated question, a false one silently drops something nobody gets asked.
 */
export function similarity(a: string, b: string): number {
  const wordsA = new Set(normalise(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalise(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared += 1;
  return (2 * shared) / (wordsA.size + wordsB.size);
}

/** Above this, two questions are close enough to be worth flagging. */
export const NEAR_DUPLICATE = 0.8;

export function isExactDuplicate(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}
