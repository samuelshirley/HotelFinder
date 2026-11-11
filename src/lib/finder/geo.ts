export type LatLng = { latitude: number; longitude: number };

/** Great-circle distance in kilometres. Straight line, not a walking route. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The middle of a set of points: the median latitude and the median longitude. */
export function medianPoint(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  const median = (values: number[]) => {
    const sorted = [...values].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return { latitude: median(points.map((p) => p.latitude)), longitude: median(points.map((p) => p.longitude)) };
}

/** Nights between two ISO dates (YYYY-MM-DD). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
