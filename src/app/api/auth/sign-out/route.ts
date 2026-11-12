import { NextResponse } from 'next/server';

import { handled, signOutBrowser } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handled(async () => {
  await signOutBrowser();
  return NextResponse.json({ signedIn: false });
});
