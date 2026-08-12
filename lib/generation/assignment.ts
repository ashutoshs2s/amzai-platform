import type { GenerationPlan } from "./resolve.ts";

/**
 * Turning roles into people. SPEC.md section 4.3.
 *
 * Pure, and shared by the preview and the commit. The preview has to show the
 * admin which roles it cannot settle on its own, and the commit has to refuse
 * until they are settled. If each worked it out separately they could disagree,
 * and the disagreement would show up as a programme generated with assignments
 * nobody was asked about.
 */

export const ROLE_LABEL: Record<string, string> = {
  engagement_lead: "Engagement lead",
  delivery_lead: "Delivery lead",
  specialist: "Specialist",
  data_ops: "Data ops",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export type TeamMember = { userId: string; fullName: string; role: string };

export type AmbiguousRole = {
  role: string;
  /** How many questions depend on the answer. Shown so the choice has weight. */
  fieldCount: number;
  holders: { id: string; fullName: string }[];
};

export type RoleAssignment = {
  /** Roles that need no question asked: exactly one holder, or none at all. */
  settled: Map<string, string | null>;
  ambiguous: AmbiguousRole[];
  /** Roles nobody holds. Their questions generate unassigned. SPEC.md 4.7. */
  unheld: { role: string; fieldCount: number }[];
};

/**
 * Client-owned questions and questions with no default role take no part.
 * Nobody at Amzai owes them, so resolving a role for them would be inventing
 * work rather than assigning it.
 */
export function rolesNeeded(plan: GenerationPlan, team: TeamMember[]): RoleAssignment {
  const counts = new Map<string, number>();
  for (const q of plan.questions) {
    const role = q.field.defaultAssigneeRole;
    if (!role || q.field.defaultOwner === "client") continue;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }

  const settled = new Map<string, string | null>();
  const ambiguous: AmbiguousRole[] = [];
  const unheld: { role: string; fieldCount: number }[] = [];

  for (const [role, fieldCount] of [...counts].sort((a, b) => b[1] - a[1])) {
    const holders = team.filter((t) => t.role === role);

    if (holders.length === 1) {
      settled.set(role, holders[0].userId);
    } else if (holders.length === 0) {
      settled.set(role, null);
      unheld.push({ role, fieldCount });
    } else {
      // Never broken by allocation, seniority or order of assignment. A wrong
      // guess stays invisible until somebody misses a deadline. SPEC.md 4.3.
      ambiguous.push({
        role,
        fieldCount,
        holders: holders.map((h) => ({ id: h.userId, fullName: h.fullName })),
      });
    }
  }

  return { settled, ambiguous, unheld };
}

/** How many questions would generate with nobody against them. */
export function unassignedCount(
  plan: GenerationPlan,
  settled: Map<string, string | null>,
): number {
  return plan.questions.filter((q) => {
    const role = q.field.defaultAssigneeRole;
    if (q.field.defaultOwner === "client") return false;
    if (!role) return true;
    return (settled.get(role) ?? null) === null;
  }).length;
}
