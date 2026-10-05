"use client";

/**
 * Pagination (`cmp-pagination`) — explicit numbered pages plus prev/next.
 *
 * The spec demands explicit pagination of 20 (no infinite scroll), and the page
 * lives in the URL (`?page=2`) so a position on the wall is shareable and
 * testable. Page 1 is server-rendered; pages 2+ are fetched client-side, which
 * is why the control takes an `onPageChange` callback rather than a `<Link>`:
 * the board owns the fetch, the URL and the skeletons that cover it.
 *
 * Landmark and state:
 *
 * - the whole control sits in `nav[aria-label="Board pages"]` (a11y
 *   requirement), so it is a navigation landmark rather than a stray row;
 * - the current page is an `aria-current="page"` link pointing at itself, which
 *   is how assistive tech announces "you are here";
 * - prev/next are real `<button>`s, disabled (not removed) at the ends so the
 *   control never reflows;
 * - a `Page N of M` caption carries the same information without colour.
 *
 * The button copy is exposed as constants because the acceptance spec asserts
 * on the exact accessible names.
 */

import { cn, FOCUS_RING } from "@/components/ui/cn";

/** Accessible name of the whole control (a11y requirement). */
export const PAGINATION_NAV_LABEL = "Board pages";

/** Prev/next accessible names — they say where they go, not which glyph is shown. */
export const PREVIOUS_PAGE_LABEL = "Previous page";
export const NEXT_PAGE_LABEL = "Next page";

/** Visible prev/next text; the glyph is decorative. */
export const PREVIOUS_PAGE_TEXT = "Previous";
export const NEXT_PAGE_TEXT = "Next";

/** Caption pattern; `Page 2 of 3`. */
export const PAGE_CAPTION = (page: number, totalPages: number): string =>
  `Page ${page} of ${totalPages}`;

/** Accessible name of one numbered page button. */
export const PAGE_LABEL = (page: number): string => `Page ${page}`;

/** The current page's accessible name, as a screen reader announces it. */
export const CURRENT_PAGE_LABEL = (page: number): string =>
  `Page ${page}, current page`;

/** How many numbered pages render either side of the current one. */
const PAGE_SIBLING_SPAN = 1;

/** Lucide `chevron-left` / `chevron-right`, decorative. */
function ChevronIcon({ direction }: { readonly direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="flex-none"
    >
      {direction === "left" ? (
        <path d="m15 18l-6-6l6-6" />
      ) : (
        <path d="m9 18l6-6l-6-6" />
      )}
    </svg>
  );
}

/** Shared control classes: a secondary, quiet control — never the amber one. */
const CONTROL_CLASSES = [
  "inline-flex h-9 select-none items-center justify-center gap-1.5 rounded-control",
  "border border-border bg-card px-3 text-body-s font-medium text-secondary shadow-card",
  "transition duration-base ease-enter hover:bg-muted",
  FOCUS_RING,
  "disabled:pointer-events-none disabled:opacity-50",
].join(" ");

/** Props for {@link Pagination}. */
export interface PaginationProps {
  /** 1-based page currently shown. */
  readonly page: number;
  /** Total number of pages, from the page's `total` over the fixed 20. */
  readonly totalPages: number;
  /**
   * Called with the page the member asked for. The board updates the URL
   * (`?page=N`), fetches that page and covers the wall with skeletons.
   */
  readonly onPageChange: (page: number) => void;
  /** True while the requested page is being fetched. */
  readonly loading?: boolean;
  /** Extra class names for the nav element. */
  readonly className?: string;
}

/**
 * The numbered window around the current page, always including page 1 and the
 * last page, with an ellipsis wherever numbers were skipped.
 */
function pageWindow(
  page: number,
  totalPages: number,
): Array<number | "ellipsis-left" | "ellipsis-right"> {
  const window: Array<number | "ellipsis-left" | "ellipsis-right"> = [];

  const first = Math.max(2, page - PAGE_SIBLING_SPAN);
  const last = Math.min(totalPages - 1, page + PAGE_SIBLING_SPAN);

  window.push(1);
  if (first > 2) window.push("ellipsis-left");
  for (let current = first; current <= last; current += 1) window.push(current);
  if (last < totalPages - 1) window.push("ellipsis-right");
  if (totalPages > 1) window.push(totalPages);

  return window;
}

/**
 * The pagination control.
 *
 * A Client Component only because the controls fire `onPageChange`; the board
 * island renders it, so no extra boundary is needed.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  loading = false,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      aria-label={PAGINATION_NAV_LABEL}
      data-testid="board-pagination"
      data-loading={loading ? "true" : "false"}
      className={cn(
        "flex flex-wrap items-center justify-center gap-2",
        className,
      )}
    >
      <button
        type="button"
        aria-label={PREVIOUS_PAGE_LABEL}
        title={PREVIOUS_PAGE_LABEL}
        disabled={!hasPrevious || loading}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        className={CONTROL_CLASSES}
      >
        <ChevronIcon direction="left" />
        <span className="hidden sm:inline">{PREVIOUS_PAGE_TEXT}</span>
      </button>

      <ul className="flex items-center gap-1.5">
        {pageWindow(page, totalPages).map((entry) => {
          if (entry === "ellipsis-left" || entry === "ellipsis-right") {
            return (
              <li key={entry} aria-hidden="true" className="px-1 text-body-s text-muted-foreground">
                …
              </li>
            );
          }

          const isCurrent = entry === page;

          return (
            <li key={entry}>
              <button
                type="button"
                aria-label={
                  isCurrent ? CURRENT_PAGE_LABEL(entry) : PAGE_LABEL(entry)
                }
                aria-current={isCurrent ? "page" : undefined}
                data-page={entry}
                data-current={isCurrent ? "true" : "false"}
                disabled={loading}
                onClick={() => {
                  if (!isCurrent) onPageChange(entry);
                }}
                className={cn(
                  "inline-grid h-9 w-9 select-none place-items-center rounded-control",
                  "text-body-s font-medium transition duration-base ease-enter",
                  FOCUS_RING,
                  "disabled:pointer-events-none",
                  isCurrent
                    ? "border border-border bg-muted text-foreground"
                    : "border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {entry}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        aria-label={NEXT_PAGE_LABEL}
        title={NEXT_PAGE_LABEL}
        disabled={!hasNext || loading}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        className={CONTROL_CLASSES}
      >
        <span className="hidden sm:inline">{NEXT_PAGE_TEXT}</span>
        <ChevronIcon direction="right" />
      </button>

      <p className="w-full text-center text-caption text-muted-foreground sm:w-auto">
        {PAGE_CAPTION(page, totalPages)}
      </p>
    </nav>
  );
}

export default Pagination;
