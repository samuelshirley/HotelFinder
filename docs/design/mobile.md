# Phones: one pane at a time

Decided 2026-11-13 after a phone audit (Sam's recordings, reproduced at
375×812 on feraltravels.com/hotels). The mocks, the audit, the product review
and the competitor survey are on the canvas "Hotel finder mobile redesign"
(claude.ai artifact). This page is what is built and why.

## What was wrong

- The app shell was `height: 100dvh; overflow: hidden`: 379px of the first
  screen could never be reached.
- The results stacked a 336px header, a 260px map and the list in a 168px box
  that scrolled inside the page; "Details" opened inside that same box.
- No viewport handling at all: no safe-area insets, no keyboard handling,
  14px inputs (iOS zooms the page on focus).

## The layout (≤900px)

- **A bottom tab bar: Chat · Hotels · Map · Trips** (FeralTravels' pattern).
  Hotels and Map are disabled until a search exists. The tab bar hides while
  the keyboard is open.
- **Each pane is one scrolling surface.** Nothing scrolls inside a pane.
  `e2e/ui/results.spec.ts › a phone: …` checks that the Hotels pane is the
  only scroller.
- **Hotels** is the list alone (the summary scrolls with it). **Map** is the
  map alone with one hotel card over it (`MapCard`): tap to open the hotel,
  arrows for the next pin. **Trips** is the trips list as a page; tapping a
  trip opens its hotels. The trips drawer and the top Chat | Hotels tabs are
  gone.
- **A hotel always opens as the full-screen page** on a phone. The `detail`
  flag's inline variant is desktop-only, so the experiment's phone numbers are
  all the slide-out (logged as such).
- **The first screen scrolls** (`.hero`), on desktop too when the window is
  short.

## The keyboard

iOS Safari ignores `interactive-widget=resizes-content` (shipped in WebKit,
not yet in Safari 27.2), so the layout viewport keeps its height when the
keyboard opens and fixed content sits under it. `useVisualViewport`
(App.tsx) sizes the shell to `visualViewport.height` and offsets it by
`offsetTop`, measured on `resize`, `scroll` and `focusout`, two frames
late because iOS reports late (WebKit 237851; iOS 26 can keep stale numbers
after the keyboard closes, hence `focusout`). The keyboard counts as open when
the visible screen is 150px or more shorter than the window.

Not verified on a real iPhone yet: the e2e suite runs Chromium, which has no
on-screen keyboard. Check it on a device before calling it done.

## Rules a change must keep

- Every input is 16px or larger on a phone (`globals.css`).
- `env(safe-area-inset-bottom)` under the tab bar, the hotel page's Book bar
  and the sign-in sheet.
- The composer is never disabled once the page has loaded: a disabled field
  drops the phone keyboard, and a question must always have something that
  answers it (docs/testing.md, "dead ends").

## Not built yet (in the mocks)

- The trip card after the first message ("from your words / assumed / needs
  you") and the sticky trip pill that opens a full-screen editor. Today the
  results summary and its chips do that job.
- Removing the Where / When / Who pills from the first screen.
- Back-button history for tabs and the hotel page (the page closes with ✕ and
  Esc; the browser's back leaves the app).
