"use client";

import { useId, useState } from "react";

import { Button } from "@/components/Button";
import { Field, TextInput } from "@/components/form/Field";

/**
 * Destructive confirmation. DESIGN.md section 5.
 *
 * "Destructive actions require typed confirmation, not just a second click."
 *
 * Rendered in place rather than in a modal. The action stays disabled until the
 * phrase is typed exactly, and the phrase is shown so nobody has to guess it.
 */

export type DestructiveConfirmProps = {
  /** What is about to happen, in plain words. */
  description: string;
  /** The exact phrase the operator must type. Usually the record's name. */
  confirmPhrase: string;
  actionLabel: string;
  onConfirm: () => void;
  onCancel?: () => void;
  className?: string;
};

export function DestructiveConfirm({
  description,
  confirmPhrase,
  actionLabel,
  onConfirm,
  onCancel,
  className = "",
}: DestructiveConfirmProps) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const matches = typed === confirmPhrase;

  return (
    <div
      className={`flex flex-col gap-3 border-l-[3px] border-critical bg-critical-bg p-3 ${className}`}
    >
      <p className="text-body text-ink">{description}</p>

      <Field
        label="Type the name to confirm"
        hint={confirmPhrase}
        htmlFor={inputId}
        className="max-w-sm"
      >
        <TextInput
          id={inputId}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
        />
      </Field>

      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          disabled={!matches}
          onClick={onConfirm}
          aria-describedby={matches ? undefined : `${inputId}-blocked`}
        >
          {actionLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {!matches && (
          <span id={`${inputId}-blocked`} className="text-caption text-slate">
            Type the name above to enable this.
          </span>
        )}
      </div>
    </div>
  );
}
