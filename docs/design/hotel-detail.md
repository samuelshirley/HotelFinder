# Hotel detail: two variants behind a flag (spec from the design review, 2026-11-11)

Flag `detail`: `expand` (A: the card expands in the list) or `slideout` (B: a panel from the right).
Assigned 50/50 per browser and kept; `?detail=expand|slideout` overrides. Metric: Book clicks per detail
open, by variant (logged as usage events).

## Order (both variants)
1. Gallery. B: hero 280px + 2x2 grid, counter opens a lightbox. A: horizontal strip, 160px, scroll-snap.
2. Header: name; `9.2 Superb · 1,284 reviews · ★★★★ · 0.6 km`. Bands: ≥9 Superb, ≥8 Very good, ≥7 Good.
3. Price block (the only boxed module) + Book: total, `N nights × €X · taxes & fees included`, pay-at-hotel line,
   cancellation (B: timeline Today → Free until X → €Y; A: two lines; non-refundable: "✕ Non-refundable"),
   room · board. Book: spinner "Checking price…".
4. Key facts row (≤6 chips): board, cancellation, parking, pets, check-in/out, children. Unknown = hidden.
5. What guests say: category bars (score/10), "Guests liked" ✓ / "Watch out for" ✕, 4 each + "+N more".
6. Other rooms & rates: fetched on open, grouped by room, cheapest first, 3 then "Show all N rooms";
   current offer pinned "Selected"; each rate bookable.
7. Good to know: up to 3 verbatim sentences pulled from the hotel's important information (pets, deposit,
   ID/credit card, minimum age, payment, quiet hours) + "Full hotel policy" disclosure. Never paraphrased.
8. Amenities: normalise, dedupe ("Free" wins), hide compliance strings; top 8 with icons; "Show all N"
   grouped (Internet · Parking & transport · Pools & wellness · Food & drink · Room comfort · Services ·
   Family · Accessibility · Business · Other), plain lists, no pills.
9. About: clamp 4 lines (B) / 3 (A) + Read more.
10. Location: address (+ map later).

Accents: ✓ in #d2cefd, ✕ in muted; no red/green. Sections divided by a 1px #3f424d rule.

## Variant differences
| | A expand | B slide-out |
|---|---|---|
| Opens | Details or card body; one open at a time | panel from the right over chat + list |
| Size | card width, natural height, page scrolls | min(720px, 60vw), full height, sticky header + Book bar |
| Closes | ▲ Collapse (top and bottom), Esc | ✕, Esc, scrim |
| Motion | height+fade 220ms | translateX 240ms, scrim 200ms; reduced motion: 120ms fade |
| <900px | accordion, sticky Book bar | full-screen bottom sheet |

A switches to B's layouts when the card is ≥720px wide (container query), so on wide screens the test
compares the interaction only.

## List column
Header and list share one container: `max-width: 960px; margin-inline: auto; padding-inline: 24px`.
Single column (a grid breaks the ranked reading order). Header: title left + nationality right; chips row;
note row; sticky. Card photo 220px, price column 200px right-aligned.
