"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
      className="rounded-base text-body text-slate underline underline-offset-2 hover:text-ink"
    >
      Sign out
    </button>
  );
}
