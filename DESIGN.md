# DESIGN.md
## Amzai Operations Platform: design system

**How to use this file.** Save it in your repo root as `DESIGN.md`. Then create a `CLAUDE.md` in the same folder containing the line: *Always read and follow DESIGN.md before building or changing any interface.* Claude Code reads that file automatically at the start of every session, so the system holds across sessions instead of being re-explained each time.

Paste-ready prompts are in the appendix.

---

## 1. What this product is

An operations console for a team running executive events and demand programmes for clients. Five to fifteen operators live in it daily under time pressure, on `app.amzai.events`.

Clients see two surfaces, both on `client.amzai.events`, both reached by token and neither behind a login: a generated dashboard, and the onboarding form where they answer their own onboarding fields. Different rules apply to both. See sections 6.3 and 6.4.

**The single job of every internal screen:** let an operator find what is off track, and act on it, without hunting.

**The organising truth of the product:** everything is running against a date that does not move. A roundtable on 30 November. A checkpoint in week 13. Onboarding fields due in W2. Time is not metadata here, it is the substance. The design should make that visible rather than burying it in a column.

**What this is not.** Not a marketing site, not a consumer app, not a dashboard product. Restraint throughout. Density over whitespace. Legibility over polish.

---

## 2. Signature

**Time is set in monospace. Nothing else is.**

Every date, countdown, week label, duration and count renders in IBM Plex Mono with tabular figures. Everything else, all prose, labels, names and navigation, renders in the UI sans face.

This does two things. Temporal columns align perfectly, so a list of ninety programs can be scanned down the countdown column without the eye adjusting. And time reads as instrument data rather than as text, which is what it actually is in this product.

Applied consistently, this is the one thing that will make the platform recognisable as itself. Do not extend mono to anything that is not a measurement of time or quantity.

---

## 3. Tokens

### Colour

Neutrals carry the interface. Colour carries meaning only.

```
--ink:        #14161A   /* primary text, headers */
--slate:      #5B6270   /* secondary text, labels, captions, freshness */
--mute:       #8B92A0   /* placeholder and disabled text only */
--line:       #E3E5E9   /* borders, dividers, table rules */
--surface:    #FFFFFF   /* cards, tables, panels */
--canvas:     #F7F8FA   /* page background */
--accent:     #1F5F5B   /* interactive: links, primary buttons, focus */
--accent-sub: #E8F1F0   /* accent background wash, selected rows */
```

**`--mute` is not a third tier of text.** It sits at 3.13:1 on white, below the floor in section 7, and darkening it far enough to pass makes it indistinguishable from `--slate`. So its role is narrowed rather than its value changed: placeholder text and disabled controls, both of which the contrast floor exempts. Everything a reader is expected to actually read, including captions and freshness markers, uses `--slate`.

Status colours, used only for status. Never decoratively.

```
--clear:      #157347   /* on track, approved, confirmed */
--clear-bg:   #E9F5EE
--watch:      #9A5D00   /* at risk, due soon, awaiting */
--watch-bg:   #FDF3E3
--critical:   #B3261E   /* blocking, overdue, failed */
--critical-bg:#FBEAE9
--idle:       #5B6270   /* not started, N/A, complete */
--idle-bg:    #F0F1F4
```

There are **four** semantic status tones, not five. `--watch` was darkened from `#B26B00`, which failed the section 7 floor at 4.20:1 on white and 3.82:1 on its own pill background. The current value clears it everywhere: 5.33 on surface, 5.02 on canvas, 4.85 on `--watch-bg`.

Dark mode is out of scope for v1. Do not build it partially.

### Type

```
--font-ui:   'Inter', system-ui, sans-serif
--font-time: 'IBM Plex Mono', ui-monospace, monospace
```

Both are free on Google Fonts. If Amzai has brand faces, substitute the UI face only; the mono role stays.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | 20px | 600 | One per screen |
| Section heading | 13px | 600 | Uppercase, 0.04em tracking, slate |
| Body and table cell | 13px | 400 | |
| Table header | 12px | 500 | Slate, uppercase, 0.04em |
| Label | 12px | 500 | Slate |
| Metric, large | 28px | 500 | Mono, tabular figures |
| Time and count | 13px | 400 | Mono, tabular figures |
| Caption | 11px | 400 | Slate |

Set `font-variant-numeric: tabular-nums` globally on the mono face.

### Spacing and shape

4px base unit. Use 4, 8, 12, 16, 24, 32, 48 only.

