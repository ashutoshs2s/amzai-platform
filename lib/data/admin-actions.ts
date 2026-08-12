"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import { assignableTiers, canEditUser, isAdminOrAbove } from "@/lib/tiers";

/**
 * Changing somebody's tier, functions and organisations.
 *
 * Every check here is made twice: once so the interface does not offer what
 * would be refused, and once in the database, which is what actually holds. The
 * super admin is protected by a trigger that no caller can get past, including
 * the service role and the table owner.
 */

export type AdminResult = { ok: true } | { ok: false; message: string };

const REFUSED = "That change was refused. You may not have the privileges for it.";

/** Who the actor is, and whether they may act on this target at all. */
type Gate =
  | { ok: false; message: string }
  | {
      ok: true;
      actorTier: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
      target: { id: string; tier: string };
    };

async function gate(targetUserId: string): Promise<Gate> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };
  if (!isAdminOrAbove(session.staff.tier)) {
    return { ok: false, message: "Only an admin can manage staff." };
  }

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("users")
    .select("id, tier")
    .eq("id", targetUserId)
    .maybeSingle();

  if (!target) return { ok: false, message: "That person does not exist." };
  if (!canEditUser(session.staff.tier, target.tier)) {
    return { ok: false, message: "The super admin cannot be changed from here." };
  }
  return { ok: true, actorTier: session.staff.tier, supabase, target };
}

export async function setUserTier(userId: string, tier: string): Promise<AdminResult> {
  const gated = await gate(userId);
  if (!gated.ok) return gated;

  // Nobody grants a tier at or above their own, and super_admin is never on the
  // list for anyone. The database refuses it too.
  if (!assignableTiers(gated.actorTier).includes(tier as never)) {
    return { ok: false, message: "You cannot give somebody that tier." };
  }

  const { data, error } = await gated.supabase
    .from("users")
    .update({ tier })
    .eq("id", userId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: REFUSED };

  revalidatePath("/admin");
  return { ok: true };
}

export async function setUserActive(userId: string, active: boolean): Promise<AdminResult> {
  const gated = await gate(userId);
  if (!gated.ok) return gated;

  const { data, error } = await gated.supabase
    .from("users")
    .update({ active })
    .eq("id", userId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: REFUSED };

  revalidatePath("/admin");
  return { ok: true };
}

export async function setUserFunction(
  userId: string,
  functionSlug: string,
  held: boolean,
): Promise<AdminResult> {
  const gated = await gate(userId);
  if (!gated.ok) return gated;

  const { data: fn } = await gated.supabase
    .from("staff_functions")
    .select("id")
    .eq("slug", functionSlug)
    .maybeSingle();
  if (!fn) return { ok: false, message: "There is no such function." };

  const { error } = held
    ? await gated.supabase
        .from("user_staff_functions")
        .upsert({ user_id: userId, function_id: fn.id }, { onConflict: "user_id,function_id" })
    : await gated.supabase
        .from("user_staff_functions")
        .delete()
        .eq("user_id", userId)
        .eq("function_id", fn.id);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function setManagedOrganisation(
  userId: string,
  organisationId: string,
  held: boolean,
): Promise<AdminResult> {
  const gated = await gate(userId);
  if (!gated.ok) return gated;

  const { error } = held
    ? await gated.supabase
        .from("organisation_managers")
        .upsert(
          { user_id: userId, organisation_id: organisationId },
          { onConflict: "user_id,organisation_id" },
        )
    : await gated.supabase
        .from("organisation_managers")
        .delete()
        .eq("user_id", userId)
        .eq("organisation_id", organisationId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
