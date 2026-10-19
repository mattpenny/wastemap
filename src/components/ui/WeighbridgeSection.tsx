"use client";

import * as React from "react";
import { ChartColumn, ChartPie, ChevronDown, ChevronUp, Info, Scale } from "lucide-react";
import type { ChartRow } from "./WasteChart";
import dynamic from "next/dynamic";

// The Recharts chart is heavy and only renders inside the weighbridge card
// (which itself only appears when a station with records is selected), so it
// is lazily loaded as a separate chunk.
const WasteChart = dynamic(() => import("./WasteChart"), {
  ssr: false,
  loading: () => <div className="h-[150px]" aria-hidden />,
});

// Same reasoning for the donut: Recharts is only pulled in once the user
// actually asks for a chart, and the bar list is the default view.
const StreamPie = dynamic(() => import("./StreamPie"), {
  ssr: false,
  loading: () => <div className="h-[152px]" aria-hidden />,
});

import {
  bucketDays,
  stationYears,
  summariseStation,
  yearRange,
  type PeriodBucket,
  type WeighbridgeStation,
} from "@/lib/weighbridge";
import { pick, t, type Lang } from "@/lib/i18n";
import { cn, formatNumber } from "@/lib/utils";

// The stream colours / labels / chart series are also used by the legend and
// the delivery-stream list below, so they stay here as well as in ./WasteChart.
const STREAM_COLOR: Record<string, string> = {
  private: "#60a5fa",
  public: "#34d399",
  gtw: "#f59e0b",
};

/** Chart/tooltip series, in the order the legend reads. */
const STREAMS = ["private", "public", "gtw"] as const;

type StreamKey = (typeof STREAMS)[number];

const STREAM_LABEL_KEY: Record<StreamKey, "streamPrivate" | "streamPublic" | "streamGtw"> = {
  private: "streamPrivate",
  public: "streamPublic",
  gtw: "streamGtw",
};

/**
 * One colour per ranked row (source district and waste type).
 *
 * Ranked rather than hashed: the palette follows the sort order, so the
 * largest row is always the same colour and no two neighbouring rows can
 * collide onto the same hue.
 */
const RANK_COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#fb923c",
  "#4ade80",
  "#e879f9",
  "#38bdf8",
  "#facc15",
  "#2dd4bf",
];

const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  zh: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
};

/** "2026-10-01" -> "01/10/2026". */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-10-01" -> "01/10". */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Axis / tooltip label for a bucket key. */
function bucketLabel(key: string, bucket: PeriodBucket, lang: Lang): string {
  const months = MONTHS[lang];
  switch (bucket) {
    case "month": {
      const [y, m] = key.split("-");
      return `${months[Number(m) - 1]} ${y.slice(2)}`;
    }
    case "quarter": {
      const [y, q] = key.split("-");
      return lang === "zh" ? `${y.slice(2)}年第${q.slice(1)}季` : `${q} ${y.slice(2)}`;
    }
    case "year":
      return key;
    default:
      return shortDate(key);
  }
}

/** Which scale every figure in the block is shown on. */
type Mode = "total" | "perDay";

/** One headline figure, with its load count underneath. */
function Tile({
  label,
  value,
  unit,
  loads,
  loadsUnit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  loads: string;
  loadsUnit: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
      <p className="text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p
        className="mt-1 flex items-baseline gap-1 text-[length:calc(17px*var(--fs))] font-bold tabular-nums leading-none"
        style={{ color: accent }}
      >
        {value}
        <span className="text-[length:calc(10px*var(--fs))] font-medium text-white/45">{unit}</span>
      </p>
      <p className="mt-1.5 text-[length:calc(10px*var(--fs))] tabular-nums text-white/45">
        {loads}
        <span className="ml-1 text-[length:calc(9px*var(--fs))] text-white/35">{loadsUnit}</span>
      </p>
    </div>
  );
}

/**
 * One ranked row: a label, a proportional bar, and the tonnage.
 *
 * `share` is of the list's own denominator and is what gets printed. `barShare`
 * is what the bar is drawn from — the same number for the streams list, but a
 * fraction of the list's largest row for the waste-type and district lists, so
 * a long tail of small sources stays readable instead of collapsing to nothing.
 */
