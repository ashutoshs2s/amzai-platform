"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/client/token";
import { findProgramme, sessionToken } from "@/lib/client/onboarding";

/**
 * A client saving an answer.
 *
 * The route says which response and what the answer is. It does not say who is
 * answering, because it cannot be trusted to: identity is derived inside
 * client_answer_question from the session token, in the same transaction that
 * writes the row, so the audit trail names the contact rather than 'system'.
 */

export type AnswerResult = { ok: true } | { ok: false; message: string };

const LOST = "Your link has expired. Ask for a new one and your answers will still be here.";

export async function saveClientAnswer(
  organisationSlug: string,
  programmeSlug: string,
  responseId: string,
  answer: string,
): Promise<AnswerResult> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: LOST };

  const programme = await findProgramme(organisationSlug, programmeSlug);
  if (!programme) return { ok: false, message: LOST };

  const db = createAdminClient();
  const { data, error } = await db.rpc("client_answer_question", {
    p_session_token_hash: hashToken(token),
    p_program_id: programme.id,
    p_response_id: responseId,
    p_answer: answer,
  });

  if (error) return { ok: false, message: "That did not save. Try again." };
  if (!data || data.ok !== true) {
    // no_session or not_yours. The client is told the same thing either way:
    // which one it was is not their business and not their fault.
    return { ok: false, message: LOST };
  }

  return { ok: true };
}
