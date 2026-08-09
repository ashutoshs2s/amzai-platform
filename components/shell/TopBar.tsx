"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AwaitingSummary } from "@/lib/data/programmes";
import { subVerticalLabel, verticalLabel, type VerticalId } from "@/lib/verticals";

/** The minimum a programme needs to be findable from the top bar. */
export type SearchEntry = {
  id: string;
  name: string;
  owner: string;
  typeLabel: string;
  vertical: VerticalId;
  subVertical: string | null;
};

/**
 * Matches the things an operator half-remembers: the name, who owns it, what
 * kind of work it is, and the market it sits in. Searching "cybersecurity" and
 * getting nothing because the word only lives in a column the search ignores
 * is worse than no search.
 */
function matches(entry: SearchEntry, term: string): boolean {
  return [
    entry.name,
    entry.owner,
    entry.typeLabel,
    verticalLabel(entry.vertical),
    subVerticalLabel(entry.subVertical) ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(term);
}

/**
 * Fixed top bar. DESIGN.md section 4.
 *
 * 52px: global search bound to "/", the current programme when inside one, and
 * the awaiting-me count. That count is the most important element here and the
 * only thing in the bar permitted to turn amber or red.
 */

function awaitingTone(summary: AwaitingSummary): string {
  // Tied to the countdown thresholds in SPEC.md section 7.2, so urgency reads
  // the same in the top bar as it does in a table. A count that is amber
  // whenever it is non-zero would be amber permanently, and stop being read.
  if (summary.overdue > 0) return "text-critical";
  if (summary.dueSoon > 0) return "text-watch";
  if (summary.count > 0) return "text-ink";
  return "text-slate";
}

export function TopBar({
  programmeContext,
  awaiting,
  searchIndex,
}: {
  programmeContext?: { id: string; name: string };
  awaiting: AwaitingSummary;
  searchIndex: SearchEntry[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const query = term.trim().toLowerCase();
  const results: SearchEntry[] =
    open && query !== ""
      ? searchIndex.filter((entry) => matches(entry, query)).slice(0, 6)
      : [];

  // "/" focuses global search, Esc closes any overlay. DESIGN.md section 7.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "/") {
        const target = event.target as HTMLElement | null;
        const typing =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target?.isContentEditable;
        if (typing) return;
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="fixed inset-x-0 left-[var(--rail-width)] top-0 z-10 flex h-[var(--topbar)] items-center gap-4 border-b border-line bg-surface px-6">
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              setOpen(false);
              router.push(`/programs/${results[0].id}`);
            }
          }}
          placeholder="Search programmes"
          aria-label="Search programmes"
          className="h-8 w-72 rounded-base border border-line bg-surface pl-2 pr-8 text-body text-ink placeholder:text-mute focus:border-accent"
        />
        {/* The shortcut is discoverable rather than folklore. */}
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-time text-caption text-mute">
          /
        </kbd>

        {open && term.trim() !== "" && (
          <div className="absolute left-0 top-9 w-96 border border-line bg-surface shadow-overlay">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-body text-slate">
                No programmes match “{term.trim()}”.
              </p>
            ) : (
              <ul>
                {results.map((programme) => (
                  <li key={programme.id}>
                    <Link
                      href={`/programs/${programme.id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-baseline justify-between gap-3 px-3 py-2 text-body hover:bg-canvas"
                    >
                      <span className="text-ink">{programme.name}</span>
                      <span className="text-caption text-slate">{programme.owner}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {programmeContext && (
        <span className="min-w-0 truncate text-body text-slate">
          <span className="text-mute">Programme</span>{" "}
          <span className="text-ink">{programmeContext.name}</span>
        </span>
      )}

      <Link
        href="/programs"
        className="ml-auto flex shrink-0 items-baseline gap-2 rounded-base text-body"
        title="Onboarding fields assigned to you that are not approved or N/A"
      >
        <span className={`font-time text-time font-medium ${awaitingTone(awaiting)}`}>
          {awaiting.count}
        </span>
        <span className="text-slate">awaiting you</span>
      </Link>
    </header>
  );
}
