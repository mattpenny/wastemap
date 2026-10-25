"use client";

import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Layers,
  ListFilter,
  Map as MapIcon,
  RotateCcw,
  Satellite,
  Ship,
  SlidersHorizontal,
  X,
} from "lucide-react";

import type { WasteMap3DHandle, WasteMap3DProps } from "@/components/map/WasteMap3D";
import {
  VESSEL_TRACKS,
  parseTracks,
  reportCount,
  trackSpan,
  vesselColor,
  type VesselTrack,
} from "@/lib/vesselTracks";
import type { MapStyleId } from "@/components/map/mapStyles";
import { DEFAULT_MAP_STYLE } from "@/components/map/mapStyles";
import FacilityDetailDrawer from "@/components/ui/FacilityDetailDrawer";
import ScrollingName from "@/components/ui/ScrollingName";
import MapInfoButton from "@/components/ui/MapInfoButton";
import {
  WASTE_FACILITIES_DATA,
  type FacilityCategory,
  type FacilityProperties,
} from "@/data/waste-facilities";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { facilityHex, rankingFacilityHex, rgbaFor } from "@/lib/facilityColors";
import { t, type Lang } from "@/lib/i18n";
import type { WeighbridgeStation } from "@/lib/weighbridge";
import { loadWeighbridgeDataset } from "@/lib/weighbridgeClient";
import { cn, formatNumber } from "@/lib/utils";

// Facility data now comes from the WASTE_FACILITIES_DATA import, so the
// client needs no GeoJSON envelope.

/** Font-scale control bounds. `--fs` multiplies font sizes only. */
const FONT_SCALE_DEFAULT = 1.2;
const FONT_SCALE_MIN = 0.9;
const FONT_SCALE_MAX = 1.8;
const FONT_SCALE_STEP = 0.1;

/**
 * `datetime-local` wants local wall-clock time with no zone, e.g.
 * "2026-10-24T20:40". These two convert to and from epoch ms so the search
 * field and the map agree on which instant is meant.
 *
 * Local, not UTC: the input is inherently local — the browser's own picker
 * works in local time — so a field showing UTC while the picker shows local
 * would silently shift the window by the offset.
 */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** "24/10 20:43" — matches the map tooltips so the two can be compared. */
function formatStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The machine's UTC offset at that instant, e.g. "UTC+8".
 *
 * Printed once, in the legend, rather than on every tooltip: it makes the local
 * timestamps unambiguous to a reader in another zone without turning every
 * hover into a timezone lecture.
 */
function offsetLabel(ms: number): string {
  const off = -new Date(ms).getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `UTC${sign}${hours}${mins ? `:${String(mins).padStart(2, "0")}` : ""}`;
}

/** Quick group filters shown on the intake card. */
const GROUP_PRESETS: Array<{
  id: string;
  labelKey: "groupAll" | "groupLandfills" | "groupRts" | "groupParks";
  categories: FacilityCategory[];
}> = [
  { id: "all", labelKey: "groupAll", categories: CATEGORY_ORDER },
  { id: "landfills", labelKey: "groupLandfills", categories: ["Landfill"] },
  { id: "rts", labelKey: "groupRts", categories: ["RTS"] },
  {
    id: "parks",
    labelKey: "groupParks",
    categories: ["I-PARK", "O-PARK", "Y-PARK"],
  },
];

/** A row in the intake card: either a single facility or a collapsed group. */
type RankingEntry =
  | { kind: "facility"; id: string; facility: FacilityProperties; total: number | null }
  | {
      kind: "group";
      id: string;
      code: string;
      nameEn: string;
      nameZh: string;
      facilities: FacilityProperties[];
      total: number | null;
      totalNoteEn: string | null;
      totalNoteZh: string | null;
    };

/**
 * Category grouping order for the ranking card: RTS first, then Landfills,
 * then the parks (I/O/Y-PARK). Shared by the sort and the group separators so
 * the two can never disagree.
 */
const CATEGORY_GROUP_RANK: Record<string, number> = {
  RTS: 0,
  Landfill: 1,
  "I-PARK": 2,
  "O-PARK": 2,
  "Y-PARK": 2,
};
function groupRankOf(entry: RankingEntry): number {
  const category =
    entry.kind === "facility" ? entry.facility.category : entry.facilities[0].category;
  return CATEGORY_GROUP_RANK[category] ?? 99;
}

/** Park logos shown in the legend in place of the colour dot. */
const PARK_LOGO: Partial<Record<FacilityCategory, string>> = {
  "I-PARK": "/logos/ipark1.png",
  "O-PARK": "/logos/opark.svg",
  "Y-PARK": "/logos/ypark.png",
};

/** A small stat readout used in the header strip. */
function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {/* Sized to match the legend card's type scale, and scaled by --fs like
          everything else — the value used to be `text-sm` (rem), which ignored
          the font-size control entirely. */}
      <span className="text-[length:calc(10.5px*var(--fs))] uppercase leading-tight tracking-wide text-white/40">
        {label}
      </span>
      <span
        className="text-[length:calc(14px*var(--fs))] font-bold tabular-nums leading-tight"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Phone variant of {@link StatPill}: label and value on one baseline.
 *
 * The stacked pill is ~44px tall, and three of them cost ~44px of a 667px
 * phone — map that never comes back. On one line the same three figures fit in
 * about a third of that. Wraps to a second line if `--fs` is cranked up.
 */
function CompactStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="text-[length:calc(9.5px*var(--fs))] uppercase tracking-wide text-white/40">
        {label}
      </span>
      <span
        className="text-[length:calc(12px*var(--fs))] font-bold tabular-nums leading-none"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * One tab in the phone bottom dock.
 *
 * Icon over a short label, so three of them fit a 320px-wide bar without
 * truncating — which is exactly why the cards' full titles cannot be used here.
 */
function DockTab({
  name,
  active,
  onClick,
  icon,
  label,
}: {
  name: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      data-dock-tab={name}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // `lg:hidden`: the dock is a phone-only affordance. Its wrapper is
        // `lg:contents` on desktop, so without this the tabs would fall into
        // the overlay as loose buttons.
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 lg:hidden",
        active
          ? "bg-emerald-500/15 text-emerald-300"
          : "text-white/55 hover:bg-white/8 hover:text-white"
      )}
    >
      {icon}
      <span className="max-w-full truncate text-[length:calc(9.5px*var(--fs))] font-semibold uppercase tracking-wide">
        {label}
      </span>
    </button>
  );
}

/** Segmented control used for the map-style and language toggles. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  compact,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  ariaLabel: string;
  /** Drop the text labels below `sm`, leaving just the icons, so the whole
   *  toolbar stays on one row on narrow phones. */
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-full border border-white/12 bg-slate-900/85 p-0.5 shadow-lg backdrop-blur-xl"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          aria-label={opt.label}
          title={opt.label}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[length:calc(11px*var(--fs))] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
            value === opt.value
              ? "bg-emerald-500 text-slate-950"
              : "text-white/60 hover:bg-white/10 hover:text-white"
          )}
        >
          {opt.icon}
          <span className={compact ? "hidden sm:inline" : undefined}>
            {opt.label}
          </span>
        </button>
      ))}
    </div>
  );
}