```
--radius:      4px     /* everything. no exceptions */
--row-height:  36px    /* table rows */
--rail-width:  220px
--topbar:      52px
```

No shadows anywhere except dropdowns and modals, where use a single hairline plus `0 4px 12px rgba(20,22,26,0.08)`. Panels and tables are separated by borders, not elevation.

No gradients. No decorative icons. Icons only where they carry meaning, from Lucide, 16px, at slate weight.

---

## 4. Layout

**Persistent left rail**, 220px, listing the eight modules. Current module marked with an accent left border, not a filled background.

**Fixed top bar**, 52px, containing: global search (keyboard shortcut `/`), the current program context when inside one, and a single count of items awaiting the current user. That count is the most important element in the top bar and should be the only thing there that can turn amber or red.

The awaiting-me count is onboarding responses assigned to the signed-in user that are neither approved nor N/A, across every programme they can see. Defined in SPEC.md section 7.3. It is a count and a link, not a dropdown of items.

**Content area** on canvas background, 24px padding, max width unconstrained. This is a dense internal tool; do not centre content in a 1200px column and waste half the screen.

---

## 5. Core patterns

### Tables

Six of the eight modules are variations on a table. Get this right once.

- 36px rows, 13px text, 12px horizontal cell padding.
- Header row: sticky, 12px uppercase slate, hairline bottom border.
- Row separation by 1px `--line`, not by alternating fill.
- Hover: `--canvas` fill. Selected: `--accent-sub` fill with a 2px accent left border.
- Every column sortable. Sort state shown by a small caret in the header, never by colour.
- Filters sit directly above the table as a single row of compact dropdowns and a text filter. Not in a collapsible panel, not in a sidebar.
- Row count and active filters shown as plain text beneath the filter row: `47 programs · 2 filters active · Clear`.
- Temporal columns right-aligned, mono. Text columns left-aligned.
- Click anywhere on a row to open the record. No separate view button.

### Status

One component, used everywhere, never restyled per module.

A pill: 11px, 500 weight, uppercase, 2px 8px padding, 4px radius, status background with status text colour. Text only, no dot, no icon.

Map every status in the platform to one of the four semantic tones rather than inventing new colours per module. Approved, confirmed and on track are all `clear`. Submitted, awaiting and due soon are all `watch`. Blocked, overdue and failed are all `critical`. Not started, in progress, N/A, paused and complete are all `idle`.

`in_progress` is deliberately `idle` rather than `watch`. Amber has to mean at risk, or it stops meaning anything: a field somebody is actively working on is not a warning.

### Countdown

The most-used element in the platform. Mono, tabular.

Format: `T-24d` for events, `W6 of 13` for retainers. Absolute date shown beside it in slate at 12px.

Colour thresholds, applied to the countdown text itself. SPEC.md section 7.2 holds the arithmetic; this is what it looks like.

Events, counting to `fixed_milestone_date`:
- More than 30 days: `--ink`
- 8 to 30 days: `--watch`
- 7 days or fewer: `--critical`
- Past the date: `--critical`, prefixed `T+`

Retainers, counting weeks from `start_date`:
- Before `gate_date`, or no gate date set: `--ink`
- On or after `gate_date`: `--watch`
- Past `end_date`: `--critical`

The gate is a real date on the programme, not a computed halfway point. A programme with no gate date stays ink until it ends.

### Blocking items

The platform's central concept and it must never be a status among statuses.

Anywhere a record has open blocking items, show a persistent bar at the top of that record: `--critical-bg` fill, `--critical` left border 3px, one line of text naming the count and the oldest item, and a link that filters to them. It does not collapse and it does not dismiss. It disappears when the items are cleared and not before.

### Empty, loading, error

- **Empty** states name what would be here and give the action that creates it. `No programs yet.` with a `New program` button. Never an illustration, never "Nothing to see here".
- **Loading** uses skeleton rows at true row height so the layout does not jump. No spinners in table areas.
- **Errors** say what failed and what to do. `Could not load programs. Retry.` No apology, no error code unless it is actionable.

### Data freshness

Critical, because dashboard figures are partly hand-entered.

Every number that is not live carries a freshness marker beneath or beside it: `Updated 4 Aug · manual` in 11px slate. More than 7 days old, the marker turns `--watch`. More than 14 days, `--critical`.

The thresholds apply to automatic figures as well as hand-entered ones. A sync that quietly stopped three weeks ago produces a number just as misleading as one somebody forgot to update. A stale number that looks current is worse than no number.

