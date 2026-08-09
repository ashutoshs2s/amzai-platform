# CLAUDE.md

## Read first, every session

- `SPEC.md` for what this product is and the data model.
- `DESIGN.md` for the design system. Follow it for any interface work.

Read both before building or changing anything.

## What this is

An internal operations platform for Amzai and BuyerForesight, a B2B executive events and demand generation business. Five to fifteen internal operators use it daily. Clients do not have accounts and never log in.

Stack: Next.js with TypeScript, Tailwind, Supabase Postgres, deployed on Cloudflare.

Two domains:

- `app.amzai.events` — the internal system, behind Cloudflare Access. Staff only.
- `client.amzai.events` — every client-facing surface. No Cloudflare Access, no login. Currently the programme dashboard and the client onboarding form.

## Who you are working with

The person building this is not a developer. They run the business. They can read code with effort but cannot debug it unaided.

- Explain what you did in plain English after every step, before moving on.
- Say when something is risky or irreversible before doing it, not after.
- If a request is ambiguous, ask rather than assume.
- Never say a step worked without having verified it. Run it.

## Hard rules

1. **Never create or alter database tables outside a migration file.** All schema changes are SQL migrations in `/supabase/migrations`, committed to the repo.
2. **Never put the Supabase service role key, the Anthropic API key, or any secret in client-side code.** Server-side only, from environment variables. `.env` stays in `.gitignore`.
3. **Row level security stays enabled on every table.** Do not disable it to make something work. If a query fails, fix the policy.
4. **Never modify `audit_events` or its trigger** except to extend coverage to new tables or new actor types. It is append-only by design.
5. **Clients never get an account.** No Supabase Auth user, no password, no login, ever. Client-facing surfaces are reached by token URL. The onboarding form additionally uses an email-verified session: the client proves control of an email address Amzai has already recorded as a client contact for that programme, and follows a one-time link. That session is ours, held in our own tables, scoped to one programme. It is not Supabase Auth and it creates no account. Do not "simplify" it by reaching for Supabase Auth.
6. **Client-facing surfaces live only on `client.amzai.events`; internal screens live only on `app.amzai.events`.** Never render an internal screen on the client domain. Never put Cloudflare Access in front of the client domain — clients cannot authenticate to it.
7. **Slugs are readability. Tokens are security.** Never gate access on a slug being hard to guess. Every token is a bearer secret: hash it at rest wherever it does not need re-sending, never write one to a log, never put one in an error message.
8. **Commit after every working step**, with a message describing what changed.
9. **Do not install a dependency without saying what it is for.** Prefer no dependency.

## Working conventions

- One module at a time. Finish and verify before starting the next.
- Shared components live in `/components`. Do not write one-off markup for something that already exists as a component.
- Every table gets an `updated_at` trigger and an audit trigger. The two exceptions are `audit_events` itself, which is append-only and would recurse, and the short-lived token tables, which are covered by explicit audit writes instead.
- Write migrations that can run twice without breaking.
- Client-facing surfaces use the same tokens and components as the internal app but follow DESIGN.md section 6.3 and 6.4, not section 5 density rules. They must work on a phone.
- When something is uncertain, say so rather than picking silently.

## When asked to review

Compare what exists against `SPEC.md` and `DESIGN.md` section by section. List every deviation, including anything from DESIGN.md section 8 that has crept in. Fix each and report what changed.
