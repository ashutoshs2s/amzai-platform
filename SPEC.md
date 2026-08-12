# SPEC.md
## Amzai Operations Platform

## 1. Product

An internal operating system for Amzai, a B2B executive events and demand generation business. Every client engagement, programme, contact and action lives here.

**Users.** Amzai staff only. Five to fifteen people. Roles: engagement_lead, delivery_lead, specialist, data_ops, admin.

**Clients have no accounts.** No Supabase Auth user, no password, no login, now or ever. Client-facing surfaces are reached by token URL on `client.amzai.events`.

There are two of them:

- The **programme dashboard**, generated per programme, read only, reached by a long-lived access token.
- The **onboarding form**, where a client answers their own onboarding fields. This one is a write surface, so it is protected by an email-verified session on top of the token. The client enters an email address, and if that address is an active client contact on that programme they receive a one-time link valid for 60 minutes. Following it opens the form for that programme only. See section 6.

That session is built in our own tables. It is not Supabase Auth and it creates no account.

**Domains.** `app.amzai.events` is the internal system, behind Cloudflare Access. `client.amzai.events` carries every client-facing surface and is never behind Cloudflare Access.

**Two kinds of work.** Single events run against a fixed date, tracked in T-minus days. Retainers and dedicated teams run against engagement weeks, tracked as W1 to W13 or similar. Both are programmes; only the template and metrics differ.

## 2. Modules

Build in this order. Finish and verify each before starting the next.

1. **Clients and Programs.** The spine. Organisations, programmes, users, assignments. Includes the creation sequence in section 4, which module 2 depends on.
2. **Onboarding.** Templated question sets per programme type and client type. Every field has an owner, due date, status and blocking flag. Completed onboarding generates the task set. Includes the client-completed onboarding form on `client.amzai.events`: Amzai generates a link per programme and emails it to named client contacts, who answer their own fields directly. Answers save as they go and need not be finished in one sitting.
3. **Delivery Operations.** Task engine from templates, portfolio calendar, attendee tracking, risk flags with numeric triggers.
4. **Client Dashboards.** Generated per programme, token URL, no login.
5. **Audience and Data Ops.** Master contact database, engagement history, consent, suppression.
6. **Campaigns.** Two-way sync with Instantly and Smartlead. Execution is external; this platform owns targeting and the record.
7. **Commercial.** Contracts, invoicing, margin.
8. **Logistics.** Venues, vendors, event delivery detail.

An intelligence layer using the Claude API comes last, after modules 1 to 6 hold real data.

## 3. Phase one schema

Build only these tables first.

### organisations
`id` uuid pk · `name` text · `trading_name` text · `slug` text unique not null · `slug_locked_at` timestamptz nullable · `client_type_id` uuid fk client_types not null · `sub_segment_id` uuid fk nullable · `category` text nullable · `status` text (prospect, active, dormant, closed) · `created_at`, `updated_at` timestamptz

**The client taxonomy has three levels, and only the first two are lists.**

| Level | Where it lives | Constrained |
|---|---|---|
| Client type | `client_types` | to the rows in that table |
| Sub-segment | `client_sub_segments` | to the rows for that client type |
| Category | `organisations.category` | not at all |

Both tables are admin editable. Adding a sub-segment is a row, not a deploy, which is why this replaced the previous `vertical` and `sub_vertical` columns: those lived in a check constraint and a TypeScript file, and neither could be changed without shipping code.

`category` is free text and will stay that way. Privileged Access Management sits under Security today; there will be three more like it next quarter, and a migration per category is not a workable way to run a taxonomy.

**Starting values**, which an admin may extend:

- **Law Firms** — not subdivided.
- **B2B Tech** — Artificial Intelligence, Security, Analytics, Data Privacy, Development and DevOps, Collaboration and Productivity, Content Management, Customer Service, Sales Tools, Marketing, Commerce, ERP, Governance Risk and Compliance, Digital Advertising, AR and VR, CAD and PLM, Design, IT Infrastructure, IT Management, HR, Vertical Industry Software, Supply Chain and Logistics, Hosting, B2B Marketplaces, Other.
- **Conference Organizers** — B2B Media, Association, AMC, Trade Show Organizer, Hosted Buyer Organizer, Community Event Organizer.

Belonging is enforced by a composite foreign key on `(sub_segment_id, client_type_id)` rather than a trigger, so a sub-segment from the wrong client type is impossible rather than discouraged. That also enforces the Law Firms rule for free: no sub-segment row carries the Law Firms type, so any value at all is refused.

`slug` is lowercase and hyphenated, generated from `name` on creation and editable afterwards. It appears in every client-facing URL. Once the first client-facing link for any programme of this organisation has been generated, `slug_locked_at` is stamped and the slug can no longer be changed, because links already sent would break. Slugs are readability only and are never an access control.

