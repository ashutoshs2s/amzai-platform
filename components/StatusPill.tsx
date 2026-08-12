import type { ReactNode } from "react";

/**
 * Status pill. DESIGN.md section 5.
 *
 * One component, used everywhere, never restyled per module. 10px, 500 weight,
 * uppercase, tight padding, 4px radius, status background with status text
 * colour. Text only: no dot, no icon.
 *
 * Deliberately small. A dense screen carries many of these at once, and at
 * caption size they competed with the values they were describing. They lean on
 * their background for legibility, not on their size.
 *
 * Every status in the platform maps onto one of the semantic tones rather than
 * inventing a new colour per module.
 */

export type StatusTone = "clear" | "watch" | "critical" | "idle";

const TONE_CLASS: Record<StatusTone, string> = {
  clear: "bg-clear-bg text-clear",
  watch: "bg-watch-bg text-watch",
  critical: "bg-critical-bg text-critical",
  idle: "bg-idle-bg text-idle",
};

/**
 * Product status to semantic tone.
 *
 * Covers the programme statuses (SPEC.md `programs.status`) and the onboarding
 * response statuses (`onboarding_responses.status`).
 *
 * NOTE: `in_progress` has no home in DESIGN.md. The token comments assign
 * "not started, N/A, complete" to idle and "at risk, due soon, awaiting" to
 * watch, and an in-flight field is neither. It is mapped to idle here because
 * amber means "at risk" and a healthy in-progress field is not at risk;
 * colouring it amber would cry wolf. Flagged for a decision.
 */
const STATUS_TONE: Record<string, StatusTone> = {
  // onboarding_responses.status
  not_started: "idle",
  in_progress: "idle",
  submitted: "watch",
  approved: "clear",
  blocked: "critical",
  na: "idle",

  // programs.status
  onboarding: "watch",
  active: "clear",
  paused: "idle",
  complete: "idle",

  // general vocabulary used across modules
  confirmed: "clear",
  on_track: "clear",
  awaiting: "watch",
  due_soon: "watch",
  overdue: "critical",
  failed: "critical",
  registered: "clear",
  no_show: "critical",
};

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  na: "N/A",
  on_track: "On track",
  due_soon: "Due soon",
  no_show: "No show",
};

export function statusTone(status: string): StatusTone {
  return STATUS_TONE[status] ?? "idle";
}

export function statusLabel(status: string): string {
  if (STATUS_LABEL[status]) return STATUS_LABEL[status];
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type StatusPillProps = {
  /** A product status such as `approved`, `blocked` or `not_started`. */
  status: string;
  /** Override the derived tone. Rarely needed; prefer extending the map. */
  tone?: StatusTone;
  /** Override the derived label. */
  label?: ReactNode;
};

export function StatusPill({ status, tone, label }: StatusPillProps) {
  const resolvedTone = tone ?? statusTone(status);

  return (
    <span
      className={`inline-flex items-center rounded-base px-1.5 py-[1px] text-pill font-medium uppercase tracking-[0.04em] ${TONE_CLASS[resolvedTone]}`}
    >
      {label ?? statusLabel(status)}
    </span>
  );
}
