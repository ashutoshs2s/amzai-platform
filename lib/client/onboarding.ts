import "server-only";

import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/client/token";

/**
 * What a verified client sees, and how their answers are saved.
 *
 * Everything here runs under the service role, because a client has no database
 * identity at all. The session token is the entire access control, so every
 * function starts by proving it — and each one passes the programme from the
 * URL alongside, so the database can refuse a session issued for another.
 */

export const SESSION_COOKIE = "amzai_client_session";

export type ClientQuestion = {
  id: string;
  section: string;
  question: string;
  guidance: string | null;
  response: string;
  status: string;
  isGeneric: boolean;
};

export type ClientView = {
  contactName: string;
  programmeName: string;
  organisationName: string;
  sections: { section: string; questions: ClientQuestion[] }[];
  answered: number;
  total: number;
};

/** The session token as the browser holds it. Null when there is none. */
export async function sessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * The programme behind a pair of slugs, or null.
 *
 * The organisation slug is checked rather than trusted: /a/b and /c/b must not
 * reach the same programme just because the second slug matched.
 */
export async function findProgramme(organisationSlug: string, programmeSlug: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("programs")
    .select("id, name, organisation:organisations ( name, slug )")
    .eq("slug", programmeSlug)
    .maybeSingle();

  const organisation = data?.organisation as unknown as
    | { name: string; slug: string }
    | null;

  if (!data || organisation?.slug !== organisationSlug) return null;
  return { id: data.id, name: data.name, organisationName: organisation.name };
}

/**
 * Everything the onboarding page renders, or null if the session does not hold.
 *
 * The questions come from client_onboarding_questions, a view whose column list
 * is the mechanism: an Amzai-owned question is not filtered out here, it is
 * absent, and no edit to this file could widen it.
 */
export async function loadClientView(
  organisationSlug: string,
  programmeSlug: string,
): Promise<ClientView | null> {
  const token = await sessionToken();
  if (!token) return null;

  const programme = await findProgramme(organisationSlug, programmeSlug);
  if (!programme) return null;

  const db = createAdminClient();
  const { data: contactId } = await db.rpc("client_session_contact", {
    p_session_token_hash: hashToken(token),
    p_program_id: programme.id,
  });
  if (!contactId) return null;

  const [{ data: contact }, { data: questions }] = await Promise.all([
    db.from("client_contacts").select("name").eq("id", contactId).maybeSingle(),
    db
      .from("client_onboarding_questions")
      .select("id, section, sort_order, question, guidance, response, status, is_generic")
      .eq("program_id", programme.id)
      .order("sort_order"),
  ]);

  const sections = new Map<string, ClientQuestion[]>();
  for (const row of questions ?? []) {
    const entry: ClientQuestion = {
      id: row.id,
      section: row.section,
      question: row.question,
      guidance: row.guidance,
      response: row.response ?? "",
      status: row.status,
      isGeneric: row.is_generic,
    };
    sections.set(row.section, [...(sections.get(row.section) ?? []), entry]);
  }

  const all = [...sections.values()].flat();

  return {
    contactName: contact?.name ?? "",
    programmeName: programme.name,
    organisationName: programme.organisationName,
    sections: [...sections.entries()].map(([section, list]) => ({ section, questions: list })),
    answered: all.filter((q) => q.response.trim() !== "").length,
    total: all.length,
  };
}
