"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Countdown } from "@/components/Countdown";
import { type Column, DataTable } from "@/components/DataTable";
import { StatusPill } from "@/components/StatusPill";
import { Select, TextInput } from "@/components/form/Field";
import { NO_SUB_SEGMENT, type ClientType } from "@/lib/taxonomy";

import type { ProgrammeRow } from "@/lib/data/programmes";

/** Which of the four counts is currently filtering the table. */
type CountFilter = "active" | "at_risk" | "blocked" | "awaiting_client" | null;

const COUNTS: {
  id: Exclude<CountFilter, null>;
  label: string;
  test: (p: ProgrammeRow) => boolean;
  /** Status colour the number carries when above zero. Absent means none. */
  tone?: string;
}[] = [
  { id: "active", label: "Active", test: (p) => p.status === "active" },
  { id: "at_risk", label: "At risk", test: (p) => p.atRisk, tone: "text-watch" },
  {
    id: "blocked",
    label: "Blocked",
    test: (p) => p.hasBlocked,
    tone: "text-critical",
  },
  {
    id: "awaiting_client",
    label: "Awaiting client",
    test: (p) => p.awaitingClient,
  },
];

export function ProgramsContent({
  nowIso,
  programmes,
  owners,
  types,
  clientTypes,
  canCreate,
}: {
  nowIso: string;
  programmes: ProgrammeRow[];
  owners: string[];
  types: { value: string; label: string }[];
  clientTypes: ClientType[];
  /** Creating a client is an admin job. SPEC.md section 5. */
  canCreate: boolean;
}) {
  const now = new Date(nowIso);
  const router = useRouter();

  const [clientType, setClientType] = useState<string>("all");
  const [subSegment, setSubSegment] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [owner, setOwner] = useState<string>("all");
  const [nameFilter, setNameFilter] = useState("");
  const [countFilter, setCountFilter] = useState<CountFilter>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const selectedType = clientTypes.find((t) => t.id === clientType);
  // A client type with no sub-segments, as Law Firms has none. The control
  // stays and is disabled rather than vanishing.
  const typeHasNoSegments =
    selectedType !== undefined && selectedType.subSegments.length === 0;
  const availableSubSegments = selectedType
    ? selectedType.subSegments
    : clientTypes.flatMap((t) => t.subSegments);

  /**
   * Changing the vertical narrows the sub-vertical list, so a sub-vertical
   * that no longer belongs is cleared rather than left behind as a filter that
   * silently matches nothing.
   */
  function changeClientType(next: string) {
    setClientType(next);
    const allowed =
      next === "all"
        ? clientTypes.flatMap((t) => t.subSegments)
        : (clientTypes.find((t) => t.id === next)?.subSegments ?? []);
    if (subSegment !== "all" && !allowed.some((s) => s.id === subSegment)) {
      setSubSegment("all");
    }
  }

  // The counts describe the whole portfolio, not the filtered view. They are
  // how an operator finds the thing that needs them, so they cannot depend on
  // a filter already being right.
  const countValues = useMemo(
    () =>
      COUNTS.map((count) => ({
        ...count,
        value: programmes.filter(count.test).length,
      })),
    [programmes],
  );

  const rows = useMemo(() => {
    return programmes.filter((programme) => {
      if (clientType !== "all" && programme.clientTypeId !== clientType) return false;
      if (subSegment !== "all" && programme.subSegmentId !== subSegment) return false;
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
  }, [programmes, clientType, subSegment, type, status, owner, nameFilter, countFilter]);

  const activeFilterCount =
    (clientType !== "all" ? 1 : 0) +
    (subSegment !== "all" ? 1 : 0) +
    (type !== "all" ? 1 : 0) +
    (status !== "all" ? 1 : 0) +
    (owner !== "all" ? 1 : 0) +
    (nameFilter.trim() ? 1 : 0) +
    (countFilter ? 1 : 0);

  function clearFilters() {
    setClientType("all");
    setSubSegment("all");
    setType("all");
    setStatus("all");
    setOwner("all");
    setNameFilter("");
    setCountFilter(null);
  }

  const columns: Column<ProgrammeRow>[] = [
    {
      key: "name",
      header: "Program",
      // Capped, so the name cannot absorb the table and push the countdown to
      // the far edge. The full name stays reachable on hover.
      width: "200px",
      truncate: true,
      cell: (row) => (
        <span className="font-medium text-ink" title={row.name}>
          {row.name}
        </span>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: "clientType",
      header: "Client type",
      width: "160px",
      truncate: true,
      cell: (row) => (
        <span className="text-slate" title={row.clientTypeLabel}>
          {row.clientTypeLabel}
        </span>
      ),
      sortValue: (row) => row.clientTypeLabel,
    },
    {
      key: "subSegment",
      header: "Sub-segment",
      width: "165px",
      truncate: true,
      cell: (row) =>
        row.subSegmentLabel ? (
          // The category sits beneath this and is shown on the record, not
          // here: it is free text and would not fit a column.
          <span
            className="text-slate"
            title={
              row.category
                ? `${row.subSegmentLabel} · ${row.category}`
                : row.subSegmentLabel
            }
          >
            {row.subSegmentLabel}
          </span>
        ) : (
          // A dash, not a blank. Blank reads as missing; a dash reads as
          // deliberately not applicable.
          <span className="text-slate" title="This client type is not subdivided">
            {NO_SUB_SEGMENT}
          </span>
        ),
      sortValue: (row) => row.subSegmentLabel ?? "",
    },
    {
      key: "type",
      header: "Type",
      width: "120px",
      truncate: true,
      cell: (row) => (
        <span className="text-slate" title={row.typeLabel}>{row.typeLabel}</span>
      ),
      sortValue: (row) => row.typeLabel,
    },
    {
      key: "countdown",
      header: "Countdown",
      align: "right",
      width: "195px",
      cell: (row) =>
        row.time === null ? (
          // A programme with no dates set yet. A dash, not a blank.
          <span className="text-slate" title="No dates set">
            —
          </span>
        ) : row.time.kind === "event" ? (
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
      width: "120px",
      truncate: true,
      cell: (row) => (
        <span className="text-slate" title={row.owner}>
          {row.owner}
        </span>
      ),
      sortValue: (row) => row.owner,
    },
    {
      key: "blocking",
      header: "Blocking",
      align: "right",
      width: "80px",
      // The platform's central concept. Above zero it carries the critical
      // colour at medium weight, so it reads as loudly as it matters; at zero
      // it drops to slate and gets out of the way.
      cell: (row) => (
        <span
          className={`font-time text-time ${
            row.blocking > 0 ? "font-medium text-critical" : "text-slate"
          }`}
          title={row.blocking > 0 ? `${row.blocking} blocking` : "None blocking"}
        >
          {row.blocking}
        </span>
      ),
      sortValue: (row) => row.blocking,
    },
    {
      key: "status",
      header: "Status",
      // Sized to its content like every other column. The table ends here
      // rather than stretching, so there is no slack to absorb.
      width: "125px",
      cell: (row) => <StatusPill status={row.status} />,
      sortValue: (row) => row.status,
    },
  ];

  /*
    One bordered cluster, not five floating boxes. The group draws the box and
    the dividers; each control is bare inside it. DESIGN.md section 5.
  */
  const filters = (
    <div className="inline-flex flex-wrap items-center divide-x divide-line overflow-hidden rounded-base border border-line bg-surface-head">
      <Select
        bare
        className="w-[132px]"
        aria-label="Client type"
        value={clientType}
        onChange={(event) => changeClientType(event.target.value)}
      >
        <option value="all">All client types</option>
        {clientTypes.map((entry) => (
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
        bare
        className="w-[150px]"
        aria-label="Sub-segment"
        value={typeHasNoSegments ? NO_SUB_SEGMENT : subSegment}
        disabled={typeHasNoSegments}
        title={
          typeHasNoSegments
            ? `${selectedType?.label} is not subdivided`
            : undefined
        }
        onChange={(event) => setSubSegment(event.target.value)}
      >
        {typeHasNoSegments ? (
          <option value={NO_SUB_SEGMENT}>{NO_SUB_SEGMENT}</option>
        ) : (
          <>
            <option value="all">All sub-segments</option>
            {availableSubSegments.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </>
        )}
      </Select>

      <Select
        bare
        className="w-[92px]"
        aria-label="Type"
        value={type}
        onChange={(event) => setType(event.target.value)}
      >
        <option value="all">All types</option>
        {types.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </Select>

      <Select
        bare
        className="w-[100px]"
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
        bare
        className="w-[96px]"
        aria-label="Owner"
        value={owner}
        onChange={(event) => setOwner(event.target.value)}
      >
        <option value="all">All owners</option>
        {owners.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </Select>

      <TextInput
        bare
        aria-label="Filter by programme name"
        placeholder="Filter by name"
        value={nameFilter}
        onChange={(event) => setNameFilter(event.target.value)}
        className="w-[136px]"
      />
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-page-title font-semibold text-ink">Programs</h1>
        {/*
          The one action that starts something here, so it is the one primary
          on the screen. Admin only, and absent rather than disabled for
          everyone else: a control that can never work is not a control.
          DESIGN.md section 5.
        */}
        {canCreate && (
          <Link
            href="/clients/new"
            className="inline-flex h-8 items-center justify-center rounded-base bg-accent px-3 text-body font-medium text-surface transition-colors hover:opacity-90"
          >
            New client
          </Link>
        )}
      </div>

      {/*
        The four counts, as controls rather than a caption: hairline border,
        hover state, filled pressed state. Not tiles — 36px high, no large
        numerals, no trend arrows, no shadow. A programme can appear in more
        than one, so these will not sum to the row count.
      */}
      <div className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-base border border-line bg-surface p-2">
        {countValues.map((count) => {
          const isActive = countFilter === count.id;
          const carriesStatus = count.value > 0 && count.tone !== undefined;
          return (
            <button
              key={count.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setCountFilter(isActive ? null : count.id)}
              className={`inline-flex h-9 items-center gap-2 rounded-base border px-3 transition-colors ${
                isActive
                  ? "border-accent bg-accent-sub text-ink"
                  : "border-line bg-surface text-ink hover:bg-canvas"
              }`}
            >
              <span
                className={`font-time text-time font-medium ${
                  carriesStatus ? count.tone : "text-slate"
                }`}
              >
                {count.value}
              </span>
              {/*
                The word is always present, so the colour on the number is
                never carrying the meaning by itself. Section 7.
              */}
              <span className="text-body font-medium">{count.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          noun={{ one: "program", other: "programs" }}
          defaultSort={{ key: "countdown", direction: "asc" }}
          layout="fixed"
          selectedKey={opened}
          onRowClick={(row) => {
            setOpened(row.id);
            router.push(`/programs/${row.id}`);
          }}
          filters={filters}
          activeFilterCount={activeFilterCount}
          onClearFilters={clearFilters}
          emptyMessage={
            programmes.length === 0
              ? "No programs yet."
              : "No programs match these filters."
          }
          emptyActionLabel={programmes.length === 0 ? "New program" : undefined}
        />
      </div>

      <p className="mt-3 text-caption text-slate">
        Click a row to open the programme.
      </p>
    </div>
  );
}
