"use server";

import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { clientOrigin } from "@/lib/hosts";
import { sendOnboardingLink } from "@/lib/client/mail";
import { expiryInMinutes, LINK_TTL_MINUTES, newToken } from "@/lib/client/token";

/**
 * Asking for a link. Public, unauthenticated, and deliberately incurious.
 *
 * The database decides everything: whether the address is a contact of that
 * programme, whether the rate limits allow it, and whether a link is issued. It
 * returns the same shape in every case, so this route cannot leak which one
 * happened even by accident. See request_client_link.
 *
 * The plaintext token exists only here and in the email. What crosses to
 * Postgres is its hash, which is what keeps the token out of query logs.
 */

export type LinkRequestResult = { done: true };

/** The same answer for every outcome. There is no second branch on purpose. */
const NEUTRAL: LinkRequestResult = { done: true };

export async function requestOnboardingLink(
  organisationSlug: string,
  programmeSlug: string,
  email: string,
): Promise<LinkRequestResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return NEUTRAL;

  const db = createAdminClient();

  /*
    The programme is resolved here rather than trusted from the URL, and a slug
    that matches nothing still returns the neutral answer. Rule 7: a slug is
    readability, never the security control — and 404ing an unknown slug would
    turn this page into a directory of which programmes exist.
  */
  const { data: programme } = await db
    .from("programs")
    .select("id, name, organisation:organisations ( name, slug )")
    .eq("slug", programmeSlug)
    .maybeSingle();

  const organisation = programme?.organisation as unknown as
    | { name: string; slug: string }
    | null;

  if (!programme || organisation?.slug !== organisationSlug) return NEUTRAL;

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : null;

  const link = newToken();

  const { data } = await db.rpc("request_client_link", {
    p_program_id: programme.id,
    p_email: trimmed,
    p_token_hash: link.hash,
    p_expires_at: expiryInMinutes(LINK_TTL_MINUTES),
    p_request_ip: ip,
  });

  // Not issued means the address is not a contact, or the limits are spent.
  // Which one, this code never learns.
  if (!data || data.issued !== true) return NEUTRAL;

  const sent = await sendOnboardingLink({
    to: trimmed,
    programmeName: programme.name,
    organisationName: organisation.name,
    url: `${clientOrigin()}/${organisationSlug}/${programmeSlug}/verify?t=${link.token}`,
    expiresInMinutes: LINK_TTL_MINUTES,
  });

  /*
    Recorded against the link, because the row existing is not the same as the
    email arriving. Without this the Contacts tab reads "Link sent" for a send
    that failed, the client waits for something that never left, and Amzai
    believes it did — with nothing anywhere reading as broken.

    The detail is whatever the mail layer produced, which is a code and never a
    provider body; the database caps it again regardless.
  */
  await db.rpc("record_client_link_send", {
    p_token_hash: link.hash,
    p_status: sent.sent ? "sent" : sent.reason === "not_configured" ? "not_configured" : "failed",
    p_detail: sent.sent ? null : (sent.detail ?? null),
  });

  return NEUTRAL;
}
