'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import { layoutPins, fitKeyFor, fitPoints, ringPolygon, type MapPin, type MapPoint } from '@/lib/mapView';
import { MAP_STYLE_URL } from '@/lib/mapStyle';
import { formatKm } from '@/lib/reasonText';
import styles from './MapPanel.module.css';

type Props = {
  pins: MapPin[];
  /** Where distance is measured from, when it is a real place. */
  anchor: (MapPoint & { label: string }) | null;
  /** Drawn only when closeness is part of the ranking: every ranked hotel is within this of the anchor. */
  ringKm: number | null;
  hovered: string | null;
  selected: string | null;
  /** Bumped when a hotel should be brought into view (a card was opened, or Penny marked one). */
  focus: { id: string; n: number } | null;
  busy: boolean;
  /** The pointer came onto a pin, or left it. Leaving names the pin, so it cannot clear a hover that has since moved to a card. */
  onHover: (id: string, on: boolean) => void;
  onSelect: (id: string) => void;
  /** A named place on the map was picked: becomes a chat message. */
  onMeasureFrom: (name: string) => void;
  /** "Search around here": the middle of the map as it stands. */
  onSearchHere: (point: MapPoint) => void;
};

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The map over the hotel list (docs/design/map.md). It shows what the finder
 * ranked and nothing else; it never searches on its own. The two gestures that
 * change the search go out through the same paths a typed change takes.
 *
 * Who owns the camera: it fits a new set of hotels once. After the user pans
 * or zooms it is theirs, and a later change offers "Recentre" instead of
 * moving it; a new anchor or a marked hotel still moves it.
 */