// The map (MapLibre GL + deck.gl) is the heaviest dependency. Load it as a
// separate chunk after the UI shell paints, instead of blocking first render.
//
// We cannot use `next/dynamic` here: it does not forward refs, and this map
// exposes an imperative handle (`resetView` / `focusFacility`) through `ref`.
// So we wrap `React.lazy` — which DOES forward a ref to a `forwardRef` component
// — in our own `forwardRef` shell. That shell also gates rendering to the client
// only (the equivalent of `next/dynamic`'s `ssr: false`), since maplibre touches
// the DOM and must never execute on the server.
const WasteMap3DImpl = lazy(() => import("@/components/map/WasteMap3D"));

const WasteMap3D = forwardRef<WasteMap3DHandle, WasteMap3DProps>((props, ref) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="absolute inset-0 bg-slate-950" aria-hidden />;
  }
  return (
    <Suspense fallback={<div className="absolute inset-0 bg-slate-950" aria-hidden />}>
      <WasteMap3DImpl ref={ref} {...props} />
    </Suspense>
  );
});

export default function HomePage() {
  const mapHandle = useRef<WasteMap3DHandle | null>(null);

  // Facility data is imported directly from the source-of-truth module
  // (`src/data/waste-facilities.ts`), so it is available on the very first
  // render — no API round-trip. The `/api/waste-data` route is kept only for
  // external embedding.
  const [facilities, setFacilities] = useState<FacilityProperties[]>(() =>
    WASTE_FACILITIES_DATA.map((f) => ({ ...f }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lang, setLang] = useState<Lang>("en");
  // OpenStreetMap is the default view, matching the reference site.
  const [mapStyle, setMapStyle] = useState<MapStyleId>(DEFAULT_MAP_STYLE);
  const [selected, setSelected] = useState<FacilityProperties | null>(null);
  /**
   * All facilities are shown on first load, so the opening view reflects the
   * full system rather than a single category. `activeGroupId` derives from
   * this, so the "All facilities" quick filter shows as pressed too.
   */
  const [visibleCategories, setVisibleCategories] = useState<FacilityCategory[]>(
    GROUP_PRESETS.find((preset) => preset.id === "all")!.categories
  );
  /** Every panel starts collapsed; the map is the opening view. */
  const [legendOpen, setLegendOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  /**
   * Phone header, both collapsed by default so the opening view is the title
   * and nothing else. `headerDetailOpen` reveals the facility counts inside the
   * header card; `controlsOpen` reveals the font / map-style / language / reset
   * toolbar, which on a phone lives in the same card behind its own chevron
   * instead of occupying a whole row of map. Neither applies from md up, where
   * the figures are always shown and the toolbar is its own row beside the
   * header.
   */
  const [headerDetailOpen, setHeaderDetailOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [fontScale, setFontScale] = useState(FONT_SCALE_DEFAULT);
  /** OITF and any other grouped facilities start collapsed. */
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  /**
   * Which vessels are drawn. Empty by default: the map is a map of facilities
   * first, and the two ships are an overlay the user opts into from the vessel
   * switch beside the font-size control.
   */
  const [visibleVessels, setVisibleVessels] = useState<string[]>([]);
  /**
   * The recording being drawn.
   *
   * Starts as the snapshot bundled at build time, then is replaced by whatever
   * the app's own store has (`GET /api/vessel-tracks`) — the store accumulates
   * at runtime, so this is how a report collected five minutes ago shows up
   * without a rebuild. On a static host the store is empty and the response
   * says so, leaving the bundled snapshot in place; that is a normal outcome,
   * not a failure.
   */
  const [tracks, setTracks] = useState<VesselTrack[]>(VESSEL_TRACKS);
  /** Where the tracks came from, for the vessel card's status line. */
  const [tracksSource, setTracksSource] = useState<"bundled" | "store">("bundled");
  /** The vessel picker popover. */
  const [vesselMenuOpen, setVesselMenuOpen] = useState(false);
  /**
   * The vessel the user clicked, whose route is drawn and whose card is open.
   *
   * Null means every drawn vessel is just a marker. The route and the time
   * search belong to one vessel at a time: the card narrows one recording, so
   * drawing a second route it does not control would misrepresent the card.
   */
  const [activeVessel, setActiveVessel] = useState<string | null>(null);
  /**
   * The stretch of the recording the route is drawn for, in epoch ms. Null
   * means "the whole recording", which the collector already caps at 24 hours
   * — so the default view is the full retained day without pinning a window
   * that would go stale as soon as the page stayed open.
   */
  const [vesselWindow, setVesselWindow] = useState<
    { from: number; to: number } | null
  >(null);
  /**
   * Measured intake, keyed by station code, from `/api/station-data`. Only the
   * stations that report weighbridge data appear here; the rest simply have no
   * entry, and the drawer omits the section.
   */
  const [stationRecords, setStationRecords] = useState<
    Record<string, WeighbridgeStation>
  >({});

  // Drive the CSS variable that every text size in the chrome multiplies by.
  useEffect(() => {
    document.documentElement.style.setProperty("--fs", String(fontScale));
  }, [fontScale]);

  // ------------------------------------------------------------------
  // Load the measured station intake (operator weighbridge records)
  // ------------------------------------------------------------------
  // A separate source from the EPD facility register. Now fetched from the
  // same-origin static copy in /public (via the client loader), so there is
  // no serverless round-trip or cold start. A failure here cannot take the
  // map down with it — the weighbridge block simply does not render.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const data = await loadWeighbridgeDataset();
        if (controller.signal.aborted) return;
        setStationRecords(data.stations ?? {});
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("[waste-map] Weighbridge data unavailable:", err);
        setStationRecords({});
      }
    }

    load();
    return () => controller.abort();
  }, []);

  // ------------------------------------------------------------------
  // Load the vessel positions the app has stored
  // ------------------------------------------------------------------
  // The app owns a store (`data/vessels/tracks.json`, written by the ingest
  // API or the collector) and serves it from `/api/vessel-tracks`. The bundled
  // snapshot is already on screen by the time this resolves, so this can only
  // ever *add* data: an empty store, a 404 or a network failure leaves the
  // snapshot alone. A vessel overlay is not worth an error state.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch("/api/vessel-tracks", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          source?: string;
          vessels?: Parameters<typeof parseTracks>[0];
        };
        if (controller.signal.aborted) return;
        if (json.source !== "store" || !json.vessels?.length) return;
        const stored = parseTracks(json.vessels);
        if (stored.length === 0) return;
        setTracks(stored);
        setTracksSource("store");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.warn("[waste-map] Vessel store unavailable:", err);
      }
    }

    load();
    return () => controller.abort();
  }, []);

  // ------------------------------------------------------------------
  // Derived values
  // ------------------------------------------------------------------
  const visibleFacilities = useMemo(
    () => facilities.filter((f) => visibleCategories.includes(f.category)),
    [facilities, visibleCategories]
  );

  const stats = useMemo(() => {
    if (visibleFacilities.length === 0) {
      return { count: 0, withPublishedThroughput: 0, withoutSiteThroughput: 0 };
    }
    const withPublishedThroughput = visibleFacilities.filter(
      (f) => f.throughputTonnesPerDay !== null
    ).length;
    return {
      count: visibleFacilities.length,
      withPublishedThroughput,
      withoutSiteThroughput: visibleFacilities.length - withPublishedThroughput,
    };
  }, [visibleFacilities]);

  /**
   * Highest-throughput first — the analytics "leaderboard".
   *
   * Facilities that belong to a group (the seven Outlying Islands Transfer
   * Facilities) collapse into a SINGLE row carrying their combined total, so
   * the OITF reads as one system rather than flooding the list with seven tiny
   * entries. The group row expands to reveal its substations.
   */
  const ranking = useMemo<RankingEntry[]>(() => {
    const grouped = new Map<string, FacilityProperties[]>();
    const singles: FacilityProperties[] = [];

    for (const facility of visibleFacilities) {
      if (facility.groupCode) {
        const list = grouped.get(facility.groupCode) ?? [];
        list.push(facility);
        grouped.set(facility.groupCode, list);
      } else {
        singles.push(facility);
      }
    }

    const entries: RankingEntry[] = [
      ...singles.map((facility) => ({
        kind: "facility" as const,
        id: facility.id,
        facility,
        total: facility.throughputTonnesPerDay,
      })),
      ...[...grouped.entries()].map(([code, members]) => {
        const sorted = [...members].sort((a, b) =>
          (a.nameEn || "").localeCompare(b.nameEn || "")
        );
        const first = sorted[0];
        return {
          kind: "group" as const,
          id: `group-${code}`,
          code,
          nameEn: first.groupEn ?? code,
          nameZh: first.groupZh ?? code,
          facilities: sorted,
          total: first.groupThroughputTonnesPerDay ?? null,
          totalNoteEn: first.groupThroughputNoteEn ?? null,
          totalNoteZh: first.groupThroughputNoteZh ?? null,
        };
      }),
    ];

    // Group order: RTS first, then Landfills, then the parks (I/O/Y-PARK).
    // Within a group, highest throughput first. `total` is the published
    // throughput (MSW tonnes/day) the card already plots; nulls sort last.
    return entries.sort((a, b) => {
      const ga = groupRankOf(a);
      const gb = groupRankOf(b);
      if (ga !== gb) return ga - gb;
      return (b.total ?? -1) - (a.total ?? -1);
    });
  }, [visibleFacilities]);

  const maxRankingIntake = Math.max(1, ...ranking.map((entry) => entry.total ?? 0));

  /**
   * Which quick group filter is active. Derived from `visibleCategories` rather
   * than held separately, so the card filters and the legend checkboxes can
   * never disagree — they drive the same state.
   */
  const activeGroupId = useMemo(() => {
    const key = [...visibleCategories].sort().join("|");
    return (
      GROUP_PRESETS.find(
        (preset) => [...preset.categories].sort().join("|") === key
      )?.id ?? null
    );
  }, [visibleCategories]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  /**
   * Tracked so a map click on the already-selected facility does not re-fly
   * the camera (toggling selection off stays a no-op too — deselect happens
   * through the drawer's close button).
   */
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected]);

  /**
   * Selection from a click on the map itself. Same contract as picking a row
   * in the ranking card: the facility becomes selected AND the camera flies in
   * to it, so "click a pillar" and "click its row" behave identically.
   *
   * The map overlay shares one click handler across the facility and vessel
   * layers. A vessel marker has no `id`, and the drawer dereferences
   * `category` and `metrics`, so anything without an id is not a site — ignore
   * it rather than trusting the caller. This is what turned a stray click on a
   * ship into "a client-side exception has occurred".
   */
  const handleSelect = useCallback((facility: FacilityProperties | null) => {
    if (facility && typeof facility.id !== "string") return;
    setSelected(facility);
    if (facility && facility.id !== selectedIdRef.current) {
      mapHandle.current?.focusFacility(facility.id);
    }
  }, []);

  const handleClose = useCallback(() => setSelected(null), []);

  /**
   * A vessel was clicked on the map.
   *
   * That one gesture is the whole entry point to the route: it selects the
   * vessel, draws its route and opens the card holding the time search. There
   * is no separate route switch any more — "show me this ship's sailing" and
   * "show me when" are the same request, made by pointing at the ship.
   *
   * Clicking the same vessel again closes the card and puts it back to a plain
   * marker, so the gesture toggles instead of being a one-way door.
   *
   * The camera move is NOT issued here: `focusVessels` reads the map's vessel
   * selection, which only updates on the next render, so firing it now would
   * frame the previous selection. The effect below runs after that render.
   */
  const handleSelectVessel = useCallback(
    (mmsi: string) => {
      const next = activeVessel === mmsi ? null : mmsi;
      setActiveVessel(next);
      // A new vessel means a new recording: a window carried over from the
      // other ship's track could easily fall outside this one and show an
      // empty card for no visible reason.
      if (next !== null) setVesselWindow(null);
      // On phones the cards are one accordion above the dock, so the vessel
      // card must displace whatever sheet was open rather than stack on it.
      if (next !== null) {
        setListOpen(false);
        setLegendOpen(false);
      }
    },
    [activeVessel]
  );

  // Frame the route once it is actually on screen. `activeVessel` only changes
  // on a click, so this fires exactly when the user asks to see a route.
  useEffect(() => {
    if (activeVessel) mapHandle.current?.focusVessels();
  }, [activeVessel]);

  /** Switch one vessel on or off. */
  const toggleVessel = useCallback(
    (mmsi: string) => {
      const next = visibleVessels.includes(mmsi)
        ? visibleVessels.filter((m) => m !== mmsi)
        : [...visibleVessels, mmsi];
      setVisibleVessels(next);
      // Hiding the vessel whose route is open must close its card too —
      // otherwise the card would be searching a track that is no longer drawn.
      if (activeVessel === mmsi && !next.includes(mmsi)) setActiveVessel(null);
    },
    [visibleVessels, activeVessel]
  );

  /** All vessels on, or all off if they are already all on. */
  const toggleAllVessels = useCallback(() => {
    const all = visibleVessels.length === tracks.length;
    setVisibleVessels(all ? [] : tracks.map((v) => v.mmsi));
    if (all) setActiveVessel(null);
  }, [visibleVessels, tracks]);

  /**
   * The vessel whose card is open, and its own recorded span.
   *
   * The search is scoped to ONE vessel: its track is the only thing it can
   * narrow, so the bounds offered are that vessel's, not the union of both.
   * The union would let the user pick a window that is empty for this ship and
   * full for the other, which reads as a broken search.
   */
  const activeTrack = useMemo(
    () => tracks.find((t) => t.mmsi === activeVessel) ?? null,
    [tracks, activeVessel]
  );

  const activeSpan = useMemo(
    () => (activeTrack ? trackSpan(activeTrack) : null),
    [activeTrack]
  );

  const activeWindow = vesselWindow ?? activeSpan;

  /** Narrow or widen the search. Either bound may be moved independently. */
  const setWindowBound = useCallback(
    (which: "from" | "to", ms: number) => {
      setVesselWindow((prev) => {
        const base = prev ?? activeSpan;
        if (!base) return prev;
        const next = { ...base, [which]: ms };
        // Guard the inverted range a half-edited input produces: dragging
        // "from" past "to" should widen the window, not empty it.
        return next.from <= next.to ? next : { from: next.to, to: next.from };
      });
    },
    [activeSpan]
  );

  /**
   * How many of this vessel's reports fall inside the window.
   *
   * Shown as a count rather than a yes/no: a route drawn from three reports is
   * a very different thing from one drawn from three hundred, and the card is
   * the only place that can say so.
   */
  const reportsInWindow = useMemo(() => {
    if (!activeTrack || !activeWindow) return 0;
    return activeTrack.points.filter(
      (p) => p.t >= activeWindow.from && p.t <= activeWindow.to
    ).length;
  }, [activeTrack, activeWindow]);

  /**
   * Bottom-dock tabs (phones only).
   *
   * Below lg the three panels are mutually exclusive: they are sheets stacked
   * above one dock, so two open at once would push the map off screen. From lg
   * up they are independent cards in three different corners — exactly as
   * before — so the accordion behaviour applies only while the dock is the
   * active layout.
   */
  const toggleDockPanel = useCallback(
    (which: "list" | "legend") => {
      const accordion =
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 1023px)").matches;

      const current = which === "list" ? listOpen : legendOpen;
      const next = !current;
      const closeOthers = accordion && next;

      setListOpen(which === "list" ? next : closeOthers ? false : listOpen);
      setLegendOpen(which === "legend" ? next : closeOthers ? false : legendOpen);
    },
    [listOpen, legendOpen]
  );

  /**
   * A real user gesture on the map (pan / zoom / rotate).
   *
   * The legend collapses on **every** width: it is a reference card, and once
   * the user starts moving the map they are looking at the map, not at a list
   * of category counts. Collapsing it hands the space back, and one click
   * brings it back.
   *
   * The ranking list collapses only below `lg`. On a phone the panels are one
   * accordion above the dock, so leaving one open would cover the map the user
   * just moved; on a desktop it is a separate card in its own corner, and
   * closing it on every pan would be an unasked-for loss of context.
   *
   * The vessel card is deliberately left alone — it is the panel the user just
   * opened by clicking a ship, and panning along a route is what it is for.
   */
  const handleUserMapInteract = useCallback(() => {
    setLegendOpen(false);
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      setListOpen(false);
      setLegendOpen(false);
    }
  }, []);

  const toggleCategory = useCallback((category: FacilityCategory) => {
    setVisibleCategories((prev) => {
      const next = prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category];
      // Never leave the user with an empty map and no way back.
      return next.length === 0 ? prev : next;
    });
  }, []);

  const selectFromList = useCallback((facility: FacilityProperties) => {
    setSelected(facility);
    mapHandle.current?.focusFacility(facility.id);
  }, []);

  const toggleGroup = useCallback((code: string) => {
    setExpandedGroups((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }, []);

  const adjustFontScale = useCallback((delta: number) => {
    setFontScale((prev) => {
      const next = Math.round((prev + delta) * 100) / 100;
      return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, next));
    });
  }, []);

  /**
   * Escape closes the vessel card.
   *
   * The card is not a modal and has its own close button, so this is a
   * convenience rather than the only way out — but it is the one key a user
   * tries when a panel has taken over part of the screen.
   */
  useEffect(() => {
    if (!activeVessel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveVessel(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeVessel]);

  /**
   * The vessel picker popover closes on any pointer-down outside it. Not a
   * full modal: the map stays interactive, so a click that misses the popover
   * both dismisses it and does what the user aimed at.
   */
  useEffect(() => {
    if (!vesselMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("[data-vessel-menu]")) return;
      setVesselMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [vesselMenuOpen]);

  /**
   * The vessel picker.
   *
   * Two shapes, because the toolbar lives in two different places. From md up
   * it floats under the button it belongs to. On a phone it renders inline and
   * the header card grows to hold it: a 16rem panel anchored to a button that
   * sits near the left edge of a narrow card runs straight off the screen,
   * which is what the floating version used to do on mobile.
   */
  const renderVesselPicker = (floating: boolean) => (
    <div
      role="dialog"
      aria-label={t("vessels", lang)}
      data-testid="vessel-menu"
      data-vessel-menu
      className={cn(
        "overflow-hidden rounded-xl border border-white/12 bg-slate-900/95 shadow-2xl backdrop-blur-xl",
        floating ? "absolute right-0 top-full z-50 mt-2 w-64" : "mt-2 w-full"
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-white/50">
          {t("vessels", lang)}
        </span>
        <button
          onClick={toggleAllVessels}
          className="text-[length:calc(10px*var(--fs))] font-semibold text-emerald-300/90 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          {visibleVessels.length === tracks.length
            ? t("vesselsNone", lang)
            : t("vesselsShowAll", lang)}
        </button>
      </div>
      <div className="p-1">
        {tracks.map((track) => {
          const on = visibleVessels.includes(track.mmsi);
          return (
            <button
              key={track.mmsi}
              onClick={() => toggleVessel(track.mmsi)}
              aria-pressed={on}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                on ? "hover:bg-white/8" : "opacity-45 hover:opacity-70"
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25"
                style={{ backgroundColor: vesselColor(track.mmsi).hex }}
              />
              <span className="flex-1 truncate text-[length:calc(11.5px*var(--fs))] font-medium text-white/85">
                {track.name}
              </span>
              <span className="text-[length:calc(10px*var(--fs))] tabular-nums text-white/40">
                {track.points.length}
              </span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-white/10 px-3 py-2 text-[length:calc(9.5px*var(--fs))] leading-relaxed text-white/40">
        {t("vesselsHint", lang)}
      </p>
    </div>
  );

  /**
   * The display toolbar: font scale, vessel switch, map style, language,
   * reset view.
   *
   * Rendered in two places — inside the header card on phones, and as its own
   * row beside the header from md up — but only one of the two is ever visible
   * (`md:hidden` / `hidden md:flex`), so this stays a single definition rather
   * than two copies that can drift apart.
   *
   * `floatingPicker` is false for the phone copy: there the picker is rendered
   * inline by the header instead of floating out of the button.
   */
  const renderControls = (floatingPicker: boolean) => (
    <>
      {/* Font size — leftmost, so it reads as a display setting that applies to
          everything to its right. */}
      <div
        role="group"
        aria-label={t("fontLarger", lang)}
        className="flex items-center gap-0.5 rounded-full border border-white/12 bg-slate-900/85 p-0.5 shadow-lg backdrop-blur-xl"
      >
        <button
          onClick={() => adjustFontScale(-FONT_SCALE_STEP)}
          disabled={fontScale <= FONT_SCALE_MIN}
          aria-label={t("fontSmaller", lang)}
          title={t("fontSmaller", lang)}
          className="grid h-6 w-6 place-items-center rounded-full text-[length:calc(11px*var(--fs))] font-bold leading-none text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          A−
        </button>
        <button
          onClick={() => adjustFontScale(FONT_SCALE_STEP)}
          disabled={fontScale >= FONT_SCALE_MAX}
          aria-label={t("fontLarger", lang)}
          title={t("fontLarger", lang)}
          className="grid h-6 w-6 place-items-center rounded-full text-[length:calc(13px*var(--fs))] font-bold leading-none text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          A+
        </button>
      </div>

      {/* Vessel switch, immediately right of the font control: both are
          "what is on the map" settings, and the ships are off until asked for.
          The count is always visible so "0" reads as a state, not a missing
          button. */}
      <div className="relative" data-vessel-menu>
        <button
          onClick={() => setVesselMenuOpen((v) => !v)}
          aria-haspopup="true"
          aria-expanded={vesselMenuOpen}
          aria-label={t("vessels", lang)}
          title={t("vesselsHint", lang)}
          data-testid="vessel-toggle"
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[length:calc(11px*var(--fs))] font-semibold shadow-lg backdrop-blur-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
            visibleVessels.length > 0
              ? "border-sky-400/45 bg-sky-400/15 text-sky-100 hover:bg-sky-400/25"
              : "border-white/12 bg-slate-900/85 text-white/70 hover:bg-white/10 hover:text-white"
          )}
        >
          <Ship className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t("vessels", lang)}</span>
          <span className="tabular-nums opacity-70">{visibleVessels.length}</span>
        </button>

        {vesselMenuOpen && floatingPicker && renderVesselPicker(true)}
      </div>

      <Segmented<MapStyleId>
        ariaLabel={t("mapStyle", lang)}
        value={mapStyle}
        onChange={setMapStyle}
        compact
        options={[
          {
            value: "satellite",
            label: t("satellite", lang),
            icon: <Satellite className="h-3.5 w-3.5" />,
          },
          {
            value: "official",
            label: t("officialMap", lang),
            icon: <MapIcon className="h-3.5 w-3.5" />,
          },
        ]}
      />
      <Segmented<Lang>
        ariaLabel={t("language", lang)}
        value={lang}
        onChange={setLang}
        options={[
          { value: "en", label: "EN" },
          { value: "zh", label: "中文" },
        ]}
      />
      <button
        onClick={() => mapHandle.current?.resetView()}
        aria-label={t("resetView", lang)}
        title={t("resetView", lang)}
        className="flex items-center gap-1.5 rounded-full border border-white/12 bg-slate-900/85 px-2.5 py-1.5 text-[length:calc(11px*var(--fs))] font-semibold text-white/70 shadow-lg backdrop-blur-xl transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {/* Icon-only on narrow screens so the row never wraps. */}
        <span className="hidden lg:inline">{t("resetView", lang)}</span>
      </button>
    </>
  );

  // Read the id out before any narrowing applies. `drawerOpen` is a const
  // derived from `selected`, so TypeScript narrows `selected` to null inside
  // the `!drawerOpen` branch below — which would make `selected?.id` a `never`.
  const selectedId = selected?.id ?? null;
  const drawerOpen = selected !== null;

  /**
   * Weighbridge records for whichever station is open, if it reports any.
   *
   * Matched on the station's `facilityId` rather than its name, so renaming a
   * facility cannot silently detach its data.
   */
  const selectedStationRecords = useMemo<WeighbridgeStation | null>(() => {
    if (!selectedId) return null;
    for (const station of Object.values(stationRecords)) {
      if (station.facilityId === selectedId) return station;
    }
    return null;
  }, [selectedId, stationRecords]);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-slate-950">
      {/* ---------------- Map column ---------------- */}
      <div
        className={cn(
          // No margin transition here on purpose. When the drawer opens this
          // element's width changes and the ResizeObserver in WasteMap3D calls
          // map.resize(). A CSS margin animation fires that observer on every
          // frame for 300ms, and each WebGL buffer realloc flashes the map —
          // worst right after a zoom, when many deep-zoom tiles are resident.
          // Keep the change instantaneous so it is one clean resize, not a
          // per-frame realloc storm.
          "absolute inset-0",
          drawerOpen && "lg:mr-[26rem]"
        )}
      >
        <WasteMap3D
          ref={mapHandle}
          facilities={facilities}
          selectedId={selected?.id ?? null}
          onSelectFacility={handleSelect}
          mapStyle={mapStyle}
          lang={lang}
          visibleCategories={visibleCategories}
          vesselTracks={tracks}
          activeVesselMmsi={activeVessel}
          visibleVesselMmsis={visibleVessels}
          vesselWindow={activeWindow}
          onSelectVessel={handleSelectVessel}
          emptyHint={!loading && visibleFacilities.length === 0}
          onUserMapInteract={handleUserMapInteract}
        />

        {/* ---------------- Overlay UI ---------------- */}
        <div className="pointer-events-none absolute inset-0 z-20">
          {/* Top stack. On phones the header is the only thing up here: the
              display toolbar lives inside the header card, behind its own
              chevron, instead of taking a row of its own. From md up the two
              sit side by side, exactly as before. Phone spacing is tight
              (top-2 / gap-1.5) because every pixel here is map. */}
          <div className="absolute inset-x-3 top-2 flex flex-col gap-1.5 md:inset-x-4 md:top-4 md:flex-row md:items-start md:justify-between md:gap-2">
            <header className="pointer-events-auto w-full md:max-w-md">
              <div className="rounded-2xl border border-white/12 bg-slate-900/85 p-2.5 shadow-2xl backdrop-blur-xl md:p-4">
                {/* The title must stay on ONE line on phones. Measured: its
                    rendered width is 19 x font-size, and the space inside the
                    card is viewport - 44px, so 15px * 1.2 (= 18px, 342px wide)
                    overflows anything under ~412px. Below md the size is
                    therefore capped by 100vw * 0.043 — which keeps it on one
                    line down to 320px wide — while still responding to A- / A+.
                    It sits on a line of its own precisely so that the two
                    disclosure controls below cannot steal width from it. From
                    md up the header is wide enough and the original sizing
                    returns. */}
                <h1 className="whitespace-nowrap text-[length:clamp(11px,calc(15px*var(--fs)),calc(100vw*0.043))] font-bold leading-tight text-white md:text-lg">
                  {t("appTitle", lang)}
                </h1>

                {/* Subtitle line. From md up it is just the subtitle. On a
                    phone the subtitle carries the chevron that opens the
                    facility figures, and the right end of the line carries the
                    display-controls pill. */}
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-0.5">
                    <p className="truncate text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-emerald-400/90">
                      {t("appSubtitle", lang)}
                    </p>
                  </div>

                  {/* Display toolbar, collapsed to this pill by default on
                      phones. `md:hidden` because from md up the toolbar is its
                      own row beside the header, rendered below. */}
                  <button
                    type="button"
                    data-testid="display-toggle"
                    onClick={() => setControlsOpen((v) => !v)}
                    aria-expanded={controlsOpen}
                    aria-label={t("displayOptions", lang)}
                    title={t("displayOptions", lang)}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full border border-white/12 bg-slate-900/85 px-2 py-1 text-white/60 shadow-lg backdrop-blur-xl transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 md:hidden",
                      controlsOpen && "bg-white/10 text-white"
                    )}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {controlsOpen ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                </div>

                {/* Display toolbar, phone only, behind the pill above. */}
                {controlsOpen && (
                  <div
                    data-testid="display-toolbar-phone"
                    className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2 md:hidden"
                  >
                    {renderControls(false)}
                    {/* Inline, not floating: the card grows to fit the picker
                        rather than letting it hang off the screen edge. */}
                    {vesselMenuOpen && renderVesselPicker(false)}
                  </div>
                )}

                {error && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                    <div className="min-w-0 text-[length:calc(11px*var(--fs))] leading-snug text-red-200/90">
                      <p className="font-semibold">{t("loadError", lang)}</p>
                      <p className="text-red-200/70">{error}</p>
                    </div>
                  </div>
                )}
              </div>
            </header>

            {/* Display toolbar. Its own row beside the header from md up; on
                phones the whole block is hidden, because the toolbar lives
                inside the header card behind its own pill instead. */}
            <div
              data-testid="display-toolbar"
              className="pointer-events-auto hidden flex-wrap items-center gap-1.5 sm:gap-2 md:flex"
            >
              {renderControls(true)}
            </div>
          </div>

          {/* Bottom area. Two completely different layouts share these cards.
              Phones (< lg): a dock pinned flush to the bottom edge — three short
              tabs plus the map "i" button. Only the active panel is shown, as a
              sheet sitting directly on top of the dock. Three always-on cards
              plus the old 48px gap cost ~190px of a 667px screen, which left the
              map barely half the viewport; the dock costs ~44px and hands back
              roughly 150px.
              Desktop (lg+): `lg:contents` dissolves the dock wrapper, so the
              info button inside falls back to the bottom-left corner and each
              card returns to its own corner of the map via `lg:absolute`. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col lg:static lg:z-20 lg:block">

          {/* Ranking list. A sheet above the dock on phones; its own top-right
              card from lg up. */}
          {ranking.length > 0 && !drawerOpen && (
            <aside
              data-testid="ranking-sheet"
              className={cn(
                "pointer-events-auto w-full flex-col overflow-hidden border border-white/12 bg-slate-900/85 shadow-2xl backdrop-blur-xl",
                // Phone: a sheet that exists only while its tab is active, so
                // the map is never covered by a panel nobody opened. The bottom
                // edge is square and borderless because the dock sits flush
                // underneath it.
                listOpen
                  ? "flex max-h-[46vh] rounded-t-2xl border-b-0"
                  : "hidden",
                // Desktop: its own card, back at the top under the display
                // toolbar (the user reverted the centred placement).
                "lg:absolute lg:right-14 lg:top-16 lg:flex lg:w-72 lg:rounded-2xl lg:border-b",
                listOpen && "lg:max-h-[min(62vh,32rem)]"
              )}
            >
              <button
                onClick={() => setListOpen((v) => !v)}
                aria-expanded={listOpen}
                aria-label={t(listOpen ? "collapse" : "expand", lang)}
                title={t(listOpen ? "collapse" : "expand", lang)}
                className="flex shrink-0 items-center justify-between border-b border-white/10 px-3.5 py-2.5 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <span className="flex items-center gap-1.5 text-[length:calc(11px*var(--fs))] font-semibold uppercase tracking-wider text-white/70">
                  <Layers className="h-3.5 w-3.5 text-emerald-400" />
                  {t("intakeRanking", lang)}
                </span>
                {listOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-white/40" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
                )}
              </button>

              {listOpen && (
                <>
                  {/* Quick group filters. These drive the same state as the
                      legend checkboxes, so the card and the legend can never
                      disagree. */}
                  <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2.5 py-2">
                    {GROUP_PRESETS.map((preset) => {
                      const isActive = activeGroupId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => setVisibleCategories(preset.categories)}
                          aria-pressed={isActive}
                          className={cn(
                            "flex-1 whitespace-nowrap rounded-full px-1.5 py-1 text-[length:calc(10px*var(--fs))] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                            isActive
                              ? "bg-emerald-500 text-slate-950"
                              : "text-white/55 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          {t(preset.labelKey, lang)}
                        </button>
                      );
                    })}
                  </div>

                  <ul className="thin-scrollbar flex-1 overflow-y-auto p-1.5">
                    {ranking.map((entry, index) => {
                      const showGroupDivider =
                        index > 0 && groupRankOf(entry) !== groupRankOf(ranking[index - 1]);
                      /* ---- Collapsed group (e.g. the seven OITF sites) ---- */
                      if (entry.kind === "group") {
                        const meta = CATEGORY_META[entry.facilities[0].category];
                        const groupAccent = facilityHex(entry.facilities[0]);
                        const isExpanded = expandedGroups.includes(entry.code);
                        return (
                          <li
                            key={entry.id}
                            className={cn(showGroupDivider && "mt-2 border-t-2 border-white/20 pt-2")}
                          >
                            <button
                              onClick={(e) => {
                                const li = e.currentTarget.closest("li");
                                toggleGroup(entry.code);
                                // The OITF has the smallest total so it sorts to
                                // the bottom; expanding it would push the
                                // substations below the fold. Bring them in.
                                if (!isExpanded && li) {
                                  window.setTimeout(
                                    () =>
                                      li.scrollIntoView({
                                        block: "nearest",
                                        behavior: "smooth",
                                      }),
                                    60
                                  );
                                }
                              }}
                              aria-expanded={isExpanded}
                              aria-label={t(
                                isExpanded ? "collapseGroup" : "expandGroup",
                                lang
                              )}
                              title={t(
                                isExpanded ? "collapseGroup" : "expandGroup",
                                lang
                              )}
                              className="w-full rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/20"
                                    style={{ backgroundColor: groupAccent }}
                                  />
                                  <ScrollingName
                                    className="text-[length:calc(11.5px*var(--fs))] font-medium text-white/85"
                                    text={lang === "zh" ? entry.nameZh : entry.nameEn}
                                  />
                                  <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[length:calc(9px*var(--fs))] font-semibold tabular-nums text-white/55">
                                    {entry.facilities.length}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  <span
                                    className="text-[length:calc(11px*var(--fs))] font-bold tabular-nums text-white/85"
                                    title={
                                      lang === "zh"
                                        ? entry.totalNoteZh ?? undefined
                                        : entry.totalNoteEn ?? undefined
                                    }
                                  >
                                    {entry.total === null
                                      ? t("notPublished", lang)
                                      : `~${formatNumber(entry.total)}`}
                                  </span>
                                  {isExpanded ? (
                                    <ChevronUp className="h-3 w-3 text-white/40" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3 text-white/40" />
                                  )}
                                </span>
                              </div>
                              {entry.totalNoteEn && (
                                <p className="mt-1 text-[length:calc(9px*var(--fs))] leading-snug text-white/40">
                                  {lang === "zh" ? entry.totalNoteZh : entry.totalNoteEn}
                                </p>
                              )}
                              {entry.total !== null && (
                                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/8">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${(entry.total / maxRankingIntake) * 100}%`,
                                      backgroundColor: rgbaFor(groupAccent, 0.6),
                                    }}
                                  />
                                </div>
                              )}
                            </button>

                            {/* Substations, revealed on demand */}
                            {isExpanded && (
                              <ul className="ml-3.5 mt-0.5 space-y-0.5 border-l border-white/12 pl-2">
                                {entry.facilities.map((child) => {
                                  const isActive = selectedId === child.id;
                                  return (
                                    <li key={child.id}>
                                      <button
                                        onClick={() => selectFromList(child)}
                                        className={cn(
                                          "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                                          isActive
                                            ? "bg-white/12"
                                            : "hover:bg-white/[0.07]"
                                        )}
                                      >
                                        <ScrollingName
                                          className="text-[length:calc(11px*var(--fs))] text-white/70"
                                          text={
                                            lang === "zh"
                                              ? child.nameZh
                                              : child.nameEn
                                          }
                                        />
                                        <span className="shrink-0 text-[length:calc(10px*var(--fs))] font-semibold tabular-nums text-white/50">
                                          {child.throughputTonnesPerDay === null
                                            ? t("notPublished", lang)
                                            : formatNumber(child.throughputTonnesPerDay)}
                                        </span>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      }

                      /* ---------------- Single facility ---------------- */
                      const facility = entry.facility;
                      const accent = rankingFacilityHex(facility);
                      const isActive = selectedId === facility.id;
                      return (
                        <li
                          key={entry.id}
                          className={cn(showGroupDivider && "mt-2 border-t-2 border-white/20 pt-2")}
                        >
                          <button
                            onClick={() => selectFromList(facility)}
                            className={cn(
                              "w-full rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                              isActive ? "bg-white/12" : "hover:bg-white/[0.07]"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/20"
                                  style={{ backgroundColor: accent }}
                                />
                                <ScrollingName
                                  className="text-[length:calc(11.5px*var(--fs))] font-medium text-white/85"
                                  text={lang === "zh" ? facility.nameZh : facility.nameEn}
                                />
                              </span>
                              <span
                                className="shrink-0 text-[length:calc(11px*var(--fs))] font-bold tabular-nums text-white/85"
                                title={
                                  lang === "zh"
                                    ? facility.throughputNoteZh ?? undefined
                                    : facility.throughputNoteEn ?? undefined
                                }
                              >
                                {facility.throughputTonnesPerDay === null
                                  ? t("notPublished", lang)
                                  : formatNumber(facility.throughputTonnesPerDay)}
                              </span>
                            </div>
                            {entry.total !== null && (
                              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/8">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${(entry.total / maxRankingIntake) * 100}%`,
                                    backgroundColor: rgbaFor(accent, 0.6),
                                  }}
                                />
                              </div>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </aside>
          )}

          {/* Legend + filters. A sheet above the dock on phones; pinned to the
              bottom-left from lg up. No width class on the wrapper: it is a
              full-width sheet on phones, and shrink-wraps to the card once it
              goes absolute at lg. */}
          <div
            data-testid="legend-sheet"
            className={cn(
              "pointer-events-auto w-full",
              legendOpen ? "block" : "hidden",
              "lg:absolute lg:bottom-4 lg:left-4 lg:block lg:w-auto"
            )}
          >
            <div className="max-h-[46vh] overflow-y-auto rounded-t-2xl border border-b-0 border-white/12 bg-slate-900/85 shadow-2xl backdrop-blur-xl lg:max-h-none lg:rounded-2xl lg:border-b">
              <button
                onClick={() => setLegendOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-4 px-3.5 py-2.5 text-left"
              >
                <span className="flex items-center gap-1.5 text-[length:calc(11px*var(--fs))] font-semibold uppercase tracking-wider text-white/70">
                  <ListFilter className="h-3.5 w-3.5 text-emerald-400" />
                  {t("legend", lang)}
                </span>
                {legendOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-white/40" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-white/40" />
                )}
              </button>

              {legendOpen && (
                <div className="space-y-1 border-t border-white/10 px-2 py-2">
                  {/* The vessel route no longer lives here. It is opened by
                      clicking a ship on the map, which brings up a card with
                      that vessel's time search — see `vesselCard` below. A
                      route switch in the legend asked the user to turn on a
                      layer and then hunt for the ship it belonged to. */}

                  {CATEGORY_ORDER.map((category) => {
                    const meta = CATEGORY_META[category];
                    const active = visibleCategories.includes(category);
                    const count = facilities.filter(
                      (f) => f.category === category
                    ).length;
                    return (
                      <button
                        key={category}
                        onClick={() => toggleCategory(category)}
                        aria-pressed={active}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                          active ? "hover:bg-white/8" : "opacity-40 hover:opacity-70"
                        )}
                      >
                        {PARK_LOGO[category] ? (
                          <img
                            src={PARK_LOGO[category]}
                            alt=""
                            className="h-4 w-auto max-w-[2.75rem] shrink-0 object-contain"
                          />
                        ) : (
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
                            style={{ backgroundColor: meta.hex }}
                          />
                        )}
                        <span className="flex-1 truncate text-[length:calc(11.5px*var(--fs))] font-medium text-white/85">
                          {lang === "zh" ? meta.labelZh : meta.labelEn}
                        </span>
                        <span className="text-[length:calc(10px*var(--fs))] tabular-nums text-white/40">
                          {count}
                        </span>
                      </button>
                    );
                  })}

                  <div className="mt-1 space-y-0.5 border-t border-white/10 px-2 pb-1 pt-2 text-[length:calc(9.5px*var(--fs))] leading-relaxed text-white/40">
                    <p>{t("legendPillarNote", lang)}</p>
                    {tracks.length > 0 && visibleVessels.length === 0 && (
                      <p>
                        {lang === "zh"
                          ? "船隻預設隱藏。用字體大小旁邊的船隻按鈕選擇要顯示的船隻，再點擊海上的船查看它的航行紀錄。"
                          : "Vessels are off by default. Pick one with the vessel switch beside the font size control, then click the ship on the map to see its sailing record."}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Vessel card. Opened by clicking a ship on the map, and the only
              place the route and its time search live now — a route switch in
              the legend asked the user to turn on a layer and then find the
              ship it belonged to. Closed by clicking the ship again, by the
              close button, or by Escape.

              Phones: a sheet above the dock, in the same slot as the ranking
              and legend sheets (which `handleSelectVessel` closes, because the
              dock shows one panel at a time). Desktop: a card at the bottom
              centre, clear of the legend on the left and the info button on
              the right. */}
          {activeVessel && activeTrack && (
            <div
              data-testid="vessel-card"
              className="pointer-events-auto w-full lg:absolute lg:bottom-4 lg:left-1/2 lg:w-[24rem] lg:-translate-x-1/2"
            >
              <div className="max-h-[46vh] overflow-y-auto rounded-t-2xl border border-b-0 border-white/12 bg-slate-900/90 shadow-2xl backdrop-blur-xl lg:max-h-none lg:rounded-2xl lg:border-b">
                <div className="flex items-start gap-2 border-b border-white/10 px-3.5 py-2.5">
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25"
                    style={{ backgroundColor: vesselColor(activeVessel).hex }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[length:calc(12px*var(--fs))] font-semibold leading-tight text-white">
                      {activeTrack.name}
                    </p>
                    <p className="mt-0.5 text-[length:calc(9.5px*var(--fs))] uppercase tracking-wider text-white/40">
                      MMSI {activeVessel}
                      {activeTrack.imo ? ` · IMO ${activeTrack.imo}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveVessel(null)}
                    aria-label={t("close", lang)}
                    title={t("close", lang)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="px-3 pb-2.5 pt-2">
                  <div className="flex items-center gap-1.5 pb-1">
                    <Clock className="h-3 w-3 shrink-0 text-white/35" />
                    <span className="text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-white/45">
                      {t("timeSearch", lang)}
                    </span>
                    <button
                      onClick={() => setVesselWindow(null)}
                      disabled={vesselWindow === null}
                      className="ml-auto rounded px-1 text-[length:calc(9.5px*var(--fs))] font-semibold text-emerald-300/80 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:opacity-30 disabled:hover:text-emerald-300/80"
                    >
                      {t("timeReset", lang)}
                    </button>
                  </div>

                  {/* Inline — label beside field. Two half-width fields leave
                      most of each row empty and make the card much taller than
                      the two timestamps it holds. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {activeWindow &&
                      (
                        [
                          ["from", t("timeFrom", lang), activeWindow.from],
                          ["to", t("timeTo", lang), activeWindow.to],
                        ] as const
                      ).map(([which, label, value]) => (
                        <label key={which} className="flex items-center gap-1">
                          <span className="text-[length:calc(9.5px*var(--fs))] text-white/40">
                            {label}
                          </span>
                          <input
                            type="datetime-local"
                            value={toLocalInput(value)}
                            // Bounded to this vessel's own recording: a window
                            // outside it can only ever be empty, so the control
                            // should not offer it.
                            min={activeSpan ? toLocalInput(activeSpan.from) : undefined}
                            max={activeSpan ? toLocalInput(activeSpan.to) : undefined}
                            onChange={(e) => {
                              const ms = fromLocalInput(e.target.value);
                              if (ms !== null) setWindowBound(which, ms);
                            }}
                            className="w-[8.6rem] rounded-md border border-white/12 bg-slate-800/70 px-1.5 py-0.5 text-[length:calc(10px*var(--fs))] tabular-nums text-white/85 [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                          />
                        </label>
                      ))}
                  </div>

                  {reportsInWindow === 0 ? (
                    <p className="mt-1 text-[length:calc(9.5px*var(--fs))] text-amber-300/80">
                      {t("timeEmpty", lang)}
                    </p>
                  ) : (
                    activeSpan && (
                      <p className="mt-1 text-[length:calc(9.5px*var(--fs))] tabular-nums leading-relaxed text-white/40">
                        {lang === "zh"
                          ? `${reportsInWindow} 次 AIS 匯報　·　${formatStamp(activeSpan.from)} – ${formatStamp(activeSpan.to)}（${offsetLabel(activeSpan.from)}）`
                          : `${reportsInWindow} AIS report${reportsInWindow === 1 ? "" : "s"} · ${formatStamp(activeSpan.from)} – ${formatStamp(activeSpan.to)} (${offsetLabel(activeSpan.from)})`}
                      </p>
                    )
                  )}

                  <p className="mt-1 text-[length:calc(9.5px*var(--fs))] leading-relaxed text-white/35">
                    {lang === "zh"
                      ? "圓點每 10 分鐘一個，滑鼠移上去可看該時刻的位置、速度、航向與狀態。匯報之間的位置是內插值。"
                      : "Dots mark every 10 minutes — hover one for its position, speed, course and status. Between reports the position is interpolated."}
                  </p>

                  {/* Where the data came from. Not decoration: it is the
                      difference between "a report collected a minute ago" and
                      "the snapshot this build shipped with". */}
                  <p className="mt-1 flex items-center gap-1 text-[length:calc(9px*var(--fs))] text-white/30">
                    <Database className="h-2.5 w-2.5 shrink-0" />
                    {tracksSource === "store"
                      ? lang === "zh"
                        ? "來自應用程式儲存的資料"
                        : "From the app's stored data"
                      : lang === "zh"
                        ? "來自建置時的資料快照"
                        : "From the snapshot bundled at build time"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Dock — phones only. Two short tabs plus the map "i" button.
              `lg:contents` dissolves this wrapper on desktop, which drops the
              info button back into the bottom-left corner (it carries
              `lg:absolute` of its own) and leaves the cards to their own
              corners. */}
          <div
            data-testid="bottom-dock"
            className="pointer-events-auto flex items-stretch gap-1 border-t border-white/10 bg-slate-900/90 px-2 pb-2 pt-1.5 backdrop-blur-xl lg:contents"
          >
            <DockTab
              name="list"
              active={listOpen}
              onClick={() => toggleDockPanel("list")}
              icon={<Layers className="h-4 w-4" />}
              label={t("dockFacility", lang)}
            />
            <DockTab
              name="legend"
              active={legendOpen}
              onClick={() => toggleDockPanel("legend")}
              icon={<ListFilter className="h-4 w-4" />}
              label={t("dockLegend", lang)}
            />
            {/* Map "i" — holds the imagery credit and the tech explanation that
                used to sit permanently on screen. Sits at the right end of the
                dock on phones (spaced by the dock's own `gap-1`), and back in
                the bottom-right corner from lg up. */}
            <MapInfoButton
              lang={lang}
              mapStyle={mapStyle}
              className="flex w-11 shrink-0 items-center justify-center lg:absolute lg:bottom-4 lg:right-4 lg:z-30"
            />
          </div>
          </div>
        </div>
      </div>

      {/* ---------------- Detail drawer ---------------- */}
      <FacilityDetailDrawer
        facility={selected}
        isOpen={drawerOpen}
        onClose={handleClose}
        lang={lang}
        weighbridge={selectedStationRecords}
      />
    </main>
  );
}
