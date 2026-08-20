"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { Field, TextInput } from "@/components/form/Field";
import { requestOnboardingLink } from "@/lib/client/link-actions";

/**
 * The client's way in.
 *
 * One field and one button. DESIGN.md 6.3 and 6.4: this must work on a phone
 * down to 360px, and section 8 bans a login screen, a password field, a
 * "create an account" prompt, and any message telling a visitor their address
 * was not recognised.
 *
 * The confirmation is deliberately the same whatever happened. An address that
 * is not a contact, an address that is, and an address that has asked six times
 * in an hour all read identically — otherwise this page tells anybody who asks
 * exactly who the client's people are.
 */
export function RequestLinkForm({
  organisationSlug,
  programmeSlug,
  programmeName,
}: {
  organisationSlug: string;
  programmeSlug: string;
  programmeName: string | null;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    await requestOnboardingLink(organisationSlug, programmeSlug, email);
    setBusy(false);
    setDone(true);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col justify-center px-6 py-12">
      <span className="text-body font-semibold tracking-[0.04em] text-ink">AMZAI</span>

      {done ? (
        <>
          <h1 className="mt-6 text-page-title font-semibold text-ink">Check your email</h1>
          <p className="mt-3 text-body text-slate">
            If that address is on the list for this programme, a link is on its way. It
            works once and expires in 30 minutes.
          </p>
          <p className="mt-3 text-body text-slate">
            Nothing arrived? Ask your Amzai contact to add the address you use.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-page-title font-semibold text-ink">
            {programmeName ? `Onboarding for ${programmeName}` : "Onboarding"}
          </h1>
          <p className="mt-3 text-body text-slate">
            Enter the email address Amzai has for you and we will send you a link. There is
            no password and no account to create.
          </p>

          <form
            className="mt-6 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) submit();
            }}
          >
            <Field label="Your email address" required>
              <TextInput
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Button type="submit" variant="primary" disabled={busy || email.trim() === ""}>
              {busy ? "Sending…" : "Send me a link"}
            </Button>
          </form>
        </>
      )}
    </main>
  );
}