export function MapPanel({ pins, anchor, ringKm, hovered, selected, focus, busy, onHover, onSelect, onMeasureFrom, onSearchHere }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, { marker: MlMarker; el: HTMLButtonElement; rank: number | null; point: MapPoint; fullWidth: number }>());
  const extras = useRef<MlMarker[]>([]);
  const userMoved = useRef(false);
  const lastFit = useRef<{ key: string; anchorKey: string; centre: MapPoint | null }>({ key: '', anchorKey: '', centre: null });
  const handlers = useRef({ onHover, onSelect });
  handlers.current = { onHover, onSelect };

  /** Labels that would cover each other are stacked, or as a last resort shown as a rank alone (lib/mapView.ts layoutPins). */
  const declutter = () => {
    const m = map.current;
    if (!m) return;
    const boxes = [...markers.current].map(([id, k]) => {
      const at = m.project([k.point.longitude, k.point.latitude]);
      return { id, rank: k.rank, x: at.x, y: at.y, width: k.fullWidth, height: 28 };
    });
    const places = layoutPins(boxes);
    for (const [id, { el, marker }] of markers.current) {
      const place = places.get(id);
      el.dataset.compact = place?.compact ? 'true' : 'false';
      const dy = place?.dy ?? 0;
      // Only when it changes: setOffset repositions the marker.
      if (marker.getOffset().y !== dy) marker.setOffset([0, dy]);
    }
  };
  const declutterRef = useRef(declutter);
  declutterRef.current = declutter;

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The user moved the map: offer the way back. */
  const [moved, setMoved] = useState(false);
  /** …and far enough that searching around the new middle means something. */
  const [away, setAway] = useState(false);
  const [picked, setPicked] = useState<{ x: number; y: number; name: string } | null>(null);

  // Start the map once.
  useEffect(() => {
    let dead = false;
    let observer: ResizeObserver | null = null;
    void import('maplibre-gl')
      .then((ml) => {
        if (dead || !box.current) return;
        lib.current = ml;
        const m = new ml.Map({
          container: box.current,
          style: MAP_STYLE_URL,
          center: [0, 20],
          zoom: 1,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        m.touchZoomRotate.disableRotation();
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        map.current = m;
        m.on('load', () => !dead && setReady(true));
        // A move the user started (drag, wheel, pinch, the zoom buttons) carries its input event; our own camera moves do not.
        // Asked at the START of the move: a wheel zoom's end event arrives without one.
        m.on('movestart', (e: { originalEvent?: unknown }) => {
          if (!e.originalEvent) return;
          userMoved.current = true;
          setMoved(true);
          setPicked(null);
        });
        const tookOver = () => {
          if (!userMoved.current) return;
          const c = lastFit.current.centre;
          if (!c) return setAway(false);
          const at = m.project([c.longitude, c.latitude]);
          const { clientWidth: w, clientHeight: h } = m.getContainer();
          setAway(Math.hypot(at.x - w / 2, at.y - h / 2) > Math.min(w, h) * 0.35);
        };
        m.on('move', () => declutterRef.current());
        m.on('moveend', tookOver);
        m.on('click', (e) => {
          // A named place under the pointer: offer to measure from it.
          const named = m.queryRenderedFeatures(e.point).find((f) => f.layer.type === 'symbol' && typeof f.properties?.name === 'string' && f.properties.name.trim().length > 1);
          setPicked(named ? { x: e.point.x, y: e.point.y, name: String(named.properties['name:latin'] ?? named.properties.name).trim() } : null);
        });
        observer = new ResizeObserver(() => m.resize());
        observer.observe(box.current);
      })
      .catch((err) => {
        console.error('[map] could not start', err);
        if (!dead) setFailed(true);
      });
    return () => {
      dead = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Pins, the anchor and the ring follow the shortlist.
  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!ready || !m || !ml) return;
    for (const { marker } of markers.current.values()) marker.remove();
    markers.current.clear();
    for (const marker of extras.current) marker.remove();
    extras.current = [];

    for (const pin of pins) {
      const el = document.createElement('button');
      el.type = 'button';
      el.dataset.pin = pin.id;
      if (pin.rank !== null) {
        el.className = styles.pin;
        el.append(String(pin.rank));
        if (pin.price) {
          const price = document.createElement('span');
          price.className = styles.pinPrice;
          price.textContent = ` · ${pin.price}`;
          el.appendChild(price);
        }
        el.setAttribute('aria-label', `${pin.rank}. ${pin.name}${pin.price ? `, ${pin.price}` : ''}`);
      } else {
        el.className = styles.miss;
        el.setAttribute('aria-label', `${pin.name}. ${pin.miss ?? 'Misses something you asked for'}`);
        const tip = document.createElement('span');
        tip.className = styles.missTip;
        tip.textContent = pin.miss ?? pin.name;
        el.appendChild(tip);
      }
      el.addEventListener('mouseenter', () => handlers.current.onHover(pin.id, true));
      el.addEventListener('mouseleave', () => handlers.current.onHover(pin.id, false));
      el.addEventListener('focus', () => handlers.current.onHover(pin.id, true));
      el.addEventListener('blur', () => handlers.current.onHover(pin.id, false));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.current.onSelect(pin.id);
      });
      const marker = new ml.Marker({ element: el, anchor: 'center' }).setLngLat([pin.longitude, pin.latitude]).addTo(m);
      // Measured once, with the full label, before anything is made compact.
      markers.current.set(pin.id, { marker, el, rank: pin.rank, point: pin, fullWidth: el.offsetWidth });
    }

    if (anchor) {
      const el = document.createElement('div');
      el.className = styles.anchor;
      el.dataset.anchor = 'true';
      const label = document.createElement('span');
      label.className = styles.anchorLabel;
      label.textContent = anchor.label;
      el.appendChild(label);
      extras.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat([anchor.longitude, anchor.latitude]).addTo(m));
    }

    // The ring: a plain distance, labelled as one. Cards quote the same straight-line figure.
    const ring = anchor && ringKm ? ringPolygon(anchor, ringKm) : null;
    const data = { type: 'FeatureCollection' as const, features: ring ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } }] : [] };
    const source = m.getSource('ring') as { setData?: (d: unknown) => void } | undefined;
    if (source?.setData) source.setData(data);
    else {
      m.addSource('ring', { type: 'geojson', data });
      m.addLayer({ id: 'ring-fill', type: 'fill', source: 'ring', paint: { 'fill-color': '#9184d9', 'fill-opacity': 0.06 } });
      m.addLayer({ id: 'ring-line', type: 'line', source: 'ring', paint: { 'line-color': '#b2b6ca', 'line-opacity': 0.5, 'line-width': 1, 'line-dasharray': [3, 3] } });
    }
    if (ring && anchor && ringKm) {
      const el = document.createElement('div');
      el.className = styles.ringLabel;
      el.textContent = formatKm(ringKm);
      extras.current.push(new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat(ring[0] as [number, number]).addTo(m));
    }

    // The camera: once per new set of hotels, unless the user has taken it.
    const key = fitKeyFor(pins, anchor);
    const anchorKey = anchor ? `${anchor.latitude},${anchor.longitude}` : '';
    const points = fitPoints(pins, anchor);
    if (key !== lastFit.current.key && points.length > 0) {
      const anchorChanged = anchorKey !== lastFit.current.anchorKey && lastFit.current.key !== '';
      const bounds = new ml.LngLatBounds();
      for (const p of points) bounds.extend([p.longitude, p.latitude]);
      const centre = bounds.getCenter();
      lastFit.current = { key, anchorKey, centre: { latitude: centre.lat, longitude: centre.lng } };
      if (!userMoved.current || anchorChanged) {
        userMoved.current = false;
        setMoved(false);
        setAway(false);
        m.fitBounds(bounds, { padding: 72, maxZoom: 16, duration: reducedMotion() ? 0 : 600 });
      }
    }
    declutterRef.current();
  }, [ready, pins, anchor, ringKm]);

  // Hover and selection are styles on pins that already exist.
  useEffect(() => {
    for (const [id, { el }] of markers.current) {
      el.dataset.hover = id === hovered ? 'true' : 'false';
      el.dataset.selected = id === selected ? 'true' : 'false';
    }
    // The best rank on top, so the first choice is never the one hidden; the pin in hand above them all.
    for (const [id, { el, rank }] of markers.current) el.style.zIndex = String(id === hovered ? 300 : id === selected ? 200 : rank === null ? 1 : 100 - Math.min(rank, 90));
  }, [hovered, selected, pins, ready]);

  // A hotel brought into view: pan only if its pin is out of sight, never zoom.
  useEffect(() => {
    const m = map.current;
    const pin = focus && pins.find((p) => p.id === focus.id);
    if (!ready || !m || !pin) return;
    const at = m.project([pin.longitude, pin.latitude]);
    const { clientWidth: w, clientHeight: h } = m.getContainer();
    if (at.x < 48 || at.y < 48 || at.x > w - 48 || at.y > h - 48) m.easeTo({ center: [pin.longitude, pin.latitude], duration: reducedMotion() ? 0 : 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, ready]);

  const recentre = () => {
    const m = map.current;
    const ml = lib.current;
    const points = fitPoints(pins, anchor);
    if (!m || !ml || points.length === 0) return;
    const bounds = new ml.LngLatBounds();
    for (const p of points) bounds.extend([p.longitude, p.latitude]);
    userMoved.current = false;
    setMoved(false);
    setAway(false);
    setPicked(null);
    m.fitBounds(bounds, { padding: 72, maxZoom: 16, duration: reducedMotion() ? 0 : 600 });
  };

  const searchHere = () => {
    const c = map.current?.getCenter();
    if (!c) return;
    // The new anchor refits the camera; until then the map stays where the user put it.
    onSearchHere({ latitude: c.lat, longitude: c.lng });
  };

  return (
    <div className={styles.wrap} data-testid="map" data-ready={ready ? 'true' : 'false'} onKeyDown={(e) => e.key === 'Escape' && setPicked(null)}>
      <div ref={box} className={styles.canvas} role="region" aria-label="Map" />
      {failed && <p className={styles.failed}>The map could not start in this browser. The list below has every hotel.</p>}
      {(moved || away) && !failed && (
        <div className={styles.chips}>
          {away && (
            <button type="button" className={styles.chip} disabled={busy} onClick={searchHere}>
              Search around here
            </button>
          )}
          {moved && (
            <button type="button" className={styles.chip} onClick={recentre}>
              Recentre
            </button>
          )}
        </div>
      )}
      {picked && (
        <div className={styles.popup} style={{ left: picked.x, top: picked.y }}>
          <button
            type="button"
            className={styles.chip}
            disabled={busy}
            onClick={() => {
              setPicked(null);
              onMeasureFrom(picked.name);
            }}
          >
            Measure from {picked.name}
          </button>
        </div>
      )}
    </div>
  );
}
