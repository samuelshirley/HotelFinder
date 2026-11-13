/**
 * Who tests each control. One claim per control (or per family of controls
 * that differ only by data: a day in a calendar, a hotel's pin, a place
 * suggestion), matched against `role "accessible name"` as
 * support/inventory.ts lists it, and naming the test that presses it as
 * `<file under e2e/> › <test title>`. guards/controls.spec.ts fails on a
 * control nothing here matches, and on a claim whose test does not exist.
 *
 * Adding a control to the app: write the test that uses it, then add its
 * claim here. Never claim a control for a test that does not press it.
 */
export type Claim = { control: RegExp; by: string };

const FIRST = 'ui/first-screen.spec.ts';
const RESULTS = 'ui/results.spec.ts';
const DETAIL = 'ui/detail.spec.ts';
const MAP = 'ui/map.spec.ts';
const CHAT = 'ui/chat.spec.ts';
const ASK = 'ui/onboarding.spec.ts';
const BOOK = 'ui/booking.spec.ts';
const ADMIN = 'ui/admin.spec.ts';
const SAVED = 'ui/saved.spec.ts';
const FILTERS = 'ui/filters.spec.ts';
const FULL = 'ui/full-list.spec.ts';
const FREEZE = 'ui/freeze.spec.ts';
const SPANISH = 'ui/spanish.spec.ts';
const EXTRAS = 'ui/checkout-extras.spec.ts';
const SIGHTS = 'ui/sights.spec.ts';

const DAY = '(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)';
const MONEY = '(?:[€£$¥]|[A-Z]{2,3}\\$?)[\\d,]+(?:\\.\\d{2})?';

