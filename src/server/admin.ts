import 'server-only';

import { isAdminEmail } from '@/lib/admin';
import type { SignedInUser } from '@/server/auth/user';
import { currentUser } from '@/server/http';

/**
 * The /admin gate. Not signed in → the page shows a sign-in form. Signed in
 * but not in ADMIN_EMAILS → the caller answers 404, as if /admin did not exist.
 */
export async function adminAccess(): Promise<{ state: 'admin'; user: SignedInUser } | { state: 'sign_in' } | { state: 'denied' }> {
  const user = await currentUser();
  if (!user) return { state: 'sign_in' };
  return isAdminEmail(user.email) ? { state: 'admin', user } : { state: 'denied' };
}
