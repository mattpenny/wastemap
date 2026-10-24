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
import { ColumnLayer, IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import type { PickingInfo } from "@deck.gl/core";

import type { FacilityCategory, FacilityProperties } from "@/data/waste-facilities";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { groupHex, groupRgb } from "@/lib/facilityColors";
import { t, type Lang } from "@/lib/i18n";
import { prefetchUnderlayTiles } from "@/lib/prefetchBasemap";
import {
  VESSEL_TRACKS,
  positionAtTime,
  trackDurationMs,
  trailBefore,
} from "@/lib/vesselTracks";
import { formatNumber } from "@/lib/utils";
import {
  HK_BEARING,
  HK_CENTER,
  HK_PITCH,
  HK_ZOOM,
  SEA_MASK_DETENT_DEFAULT,
  SEA_MASK_DETENT_MAX,
  SEA_MASK_DETENT_MIN,
  SEA_MASK_STATE,
  isSmallScreen,
  resolvePixelRatio,
  seaMaskOpacity,
  wheelDetentZoom,
  styleFor,
  styleKey,
  type MapStyleId,
} from "./mapStyles";

export interface WasteMap3DHandle {
  /** Animate back to the default Hong Kong overview. */
  resetView: () => void;
  /** Fly to a facility and select it. */
  focusFacility: (id: string) => void;
  /**
   * Fly to a framing that contains every recorded vessel route. The tracks are
   * only a few kilometres long, so at the territory overview they are a
   * handful of pixels — toggling the layer on should put them on screen.
   */
  focusVessels: () => void;
}

export interface WasteMap3DProps {
  facilities: FacilityProperties[];
  selectedId: string | null;
  onSelectFacility: (facility: FacilityProperties | null) => void;
  mapStyle: MapStyleId;
  lang: Lang;
  visibleCategories: FacilityCategory[];
  /** When true, show a "no facilities" hint instead of an empty map. */
  emptyHint?: boolean;
  /** Animate the recorded AIS vessel tracks over the sea. */
  showVessels?: boolean;
  /**
   * Fired on a *user-initiated* map move (pan / zoom / rotate / pitch). Used by
   * the mobile UI to collapse its floating sheets. Programmatic moves (e.g. the
   * fly-to on selection) are excluded via the event's `originalEvent`.
   */
  onUserMapInteract?: () => void;
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
 * ColumnLayer takes a single uniform `radius` per layer (it has no
 * `getRadius` accessor), so pillar thickness is driven per category instead:
 * one layer per category, sized to convey the relative scale of each type.
 * Per-facility size variation is still visible on the ground disc below,
 * which is a ScatterplotLayer and does support `getRadius`.
 */
const CATEGORY_RADIUS_M: Record<FacilityCategory, number> = {
  Landfill: 620,
  "I-PARK": 340,
  RTS: 340,
  "O-PARK": 340,
  "Y-PARK": 340,
};

/** Uniform radius for the three strategic landfills (WENT / NENT / SENT).  
 * Keeps the pillar base / colour‑zone area identical, matching the NENT pillar.  
 * The original Landfill radius (620 m) is retained for any other Landfill‑type sites.  
 */
const LANDFILL_GROUP_RADIUS_M = 620;

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

/** Per-facility pin icons, cached by colour so the SVG is built once per hue. */
const pinCache = new Map<string, string>();
function pinFor(hex: string): string {
  let uri = pinCache.get(hex);
  if (!uri) {
    uri = pinDataUri(hex);
    pinCache.set(hex, uri);
  }
  return uri;
}

const PIN_ICON_SIZE = { width: 64, height: 80, anchorX: 32, anchorY: 80 };

/**
 * Recorded vessel routes.
 *
 * Each tracked vessel gets its own colour so two routes on screen at once are
 * distinguishable, and so neither can be mistaken for a facility category
 * (the categories use red / green / emerald / amber / violet).
 */
const VESSEL_COLORS: Record<string, { hex: string; rgb: [number, number, number] }> = {
  "477997242": { hex: "#38bdf8", rgb: [56, 189, 248] }, // NGON SHUEN II
  "477997306": { hex: "#f472b6", rgb: [244, 114, 182] }, // LAI WAN II
};
const VESSEL_COLOR_FALLBACK = { hex: "#e2e8f0", rgb: [226, 232, 240] };

function vesselColor(mmsi: string) {
  return VESSEL_COLORS[mmsi] ?? VESSEL_COLOR_FALLBACK;
}

/**
 * Top-down vessel silhouette, pointing north (course 0). The layer rotates it
 * to the vessel's real course over ground, so it always noses the way it is
 * actually heading. Built as an inline SVG data URI for the same reason as the
 * pin: no network request, no sprite atlas.
 */
function vesselIconUri(hex: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<path d="M32 4 C40 20 42 32 42 42 L42 50 Q32 57 22 50 L22 42 C22 32 24 20 32 4 Z"
 fill="${hex}" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>
<path d="M32 13 L32 44" stroke="#ffffff" stroke-width="2" stroke-opacity="0.5"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const VESSEL_ICON_CACHE = new Map<string, string>();
function vesselIconFor(hex: string): string {
  let uri = VESSEL_ICON_CACHE.get(hex);
  if (!uri) {
    uri = vesselIconUri(hex);
    VESSEL_ICON_CACHE.set(hex, uri);
  }
  return uri;
}

const VESSEL_ICON_SIZE = { width: 64, height: 64, anchorX: 32, anchorY: 32 };

/** Vessel marker size in screen pixels, constant at every zoom. */
const VESSEL_SIZE_PX = 30;

/**
 * How much of the recorded track the wake behind the vessel covers.
 * A barge reports every few minutes, so the trail is what makes the motion
 * read as continuous rather than as a dot jumping between reports.
 */
const VESSEL_TRAIL_MS = 12 * 60 * 1000;

/**
 * Playback speed. A real West Kowloon to Shek Kwu Chau run takes one to two
 * hours, which at 1x would look like a parked boat — so the recording is
 * played back 60x faster (a 90-minute passage in 90 seconds) and loops.
 * The positions are the vessel's real ones; only the clock is compressed.
 */
const VESSEL_TIME_SCALE = 60;

/** Animation frame budget, in milliseconds. 30fps is plenty for a slow vessel. */
const VESSEL_FRAME_MS = 33;

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
    showVessels = false,
    onUserMapInteract,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  /**
   * Playback position of the vessel animation, in milliseconds since the start
   * of the longest recorded track. A ref rather than state on purpose: it
   * changes every frame, and re-rendering React 30 times a second to move a
   * boat would be wasteful.
   */
  const vesselTimeRef = useRef(0);

  // The mount-once effect must not capture a stale callback, so keep the
  // latest selection handler in a ref.
  const onSelectRef = useRef(onSelectFacility);
  onSelectRef.current = onSelectFacility;

  // Same for the user-interaction callback (mobile collapse-on-move).
  const onInteractRef = useRef(onUserMapInteract);
  onInteractRef.current = onUserMapInteract;

  /**
   * Which style is currently rendered. The Lands Department official map ships
   * separate English and Chinese label tiles, so the language is part of the
   * identity — without it, toggling language would not re-fetch the labels.
   */
  const appliedStyleRef = useRef<string>(styleKey(mapStyle, lang));

  /**
   * The sea mask's two anchors (see the init effect): the zoom the framing
   * pass settled on (`landingRef`, known only after framing) and the zoom one
   * wheel detent produces on this device (`detentRef`, refined from real
   * wheel events as they arrive; seeded with the deltaY-120 default).
   */
  const landingRef = useRef<number | null>(null);
  const detentRef = useRef(SEA_MASK_DETENT_DEFAULT);
  /** Whether a real wheel detent has settled `detentRef` for this session. */
  const detentMeasuredRef = useRef(false);
  /** Latest `pushSeaMask` from the mount-once effect, callable elsewhere. */
  const pushSeaMaskRef = useRef<(() => void) | null>(null);

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

  // All three strategic landfills draw at ONE uniform pillar height — NENT's
  // published rate. The per-site licences (WENT 6,400 / NENT 6,000 / SENT
  // 2,000 tpd) mostly reflect headroom rather than what each site handles,
  // and the taller WENT pillar visually dwarfed its neighbours.
  const landfillTpd = useMemo(
    () =>
      facilities.find((f) => f.id === "landfill-nent")?.throughputTonnesPerDay ??
      null,
    [facilities]
  );

  const heightFor = useCallback(
    (f: FacilityProperties) => {
      // Short neutral-height column means EPD publishes no per-site rate. Do
      // not turn N/A into zero or allocate the OITF system total to each pin.
      if (f.throughputTonnesPerDay === null) return MIN_HEIGHT_M * 0.55;
      // Landfills share NENT's height; every other category keeps its own rate.
      const effectiveTpd =
        f.category === "Landfill" && landfillTpd !== null
          ? landfillTpd
          : f.throughputTonnesPerDay;
      const norm = Math.sqrt(effectiveTpd / maxPublishedThroughput);
      return MIN_HEIGHT_M + norm * (MAX_HEIGHT_M - MIN_HEIGHT_M);
    },
    [maxPublishedThroughput, landfillTpd]
  );

  /**
   * Perspective compensation for the three landfill pillars.
   *
   * Metric-identical cylinders project at different sizes in a pitched camera:
   * whichever landfill is closest to the camera (SENT — southernmost at the
   * default view) appears clearly wider than the far one (NENT). All three
   * landfills are built at ONE metric size on purpose, so the apparent
   * difference is pure perspective, not data. Each landfill's radius and
   * height are scaled so they all read at the same on-screen size as NENT.
   * Non-landfill categories return 1.
   */
  const landfillScale = useCallback(
    (f: FacilityProperties): number => {
      const map = mapRef.current;
      if (f.category !== "Landfill" || !map) return 1;
      const nent = facilities.find((fac) => fac.id === "landfill-nent");
      if (!nent) return 1;

      /**
       * The ground-to-screen scale is not uniform across the screen at pitch,
       * so a single local factor still leaves the wide glow discs mismatched —
       * their near edge projects disproportionately wide. Measure the scale at
       * the disc's two horizontally-extreme rim points (the ground direction
       * whose projection points screen-right/left) and sum those; scaling each
       * landfill by (NENT's sum / this landfill's sum) neutralises the
       * perspective across the whole footprint.
       */
      const DISC_R = LANDFILL_GROUP_RADIUS_M * 1.3;

      /** Horizontal pixels per ground metre at an arbitrary ground point. */
      const hPerMetreAt = (lng: number, lat: number) => {
        const p0 = map.project({ lng, lat });
        const mPerLng = 111320 * Math.cos((lat * Math.PI) / 180);
        const dM = 400;
        const pe = map.project({ lng: lng + dM / mPerLng, lat });
        const pn = map.project({ lng, lat: lat + dM / 110574 });
        return Math.hypot((pe.x - p0.x) / dM, (pn.x - p0.x) / dM);
      };

      const rimScaleSum = (fac: FacilityProperties) => {
        const [lng, lat] = fac.coordinates;
        const p0 = map.project({ lng, lat });
        const mPerLng = 111320 * Math.cos((lat * Math.PI) / 180);
        const dM = 400;
        const pe = map.project({ lng: lng + dM / mPerLng, lat });
        const pn = map.project({ lng, lat: lat + dM / 110574 });
        const dxde = (pe.x - p0.x) / dM;
        const dxdn = (pn.x - p0.x) / dM;
        const len = Math.hypot(dxde, dxdn);
        if (!(len > 0)) return 0;
        // Ground direction that projects horizontally on screen.
        const ux = dxde / len;
        const uy = dxdn / len;
        const edge1 = hPerMetreAt(
          lng + (ux * DISC_R) / mPerLng,
          lat + (uy * DISC_R) / 110574
        );
        const edge2 = hPerMetreAt(
          lng - (ux * DISC_R) / mPerLng,
          lat - (uy * DISC_R) / 110574
        );
        return edge1 + edge2;
      };

      const ref = rimScaleSum(nent);
      const here = rimScaleSum(f);
      if (!(ref > 0) || !(here > 0)) return 1;
      // Clamped so a pathological camera pose can never collapse or inflate a
      // pillar; 1.6x covers the whole overview-to-flyTo range by a wide margin.
      return Math.max(0.5, Math.min(1.6, ref / here));
    },
    [facilities]
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

    // Pillar footprint shrinks as the camera zooms in, so a facility never
    // balloons to cover half the screen when you fly in to it. The metric
    // radius is divided by ~2^(zoom - overviewZoom), which keeps the on-screen
    // footprint roughly constant across the zoom range.
    const radiusScale = elevationScale;

    // Glowing ground disc under every pillar — anchors the columns visually
    // and gives a reliable click target at shallow pitch angles. Drawn only for
    // the un-selected facilities, so the selected site shows just its pin.
    const baseLayer = new ScatterplotLayer<FacilityProperties>({
      id: "facility-base",
      data: columnData,
      pickable: true,
      stroked: true,
      filled: true,
      radiusUnits: "meters",
      lineWidthUnits: "meters",
      getPosition: (d) => d.coordinates,
      getRadius: (d) => {
        // Force identical base footprint for all three strategic landfills,
        // then apply the perspective compensation so the nearer ones do not
        // project wider than NENT's in the pitched default view.
        const base = d.category === "Landfill" ? LANDFILL_GROUP_RADIUS_M : CATEGORY_RADIUS_M[d.category];
        return base * landfillScale(d) * 1.3 * radiusScale;
      },
      // Colour encodes the facility itself, so every site reads as its own
      // colour. Utilisation is still surfaced numerically in the tooltip,
      // the drawer and the header stats.
      getFillColor: (d) => [...groupRgb(d), 80],
      getLineColor: (d) =>
        d.id === selectedId
          ? [255, 255, 255, 235]
          : [...groupRgb(d), 205],
      getLineWidth: (d) => (d.id === selectedId ? 34 : 16),
      transitions: { getRadius: 500 },
    });

    // ColumnLayer takes ONE radius per layer, and the three landfills each
    // need their own perspective-compensated radius, so the Landfill category
    // is emitted as one layer per site. Every other category stays a single
    // layer with its shared radius.
    const columnLayers: ColumnLayer<FacilityProperties>[] = [];
    for (const cat of CATEGORY_ORDER) {
      const rows = columnData.filter((f) => f.category === cat);
      if (rows.length === 0) continue;
      if (cat !== "Landfill") {
        columnLayers.push(
          new ColumnLayer<FacilityProperties>({
            id: `facility-column-${cat}`,
            data: rows,
            pickable: true,
            extruded: true,
            diskResolution: 24,
            radiusUnits: "meters",
            radius: CATEGORY_RADIUS_M[cat] * radiusScale,
            elevationScale,
            getPosition: (d) => d.coordinates,
            getElevation: (d) => heightFor(d),
            getFillColor: (d) => [...groupRgb(d), 245],
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
        continue;
      }
      for (const f of rows) {
        // Uniform metric radius (NENT size) scaled by the perspective factor
        // so all three landfills read the same size on screen; the height is
        // divided by the same factor for the same reason — the dimensions have
        // to stay in proportion.
        const s = landfillScale(f);
        columnLayers.push(
          new ColumnLayer<FacilityProperties>({
            id: `facility-column-landfill-${f.id}`,
            data: [f],
            pickable: true,
            extruded: true,
            diskResolution: 24,
            radiusUnits: "meters",
            radius: LANDFILL_GROUP_RADIUS_M * s * radiusScale,
            elevationScale,
            getPosition: (d) => d.coordinates,
            getElevation: (d) => heightFor(d) / s,
            getFillColor: (d) => [...groupRgb(d), 245],
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
      }
    }

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
          getIcon: (d) => ({ url: pinFor(groupHex(d)), ...PIN_ICON_SIZE }),
          // Force HTMLImageElement decoding: SVG sources can come back blank
          // when luma.gl decodes them through ImageBitmap.
          loadOptions: { image: { type: "image" } },
          transitions: { getSize: 250 },
        })
      : null;

    // ------------------------------------------------------------------
    // Recorded vessel routes
    // ------------------------------------------------------------------
    // Three layers per vessel: the route it actually sailed, a bright wake
    // trailing the marker, and the vessel itself rotated to its real course.
    // Everything is driven by the recorded AIS reports — see `vesselTracks.ts`.
    const vesselLayers = showVessels
      ? VESSEL_TRACKS.flatMap((track) => {
          const path = track.points.map(
            (p) => [p.lng, p.lat] as [number, number],
          );
          const color = vesselColor(track.mmsi);
          const t0 = track.points[0].t;
          const duration = trackDurationMs(track);
          if (duration <= 0) return [];

          // Each vessel runs on its own clock: the tracks have very different
          // lengths (one passage vs. a few minutes of manoeuvring), and a
          // shared clock would make the short one vanish for most of the loop.
          const now = vesselTimeRef.current % duration;
          const at = positionAtTime(track, t0 + now);
          // A barge reports only every few minutes, so the wake is what makes
          // the motion read as continuous rather than as a dot hopping between
          // reports.
          const wake = trailBefore(track, t0 + now, VESSEL_TRAIL_MS);

          return [
            new PathLayer<[number, number][]>({
              id: `vessel-route-${track.mmsi}`,
              data: [path],
              getPath: (d: [number, number][]) => d,
              getColor: [...color.rgb, 110],
              getWidth: 2,
              widthUnits: "pixels",
              widthMinPixels: 1.5,
              capRounded: true,
              jointRounded: true,
            }),
            ...(wake
              ? [
                  new PathLayer<[number, number][]>({
                    id: `vessel-wake-${track.mmsi}`,
                    data: [wake],
                    getPath: (d: [number, number][]) => d,
                    getColor: [...color.rgb, 240],
                    getWidth: 3,
                    widthUnits: "pixels",
                    widthMinPixels: 2,
                    capRounded: true,
                    jointRounded: true,
                  }),
                ]
              : []),
            // The vessel itself. Dropped when the playback clock sits outside
            // the recorded span, so the marker never appears where the ship
            // was not actually reported.
            ...(at
              ? [
                  new IconLayer<{ position: [number, number]; course: number | null }>({
                    id: `vessel-icon-${track.mmsi}`,
                    data: [{ position: at.position, course: at.course }],
                    billboard: true,
                    sizeUnits: "pixels",
                    getSize: VESSEL_SIZE_PX,
                    getPosition: (d) => d.position,
                    getIcon: () => ({
                      url: vesselIconFor(color.hex),
                      ...VESSEL_ICON_SIZE,
                    }),
                    // AIS course is clockwise from north; deck.gl angles are
                    // counter-clockwise, hence the negation.
                    getAngle: (d) => (d.course == null ? 0 : -d.course),
                    loadOptions: { image: { type: "image" } },
                  }),
                ]
              : []),
          ];
        })
      : [];

    return [baseLayer, ...columnLayers, ...(pinLayer ? [pinLayer] : []), ...vesselLayers];
  }, [shown, selectedId, heightFor, elevationScale, landfillScale, showVessels]);

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

    // Dev/diagnostics hook: lets headless probes fly the camera without going
    // through the UI. Harmless in production (a single window property).
    (window as unknown as { __wmMap?: unknown }).__wmMap = map;

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

    map.on("load", () => {
      setReady(true);
      // Warm the browser cache with the coarse underlay tiles so a later
      // zoom-out from a facility is gap-free from the first frame. Scheduled
      // behind the initial tile stream so it never competes with it.
      setTimeout(prefetchUnderlayTiles, 1500);
    });

    // Quantised to quarter-zoom steps: setZoom bails out on an unchanged value,
    // so this avoids rebuilding the layer set on every animation frame.
    const handleZoom = () => {
      const next = Math.round(map.getZoom() * 4) / 4;
      setZoom((prev) => (prev === next ? prev : next));
    };
    map.on("zoom", handleZoom);

    // ------------------------------------------------------------------
    // The sea mask (see seaMaskOpacity in mapStyles.ts): flat one-tone sea
    // from the FOURTH wheel notch of zoom-in, natural sea before that.
    //
    // The fill-opacity reads a single global state (`wmSeaMask`), and this is
    // the code that computes and pushes it. The ramp is anchored on two
    // measured quantities, so the mechanism needs no gesture bookkeeping:
    //
    //   • `landingRef` — the zoom the framing pass actually settled on for
    //     this window (viewport-dependent),
    //   • `detentRef`  — the zoom ONE wheel detent produces on THIS device,
    //     measured off the detent's own deltaY with MapLibre's own conversion
    //     and clamped to sane bounds (trackpads report continuous small
    //     deltas that are not detents; they fall far below the clamp floor
    //     and behave like sub-notch nudges, which is what they are).
    //
    // On every wheel detent and every zoom frame the offset of the live zoom
    // above the landing is taken through the pure ramp: 0 up to 3 detents,
    // 1 from the fourth detent on, blended between. Programmatic zooms
    // (flyTo on selection, geolocate, +/− buttons, keyboard, double-click)
    // produce no wheel detents, but their offset soon clears the ramp — the
    // mask engages by zoom alone, exactly as the requirement asks ("I want
    // the masked layer start from fourth notches of mouse wheeling" — and
    // only wheel *notches* must NOT fire it earlier at any window size).
    // ------------------------------------------------------------------
    landingRef.current = null;
    detentRef.current = SEA_MASK_DETENT_DEFAULT;
    let lastPushed = -1;

    const pushSeaMask = () => {
      const landing = landingRef.current;
      const layer = map.getLayer("sea-mask");
      if (landing === null || !layer) return;
      const opacity = seaMaskOpacity(map.getZoom(), landing, detentRef.current);
      // _applyGlobalStateChanges re-evaluates the paint immediately; skip
      // the property write when the value has not moved.
      if (opacity === lastPushed) return;
      lastPushed = opacity;
      map.setGlobalStateProperty(SEA_MASK_STATE, opacity);
    };
    pushSeaMaskRef.current = pushSeaMask;

    const handleWheel = (e: maplibregl.MapWheelEvent) => {
      // ctrl+wheel is a browser/trackpad pinch, not a mouse detent.
      if (e.originalEvent.ctrlKey) return;
      const dz = wheelDetentZoom(e.originalEvent.deltaY, e.originalEvent.deltaMode);
      if (dz < SEA_MASK_DETENT_MIN || dz > SEA_MASK_DETENT_MAX) return; // not a detent
      // A wheel reports its detents at a consistent delta on a given device,
      // so the first detent settles `detentRef` for the session and later
      // detents keep it — the ramp width is then exactly this device's
      // 3-to-4-detent span, wherever it began.
      if (!detentMeasuredRef.current) {
        detentMeasuredRef.current = true;
        detentRef.current = dz;
      }
      pushSeaMask();
    };
    map.on("wheel", handleWheel);

    // During an eased zoom (wheel included) the offset sweeps continuously;
    // the zoom event fires every frame, so the blend tracks the coast live.
    map.on("zoom", pushSeaMask);

    // A style swap reinstalls the stylesheet (state defaults included), so
    // the computed opacity must be re-pushed onto the new style — guarded,
    // because only the satellite style carries the sea-mask layer. Verified
    // in maplibre-gl 5.24: `_load()` runs `_createLayers()` (which applies
    // the stylesheet `state`) and *then* fires `style.load`, so the layers
    // exist by the time this runs.
    map.on("style.load", () => {
      lastPushed = -1;
      pushSeaMask();
    });

    // ------------------------------------------------------------------

    // User-initiated map move (pan / zoom / rotate / pitch) — used on mobile to
    // collapse the floating sheets. `originalEvent` is populated only for moves
    // driven by real input (drag, wheel, touch), so a programmatic flyTo (e.g.
    // selecting a facility from the list) does NOT trigger it.
    const handleInteractStart = (e: maplibregl.MapLibreEvent) => {
      if (e.originalEvent) onInteractRef.current?.();
    };
    map.on("movestart", handleInteractStart);
    map.on("zoomstart", handleInteractStart);
    map.on("rotatestart", handleInteractStart);
    map.on("pitchstart", handleInteractStart);

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

    return () => {
      window.clearTimeout(readyFallback);
      map.off("zoom", handleZoom);
      map.off("wheel", handleWheel);
      map.off("zoom", pushSeaMask);
      map.off("movestart", handleInteractStart);
      map.off("zoomstart", handleInteractStart);
      map.off("rotatestart", handleInteractStart);
      map.off("pitchstart", handleInteractStart);
      map.off("click", handleBackgroundClick);
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

    // Anchor the sea-mask ramp on the camera the opening view actually
    // settled on, then take the mask through the ramp from wherever the
    // landing sits relative to the (possibly already-deep) live zoom.
    landingRef.current = zoom;
    if (map.getLayer("sea-mask")) pushSeaMaskRef.current?.();
  }, [ready, facilities]);

  // ------------------------------------------------------------------
  // Push layers whenever data / selection / filter changes
  // ------------------------------------------------------------------
  const pushLayers = useCallback(() => {
    if (!overlayRef.current) return;
    overlayRef.current.setProps({
      layers: buildLayers(),
      effects: [lightingEffect],
      getCursor: ({ isHovering }: { isHovering: boolean }) =>
        isHovering ? "pointer" : "grab",
    });
  }, [buildLayers]);

  useEffect(() => {
    pushLayers();
  }, [pushLayers]);

  // ------------------------------------------------------------------
  // Animate the recorded vessel routes
  // ------------------------------------------------------------------
  // Collection has to run locally (AISStream needs a long-lived WebSocket,
  // which a serverless function cannot hold), so the map plays the recording
  // back here. Only deck.gl props are pushed — React never re-renders, so the
  // 30fps clock costs nothing in the component tree.
  useEffect(() => {
    if (!showVessels || VESSEL_TRACKS.length === 0) return;
    if (Math.max(...VESSEL_TRACKS.map(trackDurationMs)) <= 0) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = now - last;
      if (dt < VESSEL_FRAME_MS) return;
      last = now;
      // Deliberately not wrapped: each vessel takes its own modulo against its
      // own track length in buildLayers, so wrapping the shared clock here
      // would just make every vessel snap back to its start at the same
      // instant. A float stays exact for centuries at this magnitude.
      vesselTimeRef.current += dt * VESSEL_TIME_SCALE;
      pushLayers();
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [showVessels, pushLayers]);

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
        // Reset the mask anchors with the view: the landing zoom is what the
        // ramp is measured against.
        landingRef.current = framed?.zoom ?? null;
        pushSeaMaskRef.current?.();
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
      focusVessels: () => {
        const map = mapRef.current;
        if (!map || VESSEL_TRACKS.length === 0) return;
        // Bounding box of every recorded point, with a little sea around it.
        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;
        for (const track of VESSEL_TRACKS) {
          for (const p of track.points) {
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
          }
        }
        const spanLng = maxLng - minLng;
        const spanLat = maxLat - minLat;
        const pad = 0.25; // ~a quarter of the extent, on every side
        const bounds: [[number, number], [number, number]] = [
          [minLng - spanLng * pad - 0.002, minLat - spanLat * pad - 0.002],
          [maxLng + spanLng * pad + 0.002, maxLat + spanLat * pad + 0.002],
        ];
        // Top-down: the routes are flat lines on the sea, and a pitched camera
        // would foreshorten them into the water.
        const camera = map.cameraForBounds(bounds, {
          padding: 90,
          bearing: 0,
          pitch: 0,
          maxZoom: 14,
        });
        map.flyTo({ ...camera, duration: 1400, essential: true });
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
    <div className="relative h-full w-full overflow-hidden bg-[#14304d]">
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
              style={{ color: groupHex(hovered.facility) }}
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
