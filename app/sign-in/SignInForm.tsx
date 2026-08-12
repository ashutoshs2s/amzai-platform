"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/Button";
import { Field, TextInput } from "@/components/form/Field";
import { createClient } from "@/lib/supabase/client";

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      /*
        Deliberately not "no account with that email". Confirming which half of
        a credential pair was wrong tells an attacker which addresses are real.
        The same rule the client onboarding form follows, SPEC.md section 6.2.
      */
      setError("That email and password do not match an account.");
      setBusy(false);
      return;
    }

    // The session lives in cookies, and the server components have already
    // rendered without it. Refresh so they re-run with the new identity.
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <Field label="Email" htmlFor={emailId}>
        <TextInput
          id={emailId}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Password" htmlFor={passwordId} error={error ?? undefined}>
        <TextInput
          id={passwordId}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          invalid={error !== null}
        />
      </Field>

      <Button type="submit" variant="primary" disabled={busy} className="w-full">
        {busy ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
