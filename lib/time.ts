/**
 * Date arithmetic for countdowns and freshness.
 *
 * The rules implemented here are defined in SPEC.md section 7.2 and rendered
 * per DESIGN.md section 5. They live in one file so there is a single answer,
 * rather than one per screen.
 *
 * Everything is normalised to a UTC day before comparison. Programme dates are
 * `date` columns in Postgres, not timestamps: a roundtable on 30 November is on
 * 30 November regardless of who is looking or what timezone they are in.
 * Comparing local times would make a countdown flip a day early for some staff.
 */

export type DateLike = Date | string;

/** Colour role a countdown renders in. Not a status; these are text colours. */
export type TimeTone = "ink" | "watch" | "critical";

const MS_PER_DAY = 86_400_000;

/** Normalise any accepted date to midnight UTC on that calendar day. */
export function toUtcDay(value: DateLike): Date {
  if (typeof value === "string") {
    // Accepts "2026-11-30" and full ISO timestamps alike.
    const [datePart] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
  );
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: DateLike, to: DateLike): number {
  return Math.round(
    (toUtcDay(to).getTime() - toUtcDay(from).getTime()) / MS_PER_DAY,
  );
}

/** `12 Aug`. The form used beside a countdown and in freshness markers. */
export function formatDayMonth(value: DateLike): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(toUtcDay(value));
}

/** `30 Nov 2026`. Used where the year matters. */
export function formatDayMonthYear(value: DateLike): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDay(value));
}

export type CountdownResult = {
  /** `T-24d`, `T+9d` or `W6 of 13`. */
  label: string;
  tone: TimeTone;
  /** The date to show beside the countdown. */
  date: Date;
};

/**
 * Event countdown, measured to `fixed_milestone_date`. SPEC.md section 7.2.
 *
 *   more than 30 days   ink
 *   8 to 30 days        watch
 *   7 days or fewer     critical
 *   past                critical, prefixed T+
 */
export function eventCountdown(
  milestoneDate: DateLike,
  now: DateLike,
): CountdownResult {
  const days = daysBetween(now, milestoneDate);
  const date = toUtcDay(milestoneDate);

  if (days < 0) return { label: `T+${Math.abs(days)}d`, tone: "critical", date };
  if (days <= 7) return { label: `T-${days}d`, tone: "critical", date };
  if (days <= 30) return { label: `T-${days}d`, tone: "watch", date };
  return { label: `T-${days}d`, tone: "ink", date };
}

/**
 * Retainer countdown, measured in engagement weeks. SPEC.md section 7.2.
 *
 * Total weeks is the number of whole weeks between start and end. The current
 * week is whole weeks elapsed since the start, plus one, so the first seven
 * days read `W1`.
 *
 *   before gate_date, or no gate set   ink
 *   on or after gate_date              watch
 *   past end_date                      critical
 */
export function retainerCountdown(
  startDate: DateLike,
  endDate: DateLike,
  gateDate: DateLike | null | undefined,
  now: DateLike,
): CountdownResult {
  const totalWeeks = Math.max(1, Math.floor(daysBetween(startDate, endDate) / 7));
  const elapsedWeeks = Math.floor(daysBetween(startDate, now) / 7);
  // Clamped, so a programme that has run past its end still reads `W13 of 13`
  // rather than inventing a week 14 that no one planned.
  const currentWeek = Math.min(Math.max(elapsedWeeks + 1, 1), totalWeeks);

  const daysPastEnd = daysBetween(endDate, now);
  let tone: TimeTone = "ink";
  if (daysPastEnd > 0) {
    tone = "critical";
  } else if (gateDate && daysBetween(gateDate, now) >= 0) {
    tone = "watch";
  }

  return {
    label: `W${currentWeek} of ${totalWeeks}`,
    tone,
    date: toUtcDay(endDate),
  };
}

export type FreshnessTone = "mute" | "watch" | "critical";

/**
 * Freshness of a hand-entered figure. DESIGN.md section 5.
 *
 *   7 days or fewer    mute
 *   more than 7        watch
 *   more than 14       critical
 *
 * A stale number that looks current is worse than no number.
 */
export function freshnessTone(updatedAt: DateLike, now: DateLike): FreshnessTone {
  const age = daysBetween(updatedAt, now);
  if (age > 14) return "critical";
  if (age > 7) return "watch";
  return "mute";
}
