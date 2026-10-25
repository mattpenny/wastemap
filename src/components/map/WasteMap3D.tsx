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
import {
  ColumnLayer,
  IconLayer,
  PathLayer,
  ScatterplotLayer,
  TextLayer,
} from "@deck.gl/layers";
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import type { PickingInfo } from "@deck.gl/core";

import type { FacilityCategory, FacilityProperties } from "@/data/waste-facilities";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { groupHex, groupRgb } from "@/lib/facilityColors";
import { t, type Lang } from "@/lib/i18n";
import { prefetchUnderlayTiles } from "@/lib/prefetchBasemap";
import {
  VESSEL_TRACKS,
  sampleAt,
  sampleTrack,
  trackSpan,
  trailBefore,
  vesselColor,
  type VesselTimeMark,
  type VesselTrack,
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
  /**
   * The recorded tracks to draw. Passed in rather than imported so the app can
   * swap in whatever its own store returned; `VESSEL_TRACKS` is the bundled
   * fallback the caller starts from.
   */
  vesselTracks?: VesselTrack[];
  /**
   * The vessel whose route is on — the one the user clicked.
   *
   * Null means every drawn vessel is a marker only: "where the ships are now".
   * This is the single switch for the route, its 10-minute marks, the wake and
   * the playback; the route belongs to one vessel because the time search in
   * the card applies to that vessel's recording.
   */
  activeVesselMmsi?: string | null;
  /**
   * MMSIs of the vessels the user has chosen to display. Empty by default —
   * the vessels are off until asked for, because a waste map is primarily a
   * map of facilities and two ships in the harbour are a detail on top of it.
   */
  visibleVesselMmsis?: string[];
  /**
   * The window the time search is scoped to, in epoch milliseconds. Null means
   * "the whole recording", which the collector already caps at 24 hours.
   */
  vesselWindow?: { from: number; to: number } | null;
  /** Fired when a vessel marker or one of its dots is clicked. */
  onSelectVessel?: (mmsi: string) => void;
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
 * Vessel colours come from `vesselTracks.ts`: the map and the vessel switch in
 * the toolbar must agree on them, so there is one table, not two.
 */

/**
 * Top-down vessel silhouette, pointing north (course 0). The layer rotates it
 * to the vessel's heading, so it always noses the way it is actually going.
 * Built as an inline SVG data URI for the same reason as the pin: no network
 * request, no sprite atlas.
 *
 * Shaped like the ships it stands for: a sharp bow, parallel sides, a flat
 * transom — long and narrow, the way a harbour work boat reads from above. The
 * previous outline had a rounded stern that bulged almost as wide as the bow,
 * so at marker size it read as a blob and you could not tell which end was
 * which. Symmetric about y=32 on purpose: that is the rotation anchor, and an
 * off-centre hull visibly swings as the course changes.
 */
function vesselIconUri(hex: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<path d="M32 6 C37 16 40 25 40 33 L40 58 L24 58 L24 33 C24 25 27 16 32 6 Z"
 fill="${hex}" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>
<path d="M32 14 L32 52" stroke="#ffffff" stroke-width="2" stroke-opacity="0.45"/>
<path d="M26 42 L38 42" stroke="#ffffff" stroke-width="2" stroke-opacity="0.3"/>
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

/**
 * Local wall-clock time for the vessel timeline, e.g. "24/10 20:43".
 *
 * Local rather than UTC on purpose: the time search is a `datetime-local`
 * field, whose value is local by definition. A dot reporting UTC beside a
 * search box reading local would have the user hunting a four-hour gap that
 * does not exist.
 */
function formatVesselTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * AIS navigational status, as the vessel reported it.
 *
 * Shown in the dot tooltip because "0.0 kn" on its own is ambiguous: a ship at
 * zero knots is either moored or stopped in the fairway, and only the status
 * code distinguishes them.
 */
const NAV_STATUS: Record<number, [string, string]> = {
  0: ["Under way using engine", "機動航行中"],
  1: ["At anchor", "拋錨"],
  2: ["Not under command", "失去控制"],
  3: ["Restricted manoeuvrability", "操縱受限"],
  4: ["Constrained by draught", "受吃水限制"],
  5: ["Moored", "繫泊"],
  6: ["Aground", "擱淺"],
  7: ["Fishing", "捕魚中"],
  8: ["Under way sailing", "帆航中"],
  15: ["Undefined", "未定義"],
};

function navLabel(nav: number | null, lang: Lang): string | null {
  if (nav == null) return null;
  const entry = NAV_STATUS[nav];
  if (!entry) return null;
  return lang === "zh" ? entry[1] : entry[0];
}

/** Initial bearing from one coordinate to another, degrees clockwise from north. */
function bearingDeg(from: [number, number], to: [number, number]): number {  const rad = Math.PI / 180;
  const [lon1, lat1] = from;
  const [lon2, lat2] = to;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x =
    Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/**
 * Speed below which a reported course over ground is not trusted, in knots.
 *
 * AIS derives COG from successive fixes, so at walking pace it is dominated by
 * GPS noise and often just repeats the last value. In this recording NGON
 * SHUEN II sat at 0.0 kn reporting 195° while the track it had just sailed ran
 * 328° — a 133° error that left the hull pointing backwards down its own wake.
 * One knot is the usual "is it actually moving" line for a harbour craft.
 */
const VESSEL_COG_MIN_KN = 1;

/**
 * Which way the hull points, in AIS convention (degrees clockwise from north).
 *
 * Below VESSEL_COG_MIN_KN we use the direction between the two reports that
 * bracket the moment instead, so the hull follows the line it is actually on.
 * Under way the reported course is the better answer, and that is what is used.
 */
function headingFor(
  track: VesselTrack,
  course: number | null,
  sog: number | null,
  fromT: number,
  toT: number
): number {
  if (sog != null && sog >= VESSEL_COG_MIN_KN && course != null) return course;
  const a = track.points.find((p) => p.t === fromT);
  const b = track.points.find((p) => p.t === toT);
  if (a && b && (a.lng !== b.lng || a.lat !== b.lat)) {
    return bearingDeg([a.lng, a.lat], [b.lng, b.lat]);
  }
  return course ?? 0;
}


/**
 * Vessel marker size in screen pixels.
 *
 * Matched to PIN_SIZE_PX on purpose: the facility pin and the vessel marker are
 * the two "one of these, here" markers on the map, so they should carry the
 * same visual weight. Measured on the running map, the boat silhouette inside
 * the 64x64 icon fills roughly 16x43 of it, and deck.gl draws the icon in the
 * ground plane, so the default 50 degree pitch foreshortens it further — at 30
 * the marker came out barely 11 px tall, which is a poor hover target.
 */
const VESSEL_SIZE_PX = 46;

/**
 * What the vessel marker carries. Kept on the object rather than looked up
 * at pick time so the hover tooltip can name the vessel without a second
 * pass over the tracks.
 */
interface VesselMarker {
  position: [number, number];
  /** Course over ground, degrees clockwise from true north. */
  course: number | null;
  name: string;
  mmsi: string;
  /** Epoch ms of the report the marker is sitting on. */
  t: number;
  sog: number | null;
}

/** A dot on the route, sampled every VESSEL_MARK_STEP_MS. */
interface VesselDot extends VesselTimeMark {
  name: string;
  mmsi: string;
}

/**
 * Spacing of the dots along a route.
 *
 * The user asks for a readable time axis over the recording rather than a dot
 * per report, which would bunch up wherever the ship reported twice in a
 * minute and vanish where it went quiet. 10 minutes is coarse enough to stay
 * legible over a 24-hour window and fine enough to read a harbour crossing.
 */
const VESSEL_MARK_STEP_MS = 10 * 60 * 1000;

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
    vesselTracks = VESSEL_TRACKS,
    activeVesselMmsi = null,
    visibleVesselMmsis,
    vesselWindow = null,
    onSelectVessel,
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

  /**
   * The vessels actually being drawn, and the stretch of each track the time
   * search has selected.
   *
   * Computed once per selection change rather than per frame: the animation
   * clock pushes layers at 30fps, and resampling a 24-hour window into 10-minute
   * marks on every one of those frames would be pure waste. Nothing here moves
   * with the clock — only the marker does.
   */
  const vesselGeometry = useMemo(() => {
    const visible = new Set(visibleVesselMmsis ?? []);
    return vesselTracks.filter((track) => visible.has(track.mmsi)).map((track) => {
      const span = trackSpan(track);
      const lo = vesselWindow ? Math.max(span.from, vesselWindow.from) : span.from;
      const hi = vesselWindow ? Math.min(span.to, vesselWindow.to) : span.to;
      return {
        track,
        lo,
        hi,
        // Only the clicked vessel gets a route. The others stay markers: the
        // time search belongs to one vessel's recording, so drawing a second
        // route that the card does not control would be a lie about what the
        // card is showing.
        active: track.mmsi === activeVesselMmsi,
        // An empty window is a real state (the search selects a quiet stretch),
        // not an error — it just means no route and no dots.
        marks: hi > lo ? sampleTrack(track, lo, hi, VESSEL_MARK_STEP_MS) : [],
      };
    });
  }, [vesselTracks, visibleVesselMmsis, vesselWindow, activeVesselMmsi]);

  // The imperative handle is memoised on `facilities`, so it would capture a
  // stale selection. It reads this ref instead.
  const vesselGeometryRef = useRef(vesselGeometry);
  vesselGeometryRef.current = vesselGeometry;

  // The mount-once effect must not capture a stale callback, so keep the
  // latest selection handler in a ref.
  const onSelectRef = useRef(onSelectFacility);
  onSelectRef.current = onSelectFacility;

  // The click handler is memoised on `onSelectFacility` only, so the vessel
  // callback goes through a ref too — otherwise a new inline arrow from the
  // parent would either be missed or force the handler to be rebuilt.
  const onSelectVesselRef = useRef(onSelectVessel);
  onSelectVesselRef.current = onSelectVessel;

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
  /**
   * Current map bearing, in degrees.
   *
   * The vessel icons are `billboard`, so they rotate in SCREEN space — measured:
   * at map bearing -18 the hull was drawn 18 deg off, exactly the bearing. A
   * north-up frame hides this, which is why the route view looked right and the
   * landing view (rotated -18) did not. The layer therefore has to subtract the
   * bearing from each course itself, and needs the bearing as a dependency so a
   * rotation rebuilds the layers.
   */
  const [bearing, setBearing] = useState(HK_BEARING);
  const [hovered, setHovered] = useState<
    | { facility: FacilityProperties; x: number; y: number }
    | { vessel: VesselMarker; x: number; y: number }
    | { dot: VesselDot; x: number; y: number }
    | null
  >(null);

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
    // Vessels
    // ------------------------------------------------------------------
    // Three switches, each with one job:
    //
    //  1. `visibleVesselMmsis` — which vessels exist on the map at all.
    //     Empty by default: this is a map of facilities, and the ships are an
    //     overlay the user asks for.
    //  2. `vesselWindow` — which stretch of the recording the time search has
    //     selected.
    //  3. `activeVesselMmsi` — the vessel the user clicked, whose route, marks,
    //     wake and playback are drawn on top of the marker that says where it
    //     is. Null means every drawn vessel is a marker and nothing more.
    //
    // Everything is driven by the recorded AIS reports — see `vesselTracks.ts`.
    const vesselLayers = vesselGeometry.flatMap(({ track, lo, hi, marks, active }, index) => {
      const color = vesselColor(track.mmsi);
      const points = track.points;
      const last = points[points.length - 1];

      // The marker. Sitting on the last report by default; riding the
      // interpolated position while the route plays back.
      const prev = points[points.length - 2];
      const marker: VesselMarker = {
        position: [last.lng, last.lat],
        // Heading, not raw COG — see `headingFor`. A ship at 0 kn still
        // broadcasts an old course, and drawing that leaves it sideways.
        course: headingFor(track, last.cog, last.sog, prev.t, last.t),
        name: track.name,
        mmsi: track.mmsi,
        t: last.t,
        sog: last.sog,
      };
      let routePath: [number, number][] | null = null;
      let dots: VesselDot[] | null = null;
      let wake: [number, number][] | null = null;

      if (active && hi > lo) {
        // The line's vertices are the real reports inside the window, closed
        // off at both edges by interpolation — so narrowing the time search
        // shortens the line without inventing a bend in it.
        const path: [number, number][] = [];
        const startAt = sampleAt(track, lo);
        if (startAt) path.push(startAt.position);
        for (const p of points) {
          if (p.t > lo && p.t < hi) path.push([p.lng, p.lat]);
        }
        const endAt = sampleAt(track, hi);
        if (endAt) path.push(endAt.position);
        if (path.length >= 2) routePath = path;

        // A dot every 10 minutes, each carrying the reports it sits between.
        dots = marks.map((m) => ({ ...m, name: track.name, mmsi: track.mmsi }));

        // Playback loops over the selected window, not over the whole track.
        const windowMs = hi - lo;
        const now = vesselTimeRef.current % windowMs;
        const at = sampleAt(track, lo + now);
        // A barge reports only every few minutes, so the wake is what makes
        // the motion read as continuous rather than as a dot hopping between
        // reports.
        wake = trailBefore(track, lo + now, VESSEL_TRAIL_MS);
        if (at) {
          marker.position = at.position;
          marker.course = headingFor(track, at.course, at.sog, at.fromT, at.toT);
          marker.t = lo + now;
          marker.sog = at.sog;
        }
      }

      return [
        ...(routePath
          ? [
              new PathLayer<[number, number][]>({
                id: `vessel-route-${track.mmsi}`,
                data: [routePath],
                getPath: (d: [number, number][]) => d,
                getColor: [...color.rgb, 110],
                getWidth: 2,
                widthUnits: "pixels",
                widthMinPixels: 1.5,
                capRounded: true,
                jointRounded: true,
              }),
            ]
          : []),
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
        ...(dots
          ? [
              // The 10-minute marks, drawn small so the route stays readable.
              new ScatterplotLayer<VesselDot>({
                id: `vessel-dot-${track.mmsi}`,
                data: dots,
                getPosition: (d) => d.position,
                getFillColor: [...color.rgb, 235],
                getLineColor: [255, 255, 255, 200],
                stroked: true,
                getRadius: 2.8,
                radiusUnits: "pixels",
                lineWidthUnits: "pixels",
                getLineWidth: 0.9,
                // Picking is geometric, so this layer could be pickable — but
                // a 2.8px target is a miss waiting to happen, and enlarging the
                // drawn dot to suit the pointer would make the route look like
                // a string of beads. The invisible layer below carries the
                // hits instead.
                pickable: false,
              }),
              // The hit area. Transparent, drawn on top of the visible dot, and
              // roughly three times its radius — a comfortable pointer target
              // that changes nothing about how the route looks.
              new ScatterplotLayer<VesselDot>({
                id: `vessel-dotpick-${track.mmsi}`,
                data: dots,
                getPosition: (d) => d.position,
                getFillColor: [...color.rgb, 0],
                getRadius: 9,
                radiusUnits: "pixels",
                pickable: true,
              }),
            ]
          : []),
        new IconLayer<VesselMarker>({
          id: `vessel-icon-${track.mmsi}`,
          data: [marker],
          billboard: true,
          sizeUnits: "pixels",
          getSize: VESSEL_SIZE_PX,
          getPosition: (d) => d.position,
          getIcon: () => ({
            url: vesselIconFor(color.hex),
            ...VESSEL_ICON_SIZE,
          }),
          // AIS course is clockwise from north and deck.gl angles are
          // counter-clockwise, hence the negation. The bearing is subtracted
          // first because a billboard icon rotates in screen space: on a map
          // rotated by -18 deg, a north-heading hull would otherwise be drawn
          // 18 deg off true.
          getAngle: (d) => bearing - (d.course ?? 0),
          loadOptions: { image: { type: "image" } },
          // Hoverable so the vessel can name itself.
          pickable: true,
        }),
        // The vessel's name, drawn whenever the vessel is. A hull silhouette in
        // a harbour is not self-explanatory, and a hover-only label means the
        // map cannot be read without first finding the marker with the pointer.
        //
        // `pickable: false` is load-bearing. `handleHover` and `handleClick`
        // branch on the layer-id prefix, and a text layer hands them a bare
        // string where they expect a marker — not picking it at all is cheaper
        // than guarding every branch against one more shape.
        new TextLayer<VesselMarker>({
          id: `vessel-label-${track.mmsi}`,
          data: [marker],
          getText: (d) => d.name,
          getPosition: (d) => d.position,
          // Clear of the hull: half of VESSEL_SIZE_PX plus a small gap. The
          // icon rotates with the heading and the text does not, so a fixed
          // offset stays legible at every course.
          //
          // Alternating above / below is a collision strategy, not decoration:
          // at the phone overview the two hulls sit 14 px apart, so two labels
          // stacked on the same side print on top of each other — which is
          // exactly when the name matters most, because the hulls overlap too.
          // One above and one below keeps both readable at every zoom without
          // hiding either or moving it far from its ship.
          getPixelOffset: [
            0,
            (index % 2 === 0 ? -1 : 1) * (VESSEL_SIZE_PX / 2 + 7),
          ],
          getSize: 13,
          sizeUnits: "pixels",
          getColor: [255, 255, 255, 255],
          // The UI stack, not deck.gl's default. That default is
          // `Monaco, monospace`, which does not exist on Windows — it falls back
          // to a generic monospace and the names read as stencilled boxes.
          fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
          fontWeight: 600,
          // A dark halo rather than a background pill: the imagery underneath
          // runs from pale quay to dark water, and an outline holds contrast
          // over both without adding a box that competes with the facility pins.
          // Kept narrow on purpose — at 13 px, an outline above ~2 px closes the
          // counters of E, S and N and the word turns into a smudge.
          outlineWidth: 1.5,
          outlineColor: [2, 6, 23, 235],
          // SDF, so the glyphs stay sharp at every zoom instead of being
          // resampled from a 12 px bitmap atlas.
          fontSettings: { sdf: true, buffer: 6, radius: 12 },
          // Screen-space, exactly like the hull: a map rotated to the harbour's
          // bearing must not tilt the text. Do NOT subtract the bearing here —
          // that correction exists for the icon, which points somewhere.
          getAngle: 0,
          billboard: true,
          pickable: false,
        }),
      ];
    });

    return [baseLayer, ...columnLayers, ...(pinLayer ? [pinLayer] : []), ...vesselLayers];
  }, [
    shown,
    selectedId,
    heightFor,
    elevationScale,
    landfillScale,
    activeVesselMmsi,
    vesselGeometry,
    bearing,
  ]);

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

    // Whole degrees: the same bail-out trick, so a drag-rotate does not rebuild
    // the layer set on every frame for a sub-degree change nobody can see.
    const handleBearing = () => {
      const next = Math.round(map.getBearing());
      setBearing((prev) => (prev === next ? prev : next));
    };
    map.on("rotate", handleBearing);

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
    if (!activeVesselMmsi || vesselGeometry.length === 0) return;
    // Nothing selected in the time search means nothing to play back; leave
    // the clock stopped rather than spinning a frame loop over an empty window.
    if (vesselGeometry.every((g) => g.hi <= g.lo)) return;

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
  }, [activeVesselMmsi, pushLayers, vesselGeometry]);

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
        // Only the vessel whose route is on. Framing the others would fly the
        // camera to a marker with nothing to look at, and the route is what
        // the user just asked to see.
        const visible = vesselGeometryRef.current.filter((g) => g.active);
        if (!map || visible.length === 0) return;
        // Bounding box of every point in the selected window, with a little
        // sea around it. `lo`/`hi` are already clipped to the recording, so a
        // narrow time search frames just that stretch.
        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;
        for (const { track, lo, hi } of visible) {
          const startAt = sampleAt(track, lo);
          const endAt = sampleAt(track, hi);
          const corners: [number, number][] = [];
          if (startAt) corners.push(startAt.position);
          if (endAt) corners.push(endAt.position);
          for (const p of track.points) {
            if (p.t >= lo && p.t <= hi) corners.push([p.lng, p.lat]);
          }
          for (const [lng, lat] of corners) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
        if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return;
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
    // Vessel markers share the overlay with the facility layers, so tell them
    // apart by the layer that produced the pick. `vessel-dot` also matches the
    // invisible `vessel-dotpick-` hit layer, which is the point.
    if (info.layer?.id?.startsWith("vessel-dot")) {
      setHovered({ dot: info.object as VesselDot, x: info.x, y: info.y });
      return;
    }
    if (info.layer?.id?.startsWith("vessel-icon-")) {
      const v = info.object as VesselMarker;
      setHovered({ vessel: v, x: info.x, y: info.y });
      return;
    }
    const facility = info.object as FacilityProperties;
    setHovered({ facility, x: info.x, y: info.y });
  }, []);

  const handleClick = useCallback(
    (info: PickingInfo) => {
      if (!info.object) return;

      // Vessel markers and their 10-minute marks share this click handler with
      // the facility layers, but they are NOT facilities: a `VesselMarker` has
      // no `id`, `category` or `metrics`, and the drawer dereferences all
      // three. Passing one through crashed the whole page, so anything from a
      // `vessel-` layer is handled here instead.
      if (info.layer?.id?.startsWith("vessel-")) {
        const picked = info.object as VesselMarker | VesselDot;
        const isDot = info.layer?.id?.startsWith("vessel-dot") ?? false;

        // Clear any open site: the vessel card and the facility drawer are two
        // different answers to "what did I just click".
        onSelectFacility(null);
        onSelectVesselRef.current?.(picked.mmsi);

        // Clicking a mark means "show me this moment", so go there. Clicking
        // the hull means "show me this vessel's route", and the parent frames
        // the whole route at pitch 0 — zooming to 14.5 on a moored ship would
        // just fill the screen with water.
        if (isDot) {
          mapRef.current?.flyTo({
            center: picked.position,
            zoom: 15,
            duration: 1200,
            essential: true,
          });
        }
        return;
      }

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

      {/* Cursor-following tooltip — vessel marker */}
      {hovered && !selectedId && "vessel" in hovered && (
        <div
          className="pointer-events-none absolute z-30 hidden max-w-[260px] -translate-y-full rounded-xl border border-white/15 bg-slate-900/95 px-3 py-2.5 shadow-2xl backdrop-blur-md sm:block"
          style={{
            left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 0) - 280),
            top: Math.max(hovered.y - 12, 90),
          }}
        >
          <p className="text-[length:calc(13px*var(--fs))] font-semibold leading-tight text-white">
            {hovered.vessel.name}
          </p>
          <p className="mt-0.5 text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-white/45">
            {lang === "zh" ? "廢物運輸船" : "Waste carrier"}
            {hovered.vessel.mmsi ? ` · MMSI ${hovered.vessel.mmsi}` : ""}
          </p>
          <p className="mt-1.5 text-[length:calc(10px*var(--fs))] tabular-nums text-white/60">
            {hovered.vessel.position[1].toFixed(5)}, {hovered.vessel.position[0].toFixed(5)}
          </p>
          <p className="mt-0.5 text-[length:calc(10px*var(--fs))] text-white/45">
            {lang === "zh" ? "AIS 位置匯報" : "AIS report"}{" "}
            {formatVesselTime(hovered.vessel.t)}
            {hovered.vessel.sog != null && ` · ${hovered.vessel.sog.toFixed(1)} kn`}
          </p>
        </div>
      )}

      {/* Cursor-following tooltip — 10-minute mark on the route */}
      {hovered && !selectedId && "dot" in hovered && (
        <div
          className="pointer-events-none absolute z-30 hidden max-w-[260px] -translate-y-full rounded-xl border border-white/15 bg-slate-900/95 px-3 py-2.5 shadow-2xl backdrop-blur-md sm:block"
          style={{
            left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 0) - 280),
            top: Math.max(hovered.y - 12, 90),
          }}
        >
          <p className="text-[length:calc(15px*var(--fs))] font-semibold leading-tight tabular-nums text-white">
            {formatVesselTime(hovered.dot.t)}
          </p>
          <p className="mt-0.5 text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-white/45">
            {hovered.dot.name}
            {hovered.dot.mmsi ? ` · MMSI ${hovered.dot.mmsi}` : ""}
          </p>
          <p className="mt-1.5 text-[length:calc(10px*var(--fs))] tabular-nums text-white/60">
            {hovered.dot.position[1].toFixed(5)}, {hovered.dot.position[0].toFixed(5)}
          </p>
          {/* Say which two reports this position sits between. Without it the
              dot implies the ship was observed every ten minutes, which it
              was not — the reports can be forty minutes apart. */}
          <p className="mt-0.5 text-[length:calc(10px*var(--fs))] leading-snug text-white/45">
            {hovered.dot.fromT === hovered.dot.t
              ? lang === "zh"
                ? "AIS 位置匯報"
                : "AIS report"
              : lang === "zh"
                ? `介乎 ${formatVesselTime(hovered.dot.fromT)} 及 ${formatVesselTime(hovered.dot.toT)} 兩次匯報之間（內插）`
                : `Between reports at ${formatVesselTime(hovered.dot.fromT)} and ${formatVesselTime(hovered.dot.toT)} (interpolated)`}
          </p>
          {/* The rest of what the vessel was reporting at this moment. A dot is
              a data point, so it should be able to answer "how fast, which
              way, doing what" without opening anything else. */}
          <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 border-t border-white/10 pt-1.5 text-[length:calc(10px*var(--fs))] tabular-nums text-white/55">
            {hovered.dot.sog != null && (
              <span>
                <span className="text-white/35">SOG </span>
                {hovered.dot.sog.toFixed(1)} kn
              </span>
            )}
            {hovered.dot.course != null && (
              <span>
                <span className="text-white/35">COG </span>
                {Math.round(hovered.dot.course)}°
              </span>
            )}
            {navLabel(hovered.dot.nav, lang) && (
              <span className="text-white/55">{navLabel(hovered.dot.nav, lang)}</span>
            )}
          </div>
        </div>
      )}

      {/* Cursor-following tooltip — facility column */}
      {hovered && !selectedId && "facility" in hovered && (
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
