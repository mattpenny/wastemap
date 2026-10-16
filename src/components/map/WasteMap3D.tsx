"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer, IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import type { PickingInfo } from "@deck.gl/core";

import type { FacilityCategory, FacilityProperties } from "@/data/waste-facilities";
import { CATEGORY_META, CATEGORY_ORDER, facilityColorMap } from "@/lib/categories";
import { t, type Lang } from "@/lib/i18n";
import { formatNumber } from "@/lib/utils";
import {
  HK_BEARING,
  HK_CENTER,
  HK_PITCH,
  HK_ZOOM,
  isSmallScreen,
  resolvePixelRatio,
  styleFor,
  styleKey,
  type MapStyleId,
} from "./mapStyles";

export interface WasteMap3DHandle {
  /** Animate back to the default Hong Kong overview. */
  resetView: () => void;
  /** Fly to a facility and select it. */
  focusFacility: (id: string) => void;
}

interface WasteMap3DProps {
  facilities: FacilityProperties[];
  selectedId: string | null;
  onSelectFacility: (facility: FacilityProperties | null) => void;
  mapStyle: MapStyleId;
  lang: Lang;
  visibleCategories: FacilityCategory[];
  /** When true, show a "no facilities" hint instead of an empty map. */
  emptyHint?: boolean;
  /**
   * Fired when the *user* pans, zooms or rotates — never for the app's own
   * camera moves. The phone shell uses it to collapse its panels.
   */
  onUserMove?: () => void;
}

/**
 * Pillar geometry.
 *
 * Heights use a square-root scale so smaller published rates remain visible
 * beside the large landfill figures. Facilities without a published individual
 * rate get a short marker column, not an invented zero or an allocated value.
 * Tuned to remain legible at the default overview zoom.
 */
const MIN_HEIGHT_M = 260;
const MAX_HEIGHT_M = 2000;

/**
 * Zoom the pillar footprint is tuned for — the overview the app opens on. Not
 * `HK_ZOOM`, which is the reference for column *height*; the two are separate
 * on purpose, because the height reference was chosen for a different reason.
 */
const OVERVIEW_ZOOM = 12.2;

/**
 * ColumnLayer takes a single uniform `radius` per layer (it has no
 * `getRadius` accessor), so pillar thickness is driven per category instead:
 * one layer per category, sized to convey the relative scale of each type.
 * Per-facility size variation is still visible on the ground disc below,
 * which is a ScatterplotLayer and does support `getRadius`.
 */
const CATEGORY_RADIUS_M: Record<FacilityCategory, number> = {
  Landfill: 620,
  "I-PARK": 520,
  RTS: 340,
  "O-PARK": 230,
  "Y-PARK": 230,
};

/** Size of the map pin, in screen pixels (constant regardless of zoom). */
const PIN_SIZE_PX = 46;

/**
 * Map pin used to mark the currently selected facility.
 *
 * Built as an inline SVG data URI so deck.gl's IconLayer can render it with no
 * network request and no sprite atlas. `anchorY` is the icon height, which puts
 * the pin's tip exactly on the facility coordinate.
 */
function pinDataUri(fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="80" viewBox="0 0 64 80">
<path d="M32 2C20.4 2 11 11.4 11 23c0 15.6 21 55 21 55s21-39.4 21-55C53 11.4 43.6 2 32 2z"
 fill="${fill}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>
<circle cx="32" cy="23" r="8" fill="#ffffff" fill-opacity="0.95"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Pin art is per colour, so the selected site keeps its own shade. */
const pinIconCache = new Map<string, string>();
function pinIcon(hex: string): string {
  const cached = pinIconCache.get(hex);
  if (cached) return cached;
  const uri = pinDataUri(hex);
  pinIconCache.set(hex, uri);
  return uri;
}

const PIN_ICON_SIZE = { width: 64, height: 80, anchorX: 32, anchorY: 80 };

/** One-time lighting rig — without it the extruded columns read as flat shapes. */
const lightingEffect = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.15 }),
  sun: new DirectionalLight({
    color: [255, 250, 240],
    intensity: 1.5,
    direction: [-3, -9, -1],
  }),
});