When the marker has gone amber or red, it says why in words as well as colour: `Updated 22 Jul · manual · out of date`.

### Buttons

One component, four variants, no others. 32px high, matching the field height, so a button sits level with an input. 4px radius, 13px medium text, no shadow.

- **Primary** — accent fill, surface text. The one action that moves the screen forward. At most one per view.
- **Secondary** — surface fill, hairline border, ink text. Everything else.
- **Quiet** — no fill, no border, accent text. For actions sitting inside dense furniture, such as clearing a filter.
- **Destructive** — critical fill, surface text. Always paired with the typed confirmation below, never on its own.

Disabled buttons drop to 40% opacity and are always accompanied by a line of text saying what would enable them. A disabled control with no explanation is a dead end.

### Forms

- Label above field, 12px slate. Never placeholder-as-label.
- 32px field height, 1px `--line` border, 4px radius, accent border on focus with a visible 2px focus ring.
- Inline editing in tables and record views: click to edit, save on blur, show a brief `Saved` in clear for 2 seconds. No modal for single-field edits.
- Destructive actions require typed confirmation, not just a second click.

---

## 6. The three screens to design first

Everything else assembles from these.

### 6.1 Program list

The default landing screen. A table of every programme.

Columns: Program, Client, Type, Countdown, Owner, Blocking, Status. Countdown and Blocking are mono and right-aligned. Blocking shows a count, rendered in `--critical` when above zero and `--slate` when zero. Not `--mute`: a zero is a real reading, not a placeholder, and the reader has to be able to tell it apart from a one.

Status is the programme's own status: onboarding, active, paused, complete. There is no separate phase. One concept, one column.

Owner is the delivery lead. The engagement lead appears on the programme detail screen, not here.

Default sort: countdown ascending, so the most urgent sits at the top without anyone choosing to sort. This single default is most of what makes the screen useful.

Above the table, a single row of four counts: Active, At risk, Blocked, Awaiting client. Each filters the table when clicked. These are text and number, not cards, not tiles. A programme can appear in more than one of them, so the four will not sum to the row count and are not meant to. Definitions are in SPEC.md section 7.3.

### 6.2 Program detail

Where the team spends most of its time. Two columns.

**Left, primary, roughly 70%.** Tabbed sections: Onboarding, Tasks, Audience, Attendees, Reports, Commercial. Onboarding renders as its sections with each field showing question, response, owner, assignee, due date, status pill and a blocking marker. Fields are inline editable. Sections show a completion count in their header: `Audience · 6 of 9`.

Owner is the party, client or Amzai. Assignee is the member of staff, and is what drives the awaiting-me count, so it is editable inline like everything else.

Where the client answered a field, the attribution shows beneath the response in 11px mute: `Answered by Priya Raman · 12 Aug`. Where Amzai answered, the same line names the staff member. This is the only place the difference is visible and it should not need hunting for.

**Unassigned count.** Beside the section completion counts in the Onboarding tab header: `Onboarding · 14 of 19 · 3 unassigned`. The unassigned figure is mono and rendered `--watch` when above zero, `--mute` when zero, and it filters to those fields when clicked. Work nobody owns appears in no one's awaiting-me count, so it has to be visible here or it is visible nowhere. Do not fold it into the completion count and do not hide it behind a filter dropdown.

**Bulk reassign.** One action in the Onboarding tab: move every response assigned to one person to another. Two selects and a confirm, for when someone leaves or covers. It is a bulk write, so it names the count in the confirm step — `Reassign 12 responses from Priya Raman to Daniel Okafor` — and follows the destructive-action rule in section 5 only if it exceeds a screenful. Otherwise a plain confirm is enough, because it is reversible.

**Generating onboarding.** Before generation, the Onboarding tab shows the empty state naming the selected template and a `Generate onboarding` button. Until at least one team member is assigned, the button is disabled and the reason sits beside it in plain words: `Assign at least one team member before generating. Fields are assigned by role.` Never a disabled button with no explanation, and never a generate that silently produces unassigned fields.

**The resolution step.** Generate is two steps, never one. Pressing it replaces the tab content in place with the resolution step. Not a modal: it can run to several rows, the admin may want the assigned team in the right column visible beside it, and a decision that writes to the database should not be something you dismiss by clicking outside it.

One row per role that more than one person holds, using the table pattern from section 5:

| Role | Fields | Assign to |
|---|---|---|
| Specialist | 12 | select: Priya Raman · Daniel Okoro · Leave unassigned |
| Delivery lead | 4 | select: Sana Iqbal · Tom Whitfield · Leave unassigned |

