"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LeftRail } from "@/components/shell/LeftRail";
import { TopBar } from "@/components/shell/TopBar";
import {
  CURRENT_USER,
  SAMPLE_PROGRAMMES,
  awaitingFor,
} from "@/app/programs/sample-data";
import { currentModule } from "@/lib/modules";

/**
 * App shell. DESIGN.md section 4.
 *
 * Rail and top bar are fixed; the content area is offset by both, sits on the
 * canvas background with 24px padding, and is capped and left-aligned.
 *
 * The programme context and the awaiting-me count are derived from the sample
 * data here because there is no session and no query yet. Both become real
 * reads when module 1 has data; nothing about the layout changes when they do.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeModule = currentModule(pathname);

  const match = pathname.match(/^\/programs\/([^/]+)$/);
  const programme = match
    ? SAMPLE_PROGRAMMES.find((entry) => entry.id === match[1])
    : undefined;

  return (
    <div className="min-h-screen bg-canvas">
      <LeftRail currentHref={activeModule?.href} />
      <TopBar
        programmeContext={
          programme ? { id: programme.id, name: programme.name } : undefined
        }
        awaiting={awaitingFor(CURRENT_USER)}
      />
      <div className="pl-[var(--rail-width)] pt-[var(--topbar)]">
        <main className="max-w-content px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