### client_types
`id` uuid pk · `slug` text unique · `label` text · `sort_order` integer · `active` boolean · `created_at`, `updated_at` timestamptz

### client_sub_segments
`id` uuid pk · `client_type_id` uuid fk · `slug` text · `label` text · `sort_order` integer · `active` boolean · `questions_from_sub_segment_id` uuid fk nullable · `created_at`, `updated_at` timestamptz

`questions_from_sub_segment_id` names another sub-segment whose question set this one borrows, and null means it has its own. It is how a sub-segment the workbook does not cover still generates: an admin repoints one row rather than asking for a code change. A composite foreign key holds the target to the same client type, and a check refuses self-reference. Responses generated through a borrow are marked `is_generic`. See section 4.1.

Unique on (`client_type_id`, `slug`). Staff read both tables; only an admin writes them, because they are reference data the whole product depends on and a wrong edit is expensive.

### users
`id` uuid pk, matches Supabase auth user id · `full_name` text · `email` text · `role` text (engagement_lead, delivery_lead, specialist, data_ops, admin) · `active` boolean · `created_at`, `updated_at` timestamptz

### programs
`id` uuid pk · `organisation_id` uuid fk · `name` text · `slug` text not null · `type` text (event, retainer, dedicated_team, series, research) · `status` text (onboarding, active, paused, complete) · `currency` text · `start_date`, `end_date` date · `fixed_milestone_date` date · `gate_date` date nullable · `onboarding_template_id` uuid fk onboarding_templates nullable · `approver_name`, `approver_email` text · `engagement_lead_id`, `delivery_lead_id` uuid fk users · `dashboard_token` text nullable · `dashboard_token_issued_at` timestamptz nullable · `slug_locked_at` timestamptz nullable · `onboarding_fill_mode` text nullable (amzai, client) · `onboarding_generated_at` timestamptz nullable · `created_at`, `updated_at` timestamptz

`onboarding_generated_at` non-null means the question set is frozen. `onboarding_template_id` predates sets being resolved from several templates and is no longer how the answer is read; `program_onboarding_sources` is.

`fixed_milestone_date` is the date that does not move. Event countdowns calculate from it.

`gate_date` is the point in a retainer after which remaining time is short. It drives the retainer countdown colour. Nullable, because not every programme has one. See section 7.

`delivery_lead_id` is the programme's owner for display purposes. It is the single name in the Owner column on the programme list.

`onboarding_template_id` records which template this programme's onboarding was generated from. Null until generation. Once set it does not change, so a later version of the same template never retroactively alters a programme already under way. See section 4.

`slug` is unique within an organisation, not globally. Same generation, editing and locking rules as the organisation slug.

`dashboard_token` is the long-lived bearer token for the programme dashboard. It is stored in full rather than hashed, because operators need to re-send the same link, so it is a secret at rest: service-role reads only, never sent to any browser except as part of the generated URL, never written to a log. Nullable because a dashboard is only generated when wanted. The dashboard itself is module 4; the column is defined here so the URL shape is settled once.

### program_assignments
`id` uuid pk · `program_id` uuid fk · `user_id` uuid fk · `role_on_program` text (engagement_lead, delivery_lead, specialist, data_ops) · `allocation_percent` integer · `created_at`, `updated_at` timestamptz

`role_on_program` is constrained to those four values. It does not include `admin`, which is a system role rather than a job on a programme.

### program_role_resolutions

One row per role on a programme that needed an admin decision, so the decision is auditable and never asked twice.

`id` uuid pk · `program_id` uuid fk · `role_on_program` text (engagement_lead, delivery_lead, specialist, data_ops) · `user_id` uuid fk users nullable · `resolved_by` uuid fk users · `resolved_at` timestamptz · `created_at`, `updated_at` timestamptz

Unique on (`program_id`, `role_on_program`). One answer per role per programme.

`user_id` null means the admin deliberately chose to leave that role's fields unassigned. That is different from having no row at all, which means the question was never asked. Keep the two distinct: the first is settled, the second is not.

`resolved_by` and `resolved_at` name who decided and when. Every write here also writes an audit row.

### onboarding_templates
`id` uuid pk · `name` text · `slug` text · `kind` text (core, segment, situational) · `source_sheet` text nullable · `content_hash` text nullable · `program_type` text **nullable** · `client_type_id` uuid fk nullable · `sub_segment_id` uuid fk nullable · `version` integer · `active` boolean · `created_at`, `updated_at` timestamptz

One row per workbook sheet per version, unique on `(slug, version)`.

