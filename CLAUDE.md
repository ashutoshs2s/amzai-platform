# CLAUDE.md

## Read first, every session

- `SPEC.md` for what this product is and the data model.
- `DESIGN.md` for the design system. Follow it for any interface work.

Read both before building or changing anything.

## What this is

An internal operations platform for Amzai and BuyerForesight, a B2B executive events and demand generation business. Five to fifteen internal operators use it daily. Clients do not have accounts and never log in.

Stack: Next.js with TypeScript, Tailwind, Supabase Postgres, deployed on Cloudflare.

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
4. **Never modify `audit_events` or its trigger** except to extend coverage to new tables. It is append-only by design.
5. **No client-facing authentication.** The client dashboard is a token URL, served without login. Do not add client accounts.
6. **Commit after every working step**, with a message describing what changed.
7. **Do not install a dependency without saying what it is for.** Prefer no dependency.

## Working conventions

- One module at a time. Finish and verify before starting the next.
- Shared components live in `/components`. Do not write one-off markup for something that already exists as a component.
- Every table gets an `updated_at` trigger and an audit trigger.
- Write migrations that can run twice without breaking.
- When something is uncertain, say so rather than picking silently.

## When asked to review

Compare what exists against `SPEC.md` and `DESIGN.md` section by section. List every deviation, including anything from DESIGN.md section 8 that has crept in. Fix each and report what changed.
