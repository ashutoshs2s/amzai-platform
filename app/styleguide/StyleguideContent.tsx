"use client";

import { useState } from "react";

import { BlockingBar } from "@/components/BlockingBar";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { type Column, DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FreshnessMarker } from "@/components/FreshnessMarker";
import { StatusPill } from "@/components/StatusPill";
import { DestructiveConfirm } from "@/components/form/DestructiveConfirm";
import { Field, Select, Textarea, TextInput } from "@/components/form/Field";
import { InlineEdit } from "@/components/form/InlineEdit";
import { contrastRatio } from "@/lib/contrast";

/* ===========================================================================
   Sample content
   =========================================================================== */

type Programme = {
  id: string;
  name: string;
  client: string;
  type: string;
  owner: string;
  blocking: number;
  status: string;
  /** Days from now until the thing that matters. Drives the default sort. */
  urgencyDays: number;
  time:
    | { kind: "event"; milestoneDate: string }
    | {
        kind: "retainer";
        startDate: string;
        endDate: string;
        gateDate?: string;
      };
};

function addDays(base: Date, days: number): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function buildProgrammes(now: Date): Programme[] {
  return [
    {
      id: "p1",
      name: "Financial Services GC Roundtable",
      client: "Bramwell Cooper LLP",
      type: "Event",
      owner: "Priya Raman",
      blocking: 3,
      status: "active",
      urgencyDays: 4,
      time: { kind: "event", milestoneDate: addDays(now, 4) },
    },
    {
      id: "p2",
      name: "Vantage Exhibitor Roundtable",
      client: "Vantage Trade Shows",
      type: "Event",
      owner: "Daniel Okoro",
      blocking: 4,
      status: "paused",
      urgencyDays: -6,
      time: { kind: "event", milestoneDate: addDays(now, -6) },
    },
    {
      id: "p3",
      name: "Q4 CISO Dinner Series",
      client: "Kestrel MedTech",
      type: "Series",
      owner: "Daniel Okoro",
      blocking: 0,
      status: "active",
      urgencyDays: 19,
      time: { kind: "event", milestoneDate: addDays(now, 19) },
    },
    {
      id: "p4",
      name: "AmLaw 100 Partner Briefing",
      client: "Aldgate Legal Media",
      type: "Event",
      owner: "Sana Iqbal",
      blocking: 1,
      status: "onboarding",
      urgencyDays: 62,
      time: { kind: "event", milestoneDate: addDays(now, 62) },
    },
    {
      id: "p5",
      name: "Association Growth Programme",
      client: "Nordhaven Associations",
      type: "Dedicated team",
      owner: "Ana Beltrán",
      blocking: 2,
      status: "active",
      urgencyDays: 28,
      // Week 9 of 13, past the gate.
      time: {
        kind: "retainer",
        startDate: addDays(now, -59),
        endDate: addDays(now, 32),
        gateDate: addDays(now, -3),
      },
    },
    {
      id: "p6",
      name: "Legal Ops Advisory Retainer",
      client: "Nordhaven Associations",
      type: "Retainer",
      owner: "Tom Whitfield",
      blocking: 0,
      status: "active",
      urgencyDays: 77,
      // Week 3 of 13, well before the gate.
      time: {
        kind: "retainer",
        startDate: addDays(now, -15),
        endDate: addDays(now, 76),
        gateDate: addDays(now, 40),
      },
    },
    {
      id: "p7",
      name: "MedTech Buyer Intelligence",
      client: "Kestrel MedTech",
      type: "Research",
      owner: "Priya Raman",
      blocking: 0,
      status: "complete",
      urgencyDays: -11,
      // Ran past its end date.
      time: {
        kind: "retainer",
        startDate: addDays(now, -102),
        endDate: addDays(now, -11),
        gateDate: addDays(now, -25),
      },
    },
  ];
}