export const CLAIMS: Claim[] = [
  // ── Sidebar and header ─────────────────────────────────────────────────────
  { control: /^button "New search"$/, by: `${RESULTS} › New search starts clean, and the trip reopens from the list` },
  { control: /^button "Trips list"$/, by: `${RESULTS} › the trips list folds away, the hotels take its room, and it stays folded over a reload` },
  { control: /^button ".+\d{1,2}(\s\w{3})?–\d{1,2} \w{3}, \d+ nights?"$/, by: `${RESULTS} › New search starts clean, and the trip reopens from the list` },
  { control: /^button "Close the trips list"$/, by: `${RESULTS} › a phone: one pane at a time over a tab bar, and each pane scrolls as one` },
  { control: /^tab "Chat"$/, by: `${RESULTS} › a phone: one pane at a time over a tab bar, and each pane scrolls as one` },
  { control: /^tab "(Map|Trips)"$/, by: `${RESULTS} › a phone: one pane at a time over a tab bar, and each pane scrolls as one` },
  { control: /^button "(Previous|Next) hotel"$/, by: `${RESULTS} › a phone: one pane at a time over a tab bar, and each pane scrolls as one` },
  { control: /^button "\d+ of \d+.+"$/, by: `${RESULTS} › a phone: one pane at a time over a tab bar, and each pane scrolls as one` },
  { control: /^tab "Hotels( \(\d+\))?"$/, by: `${RESULTS} › a phone: one pane at a time over a tab bar, and each pane scrolls as one` },
  { control: /^button "Sign out"$/, by: `${BOOK} › sign out from the sidebar: the account line and the bookings go` },
  { control: /^link ".+\d.*"$/, by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^separator "Resize the chat"$/, by: `${RESULTS} › the chat edge: drag, arrow keys and a double-click to reset; the hotels never squeezed` },

  // ── First screen ───────────────────────────────────────────────────────────
  { control: /^textbox "Your trip"$/, by: `${FIRST} › Shift+Enter is a new line; Enter submits` },
  { control: /^button "Where: .+"$/, by: `${FIRST} › the Where pill searches places in its own box, and a pick fills the pill` },
  { control: /^textbox "Place"$/, by: `${FIRST} › the Where pill searches places in its own box, and a pick fills the pill` },
  { control: /^button "When: .+"$/, by: `${FIRST} › the When pill: tonight by default, the weekend chips, the calendar and Done` },
  { control: /^button "Who: .+"$/, by: `${FIRST} › the Who pill: adults, children and their ages, rooms never more than adults, the pet` },
  { control: /^button "(Find my hotel|Finding…)"$/, by: `${FIRST} › Find my hotel with nothing typed opens the place search instead of searching` },
  { control: /^button "Search for: “.+”Enter"$/, by: `${FIRST} › the "Search for" row submits the sentence as typed` },
  // A place suggestion: its name, then "where · kind" (or the kind alone).
  { control: /^button ".+(City|Neighbourhood|Airport|Station|Region|Place)"$/, by: `${FIRST} › a bare place in the box suggests places; a pick fills Where and clears the box` },
  { control: /^button "(Low price|Great reviews|Close to the centre)"$/, by: `${FIRST} › what matters: each chip toggles, and the search carries what is pressed` },
  { control: /^button "(Tonight|This weekend|Next weekend)"$/, by: `${FIRST} › the When pill: tonight by default, the weekend chips, the calendar and Done` },
  { control: /^button "Done"$/, by: `${FIRST} › the When pill: tonight by default, the weekend chips, the calendar and Done` },
  { control: /^button "(Previous|Next) month"$/, by: `${FIRST} › the When pill: tonight by default, the weekend chips, the calendar and Done` },
  { control: new RegExp(`^button "${DAY}"$`), by: `${FIRST} › the When pill: tonight by default, the weekend chips, the calendar and Done` },
  { control: /^button "(More|Fewer) (adults|children|rooms)"$/, by: `${FIRST} › the Who pill: adults, children and their ages, rooms never more than adults, the pet` },
  { control: /^combobox "Age of child \d"$/, by: `${FIRST} › the Who pill: adults, children and their ages, rooms never more than adults, the pet` },
  { control: /^checkbox "Bringing a pet"$/, by: `${FIRST} › the Who pill: adults, children and their ages, rooms never more than adults, the pet` },

  // ── Sign in to see member prices ───────────────────────────────────────────
  { control: /^button "(Sign in for member prices|Sign in to see price)"$/, by: `${RESULTS} › sign in from the results with an emailed code: the same search comes back at member prices` },
  { control: /^textbox "6-digit code"$/, by: `${RESULTS} › sign in from the results with an emailed code: the same search comes back at member prices` },
  { control: /^button "Change"$/, by: `${RESULTS} › sign in from the results with an emailed code: the same search comes back at member prices` },

  // ── Questions in the chat ──────────────────────────────────────────────────
  { control: /^button ".+ · .+"$/, by: `${ASK} › a place with several matches is asked as "Which …?", one chip each` },
  { control: /^button "[^"]+, [^"]+"$/, by: `${ASK} › words that name no place are asked "Where are you going?", with a place search` },
  { control: /^button "Use these nights"$/, by: `${ASK} › words about when, with no two dates, ask for the nights; "Use these nights" runs the search` },
  { control: /^button "That is everyone"$/, by: `${ASK} › a search started before the first screen asks each question in turn: place, nights, party, priorities` },
  { control: /^button "Show hotels"$/, by: `${ASK} › a search started before the first screen asks each question in turn: place, nights, party, priorities` },
  { control: /^button "No preference"$/, by: `${ASK} › "No preference" answers the priorities question in one tap` },
  { control: /^button "Close to .+"$/, by: `${RESULTS} › What matters: three toggles and Apply, and the chat says how it is ranked` },

  // ── Chat ───────────────────────────────────────────────────────────────────
  { control: /^textbox "Message"$/, by: `${CHAT} › a typed message shows at once, is answered, and is recorded as a turn` },
  { control: /^button "Send"$/, by: `${CHAT} › Send is pressable only with words in the box` },
  { control: /^button "Open .+"$/, by: `${RESULTS} › Penny names one hotel and her button opens it` },

  // ── Results header ─────────────────────────────────────────────────────────
  { control: /^button "Change where"$/, by: `${RESULTS} › Change where: a new place searches there, and the trip follows` },
  { control: /^textbox "New place"$/, by: `${RESULTS} › Change where: a new place searches there, and the trip follows` },
  { control: /^button "Change when"$/, by: `${RESULTS} › Change when: new nights search again` },
  { control: /^button "Change who"$/, by: `${RESULTS} › Change who: one more adult searches again; the pet becomes a requirement` },
  { control: /^button "Apply"$/, by: `${RESULTS} › Change who: one more adult searches again; the pet becomes a requirement` },
  { control: /^button "Cancel"$/, by: `${RESULTS} › What matters: \${how} closes the toggles without changing the ranking` },
  { control: /^button "Change what matters most"$/, by: `${RESULTS} › What matters: three toggles and Apply, and the chat says how it is ranked` },
  // Sights (docs/sights.md). These appear only after a museum request, which needs the model: the tests are @ai.
  { control: /^button "Remove the plan"$/, by: `${SIGHTS} › the plan starts from another listed hotel when one is picked, and Remove the plan puts "close" back` },
  { control: /^combobox "Starting from"$/, by: `${SIGHTS} › the plan starts from another listed hotel when one is picked, and Remove the plan puts "close" back` },
  { control: /^link ".+ on Google Maps"$/, by: `${SIGHTS} › museums asked for in the chat: Penny names the most popular, hotels are ranked close to them, and the plan starts from the best hotel` },
  { control: /^link "Open the walking route for day \d+ in Google Maps"$/, by: `${SIGHTS} › museums asked for in the chat: Penny names the most popular, hotels are ranked close to them, and the plan starts from the best hotel` },
  { control: /^link ".+, on your plan"$/, by: `${SIGHTS} › museums asked for in the chat: Penny names the most popular, hotels are ranked close to them, and the plan starts from the best hotel` },
  { control: /^button "Near .+ ✕"$/, by: `${MAP} › Search around here searches around the middle of the map; its chip undoes it` },
  { control: /^combobox "Nationality for rates"$/, by: `${RESULTS} › Nationality for rates: another country prices the search again` },
  { control: /^button "(Hide|Show) map"$/, by: `${MAP} › Hide map folds it away, and it stays away over a reload until Show map` },

  // ── Cards ──────────────────────────────────────────────────────────────────
  { control: /^button "(Book|Checking the price…)"$/, by: `${BOOK} › Book re-checks the price and opens the checkout for that hotel` },
  { control: /^button "(Details|Collapse ▲)"$/, by: `${DETAIL} › Details expands the card in place; Collapse at the top and the bottom fold it` },
  { control: /^button "Sign in for a lower price"$/, by: `${RESULTS} › signed out, a card where members pay less offers a sign-in, never the amount; signed in, it shows the member price` },
  // The sign-in modal on the results.
  { control: /^textbox "Email\. A sign-in code goes here; no password\."$/, by: `${RESULTS} › signed out, a card where members pay less offers a sign-in, never the amount; signed in, it shows the member price` },
  { control: /^button "Not now"$/, by: `${RESULTS} › signed out, a card where members pay less offers a sign-in, never the amount; signed in, it shows the member price` },

  // ── Map ────────────────────────────────────────────────────────────────────
  { control: new RegExp(`^button "\\d+\\. .+(, ${MONEY})?"$`), by: `${MAP} › a pin and its card point at each other; a pressed pin stays marked and opens nothing` },
  { control: /^button "Zoom (in|out)"$/, by: `${MAP} › the zoom buttons zoom, and the (i) unfolds and folds the credits` },
  { control: /^summary "Toggle attribution"$/, by: `${MAP} › the zoom buttons zoom, and the (i) unfolds and folds the credits` },
  { control: /^link "(OpenFreeMap|© OpenMapTiles|OpenStreetMap)"$/, by: `${MAP} › the zoom buttons zoom, and the (i) unfolds and folds the credits` },
  { control: /^button "Map marker"$/, by: `${MAP} › the place distances are measured from is marked on the map by its name` },
  { control: /^button "Search around here"$/, by: `${MAP} › Search around here searches around the middle of the map; its chip undoes it` },
  { control: /^button "Recentre"$/, by: `${MAP} › the wheel zooms the map, not the list; Recentre brings the frame back` },
  { control: /^button "Measure from .+"$/, by: `${MAP} › a named place on the map: pressing it offers "Measure from", and taking it measures from there` },

  // ── Hotel detail ───────────────────────────────────────────────────────────
  { control: /^button "Close"$/, by: `${DETAIL} › closes by ✕, by Esc and by the scrim, and focus returns to Details` },
  { control: /^button "Photo \d+ of \d+"$/, by: `${DETAIL} › photos: each opens the lightbox there; arrows, keys, the counter and close` },
  { control: /^button "1\/\d+ photos"$/, by: `${DETAIL} › photos: each opens the lightbox there; arrows, keys, the counter and close` },
  { control: /^button "(Close photos|Previous photo|Next photo)"$/, by: `${DETAIL} › photos: each opens the lightbox there; arrows, keys, the counter and close` },
  { control: new RegExp(`^button "Book · ${MONEY}"$`), by: `${DETAIL} › rooms and rates: grouped, cheapest first; a room opens its rates; Select moves the price block` },
  { control: /^button "Checking price…"$/, by: `${DETAIL} › rooms and rates: grouped, cheapest first; a room opens its rates; Select moves the price block` },
  { control: /^summary "What is included"$/, by: `${DETAIL} › good to know, amenities, about and location each open and close` },
  { control: /^button "(\+\d+ more|Show less)"$/, by: `${DETAIL} › reviews: category bars, what guests liked and watch out for, +N more and Show less` },
  { control: new RegExp(`^button ".+From ${MONEY} [▾▴]"$`), by: `${DETAIL} › rooms and rates: grouped, cheapest first; a room opens its rates; Select moves the price block` },
  { control: /^button "Select"$/, by: `${DETAIL} › rooms and rates: grouped, cheapest first; a room opens its rates; Select moves the price block` },
  { control: /^button "(Show all \d+ rooms|Show fewer rooms)"$/, by: `${DETAIL} › rooms and rates: grouped, cheapest first; a room opens its rates; Select moves the price block` },
  { control: /^button "Retry"$/, by: `${DETAIL} › a listing that cannot be loaded says so, and the rest still works` },
  { control: /^summary "Full hotel policy"$/, by: `${DETAIL} › good to know, amenities, about and location each open and close` },
  { control: /^button "(Show all \d+ amenities|Show fewer)"$/, by: `${DETAIL} › good to know, amenities, about and location each open and close` },
  { control: /^button "Read more"$/, by: `${DETAIL} › good to know, amenities, about and location each open and close` },
  { control: /^link "Open in Maps"$/, by: `${DETAIL} › good to know, amenities, about and location each open and close` },

  // ── Checkout and receipt ───────────────────────────────────────────────────
  { control: /^link "(← )?Back to the shortlist"$/, by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^textbox "Email\. Your booking and a sign-in code go here; no password\."$/, by: `${BOOK} › signed out, the checkout waits behind a sign-in: each gap is named, then the same room is priced for the account` },
  { control: /^button "(Send code|Send a new code|Sending…)"$/, by: `${BOOK} › signed out, the checkout waits behind a sign-in: each gap is named, then the same room is priced for the account` },
  { control: /^textbox "The 6-digit code sent to .+"$/, by: `${BOOK} › a wrong code: the modal says why, and nothing is signed in, priced again or paid` },
  // The sign-in modal's own button, pressed only on a code typed by hand (the sixth digit usually signs in).
  { control: /^button "(Sign in|Checking the price…|Checking the prices…)"$/, by: `${BOOK} › signed out, the checkout waits behind a sign-in: each gap is named, then the same room is priced for the account` },
  { control: /^textbox "(First name \(as on the guest's ID\)|Last name)"$/, by: `${BOOK} › signed out, the checkout waits behind a sign-in: each gap is named, then the same room is priced for the account` },
  { control: new RegExp(`^button "Pay ${MONEY} with Apple Pay"$`), by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: new RegExp(`^button "Pay ${MONEY} with Google Pay"$`), by: `${BOOK} › signed in: no email and no code, the names remembered, Google Pay` },
  { control: new RegExp(`^button "(Confirm ${MONEY}|Booking with the hotel…)"$`), by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^button "Check the price again"$/, by: `${BOOK} › a price check older than 20 minutes: the wallets wait, and "Check the price again" re-checks` },
  { control: /^button "Not you\?"$/, by: `${BOOK} › Not you? signs out and asks who is booking; whoever signs in keeps the hotel and room, priced again for them` },
  { control: /^button "Cancel this booking"$/, by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^button "Keep it"$/, by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^button "(Yes, cancel it|Cancelling…)"$/, by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^button "Check again"$/, by: `${BOOK} › a booking the hotel refused, and one it has not answered yet, each say what to do` },

  // ── Language (docs/i18n.md) ────────────────────────────────────────────────
  { control: /^combobox "Language \/ Idioma"$|^combobox "Idioma \/ Language"$/, by: `${SPANISH} › switch to Spanish and search Oporto` },

  // ── Saved hotels and the currency (docs/saved.md) ─────────────────────────
  { control: /^button "(Save .+|Remove .+ from saved hotels)"$/, by: `${SAVED} › the heart on a card saves the hotel; the list shows it with its last price found; its own heart unsaves it` },
  { control: /^button ".+(Last price found: .+|No price found yet)"$/, by: `${SAVED} › a saved hotel opens the search it was saved from` },
  { control: /^button "Change currency"$/, by: `${SAVED} › another currency prices the search again: every card in it, the saved price too, and kept over a reload` },
  { control: /^combobox "Currency"$/, by: `${SAVED} › another currency prices the search again: every card in it, the saved price too, and kept over a reload` },

  // ── Filters (docs/finder.md, "Filters") ────────────────────────────────────
  { control: /^button "Change star class"$/, by: `${FILTERS} › star class: five stars only, every fitting card a 5★; back to any` },
  { control: /^radio "(Any star class|\d\+? stars)"$/, by: `${FILTERS} › star class: five stars only, every fitting card a 5★; back to any` },
  { control: /^button "Change guest rating"$/, by: `${FILTERS} › guest rating: rated 9+ only; every fitting card rated 9 or more` },
  { control: /^radio "(Any guest rating|Rated \d\+)"$/, by: `${FILTERS} › guest rating: rated 9+ only; every fitting card rated 9 or more` },
  { control: /^button "Change kind of place"$/, by: `${FILTERS} › kind of place: one kind ticked, the chip names it; none ticked is every kind` },
  { control: /^checkbox "(hotels|aparthotels|apartments|hostels|B&Bs|guest houses|holiday homes)\s*\d*"$/i, by: `${FILTERS} › kind of place: one kind ticked, the chip names it; none ticked is every kind` },
  { control: /^button "Change brand"$/, by: `${FILTERS} › brand: one brand ticked; another brand under the divider says why; kept over a reload; cleared` },
  { control: /^checkbox ".+\d+"$/, by: `${FILTERS} › brand: one brand ticked; another brand under the divider says why; kept over a reload; cleared` },

  // ── The full list (docs/finder.md, "The full list") ────────────────────────
  { control: /^button "Show all \d+ hotels"$/, by: `${FULL} › Show all opens every other hotel that fits, in the same order, compact; Top picks only folds it` },
  { control: /^button "Top picks only"$/, by: `${FULL} › Show all opens every other hotel that fits, in the same order, compact; Top picks only folds it` },
  { control: /^button "(Previous|Next)"$/, by: `${FULL} › the pager: Next and Previous move a page and say where you are` },
  { control: /^button "Try again"$/, by: `${FULL} › a page that does not load says so, and Try again loads it` },

  // ── Hotel FAQ and checkout extras ──────────────────────────────────────────
  { control: /^button "(Show all \d+ questions|Show fewer questions)"$/, by: `${DETAIL} › questions about this hotel: answered from the listing and the rate, eight first, then all, then fewer` },
  { control: /^textbox "Special requests \(optional\)"$/, by: `${EXTRAS} › checkout extras: the hotel FAQ, pay now and at the hotel, a special request on the receipt` },

  // ── Deal Freeze (docs/deal-freeze.md) ──────────────────────────────────────
  { control: /^button "(Freeze until .+|Booking with the hotel…)"$/, by: `${FREEZE} › freeze a free-cancellation room: frozen with no payment, then confirmed; frozen again, then released` },
  { control: new RegExp(`^button "Confirm and pay ${MONEY} with Apple Pay"$`), by: `${FREEZE} › freeze a free-cancellation room: frozen with no payment, then confirmed; frozen again, then released` },
  { control: new RegExp(`^button "Confirm and pay ${MONEY} with Google Pay"$`), by: `${FREEZE} › says what is held, until when, that nothing is paid and how the reminder comes; Google Pay confirms it` },
  { control: /^button "(Release it|Keep holding it|Yes, release it|Releasing…)"$/, by: `${FREEZE} › freeze a free-cancellation room: frozen with no payment, then confirmed; frozen again, then released` },

  // ── Admin ──────────────────────────────────────────────────────────────────
  { control: /^textbox "Email"$/, by: `${ADMIN} › the sign-in form: a bad email and a wrong code each say why` },
  { control: /^textbox "Code sent to .+"$/, by: `${ADMIN} › the sign-in form: a bad email and a wrong code each say why` },
  { control: /^button "Sign in"$/, by: `${ADMIN} › an admin signs in through the form and sees the cost of a real search, place lookup included` },
  { control: /^link "(24 hours|7 days|30 days)"$/, by: `${ADMIN} › the window links: 24 hours, 7 days, 30 days` },
  { control: /^link "(No destination yet|[^"]+, [^"]+)"$/, by: `${ADMIN} › an admin signs in through the form and sees the cost of a real search, place lookup included` },
  { control: /^link "← All searches"$/, by: `${ADMIN} › an admin signs in through the form and sees the cost of a real search, place lookup included` },
];
