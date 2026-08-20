# HANDOVER.md

Where this project actually stands, written for somebody picking it up cold —
including whoever wrote it, a month from now.

Read `CLAUDE.md`, `SPEC.md` and `DESIGN.md` first. This file does not repeat
them. It says what is finished, what is half-finished, what was left out on
purpose, and what is known to be wrong.

**One rule for reading this file:** "verified" and "built" are different words
here, and the difference is deliberate. Verified means something ran and
asserted it. Built means the code exists and compiles.

---

## 1. What this is

An internal operations platform for Amzai, a B2B executive events and demand
generation business. Five to fifteen internal operators use it daily. Clients
never get an account and never log in.

Two hostnames, one Next.js application:

- `app.amzai.events` — the internal system, behind Cloudflare Access
- `client.amzai.events` — every client-facing surface, no login, reached by token

Locally both are the same `npm run dev`: `localhost:3000` is the internal app
and `client.localhost:3000` is the client surface. Browsers resolve anything
under `.localhost` to 127.0.0.1 with no hosts file and no configuration.

---

## 2. Built and verified

Verified means a test suite asserts it, against real Postgres where the claim is
about the database. `npm test` runs everything: **443 checks across thirteen
suites**, all passing at the time of writing.

| Suite | Checks | What it proves |
|---|---|---|
| `test-slug` | 21 | Slug derivation, and that the result satisfies the database's format constraint |
| `test-generation` | 37 | The resolver: which question sets a programme gets, and why |
| `test-import` | 22 | Importing the same workbook twice writes nothing |
| `test-mail` | 11 | A send failure never carries a provider body; the console transport refuses production |
| `test-routes` | 15 | Route *shape* — see the caveat in section 6 |
| `migrations` | 48 | Every migration applies twice; schema, append-only rules, borrowed sets |
| `tiers` | 47 | Every privilege tier sees exactly what it should, including the union rule |
| `generation` | 25 | The generation commit transaction, and the freeze afterwards |
| `clients` | 25 | The create-client transaction, and the derived programme leads |
| `responses` | 29 | Status, due date, bulk reassign, and what the blocking bar derives from |
| `client-link` | 59 | The magic-link flow end to end, including the plaintext-token property |
| `tasks` | 42 | Approval creates work; a changed answer flags it rather than rewriting |
| `sql-suite` | 42 | Runs `test_privilege_tiers.sql`, the file you paste into the SQL editor |

### The parts worth knowing about

**Onboarding generation is resolved from rows, not code.** `lib/generation/resolve.ts`
is handed every question set in the database plus four facts — client type,
sub-segment, programme type, chosen situational modules — and decides. It names
no client and no sheet. Adding a sub-segment or importing a new workbook changes
what future programmes generate with no deploy.

**A generated set is frozen, and that is enforced rather than intended.**
`onboarding_template_fields` is append-only apart from `default_owner`; a
template version is immutable apart from its `active` flag. A later import
cannot reword a question on a live programme.

**Four privilege tiers plus orthogonal functions.** `super_admin > admin >
manager > user` decides how many programmes somebody sees; a *function*
(`data_ops` today, `finance` designed for) decides which tables and columns they
may touch. A third axis, `program_assignments.role_on_program`, is the job they
do on one programme. Conflating any two of those was the original bug.

**The union rule** — promoting somebody never removes access they already had —
is asserted in both the JS and SQL suites, in both directions, and was verified
by deliberately breaking the policy to confirm the test fails loudly.

**The client link flow.** Rate limited in the database (five per address per
hour, twenty per IP per hour) beside a neutral response, so a fast route cannot
skip either. The plaintext token never reaches Postgres — asserted by running
the real flow and then searching every text column in the schema for it.

**Client-facing writes are attributed correctly.** Those routes have no
`auth.uid()`, and `set_actor` is transaction-scoped while each PostgREST call is
its own transaction. So every client write is one database function: identity is
derived from the token *inside* the transaction that writes. Without this the
audit trail would say `system` and nothing would error.

