/**
 * Every error code the server can send, with the sentence the user sees.
 * errorCopyGuard.test.ts fails if a route uses a code that is not here.
 * Copy rule: say what happened and what to do, nothing else.
 */
export const ERROR_COPY = {
  invalid_request: 'That request was not understood. Reload the page and try again.',
  session_not_found: 'This search is no longer available. Start a new one.',
  rate_limited: 'Too many requests in a short time. Wait a minute, then continue.',
  wrong_step: 'That answer was for an earlier question. Use the latest one.',
  not_onboarding: 'This search is already set up. Type a message to change it.',
  dates_in_past: 'Those dates are in the past.',
  checkout_not_after_checkin: 'Check-out has to be after check-in.',
  stay_too_long: 'Stays are limited to 30 nights.',
  more_rooms_than_adults: 'Each room needs at least one adult.',
  unknown_country: 'That country is not in the list. Pick it from the menu.',
  place_unavailable: 'The place lookup did not answer. Try again in a moment.',
  near_too_far: 'That place is too far from where you are searching. Start a new search there instead.',
  not_active: 'Finish the questions in the chat first.',
  bad_date: 'The date on this device looks wrong. Check the clock and reload.',
  supplier_unavailable: 'The hotel service did not answer. Try again in a moment.',
  property_not_found: 'That hotel is no longer in this search.',
  turn_failed: 'Something broke while handling that message. Nothing was changed. Send it again.',
  server_error: 'Something broke on our side. Nothing was changed. Try again.',
  network: 'No connection to the server. Check the network; your message was not lost if it already appears above.',
} as const;

export type ErrorCode = keyof typeof ERROR_COPY;

export function errorCopy(code: string | null | undefined): string {
  return code && code in ERROR_COPY ? ERROR_COPY[code as ErrorCode] : ERROR_COPY.server_error;
}
