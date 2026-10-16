"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Info, Scale } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { WeighbridgeStation } from "@/lib/weighbridge";
import { pick, t, type Lang } from "@/lib/i18n";
import { cn, formatNumber } from "@/lib/utils";

/** One colour per delivery stream, reused by the chart and its legend. */
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
 * One colour per source district.
 *
 * Ranked rather than hashed: the palette follows the sort order, so the
 * largest source is always the same colour and no two neighbouring rows can
 * collide onto the same hue.
 */
const DISTRICT_COLORS = [
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

/** "2026-10-01" -> "01/10". */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Which scale every figure in the block is shown on. */
type Mode = "total" | "perDay";

/** One headline figure. */
function Tile({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
      <p className="text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p
        className="mt-1 flex items-baseline gap-1 text-[length:calc(17px*var(--fs))] font-bold tabular-nums leading-none"
        style={accent ? { color: accent } : undefined}
      >
        {value}
        {unit && (
          <span className="text-[length:calc(10px*var(--fs))] font-medium text-white/45">
            {unit}
          </span>
        )}
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
        return render(
          item,
          share,
          scaleToMax ? item.tonnes / maxTonnes : share,
          rank
        );
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
function SectionHeading({ label }: { label: string }) {
  return (
    <p className="mb-2 text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-white/40">
      {label}
    </p>
  );
}

/** One half of the Per day / Total switch. */
function ModeOption({
  active,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-2 py-0.5 text-[length:calc(10px*var(--fs))] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
        active ? "bg-emerald-500 text-slate-950" : "text-white/55 hover:text-white"
      )}
    >
      {label}
    </button>
  );
}

/**
 * Measured station intake from the operator's weighbridge.
 *
 * Deliberately a distinct block from the EPD facility record: EPD publishes no
 * per-facility throughput, whereas these are real per-weigh-in records. The two
 * are never mixed into one number.
 *
 * Everything in the block is shown on one scale at a time. The Per day / Total
 * switch rescales the headline tiles, the ranked lists and the chart together,
 * so a reader can never compare a period total against a daily average.
 */
export default function WeighbridgeSection({
  records,
  lang,
}: {
  records: WeighbridgeStation;
  lang: Lang;
}) {
  const { totals, period, daily, streams, wasteTypes, districts } = records;
  const [mode, setMode] = React.useState<Mode>("total");

  const perDay = mode === "perDay";
  const days = period.operatingDays || 1;
  const scale = React.useCallback((v: number) => (perDay ? v / days : v), [perDay, days]);

  const gtwWaste = wasteTypes.find((w) => w.gtw);
  const gtwStream = streams.find((s) => s.key === "gtw");
  const gtwTonnes = gtwStream?.tonnes ?? gtwWaste?.tonnes ?? 0;
  const gtwLoads = gtwStream?.loads ?? gtwWaste?.loads ?? 0;

  // Grease trap waste is its own stream and gets its own tile, so the waste-type
  // list is the MSW list and shares are taken of MSW — otherwise a list that no
  // longer contains GTW would still be measured against a total that does.
  const mswTonnes = totals.tonnes - gtwTonnes;
  const mswLoads = totals.loads - gtwLoads;

  const tonneUnit = perDay ? t("tpd", lang) : t("tonnes", lang);
  const loadUnit = perDay ? t("loadsPerDayUnit", lang) : t("loadsUnit", lang);

  /**
   * The chart is the daily intake series, and only ever that: it is the one
   * thing in the block that is a day-by-day series rather than a total or an
   * average, so the Per day / Total switch deliberately leaves it alone.
   */
  const chartData = daily;

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
          <ModeOption
            testId="wb-mode-perday"
            active={perDay}
            label={t("wbModePerDay", lang)}
            onClick={() => setMode("perDay")}
          />
          <ModeOption
            testId="wb-mode-total"
            active={!perDay}
            label={t("wbModeTotal", lang)}
            onClick={() => setMode("total")}
          />
        </div>
      </div>

      {/* Period. Operating days is its own tile below, so it is not repeated
          here. */}
      <span className="inline-block rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[length:calc(9px*var(--fs))] font-semibold uppercase tracking-wider text-emerald-200/90">
        {shortDate(period.from)}–{shortDate(period.to)}
      </span>

      {/* Headline figures. Grease trap waste is broken out because it is a
          stream of its own, not part of the municipal solid waste intake. */}
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label={t(perDay ? "wbMswPerDay" : "wbMswTotal", lang)}
          value={formatNumber(scale(mswTonnes))}
          unit={tonneUnit}
          accent="#34d399"
        />
        <Tile
          label={t(perDay ? "wbGtwPerDay" : "wbGtwTotal", lang)}
          value={formatNumber(scale(gtwTonnes))}
          unit={tonneUnit}
          accent="#f59e0b"
        />
        <Tile
          label={t(perDay ? "weighbridgeLoadsPerDay" : "weighbridgeLoads", lang)}
          value={formatNumber(scale(totals.loads))}
          unit={perDay ? t("loadsPerDayUnit", lang) : undefined}
        />
        <Tile
          label={t("weighbridgeDays", lang)}
          value={String(period.operatingDays)}
        />
      </div>

      {/* Daily intake, split by delivery stream. Unaffected by the switch —
          this is the day-by-day series, not a total or an average. */}
      <div>
        <SectionHeading label={t("weighbridgeDaily", lang)} />
        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2 pt-3">
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.07)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                interval={1}
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 9 }}
                tickFormatter={shortDate}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={46}
                domain={[0, "auto"]}
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 9 }}
                tickFormatter={(v: number) => formatNumber(v)}
              />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.2)" }}
                contentStyle={{
                  background: "rgba(15,23,42,0.96)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 10,
                  fontSize: 11,
                  padding: "8px 10px",
                }}
                labelStyle={{ color: "rgba(255,255,255,0.55)", fontSize: 10 }}
                labelFormatter={(label) => String(label)}
                formatter={(value: number, name: string) => [
                  `${formatNumber(value)} ${t("tonnes", lang)}`,
                  t(STREAM_LABEL_KEY[name as StreamKey] ?? "streamPrivate", lang),
                ]}
              />
              {STREAMS.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={STREAM_COLOR[key]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

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
            {t("wbChartDailyCaption", lang)}
          </p>
        </div>
      </div>

      {/* Who delivers it */}
      <div>
        <SectionHeading label={t("weighbridgeStreams", lang)} />
        <div data-testid="wb-streams" className="space-y-2.5">
          {streams.map((s) => (
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
        {gtwWaste && (
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
          items={wasteTypes.filter((w) => !w.gtw)}
          defaultCount={6}
          total={mswTonnes}
          scaleToMax
          lang={lang}
          testId="wb-waste-types"
          render={(w, share, barShare) => (
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
              color="#94a3b8"
            />
          )}
        />
      </div>

      {/* Source district */}
      <div>
        <SectionHeading label={t("weighbridgeDistricts", lang)} />
        <RankedList
          items={districts}
          defaultCount={6}
          total={totals.tonnes}
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
              color={DISTRICT_COLORS[rank % DISTRICT_COLORS.length]}
            />
          )}
        />
      </div>
    </section>
  );
}
