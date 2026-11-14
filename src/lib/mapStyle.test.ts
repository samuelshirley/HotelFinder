import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import { LANDMARK_LAYER_ID, LANDMARK_MIN_ZOOM, MAP_STYLE_URL, isLandmark, landmarkLayer, tuneStyle } from './mapStyle';

/** A point of interest as OpenMapTiles' poi layer carries it (names and classes seen in Porto's tiles, 14 Nov 2026). */
const poi = (cls: string, subclass: string, name?: string, rank = 10) => ({
  type: 1 as const, // a point
  properties: { class: cls, subclass, rank, ...(name ? { name } : {}) },
  geometry: [],
});

/** Whether a filter keeps a feature, evaluated by MapLibre's own filter code at a street-level zoom. */
const keeps = (filter: FilterSpecification, feature: ReturnType<typeof poi>) => featureFilter(filter).filter({ zoom: 15 }, feature as never);

/** The shape of OpenFreeMap's liberty style, cut down to the layers this touches (the real one has 90-odd). */
const libertyLike = (): StyleSpecification => ({
  version: 8,
  sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    ne2_shaded: { type: 'raster', url: 'https://tiles.openfreemap.org/natural_earth/ne2sr' },
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': '#d8e8c8' } },
    { id: 'poi_r1', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 15, filter: ['all', ['>=', ['get', 'rank'], 1], ['<', ['get', 'rank'], 7]], layout: { 'text-field': ['get', 'name'] } },
    { id: 'poi_transit', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', filter: ['match', ['get', 'class'], ['airport', 'bus', 'rail'], true, false], layout: { 'text-field': ['get', 'name'] } },
    { id: 'place_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': ['get', 'name'] } },
  ],
});

const layer = (style: StyleSpecification, id: string) => style.layers.find((l) => l.id === id) as LayerSpecification & { filter: FilterSpecification };

describe('the map style', () => {
  it('is OpenFreeMap liberty, the one in colour (positron was a whitewash, Sam 14 Nov 2026)', () => {
    expect(MAP_STYLE_URL).toBe('https://tiles.openfreemap.org/styles/liberty');
  });
});

describe('what counts as a landmark', () => {
  it.each([
    ['museum', 'museum', 'Museu dos Clérigos'],
    ['attraction', 'attraction', 'Torre dos Clérigos'],
    ['attraction', 'viewpoint', 'Miradouro da Vitória'],
    ['castle', 'castle', 'Palácio da Bolsa'],
    ['theatre', 'theatre', 'Teatro Nacional São João'],
    ['monument', 'monument', 'Fonte do Cubo'],
    ['art_gallery', 'gallery', 'Galeria Lehmann + Silva'],
    ['art_gallery', 'arts_centre', 'Palácio das Artes'],
    ['zoo', 'zoo', 'Zoo Santo Inácio'],
  ])('%s/%s: %s', (cls, subclass, name) => {
    expect(keeps(isLandmark, poi(cls, subclass, name))).toBe(true);
  });

  it.each([
    ['art_gallery', 'artwork', 'Treze a Rir Uns dos Outros'], // a statue: 835 of these in central Porto
    ['art_gallery', 'art', 'Ponto das Artes'], // a shop
    ['place_of_worship', 'christian', 'Igreja do Carmo'], // 282 churches would bury the museums
    ['restaurant', 'restaurant', 'Cantinho do Avillez'],
    ['bus', 'bus_stop', 'Cordoaria'],
    ['lodging', 'hotel', 'PortoBay Teatro'], // the hotels are ours to draw
  ])('not %s/%s: %s', (cls, subclass, name) => {
    expect(keeps(isLandmark, poi(cls, subclass, name))).toBe(false);
  });

  it('not one without a name: there would be nothing to measure from', () => {
    expect(keeps(isLandmark, poi('museum', 'museum'))).toBe(false);
  });
});

describe('landmarkLayer', () => {
  it('is a valid MapLibre layer that starts where the tiles first carry points of interest', () => {
    const style = { ...libertyLike(), layers: [landmarkLayer()] };
    expect(validateStyleMin(style)).toEqual([]);
    expect(landmarkLayer().minzoom).toBe(LANDMARK_MIN_ZOOM);
    expect(LANDMARK_MIN_ZOOM).toBe(14);
  });

  it('places the best-known first (the lower OpenMapTiles rank)', () => {
    expect((landmarkLayer() as { layout: Record<string, unknown> }).layout['symbol-sort-key']).toEqual(['get', 'rank']);
  });
});

describe('tuneStyle', () => {
  it('puts the landmarks on top of everything the style draws, on its vector source', () => {
    const tuned = tuneStyle(libertyLike());
    expect(tuned.layers.at(-1)?.id).toBe(LANDMARK_LAYER_ID);
    expect((tuned.layers.at(-1) as { source: string }).source).toBe('openmaptiles');
    expect(validateStyleMin(tuned)).toEqual([]);
  });

  it("stops the style's own poi layers drawing a landmark, so none is drawn twice, and leaves their other places", () => {
    const r1 = layer(tuneStyle(libertyLike()), 'poi_r1');
    expect(keeps(r1.filter, poi('museum', 'museum', 'Museu dos Clérigos', 3))).toBe(false);
    expect(keeps(r1.filter, poi('cafe', 'cafe', 'Majestic Café', 3))).toBe(true);
    // The style's own condition still holds.
    expect(keeps(r1.filter, poi('cafe', 'cafe', 'Majestic Café', 12))).toBe(false);
  });

  it('drops bus stops and keeps stations and airports', () => {
    const transit = layer(tuneStyle(libertyLike()), 'poi_transit');
    expect(keeps(transit.filter, poi('bus', 'bus_stop', 'Cordoaria'))).toBe(false);
    expect(keeps(transit.filter, poi('rail', 'station', 'São Bento'))).toBe(true);
    expect(keeps(transit.filter, poi('airport', 'airport', 'Francisco Sá Carneiro'))).toBe(true);
  });

  it('touches nothing but the poi layers', () => {
    const before = libertyLike();
    const tuned = tuneStyle(before);
    for (const id of ['background', 'park', 'place_city']) expect(layer(tuned, id)).toEqual(layer(before, id));
  });

  it('is the same done twice (a style swap runs it again): one landmarks layer', () => {
    const twice = tuneStyle(tuneStyle(libertyLike()));
    expect(twice.layers.filter((l) => l.id === LANDMARK_LAYER_ID)).toHaveLength(1);
    expect(twice.layers.filter((l) => l.id === 'poi_r1')).toHaveLength(1);
  });

  it('leaves a style without OpenMapTiles points of interest as it came', () => {
    const plain: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] };
    expect(tuneStyle(plain)).toBe(plain);
  });
});
