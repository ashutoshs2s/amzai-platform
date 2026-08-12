import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Selection, Template } from "@/lib/generation/resolve.ts";
import { resolveQuestions, situationalModulesFor } from "@/lib/generation/resolve.ts";

/**
 * Everything generation needs, read from the database.
 *
 * This file loads rows and hands them to the resolver. It decides nothing
 * itself: no list of sheets, no mapping of client to questions, no special
 * case for a segment. If a rule appears to be missing here, it belongs in
 * lib/generation/resolve.ts or in a row, not in a route.
 */

export type GenerationContext = {
  programme: {
    id: string;
    name: string;
    slug: string;
    type: string;
    organisationName: string;
    clientTypeLabel: string;
    subSegmentLabel: string | null;
    category: string | null;
    generatedAt: string | null;
    fillMode: "amzai" | "client" | null;
  };
  /** SPEC.md 4.2. Generation is blocked until somebody is assigned. */
  team: { userId: string; fullName: string; role: string }[];
  /** Modules that could be chosen for this programme, from the same rows. */
  offered: { slug: string; name: string; questionCount: number }[];
  selectedSlugs: string[];
  selection: Selection;
  templates: Template[];
};

type FieldRow = {
  id: string;
  section: string;
  sort_order: number;
  question: string;
  guidance: string | null;
  default_owner: "client" | "amzai" | "both";
  default_assignee_role: string | null;
  default_offset_type: "weeks_from_start" | "days_before_milestone";
  default_offset_value: number;
  blocking: boolean;
};

type TemplateRow = {
  id: string;
  slug: string;
  name: string;
  kind: "core" | "segment" | "situational";
  version: number;
  program_type: string | null;
  client_type_id: string | null;
  sub_segment_id: string | null;
  fields: FieldRow[] | null;
};

function toTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    version: row.version,
    programType: row.program_type,
    clientTypeId: row.client_type_id,
    subSegmentId: row.sub_segment_id,
    fields: (row.fields ?? []).map((f) => ({
      id: f.id,
      section: f.section,
      sortOrder: f.sort_order,
      question: f.question,
      guidance: f.guidance,
      defaultOwner: f.default_owner,
      defaultAssigneeRole: f.default_assignee_role,
      defaultOffsetType: f.default_offset_type,
      defaultOffsetValue: f.default_offset_value,
      blocking: f.blocking,
    })),
  };
}

export async function loadGenerationContext(
  programmeId: string,
): Promise<GenerationContext | null> {
  const supabase = await createClient();

  const { data: programme, error } = await supabase
    .from("programs")
    .select(
      `id, name, slug, type, onboarding_generated_at, onboarding_fill_mode,
       organisation:organisations (
         name, category, client_type_id, sub_segment_id,
         client_type:client_types ( id, label ),
         sub_segment:client_sub_segments!organisations_sub_segment_belongs_to (
           id, label, questions_from_sub_segment_id
         )
       )`,
    )
    .eq("id", programmeId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the programme: ${error.message}`);
  if (!programme) return null;

  const org = programme.organisation as unknown as {
    name: string;
    category: string | null;
    client_type_id: string;
    sub_segment_id: string | null;
    client_type: { id: string; label: string } | null;
    sub_segment: {
      id: string;
      label: string;
      questions_from_sub_segment_id: string | null;
    } | null;
  };

  // The label of the set being borrowed, so the preview can say whose it is.
  let borrowsFromLabel: string | null = null;
  if (org.sub_segment?.questions_from_sub_segment_id) {
    const { data: source } = await supabase
      .from("client_sub_segments")
      .select("label")
      .eq("id", org.sub_segment.questions_from_sub_segment_id)
      .maybeSingle();
    borrowsFromLabel = source?.label ?? null;
  }

  const [{ data: templateRows, error: templateError }, { data: team }, { data: chosen }] =
    await Promise.all([
      supabase
        .from("onboarding_templates")
        .select(
          `id, slug, name, kind, version, program_type, client_type_id, sub_segment_id,
           fields:onboarding_template_fields (
             id, section, sort_order, question, guidance, default_owner,
             default_assignee_role, default_offset_type, default_offset_value, blocking
           )`,
        )
        .eq("active", true),
      supabase
        .from("program_assignments")
        .select("user_id, role_on_program, user:users ( full_name )")
        .eq("program_id", programmeId),
      supabase
        .from("program_situational_modules")
        .select("module_slug")
        .eq("program_id", programmeId),
    ]);

  if (templateError) {
    throw new Error(`Could not load the question sets: ${templateError.message}`);
  }

  const templates = (templateRows ?? []).map((row) => toTemplate(row as TemplateRow));
  const selectedSlugs = (chosen ?? []).map((c) => c.module_slug);

  const selection: Selection = {
    clientTypeId: org.client_type_id,
    clientTypeLabel: org.client_type?.label ?? "Unknown client type",
    subSegmentId: org.sub_segment_id,
    subSegmentLabel: org.sub_segment?.label ?? null,
    borrowsFromSubSegmentId: org.sub_segment?.questions_from_sub_segment_id ?? null,
    borrowsFromLabel,
    programType: programme.type,
    situationalSlugs: selectedSlugs,
  };

  return {
    programme: {
      id: programme.id,
      name: programme.name,
      slug: programme.slug,
      type: programme.type,
      organisationName: org.name,
      clientTypeLabel: selection.clientTypeLabel,
      subSegmentLabel: selection.subSegmentLabel,
      category: org.category,
      generatedAt: programme.onboarding_generated_at,
      fillMode: programme.onboarding_fill_mode,
    },
    team: (team ?? []).map((t) => ({
      userId: t.user_id,
      fullName: (t.user as unknown as { full_name: string } | null)?.full_name ?? "Unknown",
      role: t.role_on_program,
    })),
    offered: situationalModulesFor(templates, selection.clientTypeId, programme.type).map(
      (t) => ({ slug: t.slug, name: t.name, questionCount: t.fields.length }),
    ),
    selectedSlugs,
    selection,
    templates,
  };
}

/**
 * The preview. The same call the commit makes, so what is shown is what is
 * written, with the modules the admin is currently considering rather than
 * whatever is stored.
 */
export function planFor(context: GenerationContext, situationalSlugs: string[]) {
  return resolveQuestions(context.templates, {
    ...context.selection,
    situationalSlugs,
  });
}
