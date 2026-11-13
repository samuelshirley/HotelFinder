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
  empty_brief: 'Type where you are going, or pick a place, then search.',
  not_active: 'Finish the questions in the chat first.',
  bad_date: 'The date on this device looks wrong. Check the clock and reload.',
  supplier_unavailable: 'The hotel service did not answer. Try again in a moment.',
  property_not_found: 'That hotel is no longer in this search.',
  circuit_open: 'The chat is paused for the moment. The filters above the hotels still work. Try the chat again in a few minutes.',
  turn_timeout: 'That took too long, so it was stopped before anything was changed. Send it again.',
  turn_failed: 'Something broke while handling that message. Nothing was changed. Send it again.',
  server_error: 'Something broke on our side. Nothing was changed. Try again.',
  email_invalid: 'That email address does not look complete. Check it and try again.',
  code_wrong: 'That code is not right. Check the latest email and type it again.',
  code_expired: 'That code has expired or was already used. Send a new one.',
  too_many_codes: 'Too many codes asked for this email. Wait an hour, then try again.',
  email_unavailable: 'Sign-in emails cannot be sent right now. Try again in a few minutes.',
  signed_out: 'Sign in with your email to see this.',
  name_missing: "Add the guest's first and last name as on their ID.",
  request_too_long: 'The special request is too long. Keep it to 500 characters.',
  rate_gone: 'The hotel no longer has this room at this price. Pick another hotel or search again.',
  price_stale: 'That price check is more than 20 minutes old. Check the price again before paying.',
  price_changed: 'The price changed. Check the new price, then pay.',
  booking_not_found: 'That booking is not on this account.',
  booking_not_payable: 'This booking was already paid or has ended. Reload to see where it stands.',
  booking_failed: 'The hotel did not confirm the booking. No money was taken. Try again or pick another hotel.',
  booking_unknown: 'The hotel has not answered yet. Do not book again: reload this page in a minute to see the result.',
  payment_unavailable: 'Payments are not set up here yet.',
  cancel_failed: 'The hotel did not confirm the cancellation. Reload this page in a minute to see where the booking stands before trying again.',
  not_cancellable: 'This booking cannot be cancelled here.',
  freeze_unavailable: 'Holding a room without paying is only set up in the test sandbox, so this one cannot be frozen. Book it now instead.',
  freeze_not_eligible: 'Only a free-cancellation rate with at least three days left to cancel can be frozen. Book it now, or pick a refundable rate.',
  freeze_limit: 'You already have 3 frozen rooms. Confirm or release one of them first.',
  freeze_terms_changed: 'The hotel booked this room on terms that cannot be frozen, so it is being released and nothing is held. Nothing was paid.',
  freeze_expired: 'The hold on this room has ended, so it is being released. Search again to book it.',
  release_unknown: 'The hotel has not confirmed the release yet. Do not release it again: reload this page in a minute.',
  not_allowed: 'This is not available here.',
  network: 'No connection to the server. Check the network; your message was not lost if it already appears above.',
} as const;

export type ErrorCode = keyof typeof ERROR_COPY;

export function errorCopy(code: string | null | undefined): string {
  return code && code in ERROR_COPY ? ERROR_COPY[code as ErrorCode] : ERROR_COPY.server_error;
}
