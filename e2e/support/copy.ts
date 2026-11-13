/**
 * The copy the pages must show. Error copy is the app's own declared source of
 * truth (src/lib/errors.ts: "every error code the server can send, with the
 * sentence the user sees"), so it is imported, never retyped. Page copy below
 * is the intended copy from docs/entry-ux.md §2.2, docs/design/*.md and the
 * components' stated purpose.
 */
import { ERROR_COPY, type ErrorCode } from '../../src/lib/errors';

export { ERROR_COPY, type ErrorCode };
export const ERROR_CODES = Object.keys(ERROR_COPY) as ErrorCode[];
export const withRef = (copy: string, ref: string) => `${copy} (Reference: ${ref})`;

export const COPY = {
  brand: 'Hotel finder',
  title: 'Hotel finder',
  h1: 'Not 400 hotels. The right one, and why.',
  sub: 'Tell us the trip. We check every hotel we can book and show the best few, each with the reason it won.',
  placeholders: [
    'Annecy, 1–6 Dec, just me, central and well rated',
    'Lisbon with my wife and the dog, 3 nights in March, nice but not crazy expensive',
    'Cheap hotel near Barcelona airport next Friday for 2',
  ],
  placeholderWithPlace: 'Anything else? e.g. central and well rated',
  whatMatters: 'What matters? Optional, pick any',
  priorities: ['Low price', 'Great reviews', 'Close to the centre'],
  trust: ['Real prices, taxes in', 'Ranked only by what you asked for'],
  sentenceHint: 'Your sentence already says what matters: we read it when you press Enter.',
  orJustThePlace: 'Or just the place',
  placeLookupFailed: 'The place search did not answer. Keep typing to try again.',
  noTrips: 'A search appears here once it has a place and dates.',
  pennyHello: "Hi, I'm Penny. I'll ask only what I need, then show you the few hotels worth your time.",
  publicPrices: 'These are public prices. Sign in for member prices',
  composerActive: 'Ask Penny, or change the search',
  checkout: {
    recheck: 'Price re-checked with the hotel just now. If it changes, you see both prices before paying.',
    emailLabel: 'Email. Your booking and a sign-in code go here; no password.',
    devMailbox: 'No email service is set up here, so the code is shown instead:',
    testBadge: 'Test payments: the wallets below are a stand-in and no money moves.',
    onePressSignedOut: 'One press: checks the code, signs you in, takes the payment and books. Next time it is just this button.',
    onePressSignedIn: 'One press: takes the payment and books.',
    sendFirst: 'Send yourself a code first.',
    stale: 'This price check is more than 20 minutes old.',
    sheetTest: 'TEST · no money moves',
    testCard: 'Test card •••• 4242',
  },
  admin: {
    h1: 'Cost per search',
    signInH1: 'Admin',
    notFound: 'This page could not be found.',
    notConfigured: 'Set ANTHROPIC_ADMIN_KEY to compare with Anthropic’s usage report.',
  },
} as const;
