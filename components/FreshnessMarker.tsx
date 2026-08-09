import {
  type DateLike,
  type FreshnessTone,
  formatDayMonth,
  freshnessTone,
} from "@/lib/time";

/**
 * Freshness marker. DESIGN.md section 5.
 *
 * Critical, because dashboard figures are partly hand-entered. Every number
 * that is not live carries one of these: `Updated 4 Aug · manual` at 11px.
 * Over 7 days old it turns watch, over 14 days critical.
 *
 * A stale number that looks current is worse than no number.
 */

const TONE_CLASS: Record<FreshnessTone, string> = {
  // Slate, not mute. A freshness marker is meaningful text and has to clear the
  // contrast floor; mute is reserved for placeholder and disabled text.
  slate: "text-slate",
  watch: "text-watch",
  critical: "text-critical",
};

export type FreshnessMarkerProps = {
  updatedAt: DateLike;
  /** How the figure got here. Shown to the reader, not just recorded. */
  source: "manual" | "automatic";
  now: DateLike;
  className?: string;
};

export function FreshnessMarker({
  updatedAt,
  source,
  now,
  className = "",
}: FreshnessMarkerProps) {
  const tone = freshnessTone(updatedAt, now);

  return (
    <span
      className={`inline-flex items-baseline gap-1 text-caption ${TONE_CLASS[tone]} ${className}`}
    >
      <span>Updated</span>
      <span className="font-time">{formatDayMonth(updatedAt)}</span>
      <span aria-hidden="true">·</span>
      <span>{source}</span>
      {/*
        Section 7: status is never communicated by colour alone. When the marker
        has gone amber or red, the reason is spelled out rather than left to the
        colour to imply.
      */}
      {tone !== "slate" && (
        <span className="font-medium">
          {tone === "critical" ? "· out of date" : "· ageing"}
        </span>
      )}
    </span>
  );
}
