"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { BlockingBar } from "@/components/BlockingBar";
import { Button } from "@/components/Button";
import { Countdown } from "@/components/Countdown";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { Select } from "@/components/form/Field";
import { InlineEdit } from "@/components/form/InlineEdit";
import { formatDayMonth } from "@/lib/time";
import {
  NO_SUB_VERTICAL,
  subVerticalLabel,
  verticalLabel,
} from "@/lib/verticals";
import {
  saveResponseAssignee,
  saveResponseText,
} from "@/lib/data/onboarding-actions";
import type { OnboardingField, ProgrammeDetail } from "@/lib/data/programmes";

const TABS = [
  "Onboarding",
  "Tasks",
  "Audience",
  "Attendees",
  "Reports",
  "Commercial",
] as const;

type Tab = (typeof TABS)[number];

const OWNER_LABEL: Record<string, string> = {
  client: "Client",
  amzai: "Amzai",
  both: "Both",
};

const ROLE_LABEL: Record<string, string> = {
  engagement_lead: "Engagement lead",
  delivery_lead: "Delivery lead",
  specialist: "Specialist",
  data_ops: "Data ops",
};

/**
 * A client-owned field has no assignee by design (SPEC.md section 4.3), so it
 * is not unassigned work. Only Amzai-owned fields with nobody on them count.
 */
function countsAsUnassigned(field: OnboardingField): boolean {
  return field.assignee === null && field.owner !== "client";
}

/** Counts open on a field: not approved and not N/A. SPEC.md section 7.3. */
function isOpen(field: OnboardingField): boolean {
  return field.status !== "approved" && field.status !== "na";
}

