/**
 * One small interface, so the provider is a config change rather than a code
 * change.
 *
 * Everything above this line composes a message; everything below it moves
 * bytes. Swapping SMTP for SES, or for an HTTP API, means adding one file that
 * satisfies `Mailer` and changing MAIL_TRANSPORT — no caller is touched.
 */

export type Message = {
  to: string;
  subject: string;
  /** Plain text only. See lib/client/mail/index.ts for why. */
  text: string;
};

/**
 * Never throws, and never carries a provider's response body.
 *
 * A failure here must not fail the request that caused it: by the time this is
 * called the link is already issued, and refusing the request would tell a
 * visitor something about their address that the neutral response exists to
 * hide. So the caller is told what happened and decides nothing differently.
 *
 * `detail` is for an operator reading a log. It carries a status or an error
 * name and never the provider's message text, because a provider that echoes
 * the request back echoes the link with it. CLAUDE.md rule 7.
 */
export type SendResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "failed"; detail?: string };

export interface Mailer {
  /** What this is, for the health screen. Never includes a credential. */
  readonly name: string;
  send(message: Message): Promise<SendResult>;
}
