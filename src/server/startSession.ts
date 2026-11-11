import 'server-only';

import { inferNationality } from '@/lib/nationality';
import { getPreferences } from '@/server/repos/preferences';
import { createSession, updateSession, type Owner, type SearchSession } from '@/server/repos/sessions';

/**
 * A new search, with the nationality for rates inferred and never asked
 * (docs/onboarding.md §4). Nothing here sees a price. The destination is the
 * last resort, filled in when it is answered if none of these gave one.
 */
export async function startSession(owner: Owner, headers: { get(name: string): string | null }): Promise<SearchSession> {
  const session = await createSession(owner);
  const saved = 'userId' in owner ? ((await getPreferences(owner.userId))?.guestNationality ?? null) : null;
  const inferred = inferNationality({
    saved,
    acceptLanguage: headers.get('accept-language'),
    ipCountry: headers.get('x-vercel-ip-country'),
    destinationCountry: null,
  });
  if (!inferred) return session;
  return (await updateSession(session.id, { guestNationality: inferred.code, nationalitySource: inferred.source }))!;
}