`kind` says how a set is reached, and it is the reason a programme's questions are not one template. A `core` set applies to every programme; a `segment` set is chosen by the taxonomy; a `situational` set is chosen for the programme by hand. See section 4.1.

`program_type` is nullable, meaning any: a core or situational set asks the same questions of an event and a retainer.

`content_hash` is the hash of the sheet as imported. Equal hash means nothing changed, so re-importing writes nothing.

**A version is immutable apart from `active`.** A trigger refuses any other change. Withdrawing a bad version is legitimate; rewriting one is not, because a programme generated from it reads its questions through it.

Both `client_type_id` and `sub_segment_id` are nullable, and null means "applies to anything at this level".

- `client_type_id` null: applies to every client type. The generic template for a programme type.
- `client_type_id` set, `sub_segment_id` null: applies to that whole client type. **One B2B Tech template covers all twenty-five sub-segments**, which is the normal case: the sub-segment is for targeting, not for asking different questions.
- Both set: applies to that sub-segment only. Added sparingly, where the questions genuinely differ, and it takes precedence over the client-type template.

`sub_segment_id` set with `client_type_id` null is meaningless and is rejected by a check constraint: a sub-segment only has meaning inside its client type.

The point of the hierarchy is that adding the twenty-sixth B2B Tech sub-segment should not mean writing a twenty-sixth template. Write one, and specialise only where a real difference in the questions justifies a second.

### onboarding_template_fields
`id` uuid pk · `template_id` uuid fk · `section` text · `sort_order` integer · `question` text · `guidance` text · `default_owner` text (client, amzai, both) · `default_assignee_role` text nullable (engagement_lead, delivery_lead, specialist, data_ops) · `default_offset_type` text (weeks_from_start, days_before_milestone) · `default_offset_value` integer · `blocking` boolean · `duplicate_kind` text nullable (exact, near) · `duplicate_of` text nullable · `created_at`, `updated_at` timestamptz

**Append-only.** A trigger refuses UPDATE, DELETE and TRUNCATE, the same treatment `audit_events` gets and for a related reason: a generated response reads its question text through this table, so editing a row in place would reword a question on every programme ever generated from it. Changing a question means importing a new version.

`duplicate_kind` and `duplicate_of` are what the importer observed when it read the sheet, kept as provenance. They are not what generation acts on; generation resolves duplicates over the set it is actually building. See section 4.1.

The workbook carries two columns, questions and responses, and no owner, deadline or blocking flag. Every imported question therefore takes the same defaults, and nothing is inferred from a question's wording. Tuning them is done in the app against real programmes, because guessing per question would be a heuristic and a wrong owner is invisible until a deadline is missed.

A due date is expressed as an offset, not as a week label, so it resolves to a real date without anyone interpreting it. `weeks_from_start` counts forward from the programme's `start_date`; `days_before_milestone` counts back from `fixed_milestone_date`. Retainers and dedicated teams use the first, events use the second. The offset is resolved into `onboarding_responses.due_date` once, when the response row is created. See section 7.

`default_assignee_role` says which job on the programme this field belongs to, not which person. The person is resolved at generation from `program_assignments`. Same four values as `role_on_program`, and nullable for fields that are nobody's by default. See section 4.

### program_onboarding_sources
`id` uuid pk · `program_id` uuid fk · `template_id` uuid fk · `role` text (core, segment, situational, fallback) · `created_at`, `updated_at` timestamptz

Every template version a generated set was built from, and the part it played. Unique on (`program_id`, `template_id`). This is what makes "why is this question here?" answerable a year later, and what a single `onboarding_template_id` could not express.

### program_situational_modules
`id` uuid pk · `program_id` uuid fk · `module_slug` text · `created_at`, `updated_at` timestamptz

The modules chosen for a programme, held from creation until generation. By slug rather than by template id, because the choice is "ask the New Market Entry questions" and not "ask version 3 of them"; which version answers that is settled at generation. A slug alone is not unique across versions so a foreign key cannot check it, and a trigger does instead — without it a typo would sit in the table looking like a real choice and quietly contribute nothing.

### onboarding_responses
`id` uuid pk · `program_id` uuid fk · `template_field_id` uuid fk · `is_generic` boolean · `response` text · `owner` text (client, amzai, both) · `assignee_id` uuid fk users nullable · `due_date` date · `status` text (not_started, in_progress, submitted, approved, blocked, na) · `blocking` boolean · `answer_source` text (amzai_written, client_written, imported) · `answered_by` uuid fk users nullable · `answered_by_contact_id` uuid fk client_contacts nullable · `answered_at` timestamptz nullable · `tasks_generated` boolean · `created_at`, `updated_at` timestamptz

