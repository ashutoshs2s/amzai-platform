import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button. DESIGN.md section 5.
 *
 * Four variants and no others. 32px high, matching the field height, so a
 * button sits level with an input. No shadows, 4px radius, accent for primary.
 * The focus ring comes from the global :focus-visible rule in globals.css.
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
