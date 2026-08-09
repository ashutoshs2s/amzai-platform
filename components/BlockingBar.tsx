import { type DateLike, formatDayMonth } from "@/lib/time";

/**
 * Blocking bar. DESIGN.md section 5.
 *
 * The platform's central concept, and it must never be a status among
 * statuses. Anywhere a record has open blocking items, this sits at the top of
 * that record: critical-bg fill, 3px critical left border, one line naming the
 * count and the oldest item, and a link that filters to them.
 *
 * It does not collapse and it does not dismiss. There is deliberately no
 * `onDismiss` prop and no collapsed state. It disappears when the items are
 * cleared and not before, which is why a count of zero renders nothing at all.
 */

export type BlockingBarProps = {
  /** Number of open blocking items on this record. Zero renders nothing. */
  count: number;
  /** Name of the oldest open blocking item. */
  oldestLabel: string;
  /** Due date of the oldest open blocking item. */
  oldestDueDate?: DateLike;
  /** Filters the record's list to the blocking items. */
  onShow?: () => void;
  showLabel?: string;
  /**
   * Opens the named item itself. Naming the oldest blocking item and then
   * making the reader go and find it wastes the one piece of navigation this
   * bar was in a position to give them. DESIGN.md section 5.
   */
  onOpenOldest?: () => void;
  /** Wording aimed at a client rather than an operator. See DESIGN.md 6.4. */
  audience?: "internal" | "client";
  className?: string;
};

export function BlockingBar({
  count,
  oldestLabel,
  oldestDueDate,
  onShow,
  showLabel = "Show blocking items",
  onOpenOldest,
  audience = "internal",
  className = "",
}: BlockingBarProps) {
  if (count <= 0) return null;

  const one = count === 1;
  const tail =
    audience === "client"
      ? one
        ? "outstanding item is blocking your programme."
        : "outstanding items are blocking your programme."
      : one
        ? "blocking item open."
        : "blocking items open.";

  return (
    <div
      role="status"
      className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-[3px] border-critical bg-critical-bg px-3 py-2 text-body text-ink ${className}`}
    >
      <span className="font-medium">
        <span className="font-time">{count}</span> {tail}
      </span>
      <span className="text-slate">
        Oldest:{" "}
        {onOpenOldest ? (
          <button
            type="button"
            onClick={onOpenOldest}
            className="rounded-base font-medium text-accent underline underline-offset-2"
          >
            {oldestLabel}
          </button>
        ) : (
          oldestLabel
        )}
        {oldestDueDate && (
          <>
            , due <span className="font-time">{formatDayMonth(oldestDueDate)}</span>
          </>
        )}
        .
      </span>
      {onShow && (
        <button
          type="button"
          onClick={onShow}
          className="rounded-base text-body font-medium text-accent underline underline-offset-2"
        >
          {showLabel}
        </button>
      )}
    </div>
  );
}
