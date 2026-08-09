# SPEC.md
## Amzai Operations Platform

## 1. Product

An internal operating system for Amzai, a B2B executive events and demand generation business. Every client engagement, programme, contact and action lives here.

**Users.** Amzai staff only. Five to fifteen people. Roles: engagement_lead, delivery_lead, specialist, data_ops, admin.

**Clients have no accounts.** No Supabase Auth user, no password, no login, now or ever. Client-facing surfaces are reached by token URL on `client.amzai.events`.

There are two of them:

- The **programme dashboard**, generated per programme, read only, reached by a long-lived access token.
- The **onboarding form**, where a client answers their own onboarding fields. This one is a write surface, so it is protected by an email-verified session on top of the token. The client enters an email address, and if that address is an active client contact on that programme they receive a one-time link valid for 60 minutes. Following it opens the form for that programme only. See section 5.

That session is built in our own tables. It is not Supabase Auth and it creates no account.

**Domains.** `app.amzai.events` is the internal system, behind Cloudflare Access. `client.amzai.events` carries every client-facing surface and is never behind Cloudflare Access.

**Two kinds of work.** Single events run against a fixed date, tracked in T-minus days. Retainers and dedicated teams run against engagement weeks, tracked as W1 to W13 or similar. Both are programmes; only the template and metrics differ.

## 2. Modules

Build in this order. Finish and verify each before starting the next.

1. **Clients and Programs.** The spine. Organisations, programmes, users, assignments.
2. **Onboarding.** Templated question sets per programme type and industry. Every field has an owner, due date, status and blocking flag. Completed onboarding generates the task set. Includes the client-completed onboarding form on `client.amzai.events`: Amzai generates a link per programme and emails it to named client contacts, who answer their own fields directly. Answers save as they go and need not be finished in one sitting.
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
`id` uuid pk · `name` text · `trading_name` text · `slug` text unique not null · `slug_locked_at` timestamptz nullable · `industry` text (law_firm, association, amc, trade_show, b2b_media, b2b_tech) · `status` text (prospect, active, dormant, closed) · `created_at`, `updated_at` timestamptz

`slug` is lowercase and hyphenated, generated from `name` on creation and editable afterwards. It appears in every client-facing URL. Once the first client-facing link for any programme of this organisation has been generated, `slug_locked_at` is stamped and the slug can no longer be changed, because links already sent would break. Slugs are readability only and are never an access control.

### users
`id` uuid pk, matches Supabase auth user id · `full_name` text · `email` text · `role` text (engagement_lead, delivery_lead, specialist, data_ops, admin) · `active` boolean · `created_at`, `updated_at` timestamptz

### programs
`id` uuid pk · `organisation_id` uuid fk · `name` text · `slug` text not null · `type` text (event, retainer, dedicated_team, series, research) · `status` text (onboarding, active, paused, complete) · `currency` text · `start_date`, `end_date` date · `fixed_milestone_date` date · `gate_date` date nullable · `approver_name`, `approver_email` text · `engagement_lead_id`, `delivery_lead_id` uuid fk users · `dashboard_token` text nullable · `dashboard_token_issued_at` timestamptz nullable · `slug_locked_at` timestamptz nullable · `created_at`, `updated_at` timestamptz

`fixed_milestone_date` is the date that does not move. Event countdowns calculate from it.

`gate_date` is the point in a retainer after which remaining time is short. It drives the retainer countdown colour. Nullable, because not every programme has one. See section 6.

`delivery_lead_id` is the programme's owner for display purposes. It is the single name in the Owner column on the programme list.

`slug` is unique within an organisation, not globally. Same generation, editing and locking rules as the organisation slug.

`dashboard_token` is the long-lived bearer token for the programme dashboard. It is stored in full rather than hashed, because operators need to re-send the same link, so it is a secret at rest: service-role reads only, never sent to any browser except as part of the generated URL, never written to a log. Nullable because a dashboard is only generated when wanted. The dashboard itself is module 4; the column is defined here so the URL shape is settled once.

