import "server-only";

import nodemailer from "nodemailer";

import { sendFailureDetail, smtpIsConfigured } from "./guards";
import type { Mailer, Message, SendResult } from "./types";

/**
 * SMTP, via nodemailer.
 *
 * nodemailer is the dependency here and it is used for exactly one thing:
 * speaking SMTP, which Node cannot do on its own. Google Workspace, SES and
 * essentially every provider expose SMTP, which is what makes this the
 * portable choice.
 *
 * Credentials come from the environment and never appear in a log, an error or
 * a health check.
 *
 * On Cloudflare Workers, verified rather than assumed. Run against workerd with
 * this project's own compatibility_date and nodejs_compat flag, all three hold:
 *
 *   cloudflare:sockets connects to smtp.gmail.com:587 and gets the greeting
 *   node:net is present, and connects, which is what nodemailer uses
 *   nodemailer imports and exposes createTransport
 *
 * An earlier comment here warned that Workers could not do this. That was true
 * of older runtimes and is not true of this one. The one thing a local workerd
 * run cannot prove is Cloudflare's edge egress policy on port 587 — the runtime
 * question is settled, the network question needs one deploy.
 */
export function smtpMailer(): Mailer | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.MAIL_FROM;

  if (!smtpIsConfigured({ SMTP_HOST: host, SMTP_USER: user, SMTP_PASSWORD: pass, MAIL_FROM: from })) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT ?? 587);

  /*
    Port 465 is implicit TLS; 587 upgrades with STARTTLS. `secure` distinguishes
    them, and getting it wrong hangs rather than failing, so it is derived from
    the port rather than configured separately.
  */
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return {
    name: `smtp:${host}`,

    async send(message: Message): Promise<SendResult> {
      try {
        await transport.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(process.env.MAIL_REPLY_TO ? { replyTo: process.env.MAIL_REPLY_TO } : {}),
        });
        return { sent: true };
      } catch (error) {
        // A code, never the provider's text. See guards.ts.
        return { sent: false, reason: "failed", detail: sendFailureDetail(error) };
      }
    },
  };
}