---

## 3. Built but NOT verified in a browser

Everything in this section compiles, typechecks, lints and has database-level
tests where relevant. **None of it has been driven through a browser by its
author**, because doing so needs a staff sign-in.

- `/programs` — the programme list
- `/programs/[id]` — the programme detail, including the Contacts tab
- `/programs/[id]/generate` — the generation preview
- `/clients/new` — the new client flow
- `/question-sets`, `/question-sets/[slug]` — question sets and ownership tuning
- `/admin` — staff, privileges, the privilege trail, archive and delete

The client surfaces on `client.localhost:3000` **were** loaded and confirmed:
the request page renders, an invalid token lands back on the request page with
the right message, and the success destination resolves.

**If you are picking this up, the highest-value hour is signing in and walking
these six screens.** Several bugs found late in this project — a clipped table
column, a run-together label, a page that could not set a cookie — were all
invisible to every test and obvious on sight.

---

## 4. Half-built

**Email sending.** The transport interface (`lib/client/mail`) is done and
tested, with SMTP, a development console transport, and none. What has not
happened is a real send: no Google Workspace account has been created and
`MAIL_TRANSPORT` has never been `smtp` against a real server.

Verified separately: SMTP genuinely works on Cloudflare's runtime. Run against
workerd with this project's own `compatibility_date` and `nodejs_compat` flag,
`cloudflare:sockets`, `node:net` and `nodemailer` all connect to
`smtp.gmail.com:587` and get a greeting. An earlier warning in this repo that
Workers could not do this was inherited from older runtimes and was wrong. The
one thing that local run does not prove is Cloudflare's *edge* egress policy on
port 587 from a deployed Worker.

**The client onboarding page.** Built, with answers saving on blur through
`client_answer_question`. Never loaded with a real session, because that needs
the two pending migrations below.

**Bulk reassign** works and is tested. **Status and due date** persist. The
programme detail's remaining unwired pieces are noted in section 6.

---

## 5. Deliberately out of scope

Not missing — decided against, with reasons.

**No Supabase Auth for clients, ever.** CLAUDE.md rule 5. Clients are reached by
token and an email-verified session held in our own tables. Do not "simplify"
this by reaching for Supabase Auth.

**No notification system.** Nothing emails an operator. Staleness, blocking
items and unassigned work are surfaced on screen. Anything that reaches somebody
not looking at the screen is unbuilt and is a real piece of work.

**No inferred ownership.** The workbook says nothing about who answers a
question, so every question imports as the client's except sections named
`Record`, which are Amzai's. Nothing is guessed from a question's wording.
Ownership is corrected per question at `/question-sets`.

**No tie-breaking, anywhere.** Where two people hold a role, the platform asks
or leaves it null. It never picks by allocation, seniority or order. A wrong
guess about who owns something stays invisible until a deadline is missed.

**No deletion where it would destroy a record.** A programme with generated
onboarding and an organisation with any programme cannot be deleted — enforced
by triggers, so the service role is held to it too. Archive instead.

**Modules 4 to 8** — client dashboards, audience and data ops, campaigns,
commercial, logistics — are listed in the rail and unbuilt. That is intentional:
a module hidden until it exists tells an operator nothing about what is coming.

---

## 6. Known open items

Ordered by how much they will cost if ignored.

### Three migrations are pending

`20260812180000_client_answers`, `20260812190000_link_send_outcome` and
`20260812200000_task_engine` have not been applied. **The client onboarding page
and the Tasks tab will fail until they are.**

```bash
npx supabase db push
```

If you are unsure what has been applied, `supabase migration list` compares
local and remote.

### The tests cannot see PostgREST or the Next runtime

