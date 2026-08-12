/**
 * Privilege tiers, client-safe.
 *
 * The tier decides HOW MANY programmes a person sees. It is not the same thing
 * as `program_assignments.role_on_program`, which is the JOB they do on one, or
 * as a staff function, which decides WHICH TABLES AND COLUMNS they may touch.
 * Three separate questions, and conflating any two of them is how somebody ends
 * up either over-privileged or unable to do their job.
 *
 * Every check here is a convenience for the interface. The database enforces
 * all of it independently, and is the thing actually holding the line.
 */

export const TIERS = ["super_admin", "admin", "manager", "user"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  manager: "Manager",
  user: "User",
};

export const TIER_DESCRIPTION: Record<string, string> = {
  super_admin: "Everything, plus this screen. Exactly one, and set by migration.",
  admin: "Every client, programme and user. Creates clients and generates onboarding.",
  manager: "Every programme under the organisations they hold, and the teams inside them.",
  user: "Only the programmes they are assigned to.",
};

/** Rank, high to low. Used to stop anyone editing at or above their own level. */
const RANK: Record<string, number> = { super_admin: 3, admin: 2, manager: 1, user: 0 };

export function rankOf(tier: string): number {
  return RANK[tier] ?? -1;
}

/** Sees everything, creates clients, generates onboarding, manages users. */
export function isAdminOrAbove(tier: string): boolean {
  return tier === "super_admin" || tier === "admin";
}

export function isSuperAdmin(tier: string): boolean {
  return tier === "super_admin";
}

/**
 * Whether `actor` may change `target`'s tier or functions.
 *
 * Nobody touches the super admin. Nobody grants a tier at or above their own,
 * which is what stops an admin minting a peer or a second super admin. The
 * database refuses all of this too; this is so the interface does not offer
 * what the database would reject.
 */
export function canEditUser(actorTier: string, targetTier: string): boolean {
  if (!isAdminOrAbove(actorTier)) return false;
  if (isSuperAdmin(targetTier)) return false;
  return true;
}

/** The tiers `actor` may assign to somebody else. Never super_admin, ever. */
export function assignableTiers(actorTier: string): Tier[] {
  if (!isAdminOrAbove(actorTier)) return [];
  return TIERS.filter((t) => t !== "super_admin" && rankOf(t) <= rankOf(actorTier));
}
