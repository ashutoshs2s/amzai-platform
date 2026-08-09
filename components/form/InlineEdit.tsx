"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Inline editing. DESIGN.md section 5.
 *
 * Click to edit, save on blur, show a brief `Saved` in clear for 2 seconds.
 * No modal for a single-field edit, and no toast for a routine save: both are
 * named in section 8 as things not to build.
 *
 * Escape cancels and restores the previous value. If the save fails, the text
 * the operator typed stays in the box. Losing someone's typing is the worst
 * thing an inline editor can do.
 */

export type InlineEditProps = {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  /** For screen readers, since there is no visible label in a table cell. */
  ariaLabel: string;
  /** Times and quantities render in the mono face. */
  mono?: boolean;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
};

type State = "idle" | "editing" | "saving" | "saved" | "failed";

export function InlineEdit({
  value,
  onSave,
  ariaLabel,
  mono = false,
  multiline = false,
  placeholder = "Not set",
  className = "",
}: InlineEditProps) {
  const [state, setState] = useState<State>("idle");
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (state === "editing") inputRef.current?.focus();
  }, [state]);

  async function commit() {
    if (draft === value) {
      setState("idle");
      return;
    }
    setState("saving");
    try {
      await onSave(draft);
      setState("saved");
      savedTimer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      // Keep the draft. The operator's typing is not thrown away.
      setState("failed");
    }
  }

  if (state === "idle" || state === "saved") {
    return (
      <span className={`inline-flex items-baseline gap-2 ${className}`}>
        <button
          type="button"
          onClick={() => {
            // The draft is taken from the current value at the moment editing
            // starts, rather than kept in sync by an effect.
            setDraft(value);
            setState("editing");
          }}
          aria-label={`${ariaLabel}. Click to edit.`}
          className={`rounded-base text-left text-body hover:underline hover:underline-offset-2 ${
            mono ? "font-time" : ""
          } ${value ? "text-ink" : "text-mute"}`}
        >
          {value || placeholder}
        </button>
        {state === "saved" && (
          <span className="text-caption font-medium text-clear" role="status">
            Saved
          </span>
        )}
      </span>
    );
  }

  const control = multiline ? (
    <textarea
      ref={(node) => {
        inputRef.current = node;
      }}
      value={draft}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(value);
          setState("idle");
        }
      }}
      disabled={state === "saving"}
      className="min-h-16 w-full rounded-base border border-accent bg-surface px-2 py-1 text-body text-ink"
    />
  ) : (
    <input
      ref={(node) => {
        inputRef.current = node;
      }}
      value={draft}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(value);
          setState("idle");
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        }
      }}
      disabled={state === "saving"}
      className={`h-8 w-full rounded-base border border-accent bg-surface px-2 text-body text-ink ${
        mono ? "font-time" : ""
      }`}
    />
  );

  return (
    <span className={`inline-flex w-full flex-col gap-1 ${className}`}>
      {control}
      {state === "saving" && (
        <span className="text-caption text-slate" role="status">
          Saving
        </span>
      )}
      {state === "failed" && (
        <span className="text-caption text-critical" role="status">
          Could not save. Your text is still here. Try again.
        </span>
      )}
    </span>
  );
}
