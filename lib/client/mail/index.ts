import "server-only";

import { consoleMailer } from "./console";
import { smtpMailer } from "./smtp";
import type { Mailer, SendResult } from "./types";

export type { Mailer, Message, SendResult } from "./types";

/**
 * Which provider sends the mail.
 *
 * MAIL_TRANSPORT picks one. Adding SES, or an HTTP provider, means one more
 * file satisfying Mailer and one more case here — no caller changes, because
 * no caller knows which one it got.
 *
 * Unset, or configured incompletely, means nothing is sent. That is deliberate:
 * the link is issued in the database either way, so the flow can be built and
 * walked through before a provider exists, and a half-configured environment
 * fails visibly at the send rather than invisibly at the link.
 */
export function getMailer(): Mailer | null {
  switch (process.env.MAIL_TRANSPORT) {
    case "smtp":
      return smtpMailer();
    case "console":
      return consoleMailer();
    default:
      return null;
  }
}

/** For /health: what is configured, never a credential. */
export function mailerName(): string {
  return getMailer()?.name ?? "none";
}

/**
 * The one email this product sends.
 *
 * Plain text, no HTML, no tracking pixel, no unsubscribe footer. This is a
 * transactional message somebody asked for seconds ago; anything else in it
 * makes it look more like the phishing it already resembles — an unexpected
 * link asking you to click.
 */
export async function sendOnboardingLink(input: {
  to: string;
  programmeName: string;
  organisationName: string;
  url: string;
  expiresInMinutes: number;
}): Promise<SendResult> {
  const mailer = getMailer();
  if (!mailer) return { sent: false, reason: "not_configured" };

  return mailer.send({
    to: input.to,
    subject: `Your link to complete onboarding for ${input.programmeName}`,
    text: [
      `You asked for a link to complete onboarding for ${input.programmeName}.`,
      ``,
      input.url,
      ``,
      `The link works once and expires in ${input.expiresInMinutes} minutes.`,
      `If you did not ask for it, nothing has happened and you can ignore this.`,
      ``,
      `Amzai, for ${input.organisationName}`,
    ].join("\n"),
  });
}
