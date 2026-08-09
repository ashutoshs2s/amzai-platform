import { Button } from "@/components/Button";

/**
 * Error state. DESIGN.md section 5.
 *
 * Says what failed and what to do. `Could not load programs. Retry.`
 * No apology, no error code unless it is actionable.
 */

export type ErrorStateProps = {
  /** What failed. `Could not load programs.` */
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Only include a code when the reader can act on it. */
  code?: string;
  className?: string;
};

export function ErrorState({
  message,
  onRetry,
  retryLabel = "Retry",
  code,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      className={`flex flex-col items-start gap-3 px-3 py-8 text-body ${className}`}
    >
      <p className="text-ink">
        {message}
        {code && <span className="ml-2 font-time text-label text-slate">{code}</span>}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
