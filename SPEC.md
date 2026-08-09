# SPEC.md
## Amzai Operations Platform

## 1. Product

An internal operating system for Amzai and BuyerForesight, a B2B executive events and demand generation business. Every client engagement, programme, contact and action lives here.

**Users.** Amzai staff only. Five to fifteen people. Roles: engagement_lead, delivery_lead, specialist, data_ops, admin.

**Clients have no accounts.** They receive a generated dashboard at a token URL. There is no client login, now or in this phase.

**Two kinds of work.** Single events run against a fixed date, tracked in T-minus days. Retainers and dedicated teams run against engagement weeks, tracked as W1 to W13 or similar. Both are programmes; only the template and metrics differ.

## 2. Modules

Build in this order. Finish and verify each before starting the next.

1. **Clients and Programs.** The spine. Organisations, programmes, users, assignments.
2. **Onboarding.** Templated question sets per programme type and industry. Every field has an owner, due date, status and blocking flag. Completed onboarding generates the task set.
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
`id` uuid pk · `name` text · `trading_name` text · `entity` text · `industry` text (law_firm, association, amc, trade_show, b2b_media, b2b_tech) · `status` text (prospect, active, dormant, closed) · `created_at`, `updated_at` timestamptz

### users
`id` uuid pk, matches Supabase auth user id · `full_name` text · `email` text · `role` text (engagement_lead, delivery_lead, specialist, data_ops, admin) · `active` boolean

### programs
`id` uuid pk · `organisation_id` uuid fk · `name` text · `type` text (event, retainer, dedicated_team, series, research) · `status` text (onboarding, active, paused, complete) · `currency` text · `start_date`, `end_date` date · `fixed_milestone_date` date · `approver_name`, `approver_email` text · `engagement_lead_id`, `delivery_lead_id` uuid fk users · `created_at`, `updated_at` timestamptz

`fixed_milestone_date` is the date that does not move. Countdowns calculate from it.

### program_assignments
`id` uuid pk · `program_id` uuid fk · `user_id` uuid fk · `role_on_program` text · `allocation_percent` integer

### onboarding_templates
`id` uuid pk · `name` text · `program_type` text · `industry` text nullable, null means applies to all · `version` integer · `active` boolean

### onboarding_template_fields
`id` uuid pk · `template_id` uuid fk · `section` text · `sort_order` integer · `question` text · `guidance` text · `default_owner` text (client, amzai, both) · `default_due_week` text · `blocking` boolean

### onboarding_responses
`id` uuid pk · `program_id` uuid fk · `template_field_id` uuid fk · `response` text · `owner` text · `due_date` date · `status` text (not_started, in_progress, submitted, approved, blocked, na) · `blocking` boolean · `answered_by` uuid fk users nullable, null means the client answered · `tasks_generated` boolean · `created_at`, `updated_at` timestamptz

### companies
`id` uuid pk · `name`, `domain` text · `revenue_band`, `employee_band`, `industry`, `country` text · `signals` jsonb

### contacts
`id` uuid pk · `company_id` uuid fk · `first_name`, `last_name`, `email`, `title`, `seniority`, `function` text · `country` text · `consent_basis` text · `source` text · `suppressed` boolean · `suppressed_at` timestamptz · `suppressed_reason` text · `created_at`, `updated_at` timestamptz

Unique index on `lower(email)`. `suppressed` is global: a suppressed contact is never contacted again on any programme for any client.

### engagement_events
The history spine. One row per thing that ever happened to a contact.

`id` uuid pk · `contact_id`, `program_id` uuid fk · `event_type` text (invited, opened, replied, registered, confirmed, attended, no_show, opted_out) · `occurred_at` timestamptz · `source_system` text (platform, instantly, smartlead, manual) · `metadata` jsonb

### audit_events
`id` bigserial pk · `actor_id` uuid nullable · `action` text · `table_name` text · `record_id` uuid · `before`, `after` jsonb · `occurred_at` timestamptz

Append-only. Update and delete revoked at database level. Populated by trigger on every table, never by application code.

## 4. Access rules

All users are internal staff. Row level security on every table.

- `admin` and `engagement_lead` see everything.
- `delivery_lead` and `specialist` see only programmes they are assigned to via `program_assignments`.
- `data_ops` sees contacts, companies and engagement_events, but not commercial fields.
- No anonymous access to any table.

The client dashboard reads through a server-side route using a programme token, not through client-side database access.

## 5. Rules that carry commercial weight

**Audit.** Every create, update and delete is logged with actor, timestamp, and before and after values. Built into the write path from the first table, not added later.

**Suppression.** Opt-outs sync two ways with Instantly and Smartlead. A person who opts out anywhere is suppressed everywhere, permanently. This is compliance, not reporting.

**Stale tasks.** Tasks generate from onboarding answers. When an answer changes after generation, flag the tasks built from it and notify. Do not regenerate silently and do not lock the answer.

**Data freshness.** Dashboard figures are partly hand-entered. Every figure stores when it was last updated and whether it was automatic or manual. The interface surfaces staleness. See DESIGN.md.

**The contact database is never exported to a client.** Programme-specific registration and attendee data is shareable with the client it belongs to. Nothing else is.
