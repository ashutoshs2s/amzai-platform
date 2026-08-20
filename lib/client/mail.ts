import "server-only";

/**
 * Sending the one email this product sends.
 *
 * Resend is the only thing that sends an onboarding link (CLAUDE.md). The key
 * is server-side only and has no NEXT_PUBLIC_ prefix, which is what keeps it
 * out of the browser bundle.
 *
 * Absent a key, nothing is sent and the caller is told so. It does NOT throw:
 * the link has already been issued in the database by then, and failing the
 * request would tell the visitor something about their address that the neutral
 * response exists to hide.
 */

export type SendResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "failed"; detail?: string };

const FROM = process.env.RESEND_FROM ?? "Amzai <onboarding@amzai.events>";
const REPLY_TO = process.env.RESEND_REPLY_TO;

export async function sendOnboardingLink(input: {
  to: string;
  programmeName: string;
  organisationName: string;
  url: string;
  expiresInMinutes: number;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "not_configured" };

  /*
    The link is the whole email. No tracking pixel, no marketing footer, no
    unsubscribe: this is a transactional message somebody asked for seconds
    ago, and anything else in it makes it look like the phishing it resembles.
  */
  const text = [
    `You asked for a link to complete onboarding for ${input.programmeName}.`,
    ``,
    input.url,
    ``,
    `The link works once and expires in ${input.expiresInMinutes} minutes.`,
    `If you did not ask for it, nothing has happened and you can ignore this.`,
    ``,
    `Amzai, for ${input.organisationName}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [input.to],
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        subject: `Your link to complete onboarding for ${input.programmeName}`,
        text,
      }),
    });

    if (!response.ok) {
      /*
        The status, never the body. A provider error can echo the request back,
        and the request contains the link. CLAUDE.md rule 7: never put a token
        in a log or an error message.
      */
      return { sent: false, reason: "failed", detail: `Resend returned ${response.status}` };
    }
    return { sent: true };
  } catch {
    return { sent: false, reason: "failed", detail: "Could not reach Resend" };
  }
}
