import { Button } from "@/components/Button";

/**
 * Empty state. DESIGN.md section 5.
 *
 * Names what would be here and gives the action that creates it.
 * `No programs yet.` with a `New program` button.
 *
 * Never an illustration, never "Nothing to see here". There is deliberately no
 * prop for an image or an icon.
 */

export type EmptyStateProps = {
  /** What would be here. A full sentence. `No programs yet.` */
  message: string;
  /** The action that creates one. `New program` */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export function EmptyState({
  message,
  actionLabel,
  onAction,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-start gap-3 px-3 py-8 text-body text-slate ${className}`}
    >
      <p>{message}</p>
      {actionLabel && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
