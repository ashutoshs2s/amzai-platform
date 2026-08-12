"use client";

import Link from "next/link";

import { ADMIN_MODULE, MODULES } from "@/lib/modules";

/**
 * Persistent left rail. DESIGN.md section 4.
 *
 * 220px, listing all eight modules. The current one is marked with an accent
 * left border and never a filled background: a filled row competes with the
 * selected-row treatment in tables, and the rail is not where the eye should
 * be drawn.
 *
 * Modules without a screen are listed and visibly unavailable rather than
 * hidden. Hiding them tells an operator nothing about what is coming; linking
 * them nowhere makes the product look broken. They render in `--mute`, which
 * is exactly the token's role: disabled text, exempt from the contrast floor.
 */
export function LeftRail({
  currentHref,
  showAdmin = false,
}: {
  currentHref?: string;
  /**
   * Staff and privileges is shown only to those who can open it. Unlike the
   * eight modules, which are listed whether or not they are built, a screen
   * somebody may never reach tells them nothing about the product's shape.
   */
  showAdmin?: boolean;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-[var(--rail-width)] flex-col border-r border-line bg-surface">
      <div className="flex h-[var(--topbar)] items-center border-b border-line px-4">
        <span className="text-body font-semibold tracking-[0.04em] text-ink">
          AMZAI
        </span>
      </div>

      <nav aria-label="Modules" className="flex flex-col pb-2">
        {MODULES.map((module) => {
          const isCurrent = module.href !== undefined && module.href === currentHref;

          if (!module.href) {
            return (
              <span
                key={module.order}
                aria-disabled="true"
                title={module.note}
                className="flex cursor-not-allowed items-baseline border-l-[3px] border-l-transparent px-4 py-2 text-body text-mute"
              >
                {module.name}
              </span>
            );
          }

          return (
            <Link
              key={module.order}
              href={module.href}
              aria-current={isCurrent ? "page" : undefined}
              className={`flex items-baseline border-l-[3px] px-4 py-2 text-body ${
                isCurrent
                  ? "border-l-accent font-medium text-ink"
                  : "border-l-transparent text-slate hover:text-ink"
              }`}
            >
              {module.name}
            </Link>
          );
        })}
        {showAdmin && (
          <Link
            href={ADMIN_MODULE.href!}
            aria-current={ADMIN_MODULE.href === currentHref ? "page" : undefined}
            className={`mt-2 flex items-baseline border-l-[3px] border-t border-t-line px-4 py-2 text-body ${
              ADMIN_MODULE.href === currentHref
                ? "border-l-accent font-medium text-ink"
                : "border-l-transparent text-slate hover:text-ink"
            }`}
          >
            {ADMIN_MODULE.name}
          </Link>
        )}
      </nav>

      <p className="mt-auto px-4 py-3 text-caption text-slate">
        Modules in grey have no screen yet. They are listed so the shape of the
        product is visible from the first day.
      </p>
    </aside>
  );
}
