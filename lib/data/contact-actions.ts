"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Naming who at the client answers.
 *
 * Ordinary staff writes: authenticated client, row level security decides, the
 * audit trigger reads auth.uid(). Nothing here needs the database-function
 * treatment the client-facing routes need, because here there is a signed-in
 * person to attribute the write to.
 */

export type ContactResult = { ok: true } | { ok: false; message: string };

const DENIED = "That did not save. You may no longer have access to this programme.";

/**
 * Deliberately permissive. The point is to reject what obviously cannot be an
 * address, not to adjudicate the grammar of email — a real address that a
 * clever pattern rejects is a client who never gets asked anything.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function addClientContact(
  programmeId: string,
  name: string,
  email: string,
): Promise<ContactResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedName) return { ok: false, message: "Give the contact a name." };
  if (!looksLikeEmail(trimmedEmail)) {
    return { ok: false, message: "That does not look like an email address." };
  }

  const supabase = await createClient();

  // organisation_id is not asked for: the composite foreign key requires it to
  // match the programme's, so it is read from the programme rather than typed.
  const { data: programme } = await supabase
    .from("programs")
    .select("organisation_id")
    .eq("id", programmeId)
    .maybeSingle();

  if (!programme) return { ok: false, message: DENIED };

  const { data: existing } = await supabase
    .from("client_contacts")
    .select("id, active")
    .eq("program_id", programmeId)
    .eq("email", trimmedEmail)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      message: existing.active
        ? "That address is already a contact on this programme."
        : "That address is already a contact, currently inactive. Reactivate it instead.",
    };
  }

  const { data, error } = await supabase
    .from("client_contacts")
    .insert({
      program_id: programmeId,
      organisation_id: programme.organisation_id,
      name: trimmedName,
      email: trimmedEmail,
    })
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

/**
 * Deactivating rather than deleting.
 *
 * An inactive contact can request no link and answer nothing, but the answers
 * they already gave keep naming them. Deleting the row would cascade those
 * away, and an answer whose author has vanished is worse than one whose author
 * has left.
 */
export async function setClientContactActive(
  programmeId: string,
  contactId: string,
  active: boolean,
): Promise<ContactResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_contacts")
    .update({ active })
    .eq("id", contactId)
    .eq("program_id", programmeId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}

export async function renameClientContact(
  programmeId: string,
  contactId: string,
  name: string,
): Promise<ContactResult> {
  const session = await getSession();
  if (session.state !== "ok") return { ok: false, message: "Not signed in." };

  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "A contact needs a name." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_contacts")
    .update({ name: trimmed })
    .eq("id", contactId)
    .eq("program_id", programmeId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) return { ok: false, message: DENIED };

  revalidatePath(`/programs/${programmeId}`);
  return { ok: true };
}
