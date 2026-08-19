"use client";

import { statusLabel, statusTone, type StatusTone } from "@/components/StatusPill";

/**
 * A status pill that is also the control that changes it.
 *
 * The alternative was a pill to read and a select beside it to change, which
 * puts the same value on the screen twice. On a programme running to 110
 * questions that is 110 duplications, and the pill is the thing being scanned.
 *
 * It stays a real `select`: tabbable, keyboard operable, and it picks up the
 * global focus ring. Only its resting appearance is the pill's.
 *
 * Colour never carries the meaning alone — the status word is the option text.
 * DESIGN.md section 7.
 */

const TONE_CLASS: Record<StatusTone, string> = {
  clear: "bg-clear-bg text-clear",
  watch: "bg-watch-bg text-watch",
  critical: "bg-critical-bg text-critical",
  idle: "bg-idle-bg text-idle",
};

/** onboarding_responses.status, in the order a question moves through them. */
export const RESPONSE_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "approved",
  "blocked",
  "na",
] as const;

export function StatusSelect({
  status,
  label,
  onChange,
  disabled = false,
}: {
  status: string;
  /** For the accessible name, since the visible text is only the status word. */
  label: string;
  onChange: (status: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={status}
      disabled={disabled}
      aria-label={`Status of: ${label}`}
      onChange={(event) => onChange(event.target.value)}
      className={`appearance-none rounded-base px-1.5 py-[1px] text-pill font-medium uppercase tracking-[0.04em] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60 ${
        TONE_CLASS[statusTone(status)]
      }`}
    >
      {RESPONSE_STATUSES.map((value) => (
        <option key={value} value={value} className="bg-surface normal-case text-ink">
          {statusLabel(value)}
        </option>
      ))}
    </select>
  );
}
