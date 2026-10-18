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
  Layers,
  ListFilter,
  Map as MapIcon,
  RotateCcw,
  Satellite,
  SlidersHorizontal,
} from "lucide-react";

import type { WasteMap3DHandle, WasteMap3DProps } from "@/components/map/WasteMap3D";
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
import { facilityHex, rgbaFor } from "@/lib/facilityColors";
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
   * Refuse Transfer Stations are pre-selected on first load, so the app opens
   * on a readable subset instead of all 19 sites at once. `activeGroupId`
   * derives from this, so the "RTS" quick filter shows as pressed too.
   */
  const [visibleCategories, setVisibleCategories] = useState<FacilityCategory[]>(
    GROUP_PRESETS.find((preset) => preset.id === "rts")!.categories
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
  const handleSelect = useCallback((facility: FacilityProperties | null) => {
    setSelected(facility);
  }, []);

  const handleClose = useCallback(() => setSelected(null), []);

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
   * Mobile only: whenever the user moves the map (pan / zoom / rotate), collapse
   * every floating sheet so the map is the only thing on screen. Driven by
   * WasteMap3D's `onUserMapInteract`, which fires only for real user input.
   */
  const handleUserMapInteract = useCallback(() => {
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
   * The display toolbar: font scale, map style, language, reset view.
   *
   * Rendered in two places — inside the header card on phones, and as its own
   * row beside the header from md up — but only one of the two is ever visible
   * (`md:hidden` / `hidden md:flex`), so this stays a single definition rather
   * than two copies that can drift apart.
   */
  const renderControls = () => (
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
                    {renderControls()}
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
              {renderControls()}
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
                      const accent = facilityHex(facility);
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
                    <p>{t("heightByThroughput", lang)}</p>
                    <p>{t("colourByCategory", lang)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

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
