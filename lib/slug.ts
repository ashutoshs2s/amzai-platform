/**
 * Slugs.
 *
 * Readability, never security. CLAUDE.md rule 7: nothing is ever gated on a
 * slug being hard to guess, and a client-facing surface is reached by token.
 * So these are as plain and as predictable as possible, on purpose.
 */

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents: Zürich -> Zurich
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Matches the check constraint on both organisations.slug and programs.slug. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/**
 * A slug not already in `taken`, by adding -2, -3 and so on.
 *
 * Only ever suggested, never applied silently to something an operator typed:
 * two clients with similar names is exactly when somebody should look.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
