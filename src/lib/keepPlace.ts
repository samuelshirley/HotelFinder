/**
 * Keeping the reader's place in the hotels list when a change searches again
 * (a currency, a filter) with the full list open. Pure: the hook in
 * components/useKeepPlace.ts reads the boxes and does the scrolling.
 *
 * The new ranking's page of the full list is read again, and until it is in
 * the list holds no rows: without a hold the scroller clamps to the shorter
 * content, and the page came back at about hotel 10 (2026-11-14).
 */

/** A hotel card's box, in viewport pixels. */
export type CardBox = { id: string; top: number; bottom: number };

/** Where the reader is: the card at the top of the view and how far below the view's top it sits. */
export type Place = { id: string | null; offset: number; scrollTop: number };

/** The first card that reaches below the top of the view: the one being read. */
export function placeAt(cards: CardBox[], viewTop: number, scrollTop: number): Place {
  const card = cards.find((c) => c.bottom > viewTop);
  return card ? { id: card.id, offset: card.top - viewTop, scrollTop } : { id: null, offset: 0, scrollTop };
}

/**
 * Where to scroll once the rows are back: the same hotel at the same height
 * when the new rows still hold it (`top` is its box's top now), otherwise
 * the same scroll position as before.
 */
export function scrollTopFor(place: Place, top: number | null, viewTop: number, scrollTop: number): number {
  if (place.id === null || top === null) return place.scrollTop;
  return Math.max(0, scrollTop + (top - viewTop) - place.offset);
}