`is_generic` marks a question borrowed from another sub-segment's set because this one has none of its own. It sits on the response rather than the template field, because the question is not generic in its own set, only in the one it was borrowed into.

`owner` is the party responsible, client or Amzai. `assignee_id` is the individual member of staff responsible, and is what the top bar's awaiting-me count reads. Nullable, because a field can be owned by Amzai without being anyone's job yet. A field with `owner` client normally has no assignee, though one can be set for whoever is chasing it.

Who answered is recorded explicitly rather than inferred. `answer_source` says how the answer arrived. When it is `client_written`, `answered_by_contact_id` names the client contact who submitted it and `answered_by` is null. When it is `amzai_written`, `answered_by` names the staff user and `answered_by_contact_id` is null. At most one of the two is ever populated. `answered_at` is when the answer was last submitted, which is not the same as `updated_at`, since a status change by Amzai also touches the row.

`owner` decides what the client sees on the onboarding form. See section 6.

### client_contacts

The named people at the client who may be sent an onboarding link. Amzai creates these rows. Nothing about them is a login.

`id` uuid pk · `organisation_id` uuid fk · `program_id` uuid fk · `name` text · `email` text · `active` boolean · `created_at`, `updated_at` timestamptz

Unique index on (`program_id`, `lower(email)`). A person working on three programmes has three rows, because access is always scoped to one programme. Setting `active` false immediately stops new links being issued and invalidates any live session.

`organisation_id` is redundant against the programme but kept for readable queries. A check constraint enforces that it matches the organisation of `program_id`, so the two can never drift apart.

These are deliberately separate from `contacts`. `contacts` is the marketable audience database and carries consent and suppression. `client_contacts` are client-side counterparts we work with. Do not merge them, and do not treat a client contact as marketable.

### client_link_requests

One row per one-time onboarding link issued.

`id` uuid pk · `program_id` uuid fk · `client_contact_id` uuid fk · `token_hash` text · `expires_at` timestamptz · `consumed_at` timestamptz nullable · `request_ip` inet nullable · `created_at`, `updated_at` timestamptz

`token_hash` is a SHA-256 of the token. The raw token exists only in the emailed URL and is never stored. `expires_at` is 60 minutes after creation. A link is single use: following it stamps `consumed_at` and it cannot be followed again.

A row is written only when the submitted email matches an active client contact on that programme. A request for an unknown or inactive address writes an audit event and nothing else, so we never accumulate rows about people who are not our contacts.

### client_sessions

The email-verified session created by following a valid one-time link.

`id` uuid pk · `client_contact_id` uuid fk · `program_id` uuid fk · `token_hash` text · `issued_at`, `expires_at`, `last_seen_at` timestamptz · `revoked_at` timestamptz nullable · `created_at`, `updated_at` timestamptz

Scoped to one programme. Life is seven days, so a client can return over several sittings without asking for a new link; expiry just means requesting another. Revoked immediately when the client contact is deactivated. The session cookie is set on `client.amzai.events` only, HTTP-only, secure, SameSite=Lax.

`last_seen_at` is written at most once an hour. This table carries an audit trigger like every other, and updating it on every request would fill `audit_events` with page views that say nothing.

### companies
`id` uuid pk · `name`, `domain` text · `revenue_band`, `employee_band`, `industry`, `country` text · `signals` jsonb · `created_at`, `updated_at` timestamptz

`companies.industry` is **not** the client taxonomy and is deliberately left as it is. These are the target companies we market to on a client's behalf, described however the data source described them. `organisations.client_type_id` classifies Amzai's own clients. Two different populations, two different vocabularies; do not unify them.

### contacts
`id` uuid pk · `company_id` uuid fk · `first_name`, `last_name`, `email`, `title`, `seniority`, `function` text · `country` text · `consent_basis` text · `source` text · `suppressed` boolean · `suppressed_at` timestamptz · `suppressed_reason` text · `created_at`, `updated_at` timestamptz

Unique index on `lower(email)`. `suppressed` is global: a suppressed contact is never contacted again on any programme for any client.

### engagement_events
The history spine. One row per thing that ever happened to a contact.

`id` uuid pk · `contact_id`, `program_id` uuid fk · `event_type` text (invited, opened, replied, registered, confirmed, attended, no_show, opted_out) · `occurred_at` timestamptz · `source_system` text (platform, instantly, smartlead, manual) · `metadata` jsonb · `created_at`, `updated_at` timestamptz

`occurred_at` is when the thing happened in the world. `created_at` is when we learned about it. For a sync from Instantly they are different, and the gap matters when reconciling.

