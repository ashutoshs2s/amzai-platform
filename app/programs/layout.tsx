import { AppShell } from "@/components/shell/AppShell";

/**
 * Every programme screen renders inside the shell. DESIGN.md section 4.
 *
 * /styleguide is deliberately left outside it: it is a component reference,
 * not a module, and reviewing components is easier without a rail and a top
 * bar around them.
 */
export default function ProgramsLayout({ children }: LayoutProps<"/programs">) {
  return <AppShell>{children}</AppShell>;
}
