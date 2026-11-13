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

const DAY = '(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)';
const MONEY = '(?:[€£$¥]|[A-Z]{2,3}\\$?)[\\d,]+(?:\\.\\d{2})?';

export const CLAIMS: Claim[] = [
  // ── Sidebar and header ─────────────────────────────────────────────────────
  { control: /^button "New search"$/, by: `${RESULTS} › New search starts clean, and the trip reopens from the list` },
  { control: /^button "Trips list"$/, by: `${RESULTS} › the trips list folds away, the hotels take its room, and it stays folded over a reload` },
  { control: /^button ".+\d{1,2}(\s\w{3})?–\d{1,2} \w{3}, \d+ nights?"$/, by: `${RESULTS} › New search starts clean, and the trip reopens from the list` },
  { control: /^button "Close the trips list"$/, by: `${RESULTS} › a narrow window: one column, Chat and Hotels as tabs, the trips list a drawer` },
  { control: /^tab "Chat"$/, by: `${RESULTS} › a narrow window: one column, Chat and Hotels as tabs, the trips list a drawer` },
  { control: /^tab "Hotels( \(\d+\))?"$/, by: `${RESULTS} › a narrow window: one column, Chat and Hotels as tabs, the trips list a drawer` },
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

  // ── Questions in the chat ──────────────────────────────────────────────────
  { control: /^textbox "Destination"$/, by: `${ASK} › words that name no place are asked "Where are you going?", with a place search` },
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
  { control: /^button "Near .+ ✕"$/, by: `${MAP} › Search around here searches around the middle of the map; its chip undoes it` },
  { control: /^combobox "Nationality for rates"$/, by: `${RESULTS} › Nationality for rates: another country prices the search again` },
  { control: /^button "(Hide|Show) map"$/, by: `${MAP} › Hide map folds it away, and it stays away over a reload until Show map` },

  // ── Cards ──────────────────────────────────────────────────────────────────
  { control: /^button "(Book|Checking the price…)"$/, by: `${BOOK} › Book re-checks the price and opens the checkout for that hotel` },
  { control: /^button "(Details|Collapse ▲)"$/, by: `${DETAIL} › Details expands the card in place; Collapse at the top and the bottom fold it` },

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
  { control: /^textbox "Email\. Your booking and a sign-in code go here; no password\."$/, by: `${BOOK} › the wallet does not open until email, code and names are there; each gap is named` },
  { control: /^button "(Send code|Send a new code|Sending…)"$/, by: `${BOOK} › the wallet does not open until email, code and names are there; each gap is named` },
  { control: /^textbox "6-digit code"$/, by: `${BOOK} › a wrong code: the sheet opens, nothing is paid, and the code field says why` },
  { control: /^textbox "(First name \(as on the guest's ID\)|Last name)"$/, by: `${BOOK} › the wallet does not open until email, code and names are there; each gap is named` },
  { control: new RegExp(`^button "Pay ${MONEY} with Apple Pay"$`), by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: new RegExp(`^button "Pay ${MONEY} with Google Pay"$`), by: `${BOOK} › signed in: no email and no code, the names remembered, Google Pay` },
  { control: new RegExp(`^button "(Confirm ${MONEY}|Booking with the hotel…)"$`), by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^button "Check the price again"$/, by: `${BOOK} › a price check older than 20 minutes: the wallets wait, and "Check the price again" re-checks` },
  { control: /^button "Not you\?"$/, by: `${BOOK} › Not you? signs out, and the checkout asks for an email instead` },
  { control: /^button "Cancel this booking"$/, by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^button "Keep it"$/, by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^button "(Yes, cancel it|Cancelling…)"$/, by: `${BOOK} › book with Apple Pay (test), keep it once, then cancel it` },
  { control: /^button "Check again"$/, by: `${BOOK} › a booking the hotel refused, and one it has not answered yet, each say what to do` },

  // ── Admin ──────────────────────────────────────────────────────────────────
  { control: /^textbox "Email"$/, by: `${ADMIN} › the sign-in form: a bad email and a wrong code each say why` },
  { control: /^textbox "Code sent to .+"$/, by: `${ADMIN} › the sign-in form: a bad email and a wrong code each say why` },
  { control: /^button "Sign in"$/, by: `${ADMIN} › an admin signs in through the form and sees the cost of a real search, place lookup included` },
  { control: /^link "(24 hours|7 days|30 days)"$/, by: `${ADMIN} › the window links: 24 hours, 7 days, 30 days` },
  { control: /^link "(No destination yet|[^"]+, [^"]+)"$/, by: `${ADMIN} › an admin signs in through the form and sees the cost of a real search, place lookup included` },
  { control: /^link "← All searches"$/, by: `${ADMIN} › an admin signs in through the form and sees the cost of a real search, place lookup included` },
];
