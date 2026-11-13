# The map (built 2026-11-12)

Sam's choices, 12 Nov 2026: layout C, OpenFreeMap over Google Maps, the map may change the search,
rank and price always on the pin, a pin's hover puts a border on its card. Three layouts were drawn
and a UI designer consulted first; the alternatives (a permanent split, a List / Split / Map switch)
lost because the middle column is only 650 to 800 px on a laptop and the list never holds more than
about ten hotels.

## Layout

Trips | hotels | chat is unchanged. Inside the hotels column:

- **Under 1000 px wide** (1280 and 1440 windows): the search header, a map band
  `clamp(200px, 32vh, 320px)` tall, then the list. Only the list scrolls, so the wheel over the map
  zooms the map.
- **1000 px and wider** (about a 1920 window): the list (640 px) beside the map, full height.
- The card is the same three-column card in both. The list is its own size container, so the card
  follows the list's width, not the column's.
- "Hide map" in the header folds the band away; remembered per browser (`hf_map`).

## Tiles

MapLibre GL JS drawing OpenFreeMap's `dark` style (`lib/mapStyle.ts`). No key, no account, no bill.
OpenFreeMap's terms offer the public instance as-is; that URL is the one thing to change if it goes.
The library is loaded on the client only, and only while the map is open.

## What is on it (`lib/mapView.ts`, unit-tested)

- **A ranked hotel**: a pill, `rank · total for the stay`. The total is formatted from the offer row,
  like the card's.
- **A near-miss**: a hollow ring with no rank; what it misses shows on hover or focus, in the card's
  words. A member-priced near-miss has no price anywhere (its row holds no offer).
- **The anchor**: a diamond with its name, when distance is measured from a real place (one the
  user named, picked on the map, or a point destination). An area with nothing named has none: the
  finder then measures from the middle of the results, which is no place.
- **The ring**: only when closeness is part of the ranking and there is an anchor. Its radius is the
  furthest ranked hotel's distance as the finder measured it, labelled as a distance.
- Only finder rows get a pin. A hotel the user merely asked about is not ranked, so it is not drawn.

## Labels never cover each other (`layoutPins`)

Found in the browser on the first real search: in Porto the label for rank 2 sat entirely under
rank 3, and ranks 1, 4 and 5 were 10 px apart, so pressing a pin selected a different hotel. Labels
are laid out best rank first. One that would touch another is stacked 32 px below or above (then
64); only when no slot is free does it shrink to its rank alone, and the price returns on hover.
A stacked label is up to 64 px from its hotel; zooming in pulls the stack apart. The best rank is
always drawn on top and always on its own spot.

## List and map

| You do | What happens |
|---|---|
| Hover a pin | Its card gets a border and scrolls into view. The map does not move. |
| Hover a card | Its pin lights up. The map does not move. |
| Press a pin | Its card stays marked. Nothing opens. |
| Open a card | Its pin is marked; the map pans only if the pin is out of sight, and never zooms. |

A hover race, found in the browser: React reports a card's enter on the browser's mouseout event,
before the pin's mouseleave arrives, so a leave that cleared the hover wiped the card just entered.
A leave now names what was left and clears the hover only if it is still on that.

## Who owns the camera

It frames a new SET of hotels once (ranked hotels and the anchor; a near-miss joins only if it grows
the frame by under 30%). A re-rank of the same hotels does not move it. After any move the app did
not start, the camera is the user's: later changes offer **Recentre** instead of moving it. A new
anchor still moves it, and so does a hotel Penny marks. The app flags its own moves; telling them
apart by the event's input was wrong (measured: a wheel zoom's events carry none).

## Gestures that change the search

Both go through the edit route as `set_near_point` (the path the header chips use): one Penny line,
no model call, no place lookup.

- **Press a named place**, then "Measure from <name>": measured from that feature's own point (or
  where it was pressed, for a label along a road or over an area), under the name the map prints.
  First built as a chat message; in the browser, pressing Campanhã made the agent ask which
  Campanhã was meant, when the user had just pointed at one.
- **Search around here**: offered once the user has moved the middle of the map more than 35% of
  its shorter side away from what was framed. Measures from the middle of the map as it stands.
  It is a new search around that point (5 km, widened once to 15 km), not a filter to the frame.

Both add closeness to what "best" means, as a place named in the chat does. `mapPointGuard` keeps
this the only way coordinates enter: the action is named in six files, none of them the agent or the
router. Refused on purpose: searching again on every pan, drawn areas, dragging the anchor, and any
price or rating control on the map.

## Penny and the map

- Jev intent `map`: "hide the map", "show the map", "where is the second one?" settle with no model
  (`ui.map` / `ui.focus` on the reply). Like every Jev intent it is **unverified against the real
  Jev** until `scripts/jev-live.sh` is run with cases for it.
- Agent tools `show_map` and `mark_on_map` for when Jev does not settle it. Verified live in
  `e2e/map.spec.ts` ("hide the map" with Jev off).
- She posts a fixed line for each and never narrates camera moves.

## Verified, and not

`e2e/map.spec.ts` runs in a real browser against the live sandbox and live tiles: layout at 1360 and
2000 wide, pins against their cards' totals, no overlapping labels, both hovers, a pressed pin, the
wheel, Recentre, Search around here and its undo, hide over a reload, hide by chat, measuring from
a named place.

Not done: the detail slide-out still opens over the map (the designer's note: it should cover the
list only). Not checked: a narrow (phone-width) window with the map open, keyboard-only use of the
pins, and a screen reader.
