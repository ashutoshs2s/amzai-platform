import "server-only";

import { assertNotProduction } from "./guards";
import type { Mailer, Message, SendResult } from "./types";

/**
 * Development only. Prints the message instead of sending it.
 *
 * This exists so the whole flow — request, link, session — can be walked
 * through before any mail provider is set up, which is the difference between
 * a feature you can test today and one you can test after a DNS change.
 *
 * It prints the link, which is a token, and that is exactly what CLAUDE.md rule
 * 7 forbids in a log. So it refuses to exist in production rather than relying
 * on somebody remembering not to select it: a misconfigured environment
 * variable would otherwise write live tokens to a log file.
 */
export function consoleMailer(): Mailer {
  assertNotProduction(process.env.NODE_ENV);

  return {
    name: "console",
    async send(message: Message): Promise<SendResult> {
      console.log(
        [
          "",
          "  ─── development mailer ──────────────────────────────────",
          `  to:      ${message.to}`,
          `  subject: ${message.subject}`,
          "",
          message.text
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n"),
          "  ─────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
      return { sent: true };
    },
  };
}
