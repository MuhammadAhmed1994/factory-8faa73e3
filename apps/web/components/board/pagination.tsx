"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Pagination — the explicit numbered board pagination (cmp-pagination).
 *
 * Infinite scroll is an anti-pattern for this product: the spec demands an
 * explicit pagination control of 20 per page (constraint C-3 / ADR-6), so the
 * wall gets `nav[aria-label="Board pages"]` with:
 *
 * - `Previous page` / `Next page` secondary buttons (disabled at the ends),
 * - one numbered page link per page, the current one marked
 *   `aria-current="page"` and rendered as a non-link pill,
 * - the caption `Page N of M` for context.
 *
 * **The page lives in the URL** (`/?page=2`) — the implementation note's "must":
 * page 1 is server-rendered by the route, pages 2+ are fetched client-side, and
 * the URL stays shareable and testable. Links are real anchors so the control
 * works with middle-click / "open in new tab" and without JavaScript; the board
 * also passes `onPageChange` so a client-side transition can fetch without a
 * full document load.
 *
 * Accessibility: the nav landmark is labelled, the current page's state is
 * exposed by `aria-current` (not colour alone), and every control carries the
 * amber focus-visible ring.
 */

/** Accessible name of the prev/next controls (they render icon-only on mobile). */
export const PAGINATION_PREV_LABEL = "Previous page";
export const PAGINATION_NEXT_LABEL = "Next page";

/** Landmark label pinned by the a11y spec. */
export const PAGINATION_NAV_LABEL = "Board pages";

/** Caption shown beside the numbers, e.g. "Page 2 of 3". */
export function paginationCaption(page: number, pageCount: number): string {
  return `Page ${page} of ${pageCount}`;
}

/**
 * The page numbers to render: a window of up to `windowSize` around the
 * current page, always including the first and last page.
 *
 * Exported because the board and the specs both need to agree on which numbers
 * a long wall actually shows (the control never renders 40 links).
 */
export function pageWindow(
  page: number,
  pageCount: number,
  windowSize = 5,
): number[] {
  if (pageCount <= 0) {
    return [];
  }

  const first = 1;
  const last = pageCount;
  const half = Math.floor(Math.max(windowSize - 1, 0) / 2);
  let start = Math.max(page - half, first);
  const end = Math.min(start + Math.max(windowSize, 1) - 1, last);
  start = Math.max(Math.min(start, end - Math.max(windowSize, 1) + 1), first);

  const pages: number[] = [];
  for (let current = start; current <= end; current += 1) {
    if (current >= first && current <= last) {
      pages.push(current);
    }
  }
  return pages;
}

/** Shared focus ring — never removed. */
const FOCUS_CLASSES = cn(
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

const CONTROL_BASE = cn(
  "inline-flex h-9 select-none items-center justify-center gap-1.5",
  "rounded-control font-body text-body-s font-semibold transition duration-fast ease-enter",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  "motion-reduce:animate-none",
  FOCUS_CLASSES,
);

const CONTROL_IDLE = cn(
  "border border-border bg-card px-3 text-foreground",
  "hover:border-accent hover:bg-accent-soft hover:shadow-card-hover",
  "active:translate-y-0",
);

const NUMBER_BASE = cn(
  "inline-flex h-9 w-9 select-none items-center justify-center",
  "rounded-control font-body text-body-s font-medium tabular-nums",
  "transition duration-fast ease-enter motion-reduce:animate-none",
  FOCUS_CLASSES,
);

/** Props accepted by {@link Pagination}. */
export interface PaginationProps {
  /** The currently shown board page (1-based). */
  page: number;
  /**
   * How many pages the wall has. The board derives this from the page size and
   * the last page it has seen, so the control works before a total arrives.
   */
  pageCount: number;
  /**
   * Fires with the newly requested page (already clamped to `1..pageCount`).
   * The board updates the URL with `?page=N` and fetches that page.
   */
  onPageChange?: (page: number) => void;
  /** Extra classes for the nav element. */
  className?: string;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
}: PaginationProps) {
  if (pageCount <= 1) {
    return null;
  }

  const current = Math.min(Math.max(page, 1), pageCount);
  const pages = pageWindow(current, pageCount);
  const hasPrev = current > 1;
  const hasNext = current < pageCount;

  /** Builds the board URL for a page — the page stays in the address bar. */
  const hrefFor = (target: number): string =>
    target <= 1 ? "/" : `/?page=${target}`;

  const goTo = (target: number): void => {
    const clamped = Math.min(Math.max(target, 1), pageCount);
    if (clamped !== current) {
      onPageChange?.(clamped);
    }
  };

  return (
    <nav
      aria-label={PAGINATION_NAV_LABEL}
      data-testid="board-pagination"
      data-page={current}
      data-page-count={pageCount}
      className={cn(
        "flex flex-wrap items-center justify-center gap-1.5",
        className,
      )}
    >
      <button
        type="button"
        aria-label={PAGINATION_PREV_LABEL}
        data-testid="pagination-prev"
        disabled={!hasPrev}
        onClick={() => goTo(current - 1)}
        className={cn(CONTROL_BASE, CONTROL_IDLE)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        <span className="hidden sm:inline">Previous page</span>
      </button>

      {pages.map((candidate) => {
        const isCurrent = candidate === current;
        return isCurrent ? (
          <span
            key={candidate}
            aria-current="page"
            data-testid={`pagination-page-${candidate}`}
            data-current="true"
            className={cn(
              NUMBER_BASE,
              "border border-primary bg-primary text-primary-foreground shadow-card",
            )}
          >
            {candidate}
          </span>
        ) : (
          <Link
            key={candidate}
            href={hrefFor(candidate)}
            data-testid={`pagination-page-${candidate}`}
            aria-label={`Page ${candidate}`}
            onClick={(event) => {
              // Let the anchor's default navigation stand for a plain click;
              // a client transition is an enhancement the board can request.
              if (onPageChange) {
                event.preventDefault();
                goTo(candidate);
              }
            }}
            className={cn(NUMBER_BASE, "border border-border bg-card text-foreground hover:bg-muted hover:text-foreground")}
          >
            {candidate}
          </Link>
        );
      })}

      <button
        type="button"
        aria-label={PAGINATION_NEXT_LABEL}
        data-testid="pagination-next"
        disabled={!hasNext}
        onClick={() => goTo(current + 1)}
        className={cn(CONTROL_BASE, CONTROL_IDLE)}
      >
        <span className="hidden sm:inline">Next page</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      <p className="type-caption sr-only sm:not-sr-only sm:ml-2 text-muted-foreground">
        {paginationCaption(current, pageCount)}
      </p>
    </nav>
  );
}

export default Pagination;
