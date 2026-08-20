/**
 * The two rules that must hold whatever provider is in use.
 *
 * Deliberately free of `server-only` and of any provider import, so the tests
 * exercise these exact functions rather than a copy of them. A copy would drift,
 * and both of these fail silently when they drift.
 */

/**
 * What escapes when a send fails: a code, never the provider's own text.
 *
 * An SMTP rejection can quote the message it rejected, and the message contains
 * the link. This is the line that keeps a token out of a log. CLAUDE.md rule 7.
 */
export function sendFailureDetail(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown";
  return `SMTP error ${code}`;
}

/**
 * The console transport prints the link on purpose, which is what makes it
 * useful in development and unacceptable anywhere else. This refuses rather
 * than trusting somebody to remember: one wrong environment variable would
 * otherwise write live tokens into a log file.
 */
export function assertNotProduction(nodeEnv: string | undefined): void {
  if (nodeEnv === "production") {
    throw new Error(
      "MAIL_TRANSPORT=console prints tokens and must never run in production. Set MAIL_TRANSPORT=smtp.",
    );
  }
}

/** Whether SMTP has everything it needs. Missing anything means no mailer. */
export function smtpIsConfigured(env: {
  SMTP_HOST?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM?: string;
}): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.MAIL_FROM);
}
