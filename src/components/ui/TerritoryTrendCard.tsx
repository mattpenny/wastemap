"use client";

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronUp, TrendingUp } from "lucide-react";

import { HK_WASTE_TREND } from "@/data/hk-waste-trend";
import { t, type Lang } from "@/lib/i18n";
import { formatNumber } from "@/lib/utils";

interface TerritoryTrendCardProps {
  lang: Lang;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Hong Kong-wide annual waste disposal, 2009–2024 (EPD territory-level CSVs).
 *
 * This is deliberately its OWN panel rather than a section inside the facility
 * drawer: EPD publishes no per-facility time series, and territory-level totals
 * placed inside a facility card read as if that facility receives that mix of
 * waste. Keeping it separate makes the scope unmistakable.
 */
export default function TerritoryTrendCard({
  lang,
  isOpen,
  onToggle,
}: TerritoryTrendCardProps) {
  return (
    <div className="w-72 overflow-hidden rounded-2xl border border-white/12 bg-slate-900/85 shadow-2xl backdrop-blur-xl">
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={t(isOpen ? "collapse" : "expand", lang)}
        title={t(isOpen ? "collapse" : "expand", lang)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[length:calc(11px*var(--fs))] font-semibold uppercase tracking-wider text-white/70">
          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span className="truncate">{t("territoryTrend", lang)}</span>
        </span>
        {isOpen ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-white/40" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-white/10 px-3.5 pb-3 pt-2.5">
          <p className="mb-2 text-[length:calc(10px*var(--fs))] leading-snug text-white/50">
            {t("hkWideTrendSub", lang)}
          </p>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2 pt-3">
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart
                data={HK_WASTE_TREND}
                margin={{ top: 6, right: 10, left: -14, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
                <XAxis
                  dataKey="year"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  domain={[0, "auto"]}
                  tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
                  tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(0)}m`}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(255,255,255,0.25)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "rgba(15,23,42,0.96)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 10,
                    fontSize: 11,
                    padding: "8px 10px",
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.55)", fontSize: 10 }}
                  formatter={(value: number, name: string) => [
                    `${formatNumber(value)} ${t("tonnesPerYear", lang)}`,
                    t(name as "mswDisposed" | "constructionDisposed" | "specialDisposed" | "mswGenerated", lang),
                  ]}
                  labelFormatter={(label) => `${t("year", lang)} ${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="mswDisposedTonnes"
                  name="mswDisposed"
                  stackId="disposed"
                  stroke="#34d399"
                  fill="#34d399"
                  fillOpacity={0.55}
                />
                <Area
                  type="monotone"
                  dataKey="constructionDisposedTonnes"
                  name="constructionDisposed"
                  stackId="disposed"
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.5}
                />
                <Area
                  type="monotone"
                  dataKey="specialDisposedTonnes"
                  name="specialDisposed"
                  stackId="disposed"
                  stroke="#a78bfa"
                  fill="#a78bfa"
                  fillOpacity={0.55}
                />
                <Line
                  type="monotone"
                  dataKey="mswGeneratedTonnes"
                  name="mswGenerated"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-2 text-[length:calc(9px*var(--fs))] text-white/45">
              <span className="text-emerald-300">■ {t("mswDisposed", lang)}</span>
              <span className="text-amber-300">■ {t("constructionDisposed", lang)}</span>
              <span className="text-violet-300">■ {t("specialDisposed", lang)}</span>
              <span className="text-sky-300">— {t("mswGenerated", lang)}</span>
            </div>
          </div>
          <p className="mt-2 text-[length:calc(9.5px*var(--fs))] leading-relaxed text-white/40">
            {t("noFacilityHistory", lang)}
          </p>
        </div>
      )}
    </div>
  );
}