/* ===========================================================================
   Layout helpers, local to this page
   =========================================================================== */

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line pt-6">
      <h2 className="text-section font-semibold uppercase tracking-[0.04em] text-slate">
        {title}
      </h2>
      {note && <p className="mt-1 max-w-3xl text-body text-slate">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Case({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-slate">{label}</span>
      <div>{children}</div>
    </div>
  );
}

/* ===========================================================================
   Tokens, for the swatch and contrast panels
   =========================================================================== */

const TOKENS: { name: string; value: string; use: string }[] = [
  { name: "--ink", value: "#14161A", use: "primary text, headers" },
  { name: "--slate", value: "#5B6270", use: "secondary text, labels" },
  { name: "--mute", value: "#8B92A0", use: "placeholder and disabled text only" },
  { name: "--line", value: "#E3E5E9", use: "borders, dividers, table rules" },
  { name: "--surface", value: "#FFFFFF", use: "cards, tables, panels" },
  { name: "--canvas", value: "#F7F8FA", use: "page background" },
  { name: "--accent", value: "#1F5F5B", use: "links, primary buttons, focus" },
  { name: "--accent-sub", value: "#E8F1F0", use: "accent wash, selected rows" },
  { name: "--clear", value: "#157347", use: "on track, approved, confirmed" },
  { name: "--clear-bg", value: "#E9F5EE", use: "clear background" },
  { name: "--watch", value: "#9A5D00", use: "at risk, due soon, awaiting" },
  { name: "--watch-bg", value: "#FDF3E3", use: "watch background" },
  { name: "--critical", value: "#B3261E", use: "blocking, overdue, failed" },
  { name: "--critical-bg", value: "#FBEAE9", use: "critical background" },
  { name: "--idle", value: "#5B6270", use: "not started, N/A, complete" },
  { name: "--idle-bg", value: "#F0F1F4", use: "idle background" },
];

const CONTRAST_PAIRS: {
  fg: string;
  fgHex: string;
  bg: string;
  bgHex: string;
  /** Placeholder and disabled text is exempt from the 4.5:1 floor. */
  exempt?: string;
}[] = [
  { fg: "ink", fgHex: "#14161A", bg: "surface", bgHex: "#FFFFFF" },
  { fg: "slate", fgHex: "#5B6270", bg: "surface", bgHex: "#FFFFFF" },
  {
    fg: "mute",
    fgHex: "#8B92A0",
    bg: "surface",
    bgHex: "#FFFFFF",
    exempt: "placeholder and disabled only",
  },
  {
    fg: "mute",
    fgHex: "#8B92A0",
    bg: "canvas",
    bgHex: "#F7F8FA",
    exempt: "placeholder and disabled only",
  },
  { fg: "accent", fgHex: "#1F5F5B", bg: "surface", bgHex: "#FFFFFF" },
  { fg: "accent", fgHex: "#1F5F5B", bg: "accent-sub", bgHex: "#E8F1F0" },
  { fg: "clear", fgHex: "#157347", bg: "clear-bg", bgHex: "#E9F5EE" },
  { fg: "watch", fgHex: "#9A5D00", bg: "surface", bgHex: "#FFFFFF" },
  { fg: "watch", fgHex: "#9A5D00", bg: "canvas", bgHex: "#F7F8FA" },
  { fg: "watch", fgHex: "#9A5D00", bg: "watch-bg", bgHex: "#FDF3E3" },
  { fg: "critical", fgHex: "#B3261E", bg: "critical-bg", bgHex: "#FBEAE9" },
  { fg: "idle", fgHex: "#5B6270", bg: "idle-bg", bgHex: "#F0F1F4" },
];

const TYPE_ROLES: { role: string; className: string; sample: string }[] = [
  { role: "Page title · 20px / 600", className: "text-page-title font-semibold", sample: "Financial Services GC Roundtable" },
  { role: "Section heading · 13px / 600 uppercase 0.04em slate", className: "text-section font-semibold uppercase tracking-[0.04em] text-slate", sample: "Onboarding" },
  { role: "Body and table cell · 13px / 400", className: "text-body", sample: "Attendee list confirmed with the client's events team." },
  { role: "Table header · 12px / 500 slate uppercase 0.04em", className: "text-table-header font-medium uppercase tracking-[0.04em] text-slate", sample: "Countdown" },
  { role: "Label · 12px / 500 slate", className: "text-label font-medium text-slate", sample: "Delivery lead" },
  { role: "Metric, large · 28px / 500 mono tabular", className: "text-metric font-medium font-time", sample: "148" },
  { role: "Time and count · 13px / 400 mono tabular", className: "text-body font-time", sample: "T-24d" },
  { role: "Caption · 11px / 400 slate", className: "text-caption text-slate", sample: "Updated 4 Aug · manual" },
];

const RESPONSE_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "approved",
  "blocked",
  "na",
];