### audit_events
`id` bigserial pk · `actor_type` text (staff, client_contact, system) · `actor_id` uuid nullable, a `users` row when `actor_type` is staff · `actor_contact_id` uuid nullable, a `client_contacts` row when `actor_type` is client_contact · `action` text · `table_name` text · `record_id` uuid · `before`, `after` jsonb · `occurred_at` timestamptz

Append-only. Update and delete revoked at database level. Populated by trigger on every table, never by application code.

**This is the only table with no `updated_at` and no audit trigger, and the migration must say why in a comment.** Nothing ever updates an append-only table, so `updated_at` would be permanently equal to `occurred_at` and would imply a mutability that does not exist. An audit trigger on the audit table would recurse. Every other table in the platform has both, with no exceptions.

`actor_id` is not read from `auth.uid()`. Both internal routes and client-facing routes set the actor in a session variable on the connection before writing, and the trigger reads it from there. This is required because client-facing routes run under the service role and have no database identity at all, and it keeps one mechanism rather than two. A write with no actor set records `actor_type` system.

Every client answer and every onboarding link request is attributed to a named client contact this way. A link request from an unrecognised address is logged with `actor_type` system and no email stored.

Not every audit row comes from a table write. Reads of a client-facing surface are logged too, because who saw what and when carries commercial weight. A dashboard view writes `action` `dashboard_view` against the programme.

## 4. Programme creation and onboarding generation

The order matters, and it is not a suggestion. Done out of order, a programme generates with every onboarding field unassigned, and the awaiting-me count that drives the whole platform reads zero for everyone from day one.

1. **Create the organisation**, including its client type, its sub-segment where the client type has them, and optionally the category.
2. **Create the programme**, including its type, its dates, and any situational modules it needs.
3. **Assign the Amzai team** in `program_assignments`, each with a `role_on_program`.
4. **Generate onboarding**, after reviewing the plan. Section 4.1a.

### 4.1 Resolving the question set

A programme's questions are not one template. They are resolved at generation from four things: the organisation's **client type**, its **sub-segment**, the **programme type**, and any **situational modules** chosen for that programme.

**Core always applies.** Every programme gets the core set, whatever the client.

**One segment set is chosen**, in this order, stopping at the first that yields a candidate:

1. **The sub-segment's own set.** A template whose `sub_segment_id` matches the organisation's.
2. **The set it borrows.** Where the sub-segment's `questions_from_sub_segment_id` names another, that one's set is used and every response taken from it is marked `is_generic`. Hosted Buyer Organizer and Community Event Organizer have no sheet in the workbook and borrow Trade Show Organizer's.
3. **The client type's set.** A template whose `client_type_id` matches and whose `sub_segment_id` is null. This is how one B2B Tech set serves all twenty-five of its sub-segments.

A borrow beats the client-type set because a borrow is something a person stated about that sub-segment, and the client-type set is only a default.

**Situational modules append**, in the order they were chosen. A module is offered only where its `client_type_id` is null or matches the organisation's, so a module can never be offered on a screen and then refused at generation.

`program_type` must match throughout, where a template's `program_type` of null means any. Only `active` templates are candidates, and the highest `version` of a slug wins.

**Nothing about this mapping lives in code.** No route, screen or script holds a list of which questions belong to which client. Adding a sub-segment, repointing a borrow, withdrawing a version or importing an updated workbook changes what future programmes generate, with no code change and no deploy. The rules above are implemented once, in `lib/generation/resolve.ts`, as a pure function of the rows and the selections.

Every contributing template version is recorded in `program_onboarding_sources` with the role it played: `core`, `segment`, `situational` or `fallback`. A single `programs.onboarding_template_id` cannot describe a set built from several, which is why that column is no longer how the answer is read.

#### Overlapping questions

Sets overlap. A situational module repeats questions the core set already asks.

Duplicates are resolved over the set actually being built, not looked up from a mark made at import time, because which questions collide depends on which sets are combined.

- **Identical wording**: asked once. Whichever set came first wins, and since core is composed first, core wins.
- **Close but not identical**: both are kept, and the later one is marked. A near-duplicate asked twice is annoying; a subtly different question silently dropped is worse.

The matching rule has one home, `lib/generation/matching.ts`, imported by both the workbook importer and generation. Two copies would drift, and then the overlap report would promise something generation did not do.

### 4.1a The preview, and what freezing means

Generation shows the whole plan before writing anything: every set selected and **why it was selected in those words**, the total question count, every question dropped as a duplicate and what dropped it, every near-duplicate kept, and anything the rules could not settle. Selections can be changed on that screen and the plan recomputes.

The preview and the write are the same calculation. `resolveQuestions` is pure — no database, no clock, no request — so the screen can run it in the browser as selections change and the server runs it again on submit. The server never trusts what the browser sends: it recomputes from the rows and writes that.

