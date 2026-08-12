import { createHash } from "node:crypto";

/**
 * Deciding what an import should write.
 *
 * Split out of scripts/import-questions.mjs so it can be run twice against a
 * store held in memory, which is the only way to test that importing an
 * unchanged workbook writes nothing. The script supplies a Supabase-backed
 * store; the test supplies a Map. Both run this same code.
 *
 * Node strips the types and runs this directly. It has no framework imports
 * and the app never imports it, which is what keeps `xlsx` out of the bundle.
 */

export type ComputedField = {
  section: string;
  sort_order: number;
  question: string;
  guidance: string | null;
  default_owner: string;
  default_assignee_role: string | null;
  default_offset_type: string;
  default_offset_value: number;
  blocking: boolean;
  duplicate_kind: string | null;
  duplicate_of: string | null;
};

export type StoredField = {
  id: string;
  section: string;
  sort_order: number;
  question: string;
  default_owner: string;
  /** Non-null means a person decided, and no import may overrule them. */
  default_owner_set_by: string | null;
};

export type StoredTemplate = {
  id: string;
  slug: string;
  version: number;
  fields: StoredField[];
};

export type Sheet = {
  slug: string;
  name: string;
  kind: string;
  clientTypeId: string | null;
  subSegmentId: string | null;
  fields: ComputedField[];
};

export type Store = {
  /** The newest version of a slug, with its fields, or null if never imported. */
  latestBySlug(slug: string): Promise<StoredTemplate | null>;
  createTemplate(input: {
    slug: string;
    name: string;
    kind: string;
    clientTypeId: string | null;
    subSegmentId: string | null;
    version: number;
    contentHash: string;
  }): Promise<{ id: string }>;
  insertFields(templateId: string, fields: ComputedField[]): Promise<void>;
  updateOwner(fieldId: string, owner: string): Promise<void>;
};

export type Outcome = {
  slug: string;
  name: string;
  action: "created" | "new version" | "unchanged";
  version: number;
  questionCount: number;
  /** Owner defaults brought into line on an unchanged sheet. */
  retuned: number;
  /** Owners a person had set, which an import must not overrule. */
  leftAlone: number;
  /** Question count before, when a new version was written. */
  previousQuestionCount?: number;
};

/**
 * What the workbook says, as opposed to what the importer decides on top.
 *
 * This is the identity of a sheet. Owner, assignee role, offsets and blocking
 * are all this script's defaults, and two of them are editable in the app, so
 * none of them can take part in deciding whether the sheet changed.
 */
export function contentOf(fields: { section: string; sort_order: number; question: string }[]) {
  return [...fields]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((f) => ({ section: f.section, sort_order: f.sort_order, question: f.question }));
}

/**
 * Recorded on the template as provenance, and useful when comparing two
 * imports by eye. It is deliberately NOT what decides whether a sheet changed.
 *
 * A hash is only a stable identity while the function producing it never
 * changes. Ours did, once, and every stored hash silently stopped matching,
 * which re-versioned nine sheets of which six were untouched. Comparing the
 * stored questions themselves cannot fail that way: it asks the question
 * directly instead of asking a proxy for it.
 */
export function contentHash(slug: string, kind: string, fields: ComputedField[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ slug, kind, content: contentOf(fields) }))
    .digest("hex");
}

/** Whether the stored questions are the workbook's questions. */
export function sameContent(stored: StoredField[], computed: ComputedField[]): boolean {
  return JSON.stringify(contentOf(stored)) === JSON.stringify(contentOf(computed));
}

/**
 * Import one sheet.
 *
 * Nothing existing is ever edited or deleted, with the single exception of an
 * owner default that no person has set. A changed sheet becomes a new version,
 * because programmes already generated read their questions from the version
 * they were generated from.
 */
export async function importSheet(store: Store, sheet: Sheet): Promise<Outcome> {
  const latest = await store.latestBySlug(sheet.slug);

  if (latest && sameContent(latest.fields, sheet.fields)) {
    /*
      The questions are unchanged, so no new version. The defaults this script
      applies may still have changed, and owner is one of them. Only where
      nobody has decided otherwise: default_owner_set_by non-null means a person
      made a judgement in the app, and an import must not overrule a person.
    */
    let retuned = 0;
    let leftAlone = 0;

    for (const field of sheet.fields) {
      const row = latest.fields.find((f) => f.sort_order === field.sort_order);
      if (!row || row.default_owner === field.default_owner) continue;
      if (row.default_owner_set_by !== null) {
        leftAlone += 1;
        continue;
      }
      await store.updateOwner(row.id, field.default_owner);
      retuned += 1;
    }

    return {
      slug: sheet.slug,
      name: sheet.name,
      action: "unchanged",
      version: latest.version,
      questionCount: sheet.fields.length,
      retuned,
      leftAlone,
    };
  }

  const version = latest ? latest.version + 1 : 1;
  const template = await store.createTemplate({
    slug: sheet.slug,
    name: sheet.name,
    kind: sheet.kind,
    clientTypeId: sheet.clientTypeId,
    subSegmentId: sheet.subSegmentId,
    version,
    contentHash: contentHash(sheet.slug, sheet.kind, sheet.fields),
  });
  await store.insertFields(template.id, sheet.fields);

  return {
    slug: sheet.slug,
    name: sheet.name,
    action: latest ? "new version" : "created",
    version,
    questionCount: sheet.fields.length,
    retuned: 0,
    leftAlone: 0,
    previousQuestionCount: latest?.fields.length,
  };
}
