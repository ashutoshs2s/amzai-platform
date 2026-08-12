import "server-only";

import { createClient } from "@/lib/supabase/server";
import { PROGRAMME_TYPE_LABEL } from "@/lib/programme-types";
import { daysBetween } from "@/lib/time";

/**
 * Programme reads.
 *
 * Everything here goes through the authenticated server client, so row level
 * security applies with the signed-in staff member's identity. Nothing uses
 * the service role: a screen that reads past its own policies is a screen that
 * cannot be trusted to show the right rows.
 *
 * The four portfolio counts are defined in SPEC.md section 7.3. They are
 * derived from onboarding responses rather than stored, and the responses are
 * themselves filtered by RLS, so a delivery lead's counts describe their own
 * programmes and nobody else's.
 */

export { PROGRAMME_TYPE_LABEL } from "@/lib/programme-types";

export type ProgrammeTime =
  | { kind: "event"; milestoneDate: string }
  | {
      kind: "retainer";
      startDate: string;
      endDate: string;
      gateDate: string | null;
    };

export type ProgrammeRow = {
  id: string;
  name: string;
  clientTypeId: string;
  clientTypeLabel: string;
  subSegmentId: string | null;
  subSegmentLabel: string | null;
  category: string | null;
  type: string;
  typeLabel: string;
  owner: string;
  status: string;
  blocking: number;
  atRisk: boolean;
  hasBlocked: boolean;
  awaitingClient: boolean;
  /** Days from today to the date that matters. Drives the default sort. */
  urgencyDays: number;
  time: ProgrammeTime | null;
};

type ResponseRollup = {
  blocking: number;
  atRisk: boolean;
  hasBlocked: boolean;
  awaitingClient: boolean;
};

/** Builds the per-programme rollups the four counts and the Blocking column need. */
function rollup(
  rows: {
    program_id: string;
    status: string;
    blocking: boolean;
    due_date: string | null;
    owner: string;
  }[],
  today: string,
): Map<string, ResponseRollup> {
  const map = new Map<string, ResponseRollup>();

  for (const row of rows) {
    const current = map.get(row.program_id) ?? {
      blocking: 0,
      atRisk: false,
      hasBlocked: false,
      awaitingClient: false,
    };

    // Blocking count: blocking and not approved. SPEC.md section 7.3.
    if (row.blocking && row.status !== "approved") current.blocking += 1;

    // At risk: blocking, past its due date, not approved.
    if (
      row.blocking &&
      row.status !== "approved" &&
      row.due_date !== null &&
      daysBetween(today, row.due_date) < 0
    ) {
      current.atRisk = true;
    }

    if (row.status === "blocked") current.hasBlocked = true;
    if (row.owner === "client" && row.status !== "approved") {
      current.awaitingClient = true;
    }

    map.set(row.program_id, current);
  }

  return map;
}

function timeFor(programme: {
  type: string;
  start_date: string | null;
  end_date: string | null;
  fixed_milestone_date: string | null;
  gate_date: string | null;
}): ProgrammeTime | null {
  // Events count to the date that does not move; everything else runs in
  // engagement weeks. SPEC.md section 7.2.
  if (programme.type === "event" || programme.type === "series") {
    return programme.fixed_milestone_date
      ? { kind: "event", milestoneDate: programme.fixed_milestone_date }
      : null;
  }
  return programme.start_date && programme.end_date
    ? {
        kind: "retainer",
        startDate: programme.start_date,
        endDate: programme.end_date,
        gateDate: programme.gate_date,
      }
    : null;
}

function urgencyFor(time: ProgrammeTime | null, today: string): number {
  if (!time) return Number.MAX_SAFE_INTEGER;
  return time.kind === "event"
    ? daysBetween(today, time.milestoneDate)
    : daysBetween(today, time.endDate);
}