const PROGRAMME_STATUSES = ["onboarding", "active", "paused", "complete"];

/* ===========================================================================
   The page
   =========================================================================== */

export function StyleguideContent({ nowIso }: { nowIso: string }) {
  const now = new Date(nowIso);
  const programmes = buildProgrammes(now);

  const [selectedId, setSelectedId] = useState<string | null>("p1");
  const [clicked, setClicked] = useState<string | null>(null);
  const [filtersActive, setFiltersActive] = useState(2);
  const [showConfirm, setShowConfirm] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [inlineValue, setInlineValue] = useState("Bramwell Cooper LLP events team");
  const [inlineCount, setInlineCount] = useState("148");
  const [inlineNotes, setInlineNotes] = useState(
    "Client asked for a two-week gap between the briefing and the follow-up call.",
  );

  const columns: Column<Programme>[] = [
    {
      key: "name",
      header: "Program",
      cell: (row) => <span className="font-medium text-ink">{row.name}</span>,
      sortValue: (row) => row.name,
    },
    {
      key: "client",
      header: "Client",
      cell: (row) => <span className="text-slate">{row.client}</span>,
      sortValue: (row) => row.client,
    },
    {
      key: "type",
      header: "Type",
      cell: (row) => <span className="text-slate">{row.type}</span>,
      sortValue: (row) => row.type,
      width: "140px",
    },
    {
      key: "countdown",
      header: "Countdown",
      align: "right",
      width: "200px",
      cell: (row) =>
        row.time.kind === "event" ? (
          <Countdown kind="event" milestoneDate={row.time.milestoneDate} now={now} />
        ) : (
          <Countdown
            kind="retainer"
            startDate={row.time.startDate}
            endDate={row.time.endDate}
            gateDate={row.time.gateDate}
            now={now}
          />
        ),
      sortValue: (row) => row.urgencyDays,
    },
    {
      key: "owner",
      header: "Owner",
      cell: (row) => <span className="text-slate">{row.owner}</span>,
      sortValue: (row) => row.owner,
      width: "150px",
    },
    {
      key: "blocking",
      header: "Blocking",
      align: "right",
      width: "100px",
      cell: (row) => (
        <span
          className={`font-time ${row.blocking > 0 ? "text-critical" : "text-slate"}`}
        >
          {row.blocking}
        </span>
      ),
      sortValue: (row) => row.blocking,
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      cell: (row) => <StatusPill status={row.status} />,
      sortValue: (row) => row.status,
    },
  ];

  const filterRow = (
    <>
      <Select aria-label="Type" defaultValue="all" className="h-8 w-auto">
        <option value="all">All types</option>
        <option value="event">Event</option>
        <option value="retainer">Retainer</option>
      </Select>
      <Select aria-label="Status" defaultValue="all" className="h-8 w-auto">
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="onboarding">Onboarding</option>
      </Select>
      <Select aria-label="Owner" defaultValue="all" className="h-8 w-auto">
        <option value="all">All owners</option>
        <option value="priya">Priya Raman</option>
      </Select>
      <TextInput
        aria-label="Filter by name"
        placeholder="Filter by name"
        className="h-8 w-56"
      />
    </>
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-page-title font-semibold">Component styleguide</h1>
        <p className="mt-1 max-w-3xl text-body text-slate">
          Every shared component in every state, with sample content from the
          product. Built from DESIGN.md sections 3 and 5. Nothing here is a real
          screen; it exists to be reviewed before these components are used
          anywhere.
        </p>
      </header>

      <nav className="mb-8 flex flex-wrap gap-x-4 gap-y-1 border-y border-line py-2 text-label">
        {[
          ["colour", "Colour"],
          ["contrast", "Contrast audit"],
          ["type", "Type"],
          ["mono", "The mono rule"],
          ["status", "StatusPill"],
          ["countdown", "Countdown"],
          ["freshness", "FreshnessMarker"],
          ["blocking", "BlockingBar"],
          ["table", "DataTable"],
          ["table-states", "Table states"],
          ["forms", "Forms"],
          ["inline", "InlineEdit"],
          ["destructive", "Destructive"],
          ["buttons", "Buttons"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-accent underline underline-offset-2">
            {label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-8">
        {/* ---------------------------------------------------------------- */}
        <Section
          id="colour"
          title="Colour"
          note="Neutrals carry the interface. Colour carries meaning only. Status colours are never used decoratively."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TOKENS.map((token) => (
              <div key={token.name} className="border border-line bg-surface">
                <div className="h-12 border-b border-line" style={{ background: token.value }} />
                <div className="p-2">
                  <div className="font-time text-caption text-ink">{token.name}</div>
                  <div className="font-time text-caption text-slate">{token.value}</div>
                  <div className="mt-1 text-caption text-slate">{token.use}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="contrast"
          title="Contrast audit"
          note="DESIGN.md section 7 sets a floor of 4.5:1 on all meaningful text. These ratios are computed from the live token values, not asserted. Every meaningful pairing passes. The two mute rows are listed for completeness: mute is now reserved for placeholder and disabled text, which the floor exempts."
        >
          <div className="overflow-x-auto border border-line bg-surface">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr>
                  {["Foreground", "Background", "Ratio", "4.5:1"].map((header, index) => (
                    <th
                      key={header}
                      className={`border-b border-line px-3 py-2 text-table-header font-medium uppercase tracking-[0.04em] text-slate ${
                        index >= 2 ? "text-right" : "text-left"
                      }`}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CONTRAST_PAIRS.map((pair) => {
                  const ratio = contrastRatio(pair.fgHex, pair.bgHex);
                  const passes = ratio >= 4.5;
                  return (
                    <tr key={`${pair.fg}-${pair.bg}`} className="border-b border-line">
                      <td className="h-row px-3 font-time text-caption">{pair.fg}</td>
                      <td className="h-row px-3 font-time text-caption text-slate">
                        {pair.bg}
                        {pair.exempt && (
                          <>
                            {" "}
                            <span className="ml-1 font-ui text-caption text-slate">
                              — {pair.exempt}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="h-row px-3 text-right font-time">{ratio.toFixed(2)}</td>
                      <td className="h-row px-3 text-right">
                        {pair.exempt ? (
                          <StatusPill status="na" tone="idle" label="Exempt" />
                        ) : (
                          <StatusPill
                            status={passes ? "approved" : "blocked"}
                            label={passes ? "Pass" : "Fail"}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="type" title="Type" note="Inter for the interface, IBM Plex Mono for time and quantity.">
          <div className="flex flex-col gap-4 border border-line bg-surface p-4">
            {TYPE_ROLES.map((role) => (
              <div key={role.role} className="flex flex-col gap-1">
                <span className="text-caption text-slate">{role.role}</span>
                <span className={role.className}>{role.sample}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="mono"
          title="The mono rule"
          note="Time is set in monospace with tabular figures so temporal columns align exactly down the page. The left column below is mono, the right is the UI face. Only the left one scans."
        >
          <div className="grid max-w-lg grid-cols-2 gap-6 border border-line bg-surface p-4">
            <div>
              <div className="mb-2 text-caption text-slate">Mono, tabular</div>
              {["T-4d", "T-19d", "T-112d", "W6 of 13", "T+6d"].map((value) => (
                <div key={value} className="font-time text-body">
                  {value}
                </div>
              ))}
            </div>
            <div>
              <div className="mb-2 text-caption text-slate">UI face, for comparison</div>
              {["T-4d", "T-19d", "T-112d", "W6 of 13", "T+6d"].map((value) => (
                <div key={value} className="text-body">
                  {value}
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="status"
          title="StatusPill"
          note="One component, never restyled per module. Text only, no dot, no icon. Every product status maps onto a semantic tone."
        >
          <div className="flex flex-col gap-4">
            <Case label="The four defined tones">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status="approved" tone="clear" label="Clear" />
                <StatusPill status="submitted" tone="watch" label="Watch" />
                <StatusPill status="blocked" tone="critical" label="Critical" />
                <StatusPill status="not_started" tone="idle" label="Idle" />
              </div>
            </Case>

            <Case label="onboarding_responses.status, all six values">
              <div className="flex flex-wrap items-center gap-2">
                {RESPONSE_STATUSES.map((status) => (
                  <StatusPill key={status} status={status} />
                ))}
              </div>
            </Case>

            <Case label="programs.status, all four values">
              <div className="flex flex-wrap items-center gap-2">
                {PROGRAMME_STATUSES.map((status) => (
                  <StatusPill key={status} status={status} />
                ))}
              </div>
            </Case>

            <div className="border-l-[3px] border-line bg-canvas p-3 text-body text-slate">
              <strong className="font-medium text-ink">Settled.</strong> There are
              four semantic tones, not five: clear, watch, critical, idle.{" "}
              <span className="font-time">in_progress</span> maps to idle, because
              amber has to mean &ldquo;at risk&rdquo; or it stops meaning
              anything. DESIGN.md section 5 has been corrected to say four.
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="countdown"
          title="Countdown"
          note="The most-used element in the platform. Thresholds come from SPEC.md section 7.2. Colour is never the only signal: each carries a title attribute naming the state."
        >
          <div className="grid gap-4 border border-line bg-surface p-4 sm:grid-cols-2">
            <Case label="Event · more than 30 days · ink">
              <Countdown kind="event" milestoneDate={addDays(now, 62)} now={now} />
            </Case>
            <Case label="Event · 8 to 30 days · watch">
              <Countdown kind="event" milestoneDate={addDays(now, 19)} now={now} />
            </Case>
            <Case label="Event · 7 days or fewer · critical">
              <Countdown kind="event" milestoneDate={addDays(now, 4)} now={now} />
            </Case>
            <Case label="Event · past the date · critical, T+">
              <Countdown kind="event" milestoneDate={addDays(now, -6)} now={now} />
            </Case>
            <Case label="Retainer · before the gate · ink">
              <Countdown
                kind="retainer"
                startDate={addDays(now, -15)}
                endDate={addDays(now, 76)}
                gateDate={addDays(now, 40)}
                now={now}
              />
            </Case>
            <Case label="Retainer · on or after the gate · watch">
              <Countdown
                kind="retainer"
                startDate={addDays(now, -59)}
                endDate={addDays(now, 32)}
                gateDate={addDays(now, -3)}
                now={now}
              />
            </Case>
            <Case label="Retainer · past the end date · critical">
              <Countdown
                kind="retainer"
                startDate={addDays(now, -102)}
                endDate={addDays(now, -11)}
                gateDate={addDays(now, -25)}
                now={now}
              />
            </Case>
            <Case label="Retainer · no gate date set · stays ink">
              <Countdown
                kind="retainer"
                startDate={addDays(now, -30)}
                endDate={addDays(now, 61)}
                gateDate={null}
                now={now}
              />
            </Case>
            <Case label="Without the absolute date">
              <Countdown
                kind="event"
                milestoneDate={addDays(now, 19)}
                now={now}
                showDate={false}
              />
            </Case>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="freshness"
          title="FreshnessMarker"
          note="Every hand-entered figure carries one. Over 7 days it turns watch, over 14 critical. The reason is spelled out in words as well as colour."
        >
          <div className="grid gap-4 border border-line bg-surface p-4 sm:grid-cols-2">
            <Case label="Fresh · 2 days · manual">
              <FreshnessMarker updatedAt={addDays(now, -2)} source="manual" now={now} />
            </Case>
            <Case label="Fresh · today · automatic">
              <FreshnessMarker updatedAt={addDays(now, 0)} source="automatic" now={now} />
            </Case>
            <Case label="Ageing · 9 days · manual · watch">
              <FreshnessMarker updatedAt={addDays(now, -9)} source="manual" now={now} />
            </Case>
            <Case label="Out of date · 20 days · manual · critical">
              <FreshnessMarker updatedAt={addDays(now, -20)} source="manual" now={now} />
            </Case>
            <Case label="Exactly 7 days · still slate (boundary)">
              <FreshnessMarker updatedAt={addDays(now, -7)} source="manual" now={now} />
            </Case>
            <Case label="Exactly 14 days · watch, not yet critical (boundary)">
              <FreshnessMarker updatedAt={addDays(now, -14)} source="manual" now={now} />
            </Case>
            <Case label="Beneath a large metric, as on a dashboard">
              <div>
                <div className="font-time text-metric font-medium">148</div>
                <div className="text-label text-slate">Registrations</div>
                <FreshnessMarker
                  updatedAt={addDays(now, -9)}
                  source="manual"
                  now={now}
                  className="mt-1"
                />
              </div>
            </Case>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="blocking"
          title="BlockingBar"
          note="Never a status among statuses. It does not collapse and it does not dismiss, so there is no prop to make it do either. A count of zero renders nothing at all."
        >
          <div className="flex flex-col gap-4">
            <Case label="Internal wording · several items">
              <BlockingBar
                count={3}
                oldestLabel="Attendee list"
                oldestDueDate={addDays(now, -5)}
                onShow={() => undefined}
              />
            </Case>
            <Case label="Internal wording · a single item">
              <BlockingBar
                count={1}
                oldestLabel="Signed venue contract"
                oldestDueDate={addDays(now, -1)}
                onShow={() => undefined}
              />
            </Case>
            <Case label="Client wording, for the onboarding form · DESIGN.md 6.4">
              <BlockingBar
                count={3}
                oldestLabel="Attendee list"
                oldestDueDate={addDays(now, -5)}
                audience="client"
                onShow={() => undefined}
                showLabel="Show these"
              />
            </Case>
            <Case label="Without a filter link">
              <BlockingBar count={2} oldestLabel="Speaker biographies" oldestDueDate={addDays(now, 2)} />
            </Case>
            <Case label="Count of zero · renders nothing, deliberately">
              <div className="border border-dashed border-line p-3 text-caption text-slate">
                <BlockingBar count={0} oldestLabel="Nothing" />
                (empty by design — the bar disappears only when items are cleared)
              </div>
            </Case>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="table"
          title="DataTable"
          note="Sorted by countdown ascending by default, so the most urgent programme sits at the top without anyone choosing to sort. Click a header to re-sort, click a row to select it, tab through rows and press Enter."
        >
          <DataTable
            columns={columns}
            rows={programmes}
            rowKey={(row) => row.id}
            noun="programs"
            defaultSort={{ key: "countdown", direction: "asc" }}
            selectedKey={selectedId}
            onRowClick={(row) => {
              setSelectedId(row.id);
              setClicked(row.name);
            }}
            filters={filterRow}
            activeFilterCount={filtersActive}
            onClearFilters={() => setFiltersActive(0)}
          />
          <p className="mt-2 text-caption text-slate">
            {clicked ? `Row opened: ${clicked}` : "No row opened yet."}
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="table-states"
          title="Table states"
          note="Loading uses skeleton rows at the true 36px row height so the layout does not jump. Empty names what would be here and offers the action that creates it. Errors say what failed and what to do."
        >
          <div className="flex flex-col gap-6">
            <Case label="Loading">
              <DataTable
                columns={columns}
                rows={[]}
                rowKey={(row) => row.id}
                noun="programs"
                loading
                skeletonRows={5}
              />
            </Case>
            <Case label="Empty, with the action that creates one">
              <DataTable
                columns={columns}
                rows={[]}
                rowKey={(row) => row.id}
                noun="programs"
                emptyMessage="No programs yet."
                emptyActionLabel="New program"
                onEmptyAction={() => undefined}
              />
            </Case>
            <Case label="Error, with retry">
              <DataTable
                columns={columns}
                rows={[]}
                rowKey={(row) => row.id}
                noun="programs"
                error="Could not load programs."
                onRetry={() => undefined}
              />
            </Case>
            <Case label="Empty state on its own">
              <EmptyState message="No onboarding fields yet." actionLabel="Generate onboarding" />
            </Case>
            <Case label="Empty state without an action">
              <EmptyState message="No blocking items. Nothing is waiting on anyone." />
            </Case>
            <Case label="Error state with an actionable code">
              <ErrorState
                message="Could not reach Supabase."
                code="ECONNREFUSED"
                onRetry={() => undefined}
              />
            </Case>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="forms"
          title="Form fields"
          note="Label above the field, always. Never placeholder-as-label. 32px height, accent border on focus with a visible focus ring — tab into these to see it."
        >
          <div className="grid gap-4 border border-line bg-surface p-4 sm:grid-cols-2">
            <Field label="Programme name" htmlFor="sg-name" required>
              <TextInput id="sg-name" defaultValue="Financial Services GC Roundtable" />
            </Field>

            <Field label="Client" htmlFor="sg-client" hint="The organisation this programme belongs to.">
              <Select id="sg-client" defaultValue="bramwell">
                <option value="bramwell">Bramwell Cooper LLP</option>
                <option value="nordhaven">Nordhaven Associations</option>
                <option value="kestrel">Kestrel MedTech</option>
              </Select>
            </Field>

            <Field label="Registrations" htmlFor="sg-count" hint="A quantity, so it renders in the mono face.">
              <TextInput id="sg-count" mono defaultValue="148" inputMode="numeric" />
            </Field>

            <Field
              label="Approver email"
              htmlFor="sg-email"
              error="Enter an email address, for example name@client.com"
            >
              <TextInput id="sg-email" invalid defaultValue="rachel.okonjo" />
            </Field>

            <Field label="Guidance for the client" htmlFor="sg-notes" className="sm:col-span-2">
              <Textarea
                id="sg-notes"
                rows={3}
                defaultValue="Twelve to fifteen general counsel from firms above £50m revenue. Job titles matter more than headcount."
              />
            </Field>

            <Field label="Locked field" htmlFor="sg-disabled" hint="Disabled, because onboarding has been generated.">
              <TextInput id="sg-disabled" disabled defaultValue="Event" />
            </Field>

            <Field label="With a placeholder as a hint, never as the label" htmlFor="sg-ph">
              <TextInput id="sg-ph" placeholder="dd/mm/yyyy" />
            </Field>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="inline"
          title="InlineEdit"
          note="Click a value to edit it, then click away. It saves on blur and shows a brief Saved in clear. Escape cancels. No modal, no toast. The last example always fails, to show that your typing is kept."
        >
          <div className="grid gap-4 border border-line bg-surface p-4 sm:grid-cols-2">
            <Case label="Text · click to edit, click away to save">
              <InlineEdit
                value={inlineValue}
                onSave={(next) => setInlineValue(next)}
                ariaLabel="Client contact"
              />
            </Case>
            <Case label="Quantity · mono face">
              <InlineEdit
                value={inlineCount}
                onSave={(next) => setInlineCount(next)}
                ariaLabel="Registrations"
                mono
              />
            </Case>
            <Case label="Empty value · shows the placeholder in mute">
              <InlineEdit value="" onSave={() => undefined} ariaLabel="Venue" />
            </Case>
            <Case label="Multiline">
              <InlineEdit
                value={inlineNotes}
                onSave={(next) => setInlineNotes(next)}
                ariaLabel="Notes"
                multiline
              />
            </Case>
            <Case label="A save that fails · edit this one and click away">
              <InlineEdit
                value="This save always fails"
                onSave={() => {
                  throw new Error("simulated failure");
                }}
                ariaLabel="Failing field"
              />
            </Case>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="destructive"
          title="Destructive confirmation"
          note="Destructive actions require typed confirmation, not just a second click. The action stays disabled until the phrase matches exactly."
        >
          {showConfirm ? (
            <DestructiveConfirm
              description="Deleting this programme removes its onboarding responses and its client contacts. The audit trail is kept. This cannot be undone."
              confirmPhrase="Financial Services GC Roundtable"
              actionLabel="Delete programme"
              onConfirm={() => {
                setConfirmed(true);
                setShowConfirm(false);
              }}
              onCancel={() => setShowConfirm(false)}
            />
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-body text-slate">
                {confirmed ? "Confirmed." : "Cancelled."}
              </span>
              <Button
                onClick={() => {
                  setShowConfirm(true);
                  setConfirmed(false);
                }}
              >
                Show it again
              </Button>
            </div>
          )}
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="buttons"
          title="Buttons"
          note="Specified in DESIGN.md section 5. 32px high so it sits level with a field. Four variants, no others: primary, secondary, quiet, destructive."
        >
          <div className="flex flex-wrap items-center gap-3 border border-line bg-surface p-4">
            <Button variant="primary">New program</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="quiet">Clear filters</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="primary" disabled>
              Generate onboarding
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </div>
          <p className="mt-2 text-caption text-slate">
            The disabled primary is the generate-onboarding gate from SPEC.md
            section 4.2, which stays disabled until a team is assigned.
          </p>
        </Section>
      </div>
    </main>
  );
}