Role and names in the UI face. `Fields` is a count, so mono and right-aligned. The select starts with nothing chosen, and `Leave unassigned` is a listed option rather than a way of skipping the row — the admin should have to choose it on purpose.

Roles held by exactly one person never appear. They were not a question. Roles nobody holds never appear either; they resolve to unassigned and show up in the header count afterwards.

Beneath the table, plain text in the same form as a table's row count: `2 roles need a decision · 16 fields affected`. Counts mono.

The confirm button stays disabled until every row has a choice, with the reason stated beside it: `Choose an assignee, or leave unassigned, for every role above.` No partial generation, no silent no-op.

Where a role was resolved on an earlier generation, its row does not appear. The line beneath the table says so instead: `3 roles resolved from earlier choices · Review`, where `Review` opens the recorded resolutions and allows changing them. A resolution whose person has since left the programme is stale, so that row does appear, with `Priya Raman is no longer on this programme` in `--watch` beneath the select.

If no role is ambiguous and none is stale, there is nothing to decide and generation runs straight through. Do not show an empty resolution step to confirm that there was no question.

**Right, persistent, roughly 30%.** Does not scroll away. Contains, in this order: the countdown, the next milestone with date, the blocking item count, the named client approver, the assigned team, and the last five audit entries in plain language. This column is the answer to "what is the state of this program" without reading anything else.

The blocking bar from section 5 sits above both columns, full width.

### 6.3 Client dashboard

One of the two external surfaces. Different rules apply: this one is presentation.

At `client.amzai.events/{org-slug}/{program-slug}` plus the access token.

Single column, generous spacing, no left rail, no navigation. Amzai mark top left, client name top right, generated date beneath.

Three to five metrics as large mono figures with plain labels beneath, each carrying its freshness marker. Then progress against target as a single horizontal bar, not a chart library. Then a short written summary, which is the most valuable thing on the page and should be given the most room. Then next milestone with its date.

No interactive filters, no drilldowns, no navigation off the page. It is a report that happens to be on the web, and it should read as considered rather than as a screenshot of an internal tool.

### 6.4 Client onboarding form

The second external surface, and the only one a client writes to. At `client.amzai.events/{org-slug}/{program-slug}/onboarding` plus the one-time token.

**Same tokens, same components, different posture.** Colours, type scale, radius, status pills, the mono rule for time: all unchanged, so it is visibly the same system. But the density rules in section 5 do not apply. This person is not an operator, has not been trained, is doing this once, and is quite likely on a phone between meetings. Give it room.

**Three screens.**

1. **Email entry.** One field, one button, one sentence saying what will happen. After submission, the same confirming message every time: *If that address is on the list for this programme, a link is on its way. It expires in 60 minutes.* Never a different message for an unknown address. Never a hint that the address was or was not recognised.
2. **Link expired or already used.** Says so plainly and offers to send another. Not an error state, because it is the expected outcome of coming back tomorrow.
3. **The form.**

**The form.**

Single column, max width 720px, centred. This is the one place in the platform where a constrained column is correct, because it is prose and answers rather than a table.

Header: client name, programme name, and the milestone date in mono. Beneath it, a progress line: `12 of 19 answered · 3 outstanding are blocking`. Counts in mono. This line stays visible as they scroll.

Fields render grouped by their template section, in template order, one per row and full width. Each field shows the question at 15px ink, the guidance beneath at 13px slate, then the input. Due date in mono, right of the question. Status pill only when the status is not `not_started`, so a fresh form is not a wall of grey pills.

Larger than internal: 15px input text, 44px field height, 16px vertical gap between fields, 32px between sections. Field text must be at least 16px on mobile viewports or iOS will zoom the page on focus.

**Saving.** Saves on blur, per field. A quiet `Saved` in `--clear` beside the field for two seconds, the same as internal inline editing. Never a toast, never a modal, never a save button at the bottom of the page. If a save fails, say so beside that field and keep the text the client typed. Losing a client's typing is the worst thing this screen can do.

**Blocking items** use the section 5 bar, full width above the form: `3 outstanding items are blocking your programme. The oldest is Attendee list, due 12 August.` and a link that scrolls to the first one. Same fill and border as internal. Wording addressed to the client, not to an operator.

**Outstanding.** Above the fields, a plain list of what is still to answer, each item a link to that field. Text and links, not cards.

**Amzai-owned fields are not rendered at all.** Not greyed, not collapsed, not present. See SPEC section 6.3.