**Once generated, the set is frozen to the programme.** A later workbook import, a repointed borrow, a new sub-segment or a withdrawn version never alters a live programme.

That is enforced, not merely intended:

- `onboarding_template_fields` is append-only. A trigger refuses UPDATE, DELETE and TRUNCATE, exactly as `audit_events` does. A generated response reads its question text through this table, so an in-place edit would rewrite the wording on every programme ever generated from it.
- A template version is immutable apart from its `active` flag, so a bad version can be withdrawn but not rewritten.
- The importer never edits. A changed sheet becomes a new version, and programmes already generated keep pointing at the version they were generated from.

Writing a generation is one transaction, `commit_onboarding_generation`, because responses, provenance, role resolutions and the programme row must all land or none of them. Four PostgREST calls would leave a programme half generated on a failure at the third. The function decides nothing; the plan arrives already decided, and it refuses when 4.2's rule is not met.

#### Who fills it in

At generation the admin records whether **Amzai** or **the client** fills the onboarding, on `programs.onboarding_fill_mode`. It records who is expected to answer; it does not rewrite question ownership, because which questions are the client's is a property of the question and not of who is typing this time.

### 4.2 Generation is blocked until the team is assigned

**Onboarding cannot be generated until `program_assignments` holds at least one row for that programme.** The generate action is unavailable until then, and says why. This is a block, not a warning to click through.

The reason, recorded so it is not softened later: without an assigned team there is no one for `default_assignee_role` to resolve to, so every field generates unassigned, and unassigned work is invisible work. Blocking costs one step at setup. Repairing it costs a field-by-field pass across a live programme.

### 4.3 Resolving roles to people

Each response takes its `assignee_id` from whoever holds the field's `default_assignee_role` on that programme. There are exactly three cases.

- **One person holds the role.** Assign automatically. There is nothing to ask.
- **Nobody holds the role.** Leave unassigned and report it. Section 4.7 makes it visible.
- **More than one person holds the role.** Stop and ask. See 4.4.

Fields where `owner` is `client`, and fields where `default_assignee_role` is null, get no assignee and take no part in resolution.

The system does not break a tie by allocation, seniority, or order of assignment. Any such rule is a guess, and a wrong guess is invisible until someone misses a deadline they never knew was theirs. An admin answering one question at setup is cheaper than that, every time.

### 4.4 The resolution step

Generation is two steps, never one. Before anything is written, the admin is shown one row per ambiguous role: the role, how many fields depend on the choice, and the people who hold it.

```
Specialist · 12 fields       Priya Raman | Daniel Okoro | Leave unassigned
Delivery lead · 4 fields     Sana Iqbal  | Tom Whitfield | Leave unassigned
```

The admin picks one person per row, or `Leave unassigned` for any row they are not ready to decide. Generation proceeds only when every ambiguous row carries a choice, and an explicit `Leave unassigned` counts as one.

Leaving unassigned is a decision, not a failure to decide. It is recorded as a decision and reused as one, so nobody is forced into naming a person before they know who it should be.

### 4.5 Resolutions are recorded and reused

Each choice writes a row to `program_role_resolutions` and an audit row alongside it.

When onboarding is regenerated, extended with new template fields, or has a second template applied, resolution reads the recorded choice for that role and does not ask again. A recorded `Leave unassigned` is honoured the same way: the question is settled, and asking a second time is noise.

One exception. If the recorded person is no longer assigned to the programme, the resolution is stale and the role is asked again. Silently assigning work to someone who has left the programme is exactly the invisible failure this step exists to prevent.

Resolutions are editable on the programme afterwards. Changing one affects the next generation only. Existing assignments do not move, for the same reason given in 4.6.

### 4.6 Reassignment

`assignee_id` is editable inline on any response, at any time.

Changing someone's `role_on_program` does **not** move existing assignments. Those were resolved at generation and moving them silently would change who owes what without anyone being told.

For the real cases — someone leaves, someone covers — the programme detail screen carries a bulk action: reassign every response currently assigned to one person to another. It writes one audit row per response changed, so the trail stays complete rather than recording a single vague bulk event.

### 4.7 Unassigned is visible

The programme detail screen shows an unassigned count beside the section completion counts. A field nobody owns is the exact failure this mechanism exists to prevent, so it is counted in plain sight rather than discovered by filtering.

This holds whether a field is unassigned because no one holds its role or because an admin deliberately chose `Leave unassigned`. The count does not distinguish them, because the consequence is identical: work nobody is doing.

## 5. Access rules

All users are internal staff. Row level security on every table.