### program_assignments
`id` uuid pk · `program_id` uuid fk · `user_id` uuid fk · `role_on_program` text (engagement_lead, delivery_lead, specialist, data_ops) · `allocation_percent` integer · `created_at`, `updated_at` timestamptz

`role_on_program` is constrained to those four values. It does not include `admin`, which is a system role rather than a job on a programme.

### onboarding_templates
`id` uuid pk · `name` text · `program_type` text · `industry` text nullable, null means applies to all · `version` integer · `active` boolean · `created_at`, `updated_at` timestamptz

### onboarding_template_fields
`id` uuid pk · `template_id` uuid fk · `section` text · `sort_order` integer · `question` text · `guidance` text · `default_owner` text (client, amzai, both) · `default_offset_type` text (weeks_from_start, days_before_milestone) · `default_offset_value` integer · `blocking` boolean · `created_at`, `updated_at` timestamptz

A due date is expressed as an offset, not as a week label, so it resolves to a real date without anyone interpreting it. `weeks_from_start` counts forward from the programme's `start_date`; `days_before_milestone` counts back from `fixed_milestone_date`. Retainers and dedicated teams use the first, events use the second. The offset is resolved into `onboarding_responses.due_date` once, when the response row is created. See section 6.

### onboarding_responses
`id` uuid pk · `program_id` uuid fk · `template_field_id` uuid fk · `response` text · `owner` text (client, amzai, both) · `assignee_id` uuid fk users nullable · `due_date` date · `status` text (not_started, in_progress, submitted, approved, blocked, na) · `blocking` boolean · `answer_source` text (amzai_written, client_written, imported) · `answered_by` uuid fk users nullable · `answered_by_contact_id` uuid fk client_contacts nullable · `answered_at` timestamptz nullable · `tasks_generated` boolean · `created_at`, `updated_at` timestamptz

`owner` is the party responsible, client or Amzai. `assignee_id` is the individual member of staff responsible, and is what the top bar's awaiting-me count reads. Nullable, because a field can be owned by Amzai without being anyone's job yet. A field with `owner` client normally has no assignee, though one can be set for whoever is chasing it.

Who answered is recorded explicitly rather than inferred. `answer_source` says how the answer arrived. When it is `client_written`, `answered_by_contact_id` names the client contact who submitted it and `answered_by` is null. When it is `amzai_written`, `answered_by` names the staff user and `answered_by_contact_id` is null. At most one of the two is ever populated. `answered_at` is when the answer was last submitted, which is not the same as `updated_at`, since a status change by Amzai also touches the row.

`owner` decides what the client sees on the onboarding form. See section 5.

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

## 4. Access rules

All users are internal staff. Row level security on every table.

- `admin` and `engagement_lead` see everything.
- `delivery_lead` and `specialist` see only programmes they are assigned to via `program_assignments`.
- `data_ops` sees `contacts`, `companies` and `engagement_events` in full. It reaches `organisations` and `programs` only through a restricted view exposing name, type and dates, and has no access to the base tables. No commercial column is readable by `data_ops` anywhere, in this phase or later.
- No anonymous access to any table.

A policy on `users` that reads a role out of `users` recurses. Role lookups therefore go through a `SECURITY DEFINER` helper function, which is the single place any policy asks who the current user is and what they may see.

Client-facing surfaces never touch the database from the browser. They read and write through server-side routes on `client.amzai.events` that run under the service role, which bypasses row level security. The token check and the session check in those routes are therefore the entire access control, and every one of them must verify the programme in the URL matches the programme the token or session was issued for. A route that trusts the slug rather than the token is a data breach.

## 5. Client access

### 5.1 URLs

```
client.amzai.events/{org-slug}/{program-slug}                    dashboard, access token
client.amzai.events/{org-slug}/{program-slug}/onboarding         onboarding form, one-time token
```

The slugs are for a client reading the URL and for our own support. They carry no authority. Two programmes with guessable slugs are still unreachable without the token.

### 5.2 Requesting an onboarding link

