'use client';

/**
 * Client feature flags. `detail` decides how a hotel opens: `expand` (the card
 * grows in the list) or `slideout` (a panel from the right). Assigned 50/50
 * once per browser and kept, so a person always sees one variant; `?detail=`
 * in the URL overrides and is remembered (for testing either on purpose).
 * docs/design/hotel-detail.md.
 */
export const DETAIL_VARIANTS = ['expand', 'slideout'] as const;
export type DetailVariant = (typeof DETAIL_VARIANTS)[number];
const KEY = 'hf_flag_detail';

const isVariant = (v: string | null): v is DetailVariant => v === 'expand' || v === 'slideout';

export function detailVariant(): DetailVariant {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('detail');
    if (isVariant(fromUrl)) {
      window.localStorage.setItem(KEY, fromUrl);
      return fromUrl;
    }
    const kept = window.localStorage.getItem(KEY);
    if (isVariant(kept)) return kept;
    const drawn: DetailVariant = Math.random() < 0.5 ? 'expand' : 'slideout';
    window.localStorage.setItem(KEY, drawn);
    return drawn;
  } catch {
    return 'slideout';
  }
}
