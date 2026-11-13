/**
 * The map's tiles and style: OpenFreeMap's public instance (OpenStreetMap
 * data), drawn by MapLibre. No API key, no account, no per-load bill, which is
 * why it was picked over Google Maps for a public repo (Sam, 12 Nov 2026).
 * Its terms offer the service as-is; if it goes away, this URL is the one
 * thing to change (any MapLibre style works). docs/design/map.md.
 *
 * `positron`, light, since 13 Nov 2026: `dark` was too dark to read streets
 * on (Sam). The pins and labels are dark chips, so they read on either.
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
