import { SignInForm } from "./SignInForm";

/**
 * Staff sign-in.
 *
 * The only screen outside the app shell that is part of the product. It has no
 * rail and no top bar because there is nothing yet to navigate: until this
 * succeeds, every module reads as empty.
 *
 * SPEC.md section 1: staff only, on app.amzai.events, behind Cloudflare Access
 * in production. This is the second lock rather than the only one.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/programs";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-page-title font-semibold">Amzai Operations</h1>
      <p className="mt-1 text-body text-slate">Staff sign-in.</p>
      <SignInForm next={next} />
      <p className="mt-6 text-caption text-slate">
        Accounts are created by an admin. There is no self sign-up, and clients
        never get one.
      </p>
    </main>
  );
}
