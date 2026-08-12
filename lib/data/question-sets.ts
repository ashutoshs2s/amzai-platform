import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { QuestionSetDetail, QuestionSetSummary } from "@/lib/question-sets";

/**
 * The question sets, as imported from the workbook.
 *
 * Reference data. Every staff member reads it; only an admin changes it, and
 * the only thing that can be changed is who owns a question. Everything else
 * about a set comes from the workbook and changes by importing it again.
 */

export { KIND_LABEL, OWNER_LABEL, OWNERS } from "@/lib/question-sets";
export type {
  QuestionSetSummary,
  QuestionSetField,
  QuestionSetDetail,
} from "@/lib/question-sets";

type Row = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  version: number;
  client_type: { label: string } | null;
  sub_segment: { label: string } | null;
  fields: {
    id: string;
    section: string;
    sort_order: number;
    question: string;
    default_owner: string;
    default_owner_set_at: string | null;
    duplicate_kind: string | null;
    duplicate_of: string | null;
    set_by: { full_name: string } | null;
  }[];
};

const SELECT = `id, slug, name, kind, version,
   client_type:client_types ( label ),
   sub_segment:client_sub_segments!onboarding_templates_sub_segment_belongs_to ( label ),
   fields:onboarding_template_fields (
     id, section, sort_order, question, default_owner, default_owner_set_at,
     duplicate_kind, duplicate_of,
     set_by:users!onboarding_template_fields_default_owner_set_by_fkey ( full_name )
   )`;

/** Who a set applies to, said in the taxonomy's own words. */
function appliesTo(row: Row): string {
  if (row.kind === "core") return "Every programme";
  if (row.sub_segment?.label) return row.sub_segment.label;
  if (row.client_type?.label) return `${row.client_type.label}, all sub-segments`;
  return "Every client type";
}

function summarise(row: Row): QuestionSetSummary {
  const fields = row.fields ?? [];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    version: row.version,
    appliesTo: appliesTo(row),
    questionCount: fields.length,
    amzaiOwned: fields.filter((f) => f.default_owner === "amzai").length,
    clientOwned: fields.filter((f) => f.default_owner === "client").length,
    bothOwned: fields.filter((f) => f.default_owner === "both").length,
    tuned: fields.filter((f) => f.default_owner_set_at !== null).length,
  };
}

/**
 * Only the newest version of each slug. Older ones are kept because live
 * programmes read through them, not because anyone needs to browse them.
 */
export async function listQuestionSets(): Promise<QuestionSetSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_templates")
    .select(SELECT)
    .eq("active", true)
    .order("version", { ascending: false });

  if (error) throw new Error(`Could not load the question sets: ${error.message}`);

  const newest = new Map<string, Row>();
  for (const row of (data ?? []) as unknown as Row[]) {
    if (!newest.has(row.slug)) newest.set(row.slug, row);
  }

  const order = { core: 0, segment: 1, situational: 2 } as Record<string, number>;
  return [...newest.values()]
    .map(summarise)
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.name.localeCompare(b.name));
}

export async function getQuestionSet(slug: string): Promise<QuestionSetDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_templates")
    .select(SELECT)
    .eq("slug", slug)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load that question set: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as Row;
  const bySection = new Map<string, QuestionSetDetail["sections"][number]>();

  for (const field of [...(row.fields ?? [])].sort((a, b) => a.sort_order - b.sort_order)) {
    let section = bySection.get(field.section);
    if (!section) {
      section = { section: field.section, fields: [] };
      bySection.set(field.section, section);
    }
    section.fields.push({
      id: field.id,
      question: field.question,
      sortOrder: field.sort_order,
      owner: field.default_owner,
      setByName: field.set_by?.full_name ?? null,
      setAt: field.default_owner_set_at,
      duplicateKind: field.duplicate_kind,
      duplicateOf: field.duplicate_of,
    });
  }

  return { ...summarise(row), sections: [...bySection.values()] };
}
