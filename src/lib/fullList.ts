/**
 * "Show all N hotels" (docs/finder.md, "The full list"). Pure: shared by the
 * finder that writes the rows, the repo that reads them and the panel that
 * pages them. No I/O here.
 *
 * The finder stores every hotel that fits as a finder row. The top picks keep
 * their reasons; the rest of the ranked order is stored under this one reason
 * kind, holding only the two facts every card shows. They are not in the
 * shortlist the chat, the answers or the agent read (`listShortlist` leaves
 * them out), except one a message names (`fullListMentions`); they are read a
 * page at a time.
 */
export const FULL_LIST_KIND = 'full_list' as const;

/** Rows per page of the full list. */
export const FULL_LIST_PAGE_SIZE = 20;

/** The most pages a request may ask for: far more than any search returns. */
export const FULL_LIST_MAX_PAGE = 50;

/** How many pages `count` rows make; never fewer than one. */
export const pageCount = (count: number, size = FULL_LIST_PAGE_SIZE) => Math.max(1, Math.ceil(count / size));

/** A page number brought into range for `count` rows. */
export const clampPage = (page: number, count: number, size = FULL_LIST_PAGE_SIZE) => Math.min(Math.max(1, Math.floor(page)), pageCount(count, size));

/**
 * "Hotels 6–25 of 47": the ranks a page of the tail holds, counted after the
 * `before` top picks. null when the page is empty.
 */
export function pageRange(page: number, count: number, before: number, size = FULL_LIST_PAGE_SIZE): { from: number; to: number; of: number } | null {
  const p = clampPage(page, count, size);
  const first = (p - 1) * size;
  if (first >= count) return null;
  return { from: before + first + 1, to: before + Math.min(count, first + size), of: before + count };
}
