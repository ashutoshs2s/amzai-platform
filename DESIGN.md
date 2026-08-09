# DESIGN.md
## Amzai Operations Platform: design system

**How to use this file.** Save it in your repo root as `DESIGN.md`. Then create a `CLAUDE.md` in the same folder containing the line: *Always read and follow DESIGN.md before building or changing any interface.* Claude Code reads that file automatically at the start of every session, so the system holds across sessions instead of being re-explained each time.

Paste-ready prompts are in the appendix.

---

## 1. What this product is

An operations console for a team running executive events and demand programmes for clients. Five to fifteen operators live in it daily under time pressure. Clients see one generated dashboard.

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
--slate:      #5B6270   /* secondary text, labels */
--mute:       #8B92A0   /* tertiary, placeholder, disabled */
--line:       #E3E5E9   /* borders, dividers, table rules */
--surface:    #FFFFFF   /* cards, tables, panels */
--canvas:     #F7F8FA   /* page background */
--accent:     #1F5F5B   /* interactive: links, primary buttons, focus */
--accent-sub: #E8F1F0   /* accent background wash, selected rows */
```

Status colours, used only for status. Never decoratively.

```
--clear:      #157347   /* on track, approved, confirmed */
--clear-bg:   #E9F5EE
--watch:      #B26B00   /* at risk, due soon, awaiting */
--watch-bg:   #FDF3E3
--critical:   #B3261E   /* blocking, overdue, failed */
--critical-bg:#FBEAE9
--idle:       #5B6270   /* not started, N/A, complete */
--idle-bg:    #F0F1F4
```

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
| Caption | 11px | 400 | Mute |

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

Map every status in the platform to one of the five semantic states rather than inventing new colours per module. Approved, confirmed and on track are all `clear`. Submitted, awaiting and due soon are all `watch`. Blocked, overdue and failed are all `critical`.

### Countdown

The most-used element in the platform. Mono, tabular.

Format: `T-24d` for events, `W6 of 13` for retainers. Absolute date shown beside it in slate at 12px.

Colour thresholds, applied to the countdown text itself:
- More than 30 days or before the halfway week: `--ink`
- 8 to 30 days, or past halfway: `--watch`
- 7 days or fewer, or past the gate week: `--critical`
- Past the date: `--critical`, prefixed `T+`

### Blocking items

The platform's central concept and it must never be a status among statuses.

Anywhere a record has open blocking items, show a persistent bar at the top of that record: `--critical-bg` fill, `--critical` left border 3px, one line of text naming the count and the oldest item, and a link that filters to them. It does not collapse and it does not dismiss. It disappears when the items are cleared and not before.

### Empty, loading, error

- **Empty** states name what would be here and give the action that creates it. `No programs yet.` with a `New program` button. Never an illustration, never "Nothing to see here".
- **Loading** uses skeleton rows at true row height so the layout does not jump. No spinners in table areas.
- **Errors** say what failed and what to do. `Could not load programs. Retry.` No apology, no error code unless it is actionable.

### Data freshness

Critical, because dashboard figures are partly hand-entered.

Every number that is not live carries a freshness marker beneath or beside it: `Updated 4 Aug · manual` in 11px mute. If a manually entered figure is more than 7 days old, the marker turns `--watch`. More than 14 days, `--critical`. A stale number that looks current is worse than no number.

### Forms

- Label above field, 12px slate. Never placeholder-as-label.
- 32px field height, 1px `--line` border, 4px radius, accent border on focus with a visible 2px focus ring.
- Inline editing in tables and record views: click to edit, save on blur, show a brief `Saved` in clear for 2 seconds. No modal for single-field edits.
- Destructive actions require typed confirmation, not just a second click.

---

## 6. The three screens to design first

Everything else assembles from these.

### 6.1 Program list

The default landing screen. A table of every program across both entities.

Columns: Program, Client, Type, Countdown, Phase, Owner, Blocking, Status. Countdown and Blocking are mono and right-aligned. Blocking shows a count, rendered in `--critical` when above zero and `--mute` when zero.

Default sort: countdown ascending, so the most urgent sits at the top without anyone choosing to sort. This single default is most of what makes the screen useful.

Above the table, a single row of four counts: Active, At risk, Blocked, Awaiting client. Each filters the table when clicked. These are text and number, not cards, not tiles.

### 6.2 Program detail

Where the team spends most of its time. Two columns.

**Left, primary, roughly 70%.** Tabbed sections: Onboarding, Tasks, Audience, Attendees, Reports, Commercial. Onboarding renders as its sections with each field showing question, response, owner, due date, status pill and a blocking marker. Fields are inline editable. Sections show a completion count in their header: `Audience · 6 of 9`.

**Right, persistent, roughly 30%.** Does not scroll away. Contains, in this order: the countdown, the next milestone with date, the blocking item count, the named client approver, the assigned team, and the last five audit entries in plain language. This column is the answer to "what is the state of this program" without reading anything else.

The blocking bar from section 5 sits above both columns, full width.

### 6.3 Client dashboard

The only external surface. Different rules apply: this one is presentation.

Single column, generous spacing, no left rail, no navigation. Amzai mark top left, client name top right, generated date beneath.

Three to five metrics as large mono figures with plain labels beneath, each carrying its freshness marker. Then progress against target as a single horizontal bar, not a chart library. Then a short written summary, which is the most valuable thing on the page and should be given the most room. Then next milestone with its date.

No interactive filters, no drilldowns, no navigation off the page. It is a report that happens to be on the web, and it should read as considered rather than as a screenshot of an internal tool.

---

## 7. Quality floor

Not optional, not announced.

- Keyboard navigable throughout. Visible focus ring on every interactive element, 2px accent.
- `/` focuses global search. `Esc` closes any overlay.
- Contrast 4.5:1 minimum on all text. Check the amber, which is the one at risk.
- Status never communicated by colour alone. Always a word beside it.
- `prefers-reduced-motion` respected. Transitions capped at 150ms regardless.
- Internal screens are desktop-first and need not work below 1024px. The client dashboard must work on a phone.

---

## 8. Things not to build

Recorded because they are the defaults an AI will otherwise reach for.

Card grids where a table would do. KPI tiles with large coloured numbers and trend arrows. Gradient headers. Illustrated empty states. Chart libraries for a single percentage. Collapsible sidebars that hide the filters. Modals for editing one field. Toast notifications for routine saves. Dark mode. Rounded corners above 4px. Drop shadows on static panels. Emoji in the interface.

---

# Appendix: prompts for Claude Code

Paste these in order. They replace prompt 6 in the Build Kit.

**Set up the system**
> Read DESIGN.md in the repo root. Set up the design tokens from section 3 as CSS custom properties in a global stylesheet, configure Tailwind to use them, and load Inter and IBM Plex Mono. Then build the shared components from section 5: DataTable, StatusPill, Countdown, BlockingBar, EmptyState, FreshnessMarker, and the form field components. Build them as reusable components with sensible props, not as one-off markup. Show me a single page that renders every component in every state so I can review them together before we use them anywhere.

**App shell**
> Following DESIGN.md section 4, build the app shell: persistent 220px left rail with the eight modules, fixed 52px top bar with global search bound to the "/" key, current program context, and the awaiting-me count. Content area on canvas background. Make the rail and top bar layout components that every screen renders inside.

**Program list**
> Following DESIGN.md section 6.1, build the program list screen using the DataTable component. Columns, alignment, default sort by countdown ascending, and the four filter counts above the table exactly as specified. Do not use card or tile components for the counts.

**Program detail**
> Following DESIGN.md section 6.2, build the program detail screen: two columns at roughly 70/30, tabbed sections on the left with the onboarding section rendering fields inline-editable with owner, due date, status pill and blocking marker, and a persistent non-scrolling right column in the order specified. Blocking bar full width above both columns.

**Client dashboard**
> Following DESIGN.md section 6.3, build the client dashboard as a standalone page with no navigation and no left rail, served from a token URL. Large mono metrics with freshness markers, a single horizontal progress bar built without a chart library, a written summary given generous room, and the next milestone. Must work on a phone.

**Review**
> Review every screen you have built against DESIGN.md, section by section. List anything that deviates, including anything in section 8 that has crept in. Fix each one and tell me what you changed.

Run that last prompt after every few screens. It is the thing that stops module eight looking nothing like module one.
