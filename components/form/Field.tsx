import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * Form fields. DESIGN.md section 5.
 *
 * Label above the field, 12px slate, never placeholder-as-label. 32px field
 * height, 1px line border, 4px radius, accent border on focus with a visible
 * 2px focus ring (the ring comes from the global :focus-visible rule).
 *
 * There is no `placeholder` prop that doubles as a label, on purpose. A
 * placeholder may hint at the format; it may never be the only label.
 */

const CONTROL_BASE =
  "w-full rounded-base border border-line bg-surface px-2 text-body text-ink " +
  "placeholder:text-mute focus:border-accent disabled:bg-canvas disabled:text-mute";

export type FieldProps = {
  label: string;
  /** Rendered beneath the label, for guidance the operator needs before typing. */
  hint?: string;
  /** Rendered beneath the control, in critical. Says what to do about it. */
  error?: string;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  children,
  className = "",
}: FieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className="text-label font-medium text-slate">
        {label}
        {required && <span className="ml-1 text-critical">*</span>}
      </label>
      {hint && <p className="text-caption text-slate">{hint}</p>}
      {children}
      {error && <p className="text-caption text-critical">{error}</p>}
    </div>
  );
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Set for values that are a time or a quantity. DESIGN.md section 2. */
  mono?: boolean;
  invalid?: boolean;
};

export function TextInput({
  mono = false,
  invalid = false,
  className = "",
  ...rest
}: TextInputProps) {
  return (
    <input
      className={`h-8 ${CONTROL_BASE} ${mono ? "font-time" : ""} ${
        invalid ? "border-critical" : ""
      } ${className}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export function Select({ invalid = false, className = "", children, ...rest }: SelectProps) {
  return (
    <select
      className={`h-8 ${CONTROL_BASE} ${invalid ? "border-critical" : ""} ${className}`}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export function Textarea({ invalid = false, className = "", ...rest }: TextareaProps) {
  return (
    <textarea
      className={`min-h-16 py-1 ${CONTROL_BASE} ${
        invalid ? "border-critical" : ""
      } ${className}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
