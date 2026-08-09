import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button.
 *
 * Not named in DESIGN.md section 5, but EmptyState, ErrorState and the forms
 * all need one, and a shared component beats each of them inventing its own
 * markup. Height matches the 32px field height from section 5 so a button can
 * sit level with an input.
 *
 * No shadows, 4px radius, accent for primary. Focus ring comes from the global
 * :focus-visible rule in globals.css.
 */

type Variant = "primary" | "secondary" | "quiet" | "destructive";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-accent text-surface hover:opacity-90 disabled:opacity-40",
  secondary:
    "bg-surface text-ink border border-line hover:bg-canvas disabled:opacity-40",
  quiet:
    "bg-transparent text-accent hover:bg-accent-sub disabled:opacity-40 px-2",
  destructive:
    "bg-critical text-surface hover:opacity-90 disabled:opacity-40",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export function Button({
  variant = "secondary",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center justify-center rounded-base px-3 text-body font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