- `admin` and `engagement_lead` see everything.
- `delivery_lead` and `specialist` see only programmes they are assigned to via `program_assignments`.
- `data_ops` sees `contacts`, `companies` and `engagement_events` in full. It reaches `organisations` and `programs` only through a restricted view exposing name, type and dates, and has no access to the base tables. No commercial column is readable by `data_ops` anywhere, in this phase or later.
- No anonymous access to any table.

A policy on `users` that reads a role out of `users` recurses. Role lookups therefore go through a `SECURITY DEFINER` helper function, which is the single place any policy asks who the current user is and what they may see.

Client-facing surfaces never touch the database from the browser. They read and write through server-side routes on `client.amzai.events` that run under the service role, which bypasses row level security. The token check and the session check in those routes are therefore the entire access control, and every one of them must verify the programme in the URL matches the programme the token or session was issued for. A route that trusts the slug rather than the token is a data breach.

## 6. Client access

### 6.1 URLs

```
client.amzai.events/{org-slug}/{program-slug}                    dashboard, access token
client.amzai.events/{org-slug}/{program-slug}/onboarding         onboarding form, one-time token
```

The slugs are for a client reading the URL and for our own support. They carry no authority. Two programmes with guessable slugs are still unreachable without the token.

### 6.2 Requesting an onboarding link

1. Amzai generates the onboarding link for a programme and emails it to the client contacts on that programme.
2. The client opens it and is asked for their email address.
3. If that address is an active `client_contacts` row on that programme, a one-time link valid for 60 minutes is emailed to it.
4. Following that link consumes it and opens the form. A session is created for that programme, lasting seven days.

**The response to step 3 is identical whether or not the address is known.** Always "if that address is on the list for this programme, a link is on its way." Never confirm or deny that an address is a contact, never vary the wording, never vary the response time in a way that reveals the answer.

Rate limits: five link requests per email address per hour, twenty per IP address per hour. Exceeding either gives the same neutral response, with no indication that a limit was reached. Tokens are single use and expire in 60 minutes. Sessions last seven days.

### 6.3 What the client sees

The form shows only fields where `owner` is `client` or `both`. Fields owned by Amzai are **hidden entirely, not shown read-only.**

The reasoning, so it is not undone later: Amzai answers are written for internal use and may carry commercial or strategic language never intended for the client. Hiding them also makes the progress count honest, since "6 of 9" then means six of the nine things the client actually owes. Where Amzai does want a field visible to the client, the mechanism already exists: set its owner to `both`. That is a deliberate act per field rather than a blanket exposure.

The form saves each answer as it is entered. It shows overall progress, what is still outstanding, and which outstanding items are blocking. It never requires completion in one sitting.

### 6.4 What is recorded

Every answer written by a client sets `answer_source` to `client_written`, `answered_by_contact_id` to the submitting contact, and `answered_at` to the time of submission.

Every link request and every client answer writes to `audit_events` with the contact identified. Requests from unrecognised addresses are logged without an email address.

On the programme detail screen Amzai sees, per field, whether the client or Amzai answered, which named contact it was, and when.

## 7. Derived values

Nothing here is stored except `due_date`. These are the definitions the interface computes from, and they are written here rather than in DESIGN.md so there is one answer rather than one per screen.

### 7.1 Due date

Resolved once, when the response row is created from its template field, and stored on `onboarding_responses.due_date`. It does not recompute afterwards, so moving a programme's dates does not silently move every due date underneath it.

- `weeks_from_start`: `start_date` plus `default_offset_value` weeks.
- `days_before_milestone`: `fixed_milestone_date` minus `default_offset_value` days.

Retainers, dedicated teams, series and research use the first. Events use the second.

### 7.2 Countdown

**Events**, from `fixed_milestone_date`:

| Condition | Display | Colour |
|---|---|---|
| More than 30 days away | `T-45d` | ink |
| 8 to 30 days | `T-22d` | watch |
| 7 days or fewer | `T-4d` | critical |
| Past | `T+9d` | critical |

**Retainers and everything else**, from `start_date` and `end_date`:

Total weeks is the number of whole weeks between `start_date` and `end_date`. Current week is whole weeks elapsed since `start_date`, plus one. Display `W6 of 13`.

| Condition | Colour |
|---|---|
| Before `gate_date`, or `gate_date` is null | ink |
| On or after `gate_date` | watch |
| Past `end_date` | critical |

### 7.3 Counts

**Blocking count**, per programme. Onboarding responses where `blocking` is true and `status` is not `approved`. Note this counts blocking items that are merely unfinished, not only ones that are late.

**The four counts above the programme list.** A programme can appear in more than one; they are filters, not a partition.