1. Amzai generates the onboarding link for a programme and emails it to the client contacts on that programme.
2. The client opens it and is asked for their email address.
3. If that address is an active `client_contacts` row on that programme, a one-time link valid for 60 minutes is emailed to it.
4. Following that link consumes it and opens the form. A session is created for that programme, lasting seven days.

**The response to step 3 is identical whether or not the address is known.** Always "if that address is on the list for this programme, a link is on its way." Never confirm or deny that an address is a contact, never vary the wording, never vary the response time in a way that reveals the answer.

Rate limits: five link requests per email address per hour, twenty per IP address per hour. Exceeding either gives the same neutral response, with no indication that a limit was reached. Tokens are single use and expire in 60 minutes. Sessions last seven days.

### 5.3 What the client sees

The form shows only fields where `owner` is `client` or `both`. Fields owned by Amzai are **hidden entirely, not shown read-only.**

The reasoning, so it is not undone later: Amzai answers are written for internal use and may carry commercial or strategic language never intended for the client. Hiding them also makes the progress count honest, since "6 of 9" then means six of the nine things the client actually owes. Where Amzai does want a field visible to the client, the mechanism already exists: set its owner to `both`. That is a deliberate act per field rather than a blanket exposure.

The form saves each answer as it is entered. It shows overall progress, what is still outstanding, and which outstanding items are blocking. It never requires completion in one sitting.

### 5.4 What is recorded

Every answer written by a client sets `answer_source` to `client_written`, `answered_by_contact_id` to the submitting contact, and `answered_at` to the time of submission.

Every link request and every client answer writes to `audit_events` with the contact identified. Requests from unrecognised addresses are logged without an email address.

On the programme detail screen Amzai sees, per field, whether the client or Amzai answered, which named contact it was, and when.

## 6. Derived values

Nothing here is stored except `due_date`. These are the definitions the interface computes from, and they are written here rather than in DESIGN.md so there is one answer rather than one per screen.

### 6.1 Due date

Resolved once, when the response row is created from its template field, and stored on `onboarding_responses.due_date`. It does not recompute afterwards, so moving a programme's dates does not silently move every due date underneath it.

- `weeks_from_start`: `start_date` plus `default_offset_value` weeks.
- `days_before_milestone`: `fixed_milestone_date` minus `default_offset_value` days.

Retainers, dedicated teams, series and research use the first. Events use the second.

### 6.2 Countdown

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

### 6.3 Counts

**Blocking count**, per programme. Onboarding responses where `blocking` is true and `status` is not `approved`. Note this counts blocking items that are merely unfinished, not only ones that are late.

**The four counts above the programme list.** A programme can appear in more than one; they are filters, not a partition.

| Count | Definition |
|---|---|
| Active | `programs.status` is `active` |
| At risk | has one or more onboarding responses where `blocking` is true, `due_date` is past, and `status` is not `approved` |
| Blocked | has one or more onboarding responses where `status` is `blocked` |
| Awaiting client | has one or more onboarding responses where `owner` is `client` and `status` is not `approved` |

**Awaiting me**, the single count in the top bar. Onboarding responses where `assignee_id` is the signed-in user and `status` is neither `approved` nor `na`, across every programme they can see.

## 7. Rules that carry commercial weight

**Audit.** Every create, update and delete is logged with actor, timestamp, and before and after values. Built into the write path from the first table, not added later.

**Suppression.** Opt-outs sync two ways with Instantly and Smartlead. A person who opts out anywhere is suppressed everywhere, permanently. This is compliance, not reporting.

**Stale tasks.** Tasks generate from onboarding answers. When an answer changes after generation, flag the tasks built from it and notify. Do not regenerate silently and do not lock the answer.

**Data freshness.** Dashboard figures are partly hand-entered. Every figure stores when it was last updated and whether it was automatic or manual. The interface surfaces staleness. See DESIGN.md.

**The contact database is never exported to a client.** Programme-specific registration and attendee data is shareable with the client it belongs to. Nothing else is.
