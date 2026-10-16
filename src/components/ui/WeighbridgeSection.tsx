"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Info, Scale, Truck } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { WeighbridgeStation } from "@/lib/weighbridge";
import { pick, t, type Lang } from "@/lib/i18n";
import { cn, formatNumber } from "@/lib/utils";

/** One colour per delivery stream, reused by the chart and the legend. */
const STREAM_COLOR: Record<string, string> = {
  private: "#60a5fa",
  public: "#34d399",
  gtw: "#f59e0b",
};

/** "2026-10-01" -> "01/10". */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

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
 * `share` is of total received tonnage, so the bars are directly comparable
 * across the waste-type and district lists.
 */
function RankedBar({
  label,
  sub,
  tonnes,
  loads,
  share,
  color,
  highlight,
  lang,
}: {
  label: string;
  sub?: string;
  tonnes: number;
  loads: number;
  share: number;
  color: string;
  highlight?: boolean;
  lang: Lang;
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
          {formatNumber(tonnes)}
          <span className="ml-1 text-[length:calc(9px*var(--fs))] font-normal text-white/35">
            {t("tonnes", lang)}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(share * 100, 0.6)}%`, backgroundColor: color }}
          />
        </div>
        <span className="w-24 shrink-0 text-right text-[length:calc(9px*var(--fs))] tabular-nums text-white/35">
          {(share * 100).toFixed(1)}% · {formatNumber(loads)} {t("loadsUnit", lang)}
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
  total,
  lang,
  testId,
}: {
  items: T[];
  render: (item: T, share: number) => React.ReactNode;
  defaultCount: number;
  /** Denominator for every share in this list. */
  total: number;
  lang: Lang;
  testId?: string;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? items : items.slice(0, defaultCount);
  const hidden = items.length - visible.length;

  return (
    <div data-testid={testId} className="space-y-2.5">
      {/* `share` must be computed here, not read off Array.map's index. */}
      {visible.map((item) => render(item, item.tonnes / (total || 1)))}
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

/**
 * Measured station intake from the operator's weighbridge.
 *
 * Deliberately a distinct block from the EPD figures above it: EPD publishes
 * no per-facility throughput, whereas these are real per-weigh-in records. The
 * two are never mixed into one number.
 */
export default function WeighbridgeSection({
  records,
  lang,
  publishedTpd,
}: {
  records: WeighbridgeStation;
  lang: Lang;
  /** EPD's published rate for the same station, when there is one. */
  publishedTpd?: number | null;
}) {
  const { totals, period, daily, streams, wasteTypes, districts } = records;
  const gtwWaste = wasteTypes.find((w) => w.gtw);
  const total = totals.tonnes || 1;

  // The drawer shows an EPD published rate directly above this block. Those are
  // two different kinds of number — a published rate and a measured intake —
  // so state the comparison rather than leaving the reader to guess.
  const delta =
    typeof publishedTpd === "number" && publishedTpd > 0
      ? Math.round(((totals.tonnesPerDay - publishedTpd) / publishedTpd) * 1000) / 10
      : null;

  return (
    <section className="space-y-3.5 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-3.5 py-3.5">
      {/* Heading */}
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
        <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[length:calc(9px*var(--fs))] font-semibold uppercase tracking-wider text-emerald-200/90">
          {shortDate(period.from)}–{shortDate(period.to)}
        </span>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label={t("weighbridgeTotal", lang)}
          value={formatNumber(totals.tonnes)}
          unit={t("tonnes", lang)}
          accent="#34d399"
        />
        <Tile
          label={t("weighbridgePerDay", lang)}
          value={formatNumber(totals.tonnesPerDay)}
          unit={`${t("tonnes", lang)}/d`}
          accent="#34d399"
        />
        <Tile
          label={t("weighbridgeLoads", lang)}
          value={formatNumber(totals.loads)}
        />
        <Tile
          label={t("weighbridgeDays", lang)}
          value={String(period.operatingDays)}
        />
      </div>

      {/* Measured vs published. Two different kinds of figure sitting next to
          each other, so say so explicitly rather than letting the reader
          assume the EPD rate above is a cap this is breaching. */}
      {delta !== null && (
        <p className="text-[length:calc(10px*var(--fs))] leading-relaxed text-white/50">
          {t("weighbridgeVsPublished", lang)
            .replace("{measured}", formatNumber(totals.tonnesPerDay))
            .replace("{published}", formatNumber(publishedTpd as number))
            .replace("{delta}", `${delta > 0 ? "+" : ""}${delta}%`)}
        </p>
      )}

      {/* Daily intake, stacked by delivery stream */}
      <div>
        <SectionHeading label={t("weighbridgeDaily", lang)} />
        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2 pt-3">
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={daily} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
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
                width={44}
                domain={[0, "auto"]}
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 9 }}
                tickFormatter={(v: number) => formatNumber(v)}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.06)" }}
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
                  t(name === "private" ? "streamPrivate" : name === "public" ? "streamPublic" : "streamGtw", lang),
                ]}
              />
              <Bar dataKey="private" stackId="intake" fill={STREAM_COLOR.private} />
              <Bar dataKey="public" stackId="intake" fill={STREAM_COLOR.public} />
              <Bar dataKey="gtw" stackId="intake" fill={STREAM_COLOR.gtw} />
            </BarChart>
          </ResponsiveContainer>
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
              tonnes={s.tonnes}
              loads={s.loads}
              share={s.share}
              color={STREAM_COLOR[s.key] ?? "#94a3b8"}
              highlight={s.key === "gtw"}
              lang={lang}
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

      {/* Waste type */}
      <div>
        <SectionHeading label={t("weighbridgeWasteTypes", lang)} />
        <RankedList
          items={wasteTypes}
          defaultCount={6}
          total={total}
          lang={lang}
          testId="wb-waste-types"
          render={(w, share) => (
            <RankedBar
              key={w.code}
              label={pick(lang, w.nameEn, w.nameZh)}
              sub={w.code}
              tonnes={w.tonnes}
              loads={w.loads}
              share={share}
              color={w.gtw ? STREAM_COLOR.gtw : "#94a3b8"}
              highlight={w.gtw}
              lang={lang}
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
          total={total}
          lang={lang}
          testId="wb-districts"
          render={(d, share) => (
            <RankedBar
              key={d.code}
              label={pick(lang, d.nameEn, d.nameZh)}
              sub={d.code}
              tonnes={d.tonnes}
              loads={d.loads}
              share={share}
              color="#60a5fa"
              lang={lang}
            />
          )}
        />
      </div>

      {/* Station maintenance — reported, never counted as intake */}
      {totals.maintenanceLoads > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
          <Truck className="mt-0.5 h-3 w-3 shrink-0 text-white/40" />
          <p className="text-[length:calc(10px*var(--fs))] leading-relaxed text-white/50">
            <span className="font-semibold text-white/70">
              {t("weighbridgeMaintenance", lang)}:
            </span>{" "}
            {formatNumber(totals.maintenanceTonnes)} {t("tonnes", lang)} /{" "}
            {formatNumber(totals.maintenanceLoads)} {t("loadsUnit", lang)}.{" "}
            {t("weighbridgeMaintenanceNote", lang)}
          </p>
        </div>
      )}

      {/* Provenance */}
      <p className="text-[length:calc(9.5px*var(--fs))] leading-relaxed text-white/35">
        {t("weighbridgeSourceNote", lang)}
      </p>
    </section>
  );
}
