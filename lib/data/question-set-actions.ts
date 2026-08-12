"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/data/session";
import { isAdminOrAbove } from "@/lib/tiers";
import { createClient } from "@/lib/supabase/server";

/**
 * Retuning who owns a question.
 *
 * The only thing about a template field that can be changed after import, and
 * the database enforces that rather than trusting this file: a trigger on
 * onboarding_template_fields refuses every other column.
 *
 * It changes what FUTURE programmes generate. A generated response holds its own
 * copy of `owner`, so a live programme is untouched, which is the same line
 * SPEC.md 4.1a draws everywhere else.
 */

export type OwnerResult = { ok: true } | { ok: false; message: string };

const OWNERS = ["client", "amzai", "both"];

export async function setFieldOwner(
  fieldId: string,
  owner: string,
): Promise<OwnerResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  // Reference data the whole product depends on. SPEC.md section 3.
  if (!isAdminOrAbove(session.staff.tier)) {
    return { ok: false, message: "Only an admin can change question ownership." };
  }
  if (!OWNERS.includes(owner)) {
    return { ok: false, message: "That is not an owner." };
  }

  const supabase = await createClient();

  /*
    Stamping who decided is what tells the importer to leave this alone. Without
    it the next import would quietly reset the judgement back to its default.
  */
  const { data, error } = await supabase
    .from("onboarding_template_fields")
    .update({
      default_owner: owner,
      default_owner_set_by: session.staff.id,
      default_owner_set_at: new Date().toISOString(),
    })
    .eq("id", fieldId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "That did not save. The question may no longer exist." };
  }

  revalidatePath("/question-sets", "layout");
  return { ok: true };
}