function RankedBar({
  label,
  sub,
  value,
  unit,
  loads,
  loadsUnit,
  share,
  barShare,
  color,
  highlight,
}: {
  label: string;
  sub?: string;
  value: number;
  unit: string;
  loads: number;
  loadsUnit: string;
  share: number;
  barShare: number;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "min-w-0 truncate text-[length:calc(11.5px*var(--fs))] leading-snug",
            highlight ? "font-semibold text-amber-200" : "text-white/80"
          )}
          title={sub ? `${label} — ${sub}` : label}
        >
          {label}
        </span>
        <span className="shrink-0 text-[length:calc(11px*var(--fs))] font-semibold tabular-nums text-white/70">
          {formatNumber(value)}
          <span className="ml-1 text-[length:calc(9px*var(--fs))] font-normal text-white/35">
            {unit}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(Math.max(barShare * 100, 1.5), 100)}%`, backgroundColor: color }}
          />
        </div>
        {/* w-28, not w-24: "52.2% · 427 loads/d" is the longest string the
            Per day scale produces and it ran past a 96px column. */}
        <span className="w-28 shrink-0 text-right text-[length:calc(9px*var(--fs))] tabular-nums text-white/35">
          {(share * 100).toFixed(1)}% · {formatNumber(loads)} {loadsUnit}
        </span>
      </div>
    </div>
  );
}

/** A ranked list that shows its top rows first. */
function RankedList<T extends { tonnes: number }>({
  items,
  render,
  defaultCount,
  /** Denominator for the printed share of every row. */
  total,
  /** Draw each bar against the largest row instead of against `total`. */
  scaleToMax = false,
  lang,
  testId,
}: {
  items: T[];
  render: (item: T, share: number, barShare: number, rank: number) => React.ReactNode;
  defaultCount: number;
  total: number;
  scaleToMax?: boolean;
  lang: Lang;
  testId?: string;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? items : items.slice(0, defaultCount);
  const hidden = items.length - visible.length;

  // `share` and `barShare` must be computed here, not read off Array.map's
  // index — an earlier build passed the index as the share and the bars read
  // 0%, 100%, 200%…
  const denominator = total || 1;
  const maxTonnes = items.reduce((m, i) => Math.max(m, i.tonnes), 0) || 1;

  return (
    <div data-testid={testId} className="space-y-2.5">
      {visible.map((item, rank) => {
        const share = item.tonnes / denominator;
        return render(item, share, scaleToMax ? item.tonnes / maxTonnes : share, rank);
      })}
      {(hidden > 0 || showAll) && (
        <button
          data-testid="ranked-more"
          onClick={() => setShowAll((v) => !v)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 py-1.5 text-[length:calc(10px*var(--fs))] font-semibold text-white/50 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          {showAll ? (
            <>
              <ChevronUp className="h-3 w-3" /> {t("collapse", lang)}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> +{hidden}
            </>
          )}
        </button>
      )}
    </div>
  );
}

/** Section heading with an uppercase label and a rule. */
/** Which shape the delivery-stream block is drawn in. */
type StreamChart = "bar" | "pie";

/**
 * Section label with an optional right-aligned control.
 *
 * The control sits in the same row as the heading rather than under it, so the
 * card gains a switch without gaining a line of vertical space.
 */
function SectionHeading({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </p>
      {action}
    </div>
  );
}

/** Bar / pie switch for the delivery-stream block. */
function ChartToggle({
  value,
  onChange,
  lang,
}: {
  value: StreamChart;
  onChange: (v: StreamChart) => void;
  lang: Lang;
}) {
  const options = [
    { id: "bar" as const, Icon: ChartColumn, labelKey: "wbChartBar" as const },
    { id: "pie" as const, Icon: ChartPie, labelKey: "wbChartPie" as const },
  ];
  return (
    <div
      role="group"
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.05] p-0.5"
    >
      {options.map(({ id, Icon, labelKey }) => {
        const active = value === id;
        const label = t(labelKey, lang);
        return (
          <button
            key={id}
            type="button"
            data-testid={`wb-chart-${id}`}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(id)}
            className={cn(
              "rounded-full p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
              active ? "bg-emerald-500 text-slate-950" : "text-white/45 hover:text-white/85"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/** One option in a small segmented control. */
function Chip({
  active,
  label,
  onClick,
  testId,
  disabled,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-full px-2 py-0.5 text-[length:calc(10px*var(--fs))] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
        active ? "bg-emerald-500 text-slate-950" : "text-white/55 hover:text-white",
        disabled && "cursor-not-allowed opacity-40 hover:text-white/55"
      )}
    >
      {label}
    </button>
  );
}

/** A labelled native date input, styled for the dark drawer. */
function DateField({
  label,
  value,
  min,
  max,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[length:calc(9.5px*var(--fs))] uppercase tracking-wider text-white/40">
        {label}
      </span>
      <input
        data-testid={testId}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        // `color-scheme` is what makes the native picker and its calendar icon
        // render dark instead of a white panel with a black glyph.
        className="w-full rounded-lg border border-white/12 bg-white/[0.06] px-2 py-1 text-[length:calc(10.5px*var(--fs))] tabular-nums text-white/85 [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      />
    </label>
  );
}

/**
 * Measured station intake from the operator's weighbridge.
 *
 * Deliberately a distinct block from the EPD facility record: EPD publishes no
 * per-facility throughput, whereas these are real per-weigh-in records. The two
 * are never mixed into one number.
 *
 * Everything in the block is derived from one call to `summariseStation` for
 * the selected date window, so the tiles, the chart and both ranked lists can
 * never disagree about which period they are showing. The Per day / Total
 * switch and the chart's Day/Month/Quarter/Year switch only change how those
 * same rows are presented.
 */
export default function WeighbridgeSection({
  records,
  lang,
}: {
  records: WeighbridgeStation;
  lang: Lang;
}) {
  const available = records.period;
  const [range, setRange] = React.useState({ from: available.from, to: available.to });
  const [mode, setMode] = React.useState<Mode>("total");
  const [bucket, setBucket] = React.useState<PeriodBucket>("day");
  // Pie is the default: the question the heading asks ("Who delivers it?") is a
  // proportion question, and the donut answers it at a glance. The bars are one
  // click away and carry the tonnage and load count per stream.
  const [streamChart, setStreamChart] = React.useState<StreamChart>("pie");

  const years = React.useMemo(() => stationYears(records), [records]);
  const summary = React.useMemo(
    () => summariseStation(records, range.from, range.to),
    [records, range]
  );

  const perDay = mode === "perDay";
  const days = summary.operatingDays || 1;
  const scale = React.useCallback((v: number) => (perDay ? v / days : v), [perDay, days]);

  const tonneUnit = perDay ? t("tpd", lang) : t("tonnes", lang);
  const loadUnit = perDay ? t("loadsPerDayUnit", lang) : t("loadsUnit", lang);

  const gtwWaste = records.wasteTypes.find((w) => w.gtw);
  const total = summary.tonnes || 1;

  const chartData = React.useMemo<ChartRow[]>(() => {
    const buckets = bucketDays(summary.daily, bucket);
    return buckets.map((b) => ({
      key: b.key,
      label: bucketLabel(b.key, bucket, lang),
      days: b.days,
      private: b.private,
      public: b.public,
      gtw: b.gtw,
    }));
  }, [summary.daily, bucket, lang]);

  /**
   * Slices for the donut — MSW only.
   *
   * Grease trap waste is dropped here on purpose: it is a separate stream that
   * WKTS alone accepts, and leaving it in would make the two vehicle shares
   * read as shares of a total that includes a different kind of waste. The
   * shares are therefore re-based on the MSW sum, not the card's grand total.
   */
  const pieSlices = React.useMemo(() => {
    const rows = summary.streams.filter((s) => s.key !== "gtw");
    const msw = rows.reduce((a, s) => a + s.tonnes, 0) || 1;
    return rows.map((s) => ({
      key: s.key,
      label: pick(lang, s.labelEn, s.labelZh),
      value: scale(s.tonnes),
      share: s.tonnes / msw,
      color: STREAM_COLOR[s.key] ?? "#94a3b8",
    }));
  }, [summary.streams, lang, scale]);

  const pieTotal = React.useMemo(
    () => pieSlices.reduce((a, s) => a + s.value, 0),
    [pieSlices]
  );

  const year = range.from.slice(0, 4);

  return (
    <section className="space-y-3.5 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-3.5 py-3.5">
      {/* Heading + the Per day / Total switch */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Scale className="h-4 w-4 shrink-0 text-emerald-300/80" />
          <div className="min-w-0">
            <p className="text-[length:calc(12px*var(--fs))] font-bold leading-tight text-white">
              {t("weighbridgeTitle", lang)}
            </p>
            <p className="text-[length:calc(9.5px*var(--fs))] uppercase tracking-wider text-emerald-300/70">
              {t("weighbridgeSubtitle", lang)}
            </p>
          </div>
        </div>
        <div
          data-testid="wb-mode"
          role="group"
          aria-label={`${t("wbModePerDay", lang)} / ${t("wbModeTotal", lang)}`}
          className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/12 bg-white/5 p-0.5"
        >
          <Chip
            testId="wb-mode-perday"
            active={perDay}
            label={t("wbModePerDay", lang)}
            onClick={() => setMode("perDay")}
          />
          <Chip
            testId="wb-mode-total"
            active={!perDay}
            label={t("wbModeTotal", lang)}
            onClick={() => setMode("total")}
          />
        </div>
      </div>

      {/* Period. Every figure below is derived from this window. */}
      <div
        data-testid="wb-period"
        className="space-y-2 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2.5"
      >
        <div className="grid grid-cols-2 gap-2">
          <DateField
            testId="wb-from"
            label={t("wbFrom", lang)}
            value={range.from}
            min={available.from}
            max={range.to}
            onChange={(v) => setRange((r) => ({ ...r, from: v }))}
          />
          <DateField
            testId="wb-to"
            label={t("wbTo", lang)}
            value={range.to}
            min={range.from}
            max={available.to}
            onChange={(v) => setRange((r) => ({ ...r, to: v }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <label className="flex items-center gap-1.5">
            <span className="text-[length:calc(9.5px*var(--fs))] uppercase tracking-wider text-white/40">
              {t("year", lang)}
            </span>
            <select
              data-testid="wb-year"
              value={years.includes(year) ? year : years[0]}
              onChange={(e) => {
                const next = yearRange(records, e.target.value);
                setRange(next);
              }}
              className="rounded-lg border border-white/12 bg-white/[0.06] px-1.5 py-1 text-[length:calc(10.5px*var(--fs))] tabular-nums text-white/85 [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          <span className="text-[length:calc(9.5px*var(--fs))] tabular-nums text-white/40">
            {summary.operatingDays} {t("wbDaysShort", lang)}
          </span>

          <button
            data-testid="wb-full-period"
            onClick={() => setRange({ from: available.from, to: available.to })}
            className="ml-auto rounded-full border border-white/12 px-2 py-0.5 text-[length:calc(9.5px*var(--fs))] font-semibold text-white/55 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {t("wbFullPeriod", lang)}
          </button>
        </div>

        <p className="text-[length:calc(9px*var(--fs))] text-white/35">
          {t("wbAvailable", lang)}: {longDate(available.from)} – {longDate(available.to)}
        </p>
      </div>

      {/* Headline figures. Grease trap waste is broken out because it is a
          stream of its own, not part of the municipal solid waste intake. */}
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label={t(perDay ? "wbMswPerDay" : "wbMswTotal", lang)}
          value={formatNumber(scale(summary.mswTonnes))}
          unit={tonneUnit}
          loads={formatNumber(scale(summary.mswLoads))}
          loadsUnit={loadUnit}
          accent="#34d399"
        />
        <Tile
          label={t(perDay ? "wbGtwPerDay" : "wbGtwTotal", lang)}
          value={formatNumber(scale(summary.gtwTonnes))}
          unit={tonneUnit}
          loads={formatNumber(scale(summary.gtwLoads))}
          loadsUnit={loadUnit}
          accent="#f59e0b"
        />
      </div>

      {/* Intake across the window, split by delivery stream. The bucket switch
          changes the x axis only — never the window the rest of the card is
          showing. */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-white/40">
            {t("weighbridgeDaily", lang)}
          </p>
          <div
            data-testid="wb-bucket"
            role="group"
            aria-label={t("wbGranularity", lang)}
            className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/12 bg-white/5 p-0.5"
          >
            {(["day", "month", "quarter", "year"] as PeriodBucket[]).map((b) => (
              <Chip
                key={b}
                testId={`wb-bucket-${b}`}
                active={bucket === b}
                label={t(
                  b === "day"
                    ? "wbBucketDay"
                    : b === "month"
                      ? "wbBucketMonth"
                      : b === "quarter"
                        ? "wbBucketQuarter"
                        : "wbBucketYear",
                  lang
                )}
                onClick={() => setBucket(b)}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2 pt-3">
          {chartData.length === 0 ? (
            <p className="py-8 text-center text-[length:calc(10.5px*var(--fs))] text-white/40">
              {t("wbNoData", lang)}
            </p>
          ) : (
            <WasteChart chartData={chartData} bucket={bucket} lang={lang} />
          )}

          {/* Series legend + what the line is measuring */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
            {STREAMS.map((key) => (
              <span
                key={key}
                className="flex items-center gap-1 text-[length:calc(9.5px*var(--fs))] text-white/50"
              >
                <span
                  className="h-1.5 w-3 rounded-full"
                  style={{ backgroundColor: STREAM_COLOR[key] }}
                />
                {t(STREAM_LABEL_KEY[key], lang)}
              </span>
            ))}
          </div>
          <p className="mt-1 px-1 text-[length:calc(9px*var(--fs))] leading-relaxed text-white/35">
            {t(
              bucket === "day"
                ? "wbCaptionDay"
                : bucket === "month"
                  ? "wbCaptionMonth"
                  : bucket === "quarter"
                    ? "wbCaptionQuarter"
                    : "wbCaptionYear",
              lang
            )}
          </p>
        </div>
      </div>

      {/* Who delivers it */}
      <div>
        <SectionHeading
          label={t("weighbridgeStreams", lang)}
          action={<ChartToggle value={streamChart} onChange={setStreamChart} lang={lang} />}
        />
        {streamChart === "pie" ? (
          <StreamPie
            slices={pieSlices}
            unit={tonneUnit}
            total={pieTotal}
            totalLabel={t("wbPieMsw", lang)}
            note={t("wbPieExcludesGtw", lang)}
          />
        ) : (
          <div data-testid="wb-streams" className="space-y-2.5">
            {summary.streams.map((s) => (
              <RankedBar
                key={s.key}
                label={pick(lang, s.labelEn, s.labelZh)}
                value={scale(s.tonnes)}
                unit={tonneUnit}
                loads={scale(s.loads)}
                loadsUnit={loadUnit}
                share={s.share}
                barShare={s.share}
                color={STREAM_COLOR[s.key] ?? "#94a3b8"}
                highlight={s.key === "gtw"}
              />
            ))}
          </div>
        )}
        {/* The amber note explains why GTW is a stream at all. In pie mode the
            block already says GTW is excluded, so showing both would be noise. */}
        {streamChart === "bar" && gtwWaste && summary.gtwTonnes > 0 && (
          <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-2.5 py-2">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-amber-300/80" />
            <p className="text-[length:calc(10px*var(--fs))] leading-relaxed text-amber-100/80">
              {t("weighbridgeGtwNote", lang)}
            </p>
          </div>
        )}
      </div>

      {/* Waste type — grease trap waste is excluded: it is the GTW stream
          reported above, and shares here are taken of MSW for that reason. */}
      <div>
        <SectionHeading label={t("weighbridgeWasteTypes", lang)} />
        <RankedList
          items={summary.wasteTypes.filter((w) => !w.gtw)}
          defaultCount={6}
          total={summary.mswTonnes}
          scaleToMax
          lang={lang}
          testId="wb-waste-types"
          render={(w, share, barShare, rank) => (
            <RankedBar
              key={w.code}
              label={pick(lang, w.nameEn, w.nameZh)}
              sub={w.code}
              value={scale(w.tonnes)}
              unit={tonneUnit}
              loads={scale(w.loads)}
              loadsUnit={loadUnit}
              share={share}
              barShare={barShare}
              color={RANK_COLORS[rank % RANK_COLORS.length]}
            />
          )}
        />
      </div>

      {/* Source district */}
      <div>
        <SectionHeading label={t("weighbridgeDistricts", lang)} />
        <RankedList
          items={summary.districts}
          defaultCount={6}
          total={total}
          scaleToMax
          lang={lang}
          testId="wb-districts"
          render={(d, share, barShare, rank) => (
            <RankedBar
              key={d.code}
              label={pick(lang, d.nameEn, d.nameZh)}
              sub={d.code}
              value={scale(d.tonnes)}
              unit={tonneUnit}
              loads={scale(d.loads)}
              loadsUnit={loadUnit}
              share={share}
              barShare={barShare}
              color={RANK_COLORS[rank % RANK_COLORS.length]}
            />
          )}
        />
      </div>
    </section>
  );
}
