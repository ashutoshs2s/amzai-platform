/**
 * The mailer interface. npm run test-mail
 *
 * Two properties worth pinning, both of which fail quietly:
 *
 *   A failure never carries the provider's response body. An SMTP rejection can
 *   quote the message it rejected, and the message contains the link.
 *
 *   The console transport cannot run in production. It prints the link on
 *   purpose, so the only thing standing between that and live tokens in a log
 *   file is this refusal.
 */

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });

/* -------------------------------------------------------------------------- */
/* A failure carries a code, never a body                                     */
/* -------------------------------------------------------------------------- */

import {
  assertNotProduction,
  sendFailureDetail,
  smtpIsConfigured,
} from "../lib/client/mail/guards.ts";

const link = "https://client.amzai.events/acme/summit/verify?t=SECRET-TOKEN-VALUE";

const rejection = Object.assign(
  new Error(`550 rejected: message body was\n${link}\nend of message`),
  { code: "EMESSAGE", response: `550 ... ${link} ...` },
);

const detail = sendFailureDetail(rejection);
check("a failure reports the code", detail === "SMTP error EMESSAGE", detail);
check("and not the provider's message", !detail.includes("rejected"), detail);
check("so the link cannot escape through an error", !detail.includes("SECRET-TOKEN-VALUE"), detail);
check("nor through the response text", !detail.includes(link), detail);

const unknown = sendFailureDetail(new Error(`boom ${link}`));
check("an error with no code still leaks nothing",
  unknown === "SMTP error unknown", unknown);

/* -------------------------------------------------------------------------- */
/* The console transport refuses production                                   */
/* -------------------------------------------------------------------------- */

try {
  assertNotProduction("production");
  check("the console transport refuses to run in production", false, "it was allowed");
} catch (error) {
  check("the console transport refuses to run in production",
    error.message.includes("never run in production"), error.message);
}
check("and is allowed everywhere else", (() => {
  try {
    assertNotProduction("development");
    assertNotProduction(undefined);
    return true;
  } catch {
    return false;
  }
})());

/* -------------------------------------------------------------------------- */
/* Nothing configured sends nothing, and says so                              */
/* -------------------------------------------------------------------------- */

check("smtp with nothing set is not configured", smtpIsConfigured({}) === false);
check("nor with only a host",
  smtpIsConfigured({ SMTP_HOST: "smtp.gmail.com" }) === false);
check("nor with credentials but no from address",
  smtpIsConfigured({
    SMTP_HOST: "smtp.gmail.com", SMTP_USER: "a@b.c", SMTP_PASSWORD: "x",
  }) === false);
check("and configured only when all four are present",
  smtpIsConfigured({
    SMTP_HOST: "smtp.gmail.com", SMTP_USER: "a@b.c",
    SMTP_PASSWORD: "x", MAIL_FROM: "Amzai <a@b.c>",
  }) === true);

console.log("\n  Mailer\n  " + "-".repeat(64));
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "\n        " + r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