export function ProgrammeDetailContent({
  nowIso,
  detail,
}: {
  nowIso: string;
  detail: ProgrammeDetail;
}) {
  const now = new Date(nowIso);
  const programme = detail;
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("Onboarding");
  const [fields, setFields] = useState<OnboardingField[] | null>(detail.onboarding);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  /*
    Adjust state when the server sends new data, React's documented pattern for
    it. A save calls router.refresh(), the page re-renders with fresh props, and
    without this the local copy would quietly go stale and show the operator
    their old value as though it had been written.
  */
  const [seenOnboarding, setSeenOnboarding] = useState(detail.onboarding);
  if (detail.onboarding !== seenOnboarding) {
    setSeenOnboarding(detail.onboarding);
    setFields(detail.onboarding);
    setSaveErrors({});
  }
  const [showReassign, setShowReassign] = useState(false);
  const [reassignFrom, setReassignFrom] = useState("");
  const [reassignTo, setReassignTo] = useState("");
  const [filter, setFilter] = useState<"all" | "blocking" | "unassigned">("all");
  // A nonce alongside the id, so revealing the same field twice still scrolls.
  const [highlight, setHighlight] = useState<{ id: string; nonce: number } | null>(null);
  const highlightId = highlight?.id ?? null;
  const [showFullLog, setShowFullLog] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  /*
    Scroll after React has committed, rather than from a requestAnimationFrame
    callback inside the click handler. A backgrounded tab never runs rAF, so
    the scroll would silently not happen; an effect runs either way.
  */
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`field-${highlight.id}`);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [highlight]);

  /**
   * Scroll a named field into view and mark it, so the eye lands on the right
   * row rather than roughly the right area. Clears any active filter first,
   * otherwise the target may not be rendered at all.
   */
  function revealField(id: string) {
    setTab("Onboarding");
    setFilter("all");
    setHighlight((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }));
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 2500);
  }

  const teamNames = detail.team.map((member) => member.name);
  const teamMembers = detail.team.map((m) => ({ id: m.id, name: m.name }));

  const blockingOpen = useMemo(
    () => (fields ?? []).filter((f) => f.blocking && isOpen(f)),
    [fields],
  );
  const unassigned = useMemo(
    () => (fields ?? []).filter(countsAsUnassigned),
    [fields],
  );
  const answered = (fields ?? []).filter((f) => !isOpen(f)).length;

  const sections = useMemo(() => {
    const map = new Map<string, OnboardingField[]>();
    for (const field of fields ?? []) {
      if (filter === "blocking" && !(field.blocking && isOpen(field))) continue;
      if (filter === "unassigned" && !countsAsUnassigned(field)) continue;
      map.set(field.section, [...(map.get(field.section) ?? []), field]);
    }
    return [...map.entries()];
  }, [fields, filter]);

  function updateField(id: string, patch: Partial<OnboardingField>) {
    setFields((current) =>
      (current ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  }

  /**
   * Optimistic, then reconciled. The value changes on screen immediately, and
   * if the write fails it goes back to what the database still holds. The
   * editor keeps whatever was typed either way: losing somebody's typing is
   * the worst thing this screen can do.
   */
  async function persistResponse(fieldId: string, text: string) {
    const previous = (fields ?? []).find((f) => f.id === fieldId)?.response ?? "";
    updateField(fieldId, { response: text });
    const result = await saveResponseText(fieldId, detail.id, text);
    if (!result.ok) {
      updateField(fieldId, { response: previous });
      // InlineEdit shows its own failure state when onSave throws.
      throw new Error(result.message);
    }
    router.refresh();
  }

  async function persistAssignee(fieldId: string, assigneeId: string | null) {
    const before = (fields ?? []).find((f) => f.id === fieldId);
    const name =
      assigneeId === null
        ? null
        : (detail.team.find((m) => m.id === assigneeId)?.name ?? null);

    updateField(fieldId, { assigneeId, assignee: name });
    setSaveErrors((e) => {
      if (!(fieldId in e)) return e;
      const rest = { ...e };
      delete rest[fieldId];
      return rest;
    });

    const result = await saveResponseAssignee(fieldId, detail.id, assigneeId);
    if (!result.ok) {
      updateField(fieldId, {
        assigneeId: before?.assigneeId ?? null,
        assignee: before?.assignee ?? null,
      });
      setSaveErrors((e) => ({ ...e, [fieldId]: result.message }));
      return;
    }
    router.refresh();
  }

  function applyReassign() {
    setFields((current) =>
      (current ?? []).map((f) =>
        f.assignee === reassignFrom ? { ...f, assignee: reassignTo } : f,
      ),
    );
    setShowReassign(false);
  }

  const reassignCount = (fields ?? []).filter((f) => f.assignee === reassignFrom).length;

  return (
    <div>
      {/* Breadcrumb back to the list, so the record is not a dead end. */}
      <Link
        href="/programs"
        className="rounded-base text-label text-accent underline underline-offset-2"
      >
        Programs
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-page-title font-semibold">{programme.name}</h1>
        <span className="text-body text-slate">
          {verticalLabel(programme.vertical)}
          {" · "}
          {subVerticalLabel(programme.subVertical) ?? NO_SUB_VERTICAL}
          {" · "}
          {programme.typeLabel}
        </span>
        <StatusPill status={programme.status} />
      </div>

      {/*
        The blocking bar sits above both columns, full width. It does not
        collapse and it does not dismiss. DESIGN.md section 5.
      */}
      <BlockingBar
        className="mt-4"
        count={blockingOpen.length}
        oldestLabel={blockingOpen[0]?.question ?? ""}
        oldestDueDate={
          blockingOpen[0]?.dueDate ?? undefined
        }
        onShow={() => {
          setTab("Onboarding");
          setFilter("blocking");
        }}
        onOpenOldest={
          blockingOpen[0] ? () => revealField(blockingOpen[0].id) : undefined
        }
      />

      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ---------------------------------------------------------------- */}
        {/* Left, primary, roughly 70%                                        */}
        {/* ---------------------------------------------------------------- */}
        <div className="min-w-0 lg:w-[70%]">
          <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
            {TABS.map((entry) => {
              const isCurrent = entry === tab;
              return (
                <button
                  key={entry}
                  role="tab"
                  aria-selected={isCurrent}
                  type="button"
                  onClick={() => setTab(entry)}
                  className={`-mb-px rounded-t-base border-b-2 px-3 py-2 text-body ${
                    isCurrent
                      ? "border-accent font-medium text-ink"
                      : "border-transparent text-slate hover:text-ink"
                  }`}
                >
                  {entry}
                </button>
              );
            })}
          </div>

          {tab === "Onboarding" && (
            <div className="mt-4">
              {fields === null ? (
                <GenerateGate
                  templateName={detail.templateName}
                  teamSize={detail.team.length}
                />
              ) : (
                <>
                  {/*
                    A summary of the whole tab, deliberately not a heading. It
                    used to be an h2 reading "Onboarding 5 of 9" directly above
                    an h3 reading "Audience 2 of 3" at the same weight, which
                    made the total and its parts look like siblings.
                  */}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
                    <span className="text-body text-slate">
                      <span className="font-time text-time font-medium text-ink">
                        {answered}
                      </span>{" "}
                      of <span className="font-time">{fields.length}</span> answered
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFilter((v) => (v === "unassigned" ? "all" : "unassigned"))
                      }
                      className={`rounded-base text-body ${
                        unassigned.length > 0 ? "text-watch" : "text-slate"
                      }`}
                      title="Work nobody owns appears in no one's awaiting-me count"
                    >
                      <span className="font-time">{unassigned.length}</span> unassigned
                    </button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setShowReassign((v) => !v);
                        setReassignFrom(teamNames[0] ?? "");
                        setReassignTo(teamNames[1] ?? "");
                      }}
                    >
                      Bulk reassign
                    </Button>
                    {filter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setFilter("all")}
                        className="rounded-base text-body font-medium text-accent underline underline-offset-2"
                      >
                        Showing {filter} only · Clear
                      </button>
                    )}
                  </div>

                  {showReassign && (
                    <div className="mt-3 flex flex-wrap items-end gap-3 border border-line bg-surface p-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-label font-medium text-slate">From</span>
                        <Select
                          value={reassignFrom}
                          onChange={(e) => setReassignFrom(e.target.value)}
                        >
                          {teamNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-label font-medium text-slate">To</span>
                        <Select
                          value={reassignTo}
                          onChange={(e) => setReassignTo(e.target.value)}
                        >
                          {teamNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <Button variant="primary" onClick={applyReassign}>
                        Reassign {reassignCount}{" "}
                        {reassignCount === 1 ? "response" : "responses"}
                      </Button>
                      <Button onClick={() => setShowReassign(false)}>Cancel</Button>
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-6">
                    {sections.map(([section, sectionFields]) => {
                      const done = sectionFields.filter((f) => !isOpen(f)).length;
                      return (
                        <section key={section}>
                          <h3 className="flex items-baseline gap-2">
                            <span className="text-section font-medium text-ink">
                              {section}
                            </span>
                            <span className="font-time text-caption text-slate">
                              {done}/{sectionFields.length}
                            </span>
                          </h3>
                          <div className="mt-2 border border-line bg-surface">
                            {sectionFields.map((field, index) => (
                              <FieldRow
                                key={field.id}
                                field={field}
                                team={teamMembers}
                                first={index === 0}
                                highlighted={field.id === highlightId}
                                saveError={saveErrors[field.id]}
                                onSaveResponse={(text) =>
                                  persistResponse(field.id, text)
                                }
                                onChangeAssignee={(id) =>
                                  persistAssignee(field.id, id)
                                }
                              />
                            ))}
                          </div>
                        </section>
                      );
                    })}
                    {sections.length === 0 && (
                      <EmptyState message="No blocking items. Nothing is waiting on anyone." />
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {tab !== "Onboarding" && (
            <div className="mt-4 border border-line bg-surface">
              <EmptyState message={emptyMessageFor(tab)} />
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Right, persistent, roughly 30%. Does not scroll away.             */}
        {/* ---------------------------------------------------------------- */}
        <aside className="lg:sticky lg:top-6 lg:w-[30%]">
          <div className="flex flex-col gap-4 border border-line bg-surface p-4">
            <Detail label="Countdown">
              {programme.time === null ? (
                <span className="text-slate">No dates set</span>
              ) : programme.time.kind === "event" ? (
                <Countdown
                  kind="event"
                  milestoneDate={programme.time.milestoneDate}
                  now={now}
                />
              ) : (
                <Countdown
                  kind="retainer"
                  startDate={programme.time.startDate}
                  endDate={programme.time.endDate}
                  gateDate={programme.time.gateDate}
                  now={now}
                />
              )}
            </Detail>

            <Detail label="Blocking">
              <span
                className={`font-time text-time ${
                  blockingOpen.length > 0 ? "font-medium text-critical" : "text-slate"
                }`}
              >
                {blockingOpen.length}
              </span>{" "}
              <span className="text-body text-slate">
                {blockingOpen.length === 1 ? "open item" : "open items"}
              </span>
            </Detail>

            <Detail label="Client approver">
              <span className="text-body text-ink">
                {detail.approverName ?? "Not set"}
              </span>
              {detail.approverEmail && (
                <div className="text-caption text-slate">{detail.approverEmail}</div>
              )}
            </Detail>

            <Detail label="Assigned team">
              {detail.team.length === 0 ? (
                <span className="text-body text-watch">Nobody assigned</span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {detail.team.map((member) => (
                    <li key={member.name} className="flex justify-between gap-2">
                      <span className="text-body text-ink">{member.name}</span>
                      <span className="text-caption text-slate">
                        {ROLE_LABEL[member.roleOnProgram] ?? member.roleOnProgram}{" "}
                        <span className="font-time">{member.allocationPercent}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Detail>

            <Detail label="Recent activity">
              <ul className="flex flex-col gap-2">
                {(showFullLog ? detail.audit : detail.audit.slice(0, 5)).map(
                  (entry, index) => (
                    <li key={index} className="text-body text-slate">
                      {entry.text}
                      <span className="ml-1 font-time text-caption">
                        {formatDayMonth(entry.at)}
                      </span>
                    </li>
                  ),
                )}
              </ul>
              {detail.audit.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowFullLog((v) => !v)}
                  className="mt-2 rounded-base text-body font-medium text-accent underline underline-offset-2"
                >
                  {showFullLog
                    ? "Show recent only"
                    : `View full log (${detail.audit.length})`}
                </button>
              )}
            </Detail>
          </div>
        </aside>
      </div>

      <p className="mt-6 text-caption text-slate">
        Answers and assignees save as you change them. Status, dates and the
        bulk reassign are not wired up yet.
      </p>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line pb-4 last:border-b-0 last:pb-0">
      <span className="text-label font-medium text-slate">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function FieldRow({
  field,
  team,
  first,
  highlighted,
  saveError,
  onSaveResponse,
  onChangeAssignee,
}: {
  field: OnboardingField;
  team: { id: string; name: string }[];
  first: boolean;
  highlighted: boolean;
  saveError?: string;
  onSaveResponse: (text: string) => Promise<void>;
  onChangeAssignee: (assigneeId: string | null) => void;
}) {
  const open = isOpen(field);
  return (
    <div
      id={`field-${field.id}`}
      className={`scroll-mt-6 border-l-2 p-3 transition-colors ${
        first ? "" : "border-t border-t-line"
      } ${
        highlighted
          ? "border-l-accent bg-accent-sub"
          : "border-l-transparent bg-surface"
      }`}
    >
      {/*
        The question is a label for the answer, so it sits below it in weight.
        The answer is the content of the record and leads. DESIGN.md section 3.
      */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-body font-medium text-slate">{field.question}</span>
        <span className="flex items-center gap-2">
          {field.blocking && open && (
            <span className="rounded-base bg-critical-bg px-2 py-[2px] text-caption font-medium uppercase text-critical">
              Blocking
            </span>
          )}
          <StatusPill status={field.status} />
          {field.dueDate && (
            <span className="font-time text-caption text-slate">
              {formatDayMonth(field.dueDate)}
            </span>
          )}
        </span>
      </div>

      {field.guidance && (
        <p className="mt-1 text-caption text-slate">{field.guidance}</p>
      )}

      <div className="mt-2">
        <InlineEdit
          value={field.response}
          onSave={onSaveResponse}
          ariaLabel={field.question}
          multiline
          placeholder="Not answered"
          textClass="text-answer"
        />
      </div>

      {/*
        Attribution stays exactly as prominent as it was. On this module, who
        said a thing and when is not a detail about the record, it is the
        record. DESIGN.md section 3.
      */}
      {field.answeredBy && (
        <p className="mt-2 text-caption text-slate">
          Answered by{" "}
          <span className="text-ink">{field.answeredBy.name}</span>
          {field.answeredBy.party === "client" ? " (client)" : ""}
          {" · "}
          <span className="font-time">
            {field.answeredBy.at ? formatDayMonth(field.answeredBy.at) : "—"}
          </span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-slate">
        <span>
          Owner <span className="text-ink">{OWNER_LABEL[field.owner]}</span>
        </span>
        <span className="flex items-center gap-1">
          Assignee
          <Select
            quiet
            aria-label={`Assignee for ${field.question}`}
            value={field.assigneeId ?? ""}
            onChange={(event) =>
              onChangeAssignee(event.target.value === "" ? null : event.target.value)
            }
            className={countsAsUnassigned(field) ? "text-watch" : "text-ink"}
          >
            <option value="">Unassigned</option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </span>
      </div>

      {saveError && (
        <p className="mt-1 text-caption text-critical">{saveError}</p>
      )}
    </div>
  );
}

/**
 * Before generation. SPEC.md section 4.2: the button is unavailable until at
 * least one team member is assigned, and it says why.
 */
function GenerateGate({
  templateName,
  teamSize,
}: {
  templateName: string | null;
  teamSize: number;
}) {
  const blocked = teamSize === 0;
  return (
    <div className="border border-line bg-surface p-6">
      <p className="text-body text-ink">Onboarding has not been generated yet.</p>
      <p className="mt-1 text-body text-slate">
        {templateName ? (
          <>
            Selected template: <span className="text-ink">{templateName}</span>
          </>
        ) : (
          "No template selected yet. It is chosen from the organisation's vertical and the programme type."
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={blocked}>
          Generate onboarding
        </Button>
        {blocked && (
          <span className="text-body text-slate">
            Assign at least one team member before generating. Fields are assigned
            by role.
          </span>
        )}
      </div>
    </div>
  );
}

function emptyMessageFor(tab: Tab): string {
  switch (tab) {
    case "Tasks":
      return "No tasks yet. Tasks generate from approved onboarding answers, in module 3.";
    case "Audience":
      return "No audience built yet. Targeting lives in module 5.";
    case "Attendees":
      return "No attendees yet. Registrations appear here once invitations go out.";
    case "Reports":
      return "No client dashboard generated yet. Dashboards are module 4.";
    case "Commercial":
      return "No commercial detail yet. Contracts and margin are module 7.";
    default:
      return "Nothing here yet.";
  }
}
