# Visual polish review (2026-11-13)

Every page and state, driven like the e2e specs, at 1360×860, 1440×900 and 390×844
(2× pixels). The app is dark-only (no `prefers-color-scheme`), so there is no light/dark pair.
Numbers are CSS px from `getBoundingClientRect` / computed styles. New tokens in
`globals.css`: `--bar-h` (56, 48 under 900px), `--gutter` (20, 16 under 900px),
`--control-sm/md/lg` (32/36/44), `--radius-sm`, `--radius-pill`, `--tp-danger`, `--tp-danger-text`.

| # | Sev | Page / state | What was wrong (measured) | Fix |
|---|---|---|---|---|
| 1 | High | Results: detail slide-out, mobile sheet, header editors, mobile drawer | Map pins carry `z-index` 95–99 and the map made no stacking context, so all 5 pins painted over the slide-out (z 50), its scrim, the full-screen mobile sheet and the header editors (`elementFromPoint` on every pin returned the pin) | `isolation: isolate` on the map wrapper |
| 2 | High | Results: Change who / when / where | Editor 560px wide anchored at its chip: at 1360 the Who editor ran from x=503 to 1063, column ends at 945, so the steppers, Cancel and Apply were clipped; on a phone it ended at 498 of 390 | Editor anchors to the chip row: left edge = row's, width `min(560px, 100%)`; stepper capped at 280px |
| 3 | Med | Slide-out gallery | `60% 40%` columns + 6px gap = 100% + 6px: the 2×2 grid's right column ended at 1366 in a panel ending at 1360 | `minmax(0,3fr) minmax(0,2fr)` |
| 4 | Med | Phone, Hotels tab | The 48px chat bar was scrolled 9px up inside its `overflow: hidden` clip (`scrollTop` 9): title and tabs cut at the top, a bubble showing underneath | `overflow: clip` (cannot be scrolled by code) |
| 5 | Med | Results top bars | Line centres of the three columns' first lines: brand 28.9, chat title 25.0 (bar was 50px, not 48), hotels heading 33.5 | One `--bar-h`: all three now at 28.0 |
| 6 | Med | Results header | Nationality select 303×35 for "Portugal" (sized by the longest country), next to Hide map 83.6×34.3 | Select max 11rem, both 32px (`--control-sm`); label and select centred |
| 7 | Med | Card price column | "total for 2 nights · €63.47 a / night": "night" alone on line 2 (171px column) | The two phrases each kept whole: "total for 2 nights · / €63.47 a night" (two `nowrap` spans, same text) |
| 8 | Med | Admin, phone | Cost table widened the page to 583px on a 390px screen (sideways scroll); dates broke over 4 lines | Table scrolls inside the page; date/time cells don't wrap |
| 9 | Med | Checkout, phone | "Send a new code" squeezed the email field to ~168px, address clipped | Field keeps 220px, the button wraps below it full width |
| 10 | Low | When calendar (trip box and header) | Arrows had their own 32px row above the month names (38px lost); arrows 36×32 | Arrows on the month-name row, 36×36 |
| 11 | Low | Who popover | Age select 12px text (inherited from the label), 40px tall next to 36px steppers; checkbox 13px with no accent (the chat's is 16px violet) | 14px, 36px; checkbox 16px `accent-color` |
| 12 | Low | First screen | Subtitle wrapped to "…the reason it / won." at 1360 and 1440 | `text-wrap: balance` |
| 13 | Low | First screen, phone | Example card: the price squeezed the hotel name to 73px wide, 4 lines | Head wraps: name full width (188px, 2 lines), price under it |
| 14 | Low | Phone gutters | Hotels header 20px vs cards 14px; chat bar 14 vs thread/composer 12 | `--gutter` 16 for all |
| 15 | Low | Checkout header | Bar ends at the window's 28px edges, content column centred at 1040: back link x=20 vs content x=136 (1360); phone 16 vs 24 | Bar ends align with the column; 16px both on a phone |
| 16 | Low | Admin | Section h2 was the browser's 21px, bigger than the 20px h1, touching the box below; 12px time cells top-aligned, 2px above the 14px row text | h2 15px/600 + 8px; cells `vertical-align: baseline` |
| 17 | Low | Admin sign-in | Light text on the violet button (2.9:1; every other filled button uses dark text); input 37px vs button 41px | Dark text, 600; both 40px; hover |
| 18 | Low | Photo lightbox | Prev/next at `top: 50%` without a translate: 22px below centre | `translateY(-50%)` |
| 19 | Low | Trip box CSS | Fallbacks to tokens that do not exist (`--tp-faint`, `--tp-border-subtle`, `--tp-accent-200`) | Real tokens, same colours |

Verified after: every row, by re-measuring and re-shooting all three sizes (pins report
"covered" under the panel; hero grid ends at 1360; centres 28.0/27.95/28.0 at 1360 and 1440;
phone chat `scrollTop` 0, header and cards both at x=16; admin page 390 wide).

## Not styling (left alone)

- **Map framing:** after the first fit the last pin's label sits partly outside the band
  (rank 5 bottom at 432 vs band bottom 426 at 1360; 631 vs 625 on a phone): the camera padding
  does not allow for labels stacked 32px below their hotel. `e2e/map.spec.ts` asserts all pins
  inside the band, so it may be flaky.
- **Map attribution:** expanded (326px) at these widths, it runs under ranks 4 and 5.
  MapLibre's compact attribution is an option in `MapPanel.tsx`.
- **Change what matters most** has no way out but Apply: after Escape, and after opening a hotel,
  the three toggles were still open in the header.
