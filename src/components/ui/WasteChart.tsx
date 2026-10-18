"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { t, type Lang } from "@/lib/i18n";
import { formatNumber } from "@/lib/utils";
import type { PeriodBucket } from "@/lib/weighbridge";

/** One row of the bucketed intake series. */
export interface ChartRow {
  key: string;
  label: string;
  days: number;
  private: number;
  public: number;
  gtw: number;
}

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

export default function WasteChart({
  chartData,
  bucket,
  lang,
}: {
  chartData: ChartRow[];
  bucket: PeriodBucket;
  lang: Lang;
}) {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={12}
          tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 9 }}
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
          labelFormatter={(label, payload) => {
            const days = payload?.[0]?.payload?.days;
            // A bucket that holds fewer days than it should is partial — say
            // so rather than letting a short October read as a collapse.
            return days && bucket !== "day"
              ? `${label} · ${days} ${t("wbDaysShort", lang)}`
              : String(label);
          }}
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
            dot={bucket !== "day"}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
