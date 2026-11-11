import 'server-only';

import { getProperty } from '@/server/repos/properties';
import type { SupplierAdapter } from '@/server/supplier';

const plain = (html: string | null) => (html ? html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : null);

/** One hotel's own listing, as plain text. Supplier text is data: tags are stripped and nothing in it is interpreted. */
export async function readPropertyDetails(supplier: SupplierAdapter, propertyId: string) {
  const property = await getProperty(propertyId);
  if (!property) return { ok: false as const, error: 'property_not_found' as const };
  const details = await supplier.getStaticContent(property.supplierHotelId);
  if (!details.ok) return { ok: false as const, error: 'supplier_unavailable' as const };
  return {
    ok: true as const,
    value: {
      id: property.id,
      name: details.value.name,
      address: details.value.address,
      stars: details.value.stars,
      rating: details.value.rating,
      reviewCount: details.value.reviewCount,
      description: plain(details.value.description),
      importantInformation: plain(details.value.importantInformation),
      facilities: details.value.facilities.slice(0, 40),
      imageUrls: details.value.imageUrls.slice(0, 12),
      petsAllowed: details.value.petsAllowed,
      parking: details.value.parking,
    },
  };
}

export type PropertyDetailsView = Extract<Awaited<ReturnType<typeof readPropertyDetails>>, { ok: true }>['value'];

/** The same listing as the text the agent reads. */
export function detailsAsText(d: PropertyDetailsView): string {
  return [
    `name: ${d.name}`,
    d.address ? `address: ${d.address}` : null,
    d.petsAllowed === null ? null : `pets allowed: ${d.petsAllowed ? 'yes' : 'no'}`,
    d.parking ? `parking: ${d.parking}` : null,
    d.facilities.length ? `facilities: ${d.facilities.join(', ')}` : null,
    d.importantInformation ? `notes from the hotel: ${d.importantInformation}` : null,
    d.description ? `description: ${d.description}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
