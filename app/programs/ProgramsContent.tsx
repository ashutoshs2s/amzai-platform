"use client";

import { useMemo, useState } from "react";

import { Countdown } from "@/components/Countdown";
import { type Column, DataTable } from "@/components/DataTable";
import { StatusPill } from "@/components/StatusPill";
import { Select, TextInput } from "@/components/form/Field";
import {
  NO_SUB_VERTICAL,
  type VerticalId,
  VERTICALS,
  subVerticalOptions,
  verticalLabel,
} from "@/lib/verticals";

import {
  OWNERS,
  PROGRAMME_TYPES,
  type Programme,
  SAMPLE_PROGRAMMES,
} from "./sample-data";

/** Which of the four counts is currently filtering the table. */
type CountFilter = "active" | "at_risk" | "blocked" | "awaiting_client" | null;

const COUNTS: { id: Exclude<CountFilter, null>; label: string; test: (p: Programme) => boolean }[] = [
  { id: "active", label: "Active", test: (p) => p.status === "active" },
  { id: "at_risk", label: "At risk", test: (p) => p.atRisk },
  { id: "blocked", label: "Blocked", test: (p) => p.hasBlocked },
  {
    id: "awaiting_client",
    label: "Awaiting client",
    test: (p) => p.awaitingClient,
  },
];