const WasteMap3D = forwardRef<WasteMap3DHandle, WasteMap3DProps>(function WasteMap3D(
  {
    facilities,
    selectedId,
    onSelectFacility,
    mapStyle,
    lang,
    visibleCategories,
    emptyHint = false,
    onUserMove,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  // The mount-once effect must not capture a stale callback, so keep the
  // latest selection handler in a ref.
  const onSelectRef = useRef(onSelectFacility);
  onSelectRef.current = onSelectFacility;
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;

  /**
   * Which style is currently rendered. The Lands Department official map ships
   * separate English and Chinese label tiles, so the language is part of the
   * identity — without it, toggling language would not re-fetch the labels.
   */
  const appliedStyleRef = useRef<string>(styleKey(mapStyle, lang));

  const [ready, setReady] = useState(false);
  /**
   * Tracked so pillar heights can be compensated for zoom. Without this a
   * pillar of fixed metric height fills the entire screen once you zoom to a
   * single site — at zoom 13.4 a 2.5 km column is absurd.
   */
  const [zoom, setZoom] = useState(HK_ZOOM);
  const [hovered, setHovered] = useState<{
    facility: FacilityProperties;
    x: number;
    y: number;
  } | null>(null);

  /** Visible facilities after the category filter is applied. */
  const shown = useMemo(
    () => facilities.filter((f) => visibleCategories.includes(f.category)),
    [facilities, visibleCategories]
  );

  const maxPublishedThroughput = useMemo(
    () =>
      Math.max(
        1,
        ...shown
          .map((f) => f.throughputTonnesPerDay ?? 0)
          .filter((value) => Number.isFinite(value))
      ),
    [shown]
  );

  const heightFor = useCallback(
    (f: FacilityProperties) => {
      // Short neutral-height column means EPD publishes no per-site rate. Do
      // not turn N/A into zero or allocate the OITF system total to each pin.
      if (f.throughputTonnesPerDay === null) return MIN_HEIGHT_M * 0.55;
      const norm = Math.sqrt(f.throughputTonnesPerDay / maxPublishedThroughput);
      return MIN_HEIGHT_M + norm * (MAX_HEIGHT_M - MIN_HEIGHT_M);
    },
    [maxPublishedThroughput]
  );

  /**
   * Keeps the *on-screen* height of the pillars roughly constant across zoom
   * levels: apparent size scales with 2^(zoom), so the scale factor is the
   * inverse. Clamped so the columns stay sensible at both extremes.
   */
  const elevationScale = useMemo(() => {
    const raw = Math.pow(2, HK_ZOOM - zoom);
    return Math.max(0.05, Math.min(1.8, raw));
  }, [zoom]);

  /**
   * Same idea for the pillars' *footprint*, which used to be fixed in metres.
   *
   * Height was already compensated for zoom; the radius was not, so zooming in
   * to a site turned its column into a cylinder hundreds of pixels across that
   * covered the very thing it was marking. This keeps the on-screen footprint
   * roughly constant instead. The reference is the overview zoom rather than
   * HK_ZOOM (which exists to keep the columns' height stable), because the
   * overview is where the footprint has to read as a marker. Floored so a
   * column never thins to a hairline at maximum zoom.
   */
  const radiusScale = useMemo(() => {
    const raw = Math.pow(2, OVERVIEW_ZOOM - zoom);
    return Math.max(0.16, Math.min(1.4, raw));
  }, [zoom]);

  /** Per-facility colour, so no two sites share a marker. */
  const facilityColors = useMemo(() => facilityColorMap(facilities), [facilities]);
  const colorOf = useCallback(
    (f: FacilityProperties): [number, number, number] =>
      facilityColors.get(f.id)?.rgb ?? CATEGORY_META[f.category].color,
    [facilityColors]
  );

  // ------------------------------------------------------------------
  // Build the deck.gl layer set
  // ------------------------------------------------------------------
  const buildLayers = useCallback(() => {
    const selected = shown.find((f) => f.id === selectedId) ?? null;

    // The selected facility is drawn as a map pin rather than a pillar, so it
    // is removed from the column data entirely.
    const columnData = selectedId
      ? shown.filter((f) => f.id !== selectedId)
      : shown;

    // Glowing ground disc under every pillar — anchors the columns visually
    // and gives a reliable click target at shallow pitch angles.
    const baseLayer = new ScatterplotLayer<FacilityProperties>({
      id: "facility-base",
      data: shown,
      pickable: true,
      stroked: true,
      filled: true,
      radiusUnits: "meters",
      lineWidthUnits: "meters",
      getPosition: (d) => d.coordinates,
      getRadius: (d) => CATEGORY_RADIUS_M[d.category] * 1.3 * radiusScale,
      // Colour identifies the SITE within its category's hue band — the
      // category still reads at a glance, and no two facilities share a marker.
      // Utilisation is surfaced numerically in the tooltip, the drawer and the
      // header stats.
      getFillColor: (d) => [...colorOf(d), 80],
      getLineColor: (d) => (d.id === selectedId ? [255, 255, 255, 235] : [...colorOf(d), 205]),
      getLineWidth: (d) => (d.id === selectedId ? 34 : 16),
      transitions: { getRadius: 500 },
    });

    const columnLayers = CATEGORY_ORDER.filter((cat) =>
      columnData.some((f) => f.category === cat)
    ).map(
      (cat) =>
        new ColumnLayer<FacilityProperties>({
          id: `facility-column-${cat}`,
          data: columnData.filter((f) => f.category === cat),
          pickable: true,
          extruded: true,
          diskResolution: 24,
          radiusUnits: "meters",
          radius: CATEGORY_RADIUS_M[cat] * radiusScale,
          elevationScale,
          getPosition: (d) => d.coordinates,
          getElevation: (d) => heightFor(d),
          getFillColor: (d) => [...colorOf(d), 245],
          stroked: true,
          getLineColor: () => [255, 255, 255, 60],
          lineWidthUnits: "meters",
          getLineWidth: () => 0,
          material: {
            ambient: 0.4,
            diffuse: 0.65,
            shininess: 40,
            specularColor: [90, 100, 110],
          },
          transitions: { getElevation: 700, getFillColor: 300 },
        })
    );

    // Map pin marking the selected facility. Sized in screen pixels so it keeps
    // a constant size at every zoom, and billboarded so it always faces the
    // camera — a pillar reads as "data", a pin reads as "this one, here".
    const pinLayer = selected
      ? new IconLayer<FacilityProperties>({
          id: "facility-pin",
          data: [selected],
          pickable: true,
          billboard: true,
          sizeUnits: "pixels",
          getSize: PIN_SIZE_PX,
          getPosition: (d) => d.coordinates,
          getIcon: (d) => ({ url: pinIcon(facilityColors.get(d.id)?.hex ?? CATEGORY_META[d.category].hex), ...PIN_ICON_SIZE }),
          // Force HTMLImageElement decoding: SVG sources can come back blank
          // when luma.gl decodes them through ImageBitmap.
          loadOptions: { image: { type: "image" } },
          transitions: { getSize: 250 },
        })
      : null;

    return [baseLayer, ...columnLayers, ...(pinLayer ? [pinLayer] : [])];
  }, [shown, selectedId, heightFor, elevationScale, radiusScale, colorOf, facilityColors]);

  // ------------------------------------------------------------------
  // Initialise the map exactly once
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(mapStyle, lang),
      center: HK_CENTER,
      zoom: isSmallScreen() ? 9.6 : HK_ZOOM,
      pitch: isSmallScreen() ? 40 : HK_PITCH,
      bearing: HK_BEARING,
      maxPitch: 75,
      minZoom: 7,
      maxZoom: 18,
      // MapLibre v5 moved WebGL context flags under canvasContextAttributes.
      canvasContextAttributes: { antialias: true },
      attributionControl: false,
      // We render attribution ourselves to keep the chrome consistent.
    });

    mapRef.current = map;

    // Zoom / compass only. The scale bar was dropped (it collided with the
    // bottom-anchored panels) and MapLibre's own attribution control is not
    // added either — the credit lives in the app's "i" popover instead, which
    // is the same collapsed pattern Mapbox, MapLibre and Google Maps use. The
    // `attribution` fields are still declared on the style sources, so adding
    // the control back is a one-line change if you ever want it.
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
      "top-right"
    );

    // GPS — sits directly under the compass in the same corner. GeolocateControl
    // already flies the camera to the user's position on the first fix, which is
    // exactly the requested behaviour, and it needs no key.
    //
    // Note: the browser only exposes geolocation in a secure context, so this
    // works on localhost and HTTPS but silently fails over plain HTTP.
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true,
        showUserLocation: true,
        // Cap how far it zooms in, so an accurate fix doesn't drop you at
        // building level with no context.
        fitBoundsOptions: { maxZoom: 15 },
      }),
      "top-right"
    );

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      // Cap the deck.gl canvas DPR on phones — a full-DPR canvas on a 3x
      // display is the single biggest cost in this view.
      useDevicePixels: resolvePixelRatio(),
      // MapboxOverlay's IControl typing targets mapbox-gl; MapLibre exposes a
      // structurally identical interface, hence the cast.
    } as ConstructorParameters<typeof MapboxOverlay>[0]);
    overlayRef.current = overlay;
    map.addControl(overlay as unknown as maplibregl.IControl);

    map.on("load", () => setReady(true));

    // Quantised to quarter-zoom steps: setZoom bails out on an unchanged value,
    // so this avoids rebuilding the layer set on every animation frame.
    const handleZoom = () => {
      const next = Math.round(map.getZoom() * 4) / 4;
      setZoom((prev) => (prev === next ? prev : next));
    };
    map.on("zoom", handleZoom);

    // If the basemap style fails to load (offline, blocked tile host) `load`
    // never fires. The deck.gl pillars do not depend on the style, so reveal
    // them anyway rather than leaving the user on a spinner forever.
    const readyFallback = window.setTimeout(() => setReady(true), 12000);

    // Clicking bare map clears the selection; pillar clicks are handled by
    // deck.gl and call stopPropagation via the picking layer instead.
    const handleBackgroundClick = (e: maplibregl.MapMouseEvent) => {
      // Only our facility layers are pickable, so an empty pick means the
      // user clicked empty map — clear the selection.
      const hit = overlayRef.current?.pickObject({
        x: e.point.x,
        y: e.point.y,
        radius: 4,
      });
      if (!hit) onSelectRef.current(null);
    };
    map.on("click", handleBackgroundClick);

    /**
     * Tell the shell when the *user* moves the map.
     *
     * `originalEvent` is the guard that matters: it is set for gestures — drag,
     * wheel, pinch, keyboard — and absent for the programmatic camera moves the
     * app makes itself (the opening fit, Reset view, focusing a facility). Only
     * the former should collapse the phone's panels; closing a sheet the moment
     * it opens, because selecting a site flew the camera, would be maddening.
     */
    const handleUserMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) onUserMoveRef.current?.();
    };
    map.on("movestart", handleUserMove);
    map.on("zoomstart", handleUserMove);

    return () => {
      window.clearTimeout(readyFallback);
      map.off("zoom", handleZoom);
      map.off("click", handleBackgroundClick);
      map.off("movestart", handleUserMove);
      map.off("zoomstart", handleUserMove);
      if (overlayRef.current) {
        map.removeControl(overlayRef.current as unknown as maplibregl.IControl);
        overlayRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Intentionally mount-once: style/lang changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Keep the canvas in sync when the layout changes — e.g. the detail
  // drawer narrowing the map column on desktop.
  // ------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    const map = mapRef.current;
    if (!el || !map || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.resize());
    });
    observer.observe(el);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // ------------------------------------------------------------------
  // Frame the facility extent once the data has arrived.
  //
  // The padding used to reserve the full width of the header card on the left
  // and the ranking card on the right (390 + 340 = 730px). That was wrong for
  // the *opening* view: every panel starts collapsed, so on a 1080px window it
  // was reserving 68% of the map for two small pills and the territory ended
  // up as a small cluster in the middle of a lot of open sea. What actually
  // overlaps the map at rest is a top strip (the header card) and thin bottom
  // strips (the legend / trend pills), so that is what the padding covers now.
  // Opening a panel afterwards can put a site behind it; the user opened it,
  // and panning is one drag away.
  // ------------------------------------------------------------------
  const framedRef = useRef(false);
  /** The camera the opening view settled on, so "Reset view" returns to it. */
  const framedCameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || framedRef.current || facilities.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    for (const facility of facilities) bounds.extend(facility.coordinates);

    const padding = isSmallScreen()
      ? { top: 110, bottom: 120, left: 24, right: 24 }
      : { top: 150, bottom: 70, left: 60, right: 60 };
    const pitch = isSmallScreen() ? 40 : HK_PITCH;

    // 1. Fit the *width* of the extent. A box that is a hair tall makes the
    //    fit ignore latitude and solve for the east-west spread alone, which
    //    is what should set the zoom: the territory is wider than it is tall,
    //    so a latitude-driven fit on a short window leaves a lot of empty sea
    //    either side.
    //
    //    Flat, because MapLibre's pitch-aware fit errs heavily on the wide
    //    side — at pitch 50 it came out about 2.7x wider than the extent
    //    needed, which is what left the territory as a small cluster in the
    //    middle of the sea.
    const midLat = (bounds.getSouth() + bounds.getNorth()) / 2;
    const widthOnly = new maplibregl.LngLatBounds(
      [bounds.getWest(), midLat - 0.002],
      [bounds.getEast(), midLat + 0.002]
    );
    const byWidth = map.cameraForBounds(widthOnly, { padding, bearing: HK_BEARING, pitch: 0 });
    // `zoom` is optional on the returned camera, so narrow it rather than
    // asserting — a missing zoom means no usable fit at all.
    if (!byWidth || typeof byWidth.zoom !== "number") return;

    framedRef.current = true;
    // jumpTo is instant by definition — no duration to pass.
    map.jumpTo({
      center: byWidth.center as [number, number],
      zoom: byWidth.zoom,
      bearing: HK_BEARING,
      pitch,
    });

    // 2. Relax until every corner is actually on the canvas. Testing real
    //    projected corners rather than a formula keeps this honest at any
    //    window size and aspect ratio. The guard is the canvas edge rather
    //    than the padded band, so a short window trades a little of the
    //    north/south extreme for a frame full of Hong Kong instead of
    //    half-full of open sea.
    const canvas = map.getCanvas();
    if (canvas.clientWidth === 0) return;

    const corners = [
      bounds.getNorthWest(),
      bounds.getNorthEast(),
      bounds.getSouthWest(),
      bounds.getSouthEast(),
    ];
    const onCanvas = () =>
      corners.every((corner) => {
        const p = map.project(corner);
        return p.x >= 0 && p.x <= canvas.clientWidth && p.y >= 0 && p.y <= canvas.clientHeight;
      });

    let zoom = byWidth.zoom;
    for (let i = 0; i < 24; i += 1) {
      map.setZoom(zoom);
      if (onCanvas()) break;
      zoom -= 0.25;
    }
    map.setZoom(zoom);

    framedCameraRef.current = { center: byWidth.center as [number, number], zoom };
  }, [ready, facilities]);

  // ------------------------------------------------------------------
  // Push layers whenever data / selection / filter changes
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!overlayRef.current) return;
    overlayRef.current.setProps({
      layers: buildLayers(),
      effects: [lightingEffect],
      getCursor: ({ isHovering }: { isHovering: boolean }) =>
        isHovering ? "pointer" : "grab",
    });
  }, [buildLayers]);

  // ------------------------------------------------------------------
  // Swap basemap. For the official map the language is part of the style
  // identity, so a language switch re-fetches the label tiles too.
  // ------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const key = styleKey(mapStyle, lang);
    if (appliedStyleRef.current === key) return;
    appliedStyleRef.current = key;

    map.setStyle(styleFor(mapStyle, lang), { diff: false });
  }, [mapStyle, lang, ready]);

  // ------------------------------------------------------------------
  // Imperative handle
  // ------------------------------------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      resetView: () => {
        // Back to the framing the app opened on — the same extent-filled view
        // the tighten pass settled on, not a fixed zoom that no longer matches
        // it. Falls back to the territory centre if the fit never ran.
        const framed = framedCameraRef.current;
        mapRef.current?.flyTo({
          center: framed?.center ?? HK_CENTER,
          zoom: framed?.zoom ?? (isSmallScreen() ? 9.6 : HK_ZOOM),
          pitch: isSmallScreen() ? 40 : HK_PITCH,
          bearing: HK_BEARING,
          duration: 1400,
          essential: true,
        });
      },
      focusFacility: (id: string) => {
        const facility = facilities.find((f) => f.id === id);
        if (!facility || !mapRef.current) return;
        mapRef.current.flyTo({
          center: facility.coordinates,
          zoom: 13.4,
          // Deliberately moderate: at 60° the pin's body is drawn well above its
          // anchor, which makes a correctly-placed pin look like it is sitting
          // in the water. 45° keeps the 3D read while staying unambiguous.
          pitch: 45,
          duration: 1400,
          essential: true,
        });
      },
    }),
    [facilities]
  );

  // ------------------------------------------------------------------
  // deck.gl interaction handlers
  // ------------------------------------------------------------------
  const handleHover = useCallback((info: PickingInfo) => {
    if (!info.object || !info.picked) {
      setHovered(null);
      return;
    }
    const facility = info.object as FacilityProperties;
    setHovered({ facility, x: info.x, y: info.y });
  }, []);

  const handleClick = useCallback(
    (info: PickingInfo) => {
      if (!info.object) return;
      onSelectFacility(info.object as FacilityProperties);
    },
    [onSelectFacility]
  );

  // Keep deck's own event wiring in sync with our React callbacks.
  useEffect(() => {
    if (!overlayRef.current) return;
    overlayRef.current.setProps({
      onHover: handleHover,
      onClick: handleClick,
    });
  }, [handleHover, handleClick]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none" }}
      />

      {/* Cursor-following tooltip */}
      {hovered && !selectedId && (
        <div
          className="pointer-events-none absolute z-30 hidden max-w-[260px] -translate-y-full rounded-xl border border-white/15 bg-slate-900/95 px-3 py-2.5 shadow-2xl backdrop-blur-md sm:block"
          style={{
            left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 0) - 280),
            top: Math.max(hovered.y - 12, 90),
          }}
        >
          <p className="text-[length:calc(13px*var(--fs))] font-semibold leading-tight text-white">
            {lang === "zh" ? hovered.facility.nameZh : hovered.facility.nameEn}
          </p>
          <p className="mt-0.5 text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-white/45">
            {lang === "zh"
              ? CATEGORY_META[hovered.facility.category].labelZh
              : CATEGORY_META[hovered.facility.category].labelEn}
          </p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className="text-[length:calc(16px*var(--fs))] font-bold tabular-nums"
              style={{ color: CATEGORY_META[hovered.facility.category].hex }}
            >
              {hovered.facility.throughputTonnesPerDay === null
                ? t("notPublished", lang)
                : formatNumber(hovered.facility.throughputTonnesPerDay)}
            </span>
            {hovered.facility.throughputTonnesPerDay !== null && (
              <span className="text-[length:calc(10px*var(--fs))] text-white/50">
                {t("tpd", lang)}
              </span>
            )}
          </div>
          {hovered.facility.throughputNoteEn && (
            <p className="mt-0.5 text-[length:calc(10px*var(--fs))] leading-snug text-white/55">
              {lang === "zh"
                ? hovered.facility.throughputNoteZh
                : hovered.facility.throughputNoteEn}
            </p>
          )}
          {hovered.facility.groupThroughputTonnesPerDay && (
            <p className="mt-0.5 text-[length:calc(10px*var(--fs))] leading-snug text-amber-300/80">
              {lang === "zh"
                ? hovered.facility.groupThroughputNoteZh
                : hovered.facility.groupThroughputNoteEn}
            </p>
          )}
          <p className="mt-1.5 text-[length:calc(10px*var(--fs))] text-emerald-400/80">
            {t("clickHint", lang)}
          </p>
        </div>
      )}

      {/* Loading shimmer */}
      {!ready && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950">
          <div className="flex flex-col items-center gap-3">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-emerald-400" />
            <p className="text-xs font-medium text-white/60">{t("loading", lang)}</p>
          </div>
        </div>
      )}

      {/* Empty-filter hint */}
      {ready && emptyHint && (
        <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-slate-900/90 px-5 py-3 text-sm text-white/70 backdrop-blur-md">
          {t("noFacilities", lang)}
        </div>
      )}
    </div>
  );
});

export default WasteMap3D;