**Nothing else on the page.** No navigation, no other programme, no link into the dashboard, no footer beyond a single line naming who to contact with a question. A client contact can reach exactly one programme's form and nothing else.

**Phone.** Must work at 360px. This is the likeliest place it will be opened.

---

## 7. Quality floor

Not optional, not announced.

- Keyboard navigable throughout. Visible focus ring on every interactive element, 2px accent.
- `/` focuses global search. `Esc` closes any overlay.
- Contrast 4.5:1 minimum on all meaningful text. Placeholder and disabled text is exempt, and `--mute` is the only token permitted to rely on that exemption. The amber was the one at risk and has been darkened to clear the floor; re-check it if it is ever changed again. `/styleguide` computes every pairing from the live token values, so this is checkable rather than assumed.
- Status never communicated by colour alone. Always a word beside it.
- `prefers-reduced-motion` respected. Transitions capped at 150ms regardless.
- Internal screens are desktop-first and need not work below 1024px. Both client surfaces, the dashboard and the onboarding form, must work on a phone down to 360px.
- Nothing on a client surface reveals another client, another programme, or whether an email address is on a list.

---

## 8. Things not to build

Recorded because they are the defaults an AI will otherwise reach for.

Card grids where a table would do. KPI tiles with large coloured numbers and trend arrows. Gradient headers. Illustrated empty states. Chart libraries for a single percentage. Collapsible sidebars that hide the filters. Modals for editing one field. Toast notifications for routine saves. Dark mode. Rounded corners above 4px. Drop shadows on static panels. Emoji in the interface.

On client surfaces, additionally: a login screen, a password field, a "create an account" prompt, or a "remember me" checkbox. A message that tells the visitor their email address was not recognised. A save button at the bottom of the onboarding form. Any link that leads off the programme they were given.

---

# Appendix: prompts for Claude Code

Paste these in order. They replace prompt 6 in the Build Kit.

**Set up the system**
> Read DESIGN.md in the repo root. Set up the design tokens from section 3 as CSS custom properties in a global stylesheet, configure Tailwind to use them, and load Inter and IBM Plex Mono. Then build the shared components from section 5: DataTable, StatusPill, Countdown, BlockingBar, EmptyState, FreshnessMarker, Button, and the form field components. Build them as reusable components with sensible props, not as one-off markup. Show me a single page that renders every component in every state so I can review them together before we use them anywhere.

*Built. The components live in `/components`, the tokens in `app/globals.css`, and the review page at `/styleguide`.*

**App shell**
> Following DESIGN.md section 4, build the app shell: persistent 220px left rail with the eight modules, fixed 52px top bar with global search bound to the "/" key, current program context, and the awaiting-me count. Content area on canvas background. Make the rail and top bar layout components that every screen renders inside.

**Program list**
> Following DESIGN.md section 6.1, build the program list screen using the DataTable component. Columns, alignment, default sort by countdown ascending, and the four filter counts above the table exactly as specified. Do not use card or tile components for the counts.

**Program detail**
> Following DESIGN.md section 6.2, build the program detail screen: two columns at roughly 70/30, tabbed sections on the left with the onboarding section rendering fields inline-editable with owner, assignee, due date, status pill and blocking marker, and a persistent non-scrolling right column in the order specified. Blocking bar full width above both columns. Include the unassigned count in the section header, the bulk reassign action, and the generate-onboarding flow with its disabled state, its two-step role resolution table, and the stated reasons on both, per SPEC.md section 4.

**Client dashboard**
> Following DESIGN.md section 6.3, build the client dashboard as a standalone page with no navigation and no left rail, served from a token URL at client.amzai.events/{org-slug}/{program-slug}. Large mono metrics with freshness markers, a single horizontal progress bar built without a chart library, a written summary given generous room, and the next milestone. Must work on a phone.

**Client onboarding form**
> Following DESIGN.md section 6.4 and SPEC.md section 6, build the client onboarding form at client.amzai.events/{org-slug}/{program-slug}/onboarding. Three screens: email entry with an identical neutral response for every address, expired-link, and the form itself. Use the existing tokens and components. Single 720px column, larger touch targets, saves on blur per field, progress line and outstanding list, blocking bar, Amzai-owned fields not rendered. No Supabase Auth and no client account. Must work at 360px.

**Review**
> Review every screen you have built against DESIGN.md, section by section. List anything that deviates, including anything in section 8 that has crept in. Fix each one and tell me what you changed.

Run that last prompt after every few screens. It is the thing that stops module eight looking nothing like module one.