function addDays(base: Date, days: number): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function ProgramsContent({ nowIso }: { nowIso: string }) {
  const now = new Date(nowIso);

  const [vertical, setVertical] = useState<VerticalId | "all">("all");
  const [subVertical, setSubVertical] = useState<string | "all">("all");
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [owner, setOwner] = useState<string>("all");
  const [nameFilter, setNameFilter] = useState("");
  const [countFilter, setCountFilter] = useState<CountFilter>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const lawFirmsSelected = vertical === "law_firms";
  const availableSubVerticals = subVerticalOptions(vertical);

  /**
   * Changing the vertical narrows the sub-vertical list, so a sub-vertical
   * that no longer belongs is cleared rather than left behind as a filter that
   * silently matches nothing.
   */
  function changeVertical(next: VerticalId | "all") {
    setVertical(next);
    if (subVertical !== "all" && !subVerticalOptions(next).includes(subVertical)) {
      setSubVertical("all");
    }
  }

  // The counts describe the whole portfolio, not the filtered view. They are
  // how an operator finds the thing that needs them, so they cannot depend on
  // a filter already being right.
  const countValues = useMemo(
    () =>
      COUNTS.map((count) => ({
        ...count,
        value: SAMPLE_PROGRAMMES.filter(count.test).length,
      })),
    [],
  );

  const rows = useMemo(() => {
    return SAMPLE_PROGRAMMES.filter((programme) => {
      if (vertical !== "all" && programme.vertical !== vertical) return false;
      if (subVertical !== "all" && programme.subVertical !== subVertical) return false;
      if (type !== "all" && programme.type !== type) return false;
      if (status !== "all" && programme.status !== status) return false;
      if (owner !== "all" && programme.owner !== owner) return false;
      if (
        nameFilter.trim() &&
        !programme.name.toLowerCase().includes(nameFilter.trim().toLowerCase())
      ) {
        return false;
      }
      if (countFilter) {
        const count = COUNTS.find((entry) => entry.id === countFilter);
        if (count && !count.test(programme)) return false;
      }
      return true;
    });
  }, [vertical, subVertical, type, status, owner, nameFilter, countFilter]);

  const activeFilterCount =
    (vertical !== "all" ? 1 : 0) +
    (subVertical !== "all" ? 1 : 0) +
    (type !== "all" ? 1 : 0) +
    (status !== "all" ? 1 : 0) +
    (owner !== "all" ? 1 : 0) +
    (nameFilter.trim() ? 1 : 0) +
    (countFilter ? 1 : 0);

  function clearFilters() {
    setVertical("all");
    setSubVertical("all");
    setType("all");
    setStatus("all");
    setOwner("all");
    setNameFilter("");
    setCountFilter(null);
  }

  const columns: Column<Programme>[] = [
    {
      key: "name",
      header: "Program",
      cell: (row) => <span className="font-medium text-ink">{row.name}</span>,
      sortValue: (row) => row.name,
    },
    {
      key: "vertical",
      header: "Vertical",
      width: "170px",
      cell: (row) => <span className="text-slate">{verticalLabel(row.vertical)}</span>,
      sortValue: (row) => verticalLabel(row.vertical),
    },
    {
      key: "subVertical",
      header: "Sub-vertical",
      width: "170px",
      cell: (row) =>
        row.subVertical ? (
          <span className="text-slate">{row.subVertical}</span>
        ) : (
          // A dash, not a blank. Blank reads as missing; a dash reads as
          // deliberately not applicable.
          <span className="text-slate" title="Law Firms are not subdivided">
            {NO_SUB_VERTICAL}
          </span>
        ),
      sortValue: (row) => row.subVertical ?? "",
    },
    {
      key: "type",
      header: "Type",
      width: "130px",
      cell: (row) => <span className="text-slate">{row.type}</span>,
      sortValue: (row) => row.type,
    },
    {
      key: "countdown",
      header: "Countdown",
      align: "right",
      width: "200px",
      cell: (row) =>
        row.time.kind === "event" ? (
          <Countdown
            kind="event"
            milestoneDate={addDays(now, row.time.milestoneOffset)}
            now={now}
          />
        ) : (
          <Countdown
            kind="retainer"
            startDate={addDays(now, row.time.startOffset)}
            endDate={addDays(now, row.time.endOffset)}
            gateDate={
              row.time.gateOffset === null ? null : addDays(now, row.time.gateOffset)
            }
            now={now}
          />
        ),
      sortValue: (row) => row.urgencyDays,
    },
    {
      key: "owner",
      header: "Owner",
      width: "150px",
      cell: (row) => <span className="text-slate">{row.owner}</span>,
      sortValue: (row) => row.owner,
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

  const filters = (
    <>
      <Select
        aria-label="Vertical"
        value={vertical}
        onChange={(event) => changeVertical(event.target.value as VerticalId | "all")}
       
      >
        <option value="all">All verticals</option>
        {VERTICALS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </Select>

      {/*
        Disabled rather than hidden when Law Firms is selected. A control that
        vanishes makes the operator wonder what they did.
      */}
      <Select
        aria-label="Sub-vertical"
        value={lawFirmsSelected ? NO_SUB_VERTICAL : subVertical}
        disabled={lawFirmsSelected}
        title={
          lawFirmsSelected ? "Law Firms are not subdivided" : undefined
        }
        onChange={(event) => setSubVertical(event.target.value)}
       
      >
        {lawFirmsSelected ? (
          <option value={NO_SUB_VERTICAL}>{NO_SUB_VERTICAL}</option>
        ) : (
          <>
            <option value="all">All sub-verticals</option>
            {availableSubVerticals.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </>
        )}
      </Select>

      <Select
        aria-label="Type"
        value={type}
        onChange={(event) => setType(event.target.value)}
       
      >
        <option value="all">All types</option>
        {PROGRAMME_TYPES.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
       
      >
        <option value="all">All statuses</option>
        <option value="onboarding">Onboarding</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="complete">Complete</option>
      </Select>

      <Select
        aria-label="Owner"
        value={owner}
        onChange={(event) => setOwner(event.target.value)}
       
      >
        <option value="all">All owners</option>
        {OWNERS.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </Select>

      <TextInput
        aria-label="Filter by programme name"
        placeholder="Filter by name"
        value={nameFilter}
        onChange={(event) => setNameFilter(event.target.value)}
        className="w-56"
      />
    </>
  );

  return (
    <main className="px-6 py-6">
      <h1 className="text-page-title font-semibold">Programs</h1>

      {/*
        The four counts. Text and number, not cards and not tiles. A programme
        can appear in more than one, so these will not sum to the row count.
      */}
      <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-line pb-3">
        {countValues.map((count) => {
          const isActive = countFilter === count.id;
          return (
            <button
              key={count.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setCountFilter(isActive ? null : count.id)}
              className={`rounded-base ${
                isActive ? "text-accent" : "text-ink hover:text-accent"
              }`}
            >
              <span
                className={`font-time text-body ${isActive ? "font-medium" : ""}`}
              >
                {count.value}
              </span>{" "}
              <span
                className={`text-body ${
                  isActive ? "font-medium underline underline-offset-4" : "text-slate"
                }`}
              >
                {count.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          noun={{ one: "program", other: "programs" }}
          defaultSort={{ key: "countdown", direction: "asc" }}
          selectedKey={opened}
          onRowClick={(row) => setOpened(row.id)}
          filters={filters}
          activeFilterCount={activeFilterCount}
          onClearFilters={clearFilters}
          emptyMessage="No programs match these filters."
        />
      </div>

      <p className="mt-3 text-caption text-slate">
        Sample data, not a database. Clicking a row selects it; the programme
        detail screen does not exist yet.
      </p>
    </main>
  );
}
