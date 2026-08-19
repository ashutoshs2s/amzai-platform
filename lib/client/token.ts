import { createHash, randomBytes } from "node:crypto";

/**
 * Client access tokens.
 *
 * CLAUDE.md rule 7: a token is a bearer secret. Hashed at rest wherever it does
 * not need re-sending, never written to a log, never put in an error message.
 *
 * The hashing happens HERE rather than in the database, and that is the whole
 * point: the plaintext token never crosses the wire to Postgres at all. If a
 * function took the token and hashed it in SQL, the plaintext would appear in
 * the query — and therefore in pg_stat_statements, in any statement logging,
 * and in the text of any error that echoed the statement back. A query log is a
 * log.
 *
 * supabase/tests/client-link.test.mjs asserts exactly this, by running the real
 * flow and then scanning every text column in the database for the plaintext.
 * It is a property one well-meaning refactor can destroy and nobody can see by
 * eye.
 */

/** 32 bytes of randomness. Enough that guessing is not a strategy. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A link is short-lived; a session lasts a working week. */
export const LINK_TTL_MINUTES = 30;
export const SESSION_TTL_DAYS = 7;

export function expiryInMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function expiryInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
