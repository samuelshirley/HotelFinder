import type { ExpressionSpecification, FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

/**
 * The map's tiles and style: OpenFreeMap's public instance (OpenStreetMap
 * data), drawn by MapLibre. No API key, no account, no per-load bill, which is
 * why it was picked over Google Maps for a public repo (Sam, 12 Nov 2026).
 * Its terms offer the service as-is; if it goes away, this URL is the one
 * thing to change (any OpenMapTiles-schema style works). docs/design/map.md.
 *
 * `liberty`, in colour, since 14 Nov 2026: `positron` (light grey) was a
 * whitewash that did not say where anything was (Sam: he wants to know how
 * close he is to a museum). `dark`, before 13 Nov, was too dark to read.
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Our own layer of the places a visitor goes to see, drawn over the style's. */
export const LANDMARK_LAYER_ID = 'landmarks';

/**
 * The zoom it starts at. OpenFreeMap's tiles carry points of interest only
 * from zoom 14 (measured on Porto, 14 Nov 2026: at 13 the poi layer held only
 * stations and ferry terminals), so nothing could be drawn wider than this.
 */
export const LANDMARK_MIN_ZOOM = 14;

/**
 * What counts as a landmark, as an OpenMapTiles `class` (any subclass) or
 * `class/subclass`. Chosen against Porto's tiles (14 Nov 2026):
 * - art_gallery is also street art, statues and shops that sell paintings
 *   (835 `artwork` points against about 40 galleries): only galleries, arts
 *   centres and museums filed under it count.
 * - attraction holds Torre dos Clérigos and the viewpoints (miradouros).
 * - castle holds the palaces (Palácio da Bolsa).
 * - place_of_worship is left out: 282 churches in the centre alone would
 *   bury the museums. The famous ones (the Clérigos) are attractions too.
 */
export const LANDMARK_CLASSES: readonly string[] = ['museum', 'attraction', 'castle', 'monument', 'theatre', 'zoo', 'aquarium', 'art_gallery/gallery', 'art_gallery/arts_centre', 'art_gallery/museum'];

const wholeClasses = LANDMARK_CLASSES.filter((c) => !c.includes('/'));
const subclassPairs = LANDMARK_CLASSES.filter((c) => c.includes('/'));

/** True for a feature of the poi source layer that is a landmark with a name to show. */
export const isLandmark: ExpressionSpecification = [
  'all',
  ['has', 'name'],
  ['any', ['match', ['get', 'class'], wholeClasses, true, false], ['match', ['concat', ['get', 'class'], '/', ['get', 'subclass']], subclassPairs, true, false]],
];

/** The words a label shows: an English name where OSM has one, as the style's own labels do. */
const labelText: ExpressionSpecification = ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];

/** The sprite's icon for a class; an aquarium borrows the zoo's. */
const iconFor: ExpressionSpecification = ['match', ['get', 'class'], 'aquarium', 'zoo', ['get', 'class']];

/**
 * The landmarks: an icon and a name, darker, bolder and larger than the
 * style's own shop and café labels. Within the layer a lower OpenMapTiles rank
 * (the better known place in its tile) is placed first. The name may give way
 * where it does not fit; the icon stays.
 */
export function landmarkLayer(source = 'openmaptiles'): LayerSpecification {
  return {
    id: LANDMARK_LAYER_ID,
    type: 'symbol',
    source,
    'source-layer': 'poi',
    minzoom: LANDMARK_MIN_ZOOM,
    filter: ['all', ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false], isLandmark],
    layout: {
      'icon-image': iconFor,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.9, 17, 1.2],
      'text-field': labelText,
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 17, 13],
      'text-max-width': 8,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-optional': true,
      'symbol-sort-key': ['get', 'rank'],
    },
    paint: {
      'text-color': '#7a3b12',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-halo-blur': 0.3,
    },
  };
}

/**
 * The style as fetched, made fit for choosing a hotel (pure; MapLibre runs it
 * through transformStyle before anything is drawn):
 * - the landmarks layer goes after the style's last layer, so it wins every
 *   collision with a shop or a street name;
 * - the style's own poi layers stop drawing landmarks, so none is drawn twice;
 * - bus stops go (983 of them in central Porto, one every street); railway
 *   and metro stations and airports stay.
 * A style without OpenMapTiles' poi layer is returned unchanged.
 */
export function tuneStyle(style: StyleSpecification): StyleSpecification {
  const source = Object.entries(style.sources).find(([, s]) => s.type === 'vector')?.[0];
  if (!source || !style.layers.some((l) => 'source-layer' in l && l['source-layer'] === 'poi')) return style;
  const layers = style.layers
    .filter((l) => l.id !== LANDMARK_LAYER_ID)
    .map((l): LayerSpecification => {
      if (l.type !== 'symbol' || l['source-layer'] !== 'poi') return l;
      if (l.id === 'poi_transit') return { ...l, filter: ['match', ['get', 'class'], ['airport', 'rail'], true, false] };
      const notLandmark: FilterSpecification = ['!', isLandmark];
      return { ...l, filter: l.filter ? (['all', l.filter, notLandmark] as FilterSpecification) : notLandmark };
    });
  return { ...style, layers: [...layers, landmarkLayer(source)] };
}
