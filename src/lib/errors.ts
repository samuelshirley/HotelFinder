import { copy } from '@/lib/i18n';
import { en } from '@/lib/i18n/catalogue/en';
import type { Locale } from '@/lib/i18n/locale';

/**
 * Every error code the server can send, with the sentence the user sees.
 * errorCopyGuard.test.ts fails if a route uses a code that is not here.
 * Copy rule: say what happened and what to do, nothing else.
 * The words live in the catalogues (lib/i18n/catalogue); this is the English
 * table and the lookup in any language.
 */
export const ERROR_COPY = en.errors;

export type ErrorCode = keyof typeof ERROR_COPY;

export function errorCopy(code: string | null | undefined, locale: Locale = 'en'): string {
  const table = copy(locale).errors;
  return code && code in table ? table[code as ErrorCode] : table.server_error;
}

/** The copy with the server's reference appended, so a report can be matched to its log line. */
export function withRef(copy: string, ref: string | null | undefined): string {
  return ref ? `${copy} (Reference: ${ref})` : copy;
}
