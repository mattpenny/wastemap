"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Layers,
  ListFilter,
  Map as MapIcon,
  RotateCcw,
  Satellite,
} from "lucide-react";

import WasteMap3D, {
  type WasteMap3DHandle,
} from "@/components/map/WasteMap3D";
import type { MapStyleId } from "@/components/map/mapStyles";
import { DEFAULT_MAP_STYLE } from "@/components/map/mapStyles";
import FacilityDetailDrawer from "@/components/ui/FacilityDetailDrawer";
import TerritoryTrendCard from "@/components/ui/TerritoryTrendCard";
import MapInfoButton from "@/components/ui/MapInfoButton";
import type {
  FacilityCategory,
  FacilityProperties,
} from "@/data/waste-facilities";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { t, type Lang } from "@/lib/i18n";
import { cn, formatNumber } from "@/lib/utils";

/** Shape of a single feature as returned by `/api/waste-data`. */
interface FacilityFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: FacilityProperties;
}

interface FacilityFeatureCollection {
  type: "FeatureCollection";
  features: FacilityFeature[];
}

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

export default function HomePage() {
  const mapHandle = useRef<WasteMap3DHandle | null>(null);

  const [facilities, setFacilities] = useState<FacilityProperties[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [trendOpen, setTrendOpen] = useState(false);
  const [fontScale, setFontScale] = useState(FONT_SCALE_DEFAULT);
  /** OITF and any other grouped facilities start collapsed. */
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

  // Drive the CSS variable that every text size in the chrome multiplies by.
  useEffect(() => {
    document.documentElement.style.setProperty("--fs", String(fontScale));
  }, [fontScale]);

  // ------------------------------------------------------------------
  // Load the facility data
  // ------------------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/waste-data", {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const geojson: FacilityFeatureCollection = await res.json();

        // Trust the geometry over the duplicated property copy so the pillars
        // and the API can never disagree about where a facility is.
        const mapped = geojson.features.map((feature) => ({
          ...feature.properties,
          coordinates: feature.geometry.coordinates,
        }));

        setFacilities(mapped);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[waste-map] Failed to load facility data:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
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

    return entries.sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
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

  // Read the id out before any narrowing applies. `drawerOpen` is a const
  // derived from `selected`, so TypeScript narrows `selected` to null inside
  // the `!drawerOpen` branch below — which would make `selected?.id` a `never`.
  const selectedId = selected?.id ?? null;
  const drawerOpen = selected !== null;
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-slate-950">
      {/* ---------------- Map column ---------------- */}
      <div
        className={cn(
          "absolute inset-0 transition-[margin] duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
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
        />

        {/* ---------------- Overlay UI ---------------- */}
        <div className="pointer-events-none absolute inset-0 z-20">
          {/* Top stack. On mobile the header and the controls stack vertically
              so the toggles can never overlap the title; from md up they sit
              side by side. */}
          <div className="absolute inset-x-3 top-3 flex flex-col gap-2 md:inset-x-4 md:top-4 md:flex-row md:items-start md:justify-between">
            <header className="pointer-events-auto w-full md:max-w-md">
              <div className="rounded-2xl border border-white/12 bg-slate-900/85 p-3.5 shadow-2xl backdrop-blur-xl md:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-[length:calc(15px*var(--fs))] font-bold leading-tight text-white md:text-lg">
                      {t("appTitle", lang)}
                    </h1>
                    <p className="mt-0.5 text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-emerald-400/90">
                      {t("appSubtitle", lang)}
                    </p>
                  </div>
                </div>

                {/* Stats */}
                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/10 pt-3">
                  <StatPill label={t("facilities", lang)} value={String(stats.count)} />
                  <StatPill
                    label={t("publishedRates", lang)}
                    value={`${stats.withPublishedThroughput}/${stats.count}`}
                    accent="#10b981"
                  />
                  <StatPill
                    label={t("noSiteRate", lang)}
                    value={String(stats.withoutSiteThroughput)}
                    accent="#f59e0b"
                  />
                </div>

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

            {/* Controls — a single row on every breakpoint. */}
            <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* Font size — leftmost, so it reads as a display setting that
                  applies to everything to its right. */}
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
            </div>
          </div>

          {/* Ranking list — desktop only */}
          {ranking.length > 0 && !drawerOpen && (
            <aside
              className={cn(
                "pointer-events-auto absolute right-14 top-16 hidden w-72 flex-col overflow-hidden rounded-2xl border border-white/12 bg-slate-900/85 shadow-2xl backdrop-blur-xl lg:flex",
                // `top-16` is the same 4rem offset the zoom/compass control uses
                // (see .maplibregl-ctrl-top-right), so the two line up exactly.
                listOpen && "max-h-[min(62vh,32rem)]"
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
                    {ranking.map((entry) => {
                      /* ---- Collapsed group (e.g. the seven OITF sites) ---- */
                      if (entry.kind === "group") {
                        const meta = CATEGORY_META[entry.facilities[0].category];
                        const isExpanded = expandedGroups.includes(entry.code);
                        return (
                          <li key={entry.id}>
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
                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: meta.hex }}
                                  />
                                  <span className="truncate text-[length:calc(11.5px*var(--fs))] font-medium text-white/85">
                                    {lang === "zh" ? entry.nameZh : entry.nameEn}
                                  </span>
                                  <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[length:calc(9px*var(--fs))] font-semibold tabular-nums text-white/55">
                                    {entry.facilities.length}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  <span
                                    className="text-[length:calc(11px*var(--fs))] font-bold tabular-nums"
                                    style={{ color: meta.hex }}
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
                                      backgroundColor: meta.hex,
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
                                        <span className="truncate text-[length:calc(11px*var(--fs))] text-white/70">
                                          {lang === "zh"
                                            ? child.nameZh
                                            : child.nameEn}
                                        </span>
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
                      const meta = CATEGORY_META[facility.category];
                      const accent = meta.hex;
                      const isActive = selectedId === facility.id;
                      return (
                        <li key={entry.id}>
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
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: meta.hex }}
                                />
                                <span className="truncate text-[length:calc(11.5px*var(--fs))] font-medium text-white/85">
                                  {lang === "zh" ? facility.nameZh : facility.nameEn}
                                </span>
                              </span>
                              <span
                                className="shrink-0 text-[length:calc(11px*var(--fs))] font-bold tabular-nums"
                                style={{ color: accent }}
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
                                    backgroundColor: accent,
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

          {/* Legend + filters. Raised clear of the map "i" button in the
              bottom-left corner. */}
          <div className="pointer-events-auto absolute bottom-12 left-3 md:left-4">
            <div className="rounded-2xl border border-white/12 bg-slate-900/85 shadow-2xl backdrop-blur-xl">
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
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
                          style={{ backgroundColor: meta.hex }}
                        />
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

          {/* Map "i" — holds the imagery credit and the tech explanation that
              used to sit permanently on screen. */}
          <MapInfoButton
            lang={lang}
            mapStyle={mapStyle}
            className="pointer-events-auto absolute bottom-3 left-3 z-30"
          />

          {/* Hong Kong-wide annual trend — a panel in its own right, deliberately
              NOT a section of the facility drawer: EPD publishes no per-facility
              time series, and territory totals inside a facility card read as if
              that facility receives that waste mix. Hidden while the drawer is
              open so the two never overlap. */}
          {!drawerOpen && (
            <div className="pointer-events-auto absolute bottom-3 right-3 z-20 hidden lg:block">
              <TerritoryTrendCard
                lang={lang}
                isOpen={trendOpen}
                onToggle={() => setTrendOpen((v) => !v)}
              />
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Detail drawer ---------------- */}
      <FacilityDetailDrawer
        facility={selected}
        isOpen={drawerOpen}
        onClose={handleClose}
        lang={lang}
      />
    </main>
  );
}