| Count | Definition |
|---|---|
| Active | `programs.status` is `active` |
| At risk | has one or more onboarding responses where `blocking` is true, `due_date` is past, and `status` is not `approved` |
| Blocked | has one or more onboarding responses where `status` is `blocked` |
| Awaiting client | has one or more onboarding responses where `owner` is `client` and `status` is not `approved` |

**Awaiting me**, the single count in the top bar. Onboarding responses where `assignee_id` is the signed-in user and `status` is neither `approved` nor `na`, across every programme they can see.

## 8. Rules that carry commercial weight

**Audit.** Every create, update and delete is logged with actor, timestamp, and before and after values. Built into the write path from the first table, not added later.

**Suppression.** Opt-outs sync two ways with Instantly and Smartlead. A person who opts out anywhere is suppressed everywhere, permanently. This is compliance, not reporting.

**Stale tasks.** Tasks generate from onboarding answers. When an answer changes after generation, flag the tasks built from it and notify. Do not regenerate silently and do not lock the answer.

**Data freshness.** Dashboard figures are partly hand-entered. Every figure stores when it was last updated and whether it was automatic or manual. The interface surfaces staleness. See DESIGN.md.

**The contact database is never exported to a client.** Programme-specific registration and attendee data is shareable with the client it belongs to. Nothing else is.

## 9. Known deviations and planned work

Recorded so nobody rediscovers them cold. Each entry says what it is, why it is that way, and what would change it.

### 9.1 Accepted risk: the restricted views run with owner rights

**What the linter says.** Supabase's Security Advisor flags `organisations_restricted` and `programs_restricted` as `security_definer_view`, at critical severity. The Table Editor additionally shows them as UNRESTRICTED while every table shows RLS enabled.

**What is actually true.** The UNRESTRICTED label carries no information: a view is not a table, has no rows of its own, and cannot have a policy attached. Every view in every Postgres database is labelled this way.

The `security_definer_view` finding is real but generic. Both views run with their owner's rights, which is deliberate and is the only reason they work: `data_ops` has no policy permitting it to read `organisations` or `programs`, so a caller-rights view would inherit that exclusion and return nothing. The views exist precisely to reach past a policy, in a controlled way, and expose a fixed column list that omits `currency`, `approver_name`, `approver_email` and `dashboard_token`.

The risk the linter is warning about is that such a view becomes a way round row level security for someone who should not have the data. That was tested rather than assumed, against an instance configured the way Supabase configures one, including the default privileges that silently grant new views to `anon`:

- `anon` is denied on both views outright, not merely filtered to nothing.
- A specialist reads zero rows from both.
- A specialist cannot create the leaky function the strongest form of the attack needs; `authenticated` has no `CREATE` on `public`.
- An error-oracle predicate supplied by a specialist leaks nothing. The gating filter does not depend on any row, so the planner hoists it into a One-Time Filter that gates the scan before a row is read.

Both views are marked `security_barrier`, which forbids the planner from evaluating a caller-supplied predicate below the view's own filter. Without it the safety above holds only by accident of the filter's shape: change it to something row-dependent and the protection would disappear with no test failing.

All of this is covered by cases in `supabase/tests/test_row_level_security.sql`, so a regression fails a test rather than sitting quietly.

**The finding will remain on the advisor board.** `security_barrier` does not clear it, because the views still run with owner rights. It is accepted, not fixed.

**What would clear it.** Two options, in increasing order of value:

1. Replace both views with `SECURITY DEFINER` set-returning functions. The linter does not flag functions, and a definer function is never inlined, so predicate pushdown cannot happen at all rather than merely being forbidden. Callers change from `select * from programs_restricted` to `select * from programs_restricted()`.
2. Section 9.2. The preferred answer.

### 9.2 Planned: move commercial columns out of `programs`

**Not now.** Recorded as the intended long-term fix for 9.1.

`currency`, `approver_name`, `approver_email` and `dashboard_token` move out of `programs` into a `program_commercials` table, keyed one-to-one on `program_id`.

**Why this is the right shape.** The reason the restricted views exist at all is that `programs` mixes two sensitivities in one table: facts every internal role may see, and commercial detail `data_ops` may not. Row level security can restrict rows but not columns, so the column boundary has to be enforced somewhere else, and today that somewhere is a view reaching around a policy.

Split the table and the boundary becomes a table boundary, which row level security expresses natively:

- `programs` gains an ordinary policy granting `data_ops` read access alongside everyone else.
- `program_commercials` gets a policy that excludes `data_ops`.
- Both restricted views are deleted, and with them the advisor finding, the `security_barrier` reasoning, and an entire class of question about planner behaviour.

**What it costs.** A migration moving four columns and backfilling, a policy on the new table, deleting two views, updating section 5 and the `dashboard_token` note in section 3, and removing the view cases from the row level security test. Do it before there is real commercial data, not after.
