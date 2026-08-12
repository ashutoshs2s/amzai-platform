"use client";

import { type ReactNode, useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";

/**
 * DataTable. DESIGN.md section 5.
 *
 * Six of the eight modules are variations on a table, so this is the one to get
 * right. 36px rows, 13px text, 12px horizontal cell padding, sticky header,
 * rows separated by a hairline rather than alternating fill, every column
 * sortable with the state shown by a caret and never by colour, temporal
 * columns right-aligned and mono, and the whole row clickable.
 *
 * Filters sit directly above the table, and the row count sits beneath them as
 * plain text. Neither is collapsible: a filter you cannot see is a filter you
 * forget is on.
 */

export type SortDirection = "asc" | "desc";

export type Column<T> = {
  /** Stable identifier, also used as the sort key. */
  key: string;
  header: string;
  /** Temporal and numeric columns are right-aligned. Text is left-aligned. */
  align?: "left" | "right";
  /** Render the cell. */
  cell: (row: T) => ReactNode;
  /**
   * Value to sort by. Without one the column is not sortable, because sorting
   * by rendered markup is meaningless.
   */
  sortValue?: (row: T) => string | number;
  /** Column width, e.g. "160px". Honoured exactly when layout is "fixed". */
  width?: string;
  /**
   * Clip overflowing content with an ellipsis instead of letting it widen the
   * column. Needs a width and layout="fixed". Give the cell a title attribute
   * so the full value is still reachable.
   */
  truncate?: boolean;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /**
   * Noun for the count line: `47 programs`, `1 program`.
   *
   * Given both forms so a filtered-down table reads correctly. English
   * pluralisation is not reliably reversible, so the singular is stated rather
   * than guessed by trimming an "s".
   */
  noun: { one: string; other: string };
  /** Clicking anywhere on a row opens the record. No separate view button. */
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  /** Sort applied on first render. The programme list sorts by countdown. */
  defaultSort?: { key: string; direction: SortDirection };
  /**
   * "fixed" honours column widths exactly and lets a capped column truncate.
   * "auto" sizes columns to their content, which lets the widest text column
   * absorb the whole table. Default "auto".
   */
  layout?: "auto" | "fixed";

  /** The filter row. A single row of compact controls, never a panel. */
  filters?: ReactNode;
  activeFilterCount?: number;
  onClearFilters?: () => void;

  loading?: boolean;
  skeletonRows?: number;
  error?: string | null;
  onRetry?: () => void;

  emptyMessage?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;

  className?: string;
};

/** Sort caret. Shape only; never colour, per section 5. */
function SortCaret({
  direction,
  align,
}: {
  direction: SortDirection;
  align: "left" | "right";
}) {
  return (
    <svg
      width="8"
      height="5"
      viewBox="0 0 8 5"
      aria-hidden="true"
      // The header is reversed for right-aligned columns so the caret sits
      // beside the numbers, so the margin has to move with it.
      className={`inline-block shrink-0 ${align === "right" ? "mr-1" : "ml-1"}`}
    >
      <path
        d={direction === "asc" ? "M4 0 L8 5 L0 5 Z" : "M4 5 L0 0 L8 0 Z"}
        fill="currentColor"
      />
    </svg>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  noun,
  onRowClick,
  selectedKey = null,
  defaultSort,
  layout = "auto",
  filters,
  activeFilterCount = 0,
  onClearFilters,
  loading = false,
  skeletonRows = 8,
  error = null,
  onRetry,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  className = "",
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(
    defaultSort ?? null,
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;

    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * factor;
    });
  }, [rows, sort, columns]);

  function toggleSort(column: Column<T>) {
    if (!column.sortValue) return;
    setSort((current) => {
      if (current?.key !== column.key) return { key: column.key, direction: "asc" };
      return {
        key: column.key,
        direction: current.direction === "asc" ? "desc" : "asc",
      };
    });
  }

  const showBody = !loading && !error && sortedRows.length > 0;
  const showEmpty = !loading && !error && sortedRows.length === 0;

  return (
    <div className={className}>
      {filters && <div className="mb-3">{filters}</div>}

      {/* Row count and active filters, as plain text. Section 5. */}
      <p className="mb-2 text-label text-slate">
        <span className="font-time font-medium text-ink">{loading ? "—" : sortedRows.length}</span>{" "}
        {sortedRows.length === 1 && !loading ? noun.one : noun.other}
        {activeFilterCount > 0 && (
          <>
            {" · "}
            <span className="font-time font-medium text-ink">{activeFilterCount}</span>{" "}
            {activeFilterCount === 1 ? "filter" : "filters"} active
            {onClearFilters && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="rounded-base font-medium text-accent underline underline-offset-2"
                >
                  Clear
                </button>
              </>
            )}
          </>
        )}
      </p>

      {/*
        A fixed-layout table fills its container and honours the declared
        column widths, distributing any leftover across them proportionally.
        Two things follow: no column silently absorbs all the slack and turns
        into a wide empty band, and the table never overflows the content area.

        `table-fixed` needs a definite table width to work. Paired with `w-auto`
        the algorithm is undefined and browsers quietly fall back to auto
        layout, honouring none of the declared widths.
      */}
      <div className="overflow-x-auto rounded-base border border-line bg-surface">
        <table
          className={`w-full border-collapse text-body ${
            layout === "fixed" ? "table-fixed" : ""
          }`}
        >
          <thead>
            <tr>
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                const sortable = Boolean(column.sortValue);
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={
                      isSorted
                        ? sort!.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : sortable
                          ? "none"
                          : undefined
                    }
                    // Canvas fill and a doubled bottom rule. A single hairline
                    // reads as just another row boundary. DESIGN.md section 5.
                    className={`sticky top-0 z-10 border-b border-line bg-surface-head px-3 py-2 text-table-header font-medium uppercase tracking-[0.04em] text-slate ${
                      column.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={`inline-flex items-center rounded-base uppercase ${
                          column.align === "right" ? "flex-row-reverse" : ""
                        }`}
                      >
                        {column.header}
                        {isSorted && (
                          <SortCaret
                            direction={sort!.direction}
                            align={column.align === "right" ? "right" : "left"}
                          />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {/* Skeleton rows at true row height, so the layout does not jump. */}
            {loading &&
              Array.from({ length: skeletonRows }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="border-b border-line">
                  {columns.map((column) => (
                      <td
                      key={column.key}
                      className="p-0 align-middle first:border-l-2 first:border-l-transparent"
                    >
                      <div className="flex h-[calc(var(--row-height)-1px)] items-center px-3">
                        <span className="block h-[9px] w-full max-w-[140px] rounded-base bg-line" />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}

            {showBody &&
              sortedRows.map((row) => {
                const key = rowKey(row);
                const isSelected = key === selectedKey;
                const interactive = Boolean(onRowClick);

                return (
                  <tr
                    key={key}
                    tabIndex={interactive ? 0 : undefined}
                    onClick={interactive ? () => onRowClick!(row) : undefined}
                    onKeyDown={
                      interactive
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick!(row);
                            }
                          }
                        : undefined
                    }
                    className={`border-b border-line ${
                      isSelected ? "bg-accent-sub" : "bg-surface"
                    } ${interactive ? "cursor-pointer hover:bg-canvas" : ""}`}
                  >
                    {columns.map((column, columnIndex) => (
                      <td
                        key={column.key}
                        /*
                          `height` on a table cell is a minimum, not a maximum:
                          the cell grows to whatever its line box needs, so the
                          row height ends up decided by font metrics. The fixed
                          box below is what actually pins it. The height here
                          only stops a short row collapsing.
                        */
                        className={`whitespace-nowrap p-0 align-middle ${
                          columnIndex === 0
                            ? isSelected
                              ? "border-l-2 border-l-accent"
                              : "border-l-2 border-l-transparent"
                            : ""
                        }`}
                      >
                        {/*
                          --row-height is the pitch: the row plus its separating
                          rule. The box is one pixel short of it so rows repeat
                          every 36px exactly, rather than every 37.
                        */}
                        <div
                          className={`flex h-[calc(var(--row-height)-1px)] items-center overflow-hidden px-3 ${
                            column.align === "right" ? "justify-end" : ""
                          }`}
                        >
                          <span className={column.truncate ? "min-w-0 truncate" : ""}>
                            {column.cell(row)}
                          </span>
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>

        {error && (
          <ErrorState message={error} onRetry={onRetry} />
        )}

        {showEmpty && !error && (
          <EmptyState
            message={emptyMessage ?? `No ${noun.other} yet.`}
            actionLabel={emptyActionLabel}
            onAction={onEmptyAction}
          />
        )}
      </div>
    </div>
  );
}
