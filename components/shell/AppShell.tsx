"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LeftRail } from "@/components/shell/LeftRail";
import { TopBar } from "@/components/shell/TopBar";
import type { AwaitingSummary } from "@/lib/data/programmes";
import { currentModule } from "@/lib/modules";
import type { SearchEntry } from "@/components/shell/TopBar";

/**
 * App shell. DESIGN.md section 4.
 *
 * Rail and top bar are fixed; the content area is offset by both, sits on the
 * canvas background with 24px padding, and is capped and left-aligned.
 *
 * The awaiting-me count and the search index are read in the layout and passed
 * in, through the same authenticated client the screens use, so the shell can
 * never surface a programme the screen beneath it would not show.
 */
export function AppShell({
  children,
  awaiting,
  searchIndex,
  staffName,
}: {
  children: ReactNode;
  awaiting: AwaitingSummary;
  searchIndex: SearchEntry[];
  staffName?: string;
}) {
  const pathname = usePathname();
  const activeModule = currentModule(pathname);

  const match = pathname.match(/^\/programs\/([^/]+)$/);
  const programme = match
    ? searchIndex.find((entry) => entry.id === match[1])
    : undefined;

  return (
    <div className="min-h-screen bg-canvas">
      <LeftRail currentHref={activeModule?.href} />
      <TopBar
        programmeContext={
          programme ? { id: programme.id, name: programme.name } : undefined
        }
        awaiting={awaiting}
        searchIndex={searchIndex}
        staffName={staffName}
      />
      <div className="pl-[var(--rail-width)] pt-[var(--topbar)]">
        <main className="max-w-content px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
