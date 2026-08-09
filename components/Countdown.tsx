import {
  type DateLike,
  type TimeTone,
  eventCountdown,
  formatDayMonthYear,
  retainerCountdown,
} from "@/lib/time";

/**
 * Countdown. DESIGN.md section 5.
 *
 * The most-used element in the platform. Mono, tabular. `T-24d` for events,
 * `W6 of 13` for retainers, with the absolute date beside it in slate at 12px.
 *
 * The arithmetic and the colour thresholds are in lib/time.ts, which follows
 * SPEC.md section 7.2. This component only renders the result.
 *
 * `now` is passed in rather than read from the clock inside the component, so
 * a server render and a client render of the same page always agree.
 */

const TONE_CLASS: Record<TimeTone, string> = {
  ink: "text-ink",
  watch: "text-watch",
  critical: "text-critical",
};

type CommonProps = {
  now: DateLike;
  /** Show the absolute date beside the countdown. Default true. */
  showDate?: boolean;
  className?: string;
};

export type CountdownProps = CommonProps &
  (
    | { kind: "event"; milestoneDate: DateLike }
    | {
        kind: "retainer";
        startDate: DateLike;
        endDate: DateLike;
        gateDate?: DateLike | null;
      }
  );

export function Countdown(props: CountdownProps) {
  const { now, showDate = true, className = "" } = props;

  const result =
    props.kind === "event"
      ? eventCountdown(props.milestoneDate, now)
      : retainerCountdown(props.startDate, props.endDate, props.gateDate, now);

  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span
        className={`font-time text-time ${TONE_CLASS[result.tone]}`}
        // The colour alone never carries the meaning. Section 7.
        title={
          result.tone === "critical"
            ? "Critical"
            : result.tone === "watch"
              ? "Due soon"
              : "On track"
        }
      >
        {result.label}
      </span>
      {showDate && (
        <span className="font-time text-label text-slate">
          {formatDayMonthYear(result.date)}
        </span>
      )}
    </span>
  );
}