This has bitten twice. The database suites talk SQL directly, so a row level
security policy is proven but an embed inside a `.select()` string is not. And
no test asserts a Next.js runtime rule: a page that set a cookie compiled,
typechecked and linted cleanly, then failed the first time somebody followed a
link.

`npm run test-routes` asserts route *shape* — that verify is a Route Handler and
not a page, that the session cookie keeps its flags — so the same mistake cannot
be made silently again. It does not prove the runtime accepts anything. Only
loading the page does.

### Thirteen workbook questions were lost and recovered

The importer detects section headers by per-sheet colour calibration. Thirteen
rows across AMC, B2B Media and B2B Tech had no fill where their neighbours did,
so they classified as headings and were never asked. The workbook was corrected
(`-5.xlsx`) and the importer now warns when a section reads like a question —
ending in a question mark, or over 80 characters — without changing the
classification. **If a future workbook adds a sheet, read that warning.**

### One-time links and email scanners

Links are single-use GETs. Corporate mail scanners follow links, and one that
follows this one burns it before the client clicks. Not yet mitigated. Watch for
it once real mail is flowing; the usual answer is an interstitial with a POST.

### Unwired on the programme detail

The programme's own status and dates are not editable from the detail screen.
Everything else on it persists.

### The seed creates its own template

`npm run seed` writes a small `seed_b2b_tech_event` question set so a development
machine has something to look at. It is separate from anything the importer
writes and will not collide, but it is not real data.

### Accepted risk, already documented

SPEC 9.1 records the `security_definer_view` finding on the restricted views and
why it is not exploitable. Read it before "fixing" it.

---

## 7. The next module

**Module 3's task engine is built.** Schema, the approval trigger, staleness
handling per SPEC section 8, task template authoring on `/question-sets`, and a
Tasks tab on the programme detail. 42 tests in `supabase/tests/tasks.test.mjs`.

Three decisions were taken and are recorded in SPEC section 8:

- **A trigger, not an explicit step.** Onboarding generation freezes hundreds of
  questions in one act and earns a preview; this is one answer at a time and
  reversible, so it cannot be forgotten instead.
- **It ships empty.** No task template is seeded. Inventing a starter set would
  hand the team work to unpick, so both screens say plainly that no question
  defines work yet and where to write the first ones.
- **"Notify" means surfacing**, in the same language as blocking items. There is
  no notification system and none was invented.

**Still unbuilt in module 3**, and deliberately separate features that happen to
share a module number: the portfolio calendar, attendee tracking, and risk flags
with numeric triggers.

**One known limitation of task templates.** They attach to a template field,
which is a specific question in a specific version of a set. An unchanged sheet
reuses its field rows on re-import, so templates persist. A sheet that genuinely
changes writes new rows, and templates do not follow to them — they would need
re-authoring. Carrying them across a version needs a stable question key and was
deliberately not built. The same limitation applies to hand-set ownership.

**Modules 4 to 8** remain unbuilt and listed in the rail.

## 8. Running it

```bash
npm run dev          # internal app on :3000, client surfaces on client.localhost:3000
npm test             # everything, 443 checks
npm run test-db      # just the database suites
npm run cf:preview   # the real Cloudflare runtime, locally
```

`.env.example` documents every variable and why it exists. Copy it to
`.env.local`. For the client flow without a mail provider, set
`MAIL_TRANSPORT=console` and the whole email prints to your terminal.

`supabase/tests/test_privilege_tiers.sql` is run by hand in the Supabase SQL
editor against the real database, and by `sql-suite.test.mjs` here, so a policy
change breaks it on your machine rather than in production.

### The walkthrough that exercises the most

New client → generation preview → generate → programme detail → add a client
contact → request a link on `client.localhost:3000` → follow it from the
terminal → answer a question. That crosses the create transaction, the resolver
against real question sets, the role resolution step, the freeze, the domain
split, the rate limiter, the token exchange and client attribution.

It has never been done end to end by the author. It needs the two pending
migrations first.
