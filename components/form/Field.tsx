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

/*
  Deliberately no width. Inside a Field the wrapper is a flex column, whose
  default `align-items: stretch` already makes controls fill it. In a filter
  row, which is a centred flex row, they take their intrinsic width instead.
  Baking `w-full` in here would make every filter dropdown span the screen,
  and a caller could not override it: `w-auto` and `w-full` have equal
  specificity, so which one wins depends on stylesheet order rather than on
  what the caller asked for.
*/
const CONTROL_BASE =
  "rounded-base border border-line bg-surface px-2 text-body text-ink " +
  "placeholder:text-mute focus:border-accent disabled:bg-canvas disabled:text-mute";

/*
  For controls inside a bordered cluster, such as the filter row in DESIGN.md
  section 5. The cluster supplies the box and the dividers, so each control
  drops its own border rather than drawing a second one inside the first.
*/
const CONTROL_BARE =
  "bg-transparent px-2 text-body text-ink placeholder:text-mute " +
  "disabled:text-mute focus:outline-offset-[-2px]";

function controlClass(bare: boolean, invalid: boolean, extra: string) {
  return [
    bare ? CONTROL_BARE : CONTROL_BASE,
    invalid && !bare ? "border-critical" : "",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

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
  /** Drop the border, for use inside a bordered cluster. */
  bare?: boolean;
};

export function TextInput({
  mono = false,
  invalid = false,
  bare = false,
  className = "",
  ...rest
}: TextInputProps) {
  return (
    <input
      className={`h-8 ${controlClass(bare, invalid, `${mono ? "font-time" : ""} ${className}`)}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  /** Drop the border, for use inside a bordered cluster. */
  bare?: boolean;
};

export function Select({
  invalid = false,
  bare = false,
  className = "",
  children,
  ...rest
}: SelectProps) {
  return (
    <select
      className={`h-8 ${controlClass(bare, invalid, className)}`}
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
      className={`min-h-16 py-1 ${controlClass(false, invalid, className)}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
