import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ensureOwner, errorResponse, handled, rateLimit } from '@/server/http';
import { placeKindWord } from '@/lib/placePick';
import { getSupplier } from '@/server/supplier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const query = z.object({ q: z.string().trim().min(2).max(80) }).strict();

/** Place suggestions for the destination question. Ids are the supplier's, forwarded untouched. */
export const GET = handled(async (req: Request) => {
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return errorResponse('invalid_request', 400);
  await ensureOwner();
  const limited = await rateLimit('places', 60);
  if (limited) return limited;

  const places = await getSupplier().searchPlaces(parsed.data.q);
  if (!places.ok) return errorResponse('supplier_unavailable', 503);
  // Hotels are never a destination; every row says where and what it is (docs/entry-ux.md §2.2).
  return NextResponse.json({
    places: places.value
      .flatMap((p) => {
        const kind = placeKindWord(p.types);
        return kind ? [{ placeId: p.placeId, label: p.address ? `${p.name}, ${p.address}` : p.name, name: p.name, where: p.address, kind }] : [];
      })
      .slice(0, 6),
  });
});
