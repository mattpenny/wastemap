"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatNumber } from "@/lib/utils";

/** One slice: an already-scaled tonnage plus its share of the MSW total. */
export interface StreamSlice {
  key: string;
  label: string;
  value: number;
  share: number;
  color: string;
}

/** Tooltip body. Hand-rolled so the slice share and the unit stay on one line. */
function PieTip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ payload?: StreamSlice }>;
  unit: string;
}) {
  const slice = active ? payload?.[0]?.payload : undefined;
  if (!slice) return null;
  return (
    <div className="rounded-[10px] border border-white/14 bg-slate-900/95 px-2.5 py-2 text-[length:calc(10px*var(--fs))]">
      <div className="flex items-center gap-1.5 text-white/80">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: slice.color }}
        />
        {slice.label}
      </div>
      <div className="mt-0.5 tabular-nums text-white">
        {formatNumber(slice.value)} {unit}
        <span className="ml-1.5 text-white/45">{Math.round(slice.share * 100)}%</span>
      </div>
    </div>
  );
}

/**
 * Delivery streams as a donut.
 *
 * Deliberately no labels on the slices: at this card width (a 26rem drawer) a
 * small slice has no room for text, and Recharts would drop or overlap it. The
 * names live in the legend underneath instead, which also keeps the colour key
 * identical to the bar list it replaces.
 *
 * The centre carries the total the slices are shares *of*, so the percentages
 * can never be read as shares of all intake — grease trap waste is excluded
 * before this component is called, and the caption says so.
 */
export default function StreamPie({
  slices,
  unit,
  total,
  totalLabel,
  note,
}: {
  slices: StreamSlice[];
  unit: string;
  total: number;
  totalLabel: string;
  note: string;
}) {
  if (slices.length === 0) return null;

  return (
    <div data-testid="wb-streams-pie">
      <div className="relative">
        <ResponsiveContainer width="100%" height={152}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="52%"
              outerRadius="82%"
              paddingAngle={2}
              stroke="none"
              // Animating a donut that swaps in on a click reads as a glitch;
              // the switch should feel instant.
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<PieTip unit={unit} />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Centre total. `inset-0` matches the 152px chart box exactly, so this
            needs no SVG maths and stays centred at any card width. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[length:calc(8px*var(--fs))] uppercase tracking-wider text-white/35">
            {totalLabel}
          </span>
          <span className="text-[length:calc(14px*var(--fs))] font-bold leading-tight tabular-nums text-white">
            {formatNumber(total)}
          </span>
          <span className="text-[length:calc(8.5px*var(--fs))] text-white/45">{unit}</span>
        </div>
      </div>

      <div
        data-testid="wb-streams-pie-legend"
        className="mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
      >
        {slices.map((s) => (
          <span
            key={s.key}
            className="flex items-center gap-1 text-[length:calc(9.5px*var(--fs))] text-white/55"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
            <span className="tabular-nums text-white/35">{Math.round(s.share * 100)}%</span>
          </span>
        ))}
      </div>

      <p className="mt-1 text-center text-[length:calc(9px*var(--fs))] leading-relaxed text-white/35">
        {note}
      </p>
    </div>
  );
}
