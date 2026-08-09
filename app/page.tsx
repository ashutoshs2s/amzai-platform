import { SUPABASE_URL, supabasePublicEnvIsSet } from "@/lib/env";
import { serviceRoleKeyIsSet } from "@/lib/supabase/admin";

// Read the environment at request time rather than at build time, so this page
// tells the truth about the machine it is running on.
export const dynamic = "force-dynamic";

/**
 * Placeholder home page.
 *
 * Its only job is to confirm the scaffold runs and the environment variables
 * are wired up. It is not designed, because the design system does not exist
 * yet. It gets replaced by the app shell in DESIGN.md section 4.
 */
export default function Home() {
  const publicEnvSet = supabasePublicEnvIsSet();
  const serviceKeySet = serviceRoleKeyIsSet();

  // Show the host only, never the key. A URL is not a secret; the keys are.
  let supabaseHost = "not set";
  if (SUPABASE_URL) {
    try {
      supabaseHost = new URL(SUPABASE_URL).host;
    } catch {
      supabaseHost = "set, but not a valid URL";
    }
  }

  const checks = [
    {
      label: "NEXT_PUBLIC_SUPABASE_URL",
      ok: Boolean(SUPABASE_URL),
      detail: supabaseHost,
    },
    {
      label: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ok: publicEnvSet,
      detail: publicEnvSet ? "set" : "not set",
    },
    {
      label: "SUPABASE_SERVICE_ROLE_KEY",
      ok: serviceKeySet,
      detail: serviceKeySet ? "set, server-side only" : "not set",
    },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">Amzai Operations</h1>
      <p className="mt-2 text-sm text-gray-600">
        Scaffold is running. No design system, no app shell and no database
        tables yet.
      </p>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Environment
      </h2>
      <ul className="mt-3 divide-y divide-gray-200 border-y border-gray-200">
        {checks.map((check) => (
          <li
            key={check.label}
            className="flex items-baseline justify-between gap-4 py-2 text-sm"
          >
            <span className="font-mono text-xs">{check.label}</span>
            <span className={check.ok ? "text-green-700" : "text-red-700"}>
              {check.detail}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-gray-500">
        Values are never shown here, only whether each one is present. If any
        line reads &ldquo;not set&rdquo;, copy <code>.env.example</code> to{" "}
        <code>.env.local</code>, fill it in, and restart the dev server.
      </p>
    </main>
  );
}