export async function listProgrammes(today: string): Promise<ProgrammeRow[]> {
  const supabase = await createClient();

  const { data: programmes, error } = await supabase
    .from("programs")
    .select(
      `id, name, type, status, start_date, end_date, fixed_milestone_date, gate_date,
       organisation:organisations (
         category,
         client_type:client_types ( id, label ),
         sub_segment:client_sub_segments ( id, label )
       ),
       delivery_lead:users!programs_delivery_lead_id_fkey ( full_name )`,
    )
    // Archived programmes leave the interface but keep their history. They are
    // reachable, and reversible, from the staff screen.
    .is("archived_at", null)
    .order("name");

  if (error) throw new Error(`Could not load programmes: ${error.message}`);
  if (!programmes || programmes.length === 0) return [];

  const { data: responses, error: responsesError } = await supabase
    .from("onboarding_responses")
    .select("program_id, status, blocking, due_date, owner");

  if (responsesError) {
    throw new Error(`Could not load onboarding: ${responsesError.message}`);
  }

  const rollups = rollup(responses ?? [], today);

  return programmes.map((programme) => {
    // PostgREST types an embedded to-one as an array; take the first.
    const organisation = Array.isArray(programme.organisation)
      ? programme.organisation[0]
      : programme.organisation;
    const lead = Array.isArray(programme.delivery_lead)
      ? programme.delivery_lead[0]
      : programme.delivery_lead;

    const clientType = Array.isArray(organisation?.client_type)
      ? organisation.client_type[0]
      : organisation?.client_type;
    const subSegment = Array.isArray(organisation?.sub_segment)
      ? organisation.sub_segment[0]
      : organisation?.sub_segment;

    const time = timeFor(programme);
    const counts = rollups.get(programme.id) ?? {
      blocking: 0,
      atRisk: false,
      hasBlocked: false,
      awaitingClient: false,
    };

    return {
      id: programme.id,
      name: programme.name,
      clientTypeId: clientType?.id ?? "",
      clientTypeLabel: clientType?.label ?? "Unclassified",
      subSegmentId: subSegment?.id ?? null,
      subSegmentLabel: subSegment?.label ?? null,
      category: organisation?.category ?? null,
      type: programme.type,
      typeLabel: PROGRAMME_TYPE_LABEL[programme.type] ?? programme.type,
      owner: lead?.full_name ?? "Unassigned",
      status: programme.status,
      urgencyDays: urgencyFor(time, today),
      time,
      ...counts,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                     */
/* -------------------------------------------------------------------------- */

export type OnboardingField = {
  id: string;
  section: string;
  question: string;
  guidance: string | null;
  response: string;
  owner: string;
  assignee: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  status: string;
  blocking: boolean;
  answeredBy: { name: string; party: "client" | "amzai"; at: string } | null;
};

export type ProgrammeDetail = {
  id: string;
  name: string;
  clientTypeLabel: string;
  subSegmentLabel: string | null;
  category: string | null;
  typeLabel: string;
  status: string;
  time: ProgrammeTime | null;
  approverName: string | null;
  approverEmail: string | null;
  team: { id: string; name: string; roleOnProgram: string; allocationPercent: number | null }[];
  /** Null when onboarding has not been generated. */
  onboarding: OnboardingField[] | null;
  templateName: string | null;
  audit: { at: string; text: string }[];
};

export async function getProgramme(id: string): Promise<ProgrammeDetail | null> {
  const supabase = await createClient();

  const { data: programme, error } = await supabase
    .from("programs")
    .select(
      `id, name, type, status, start_date, end_date, fixed_milestone_date, gate_date,
       approver_name, approver_email, onboarding_template_id,
       organisation:organisations (
         category,
         client_type:client_types ( label ),
         sub_segment:client_sub_segments ( label )
       ),
       template:onboarding_templates ( name, version )`,
    )
    .eq("id", id)
    .maybeSingle();

  // A programme the reader may not see is indistinguishable from one that does
  // not exist, which is the correct behaviour: RLS should not confirm that a
  // record exists to someone with no right to it.
  if (error || !programme) return null;

  const [{ data: assignments }, { data: responses }, { data: audit }] =
    await Promise.all([
      supabase
        .from("program_assignments")
        .select(
          `role_on_program, allocation_percent, user:users!program_assignments_user_id_fkey ( id, full_name )`,
        )
        .eq("program_id", id),
      supabase
        .from("onboarding_responses")
        .select(
          `id, response, owner, due_date, status, blocking, answered_at,
           assignee:users!onboarding_responses_assignee_id_fkey ( id, full_name ),
           author:users!onboarding_responses_answered_by_fkey ( full_name ),
           contact:client_contacts!onboarding_responses_answered_by_contact_id_fkey ( name ),
           field:onboarding_template_fields ( section, sort_order, question, guidance )`,
        )
        .eq("program_id", id),
      supabase
        .from("audit_events")
        .select("action, table_name, occurred_at, after")
        .eq("record_id", id)
        .order("occurred_at", { ascending: false })
        .limit(20),
    ]);

  const first = <T,>(value: T | T[] | null | undefined): T | undefined =>
    Array.isArray(value) ? value[0] : (value ?? undefined);

  const organisation = first(programme.organisation);
  const template = first(programme.template);

  const onboarding: OnboardingField[] | null =
    responses && responses.length > 0
      ? responses
          .map((row) => {
            const field = first(row.field);
            const assignee = first(row.assignee);
            const author = first(row.author);
            const contact = first(row.contact);
            return {
              id: row.id,
              section: field?.section ?? "Onboarding",
              question: field?.question ?? "",
              guidance: field?.guidance ?? null,
              sortOrder: field?.sort_order ?? 0,
              response: row.response ?? "",
              owner: row.owner,
              assignee: assignee?.full_name ?? null,
              assigneeId: assignee?.id ?? null,
              dueDate: row.due_date,
              status: row.status,
              blocking: row.blocking,
              answeredBy: contact
                ? {
                    name: contact.name,
                    party: "client" as const,
                    at: row.answered_at ?? "",
                  }
                : author
                  ? {
                      name: author.full_name,
                      party: "amzai" as const,
                      at: row.answered_at ?? "",
                    }
                  : null,
            };
          })
          .sort(
            (a, b) =>
              a.section.localeCompare(b.section) || a.sortOrder - b.sortOrder,
          )
          .map((field) => {
            const { sortOrder, ...rest } = field;
            void sortOrder;
            return rest;
          })
      : null;

  return {
    id: programme.id,
    name: programme.name,
    clientTypeLabel: first(organisation?.client_type)?.label ?? "Unclassified",
    subSegmentLabel: first(organisation?.sub_segment)?.label ?? null,
    category: organisation?.category ?? null,
    typeLabel: PROGRAMME_TYPE_LABEL[programme.type] ?? programme.type,
    status: programme.status,
    time: timeFor(programme),
    approverName: programme.approver_name,
    approverEmail: programme.approver_email,
    team: (assignments ?? []).map((row) => ({
      id: first(row.user)?.id ?? "",
      name: first(row.user)?.full_name ?? "Unknown",
      roleOnProgram: row.role_on_program,
      allocationPercent: row.allocation_percent,
    })),
    onboarding,
    templateName: template ? `${template.name}, v${template.version}` : null,
    audit: (audit ?? []).map((row) => ({
      at: row.occurred_at,
      text: describeAudit(row),
    })),
  };
}

/** Audit rows in plain language. DESIGN.md section 6.2. */
function describeAudit(row: {
  action: string;
  table_name: string | null;
  after: Record<string, unknown> | null;
}): string {
  const verb =
    row.action === "insert"
      ? "created"
      : row.action === "delete"
        ? "deleted"
        : "updated";
  const subject = (row.after?.name as string | undefined) ?? row.table_name ?? "record";
  return `${subject} ${verb}`;
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export type AwaitingSummary = { count: number; overdue: number; dueSoon: number };

/**
 * The awaiting-me count. SPEC.md section 7.3: responses assigned to the
 * signed-in user whose status is neither approved nor N/A, across every
 * programme they can see. RLS does the "can see" part.
 */
export async function awaitingFor(
  staffId: string,
  today: string,
): Promise<AwaitingSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("onboarding_responses")
    .select("due_date, status")
    .eq("assignee_id", staffId)
    .not("status", "in", "(approved,na)");

  let overdue = 0;
  let dueSoon = 0;
  for (const row of data ?? []) {
    if (!row.due_date) continue;
    const days = daysBetween(today, row.due_date);
    if (days < 0) overdue += 1;
    else if (days <= 7) dueSoon += 1;
  }

  return { count: data?.length ?? 0, overdue, dueSoon };
}

