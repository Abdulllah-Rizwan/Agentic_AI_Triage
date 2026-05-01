"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getTimeseries } from "@/lib/api";
import type { TimeseriesResponse } from "@/lib/api";

type Days = 7 | 30 | 90;

interface Props {
  days: Days;
  onDaysChange: (d: Days) => void;
}

function ChartSkeleton() {
  return (
    <div className="space-y-2 pt-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-6 animate-pulse rounded bg-gray-800" style={{ width: `${60 + i * 8}%` }} />
      ))}
    </div>
  );
}

export function CasesTimelineChart({ days, onDaysChange }: Props) {
  const [data, setData] = useState<TimeseriesResponse["series"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTimeseries(days)
      .then((r) => setData(r.series))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  const formatted = data.map((d) => ({
    ...d,
    label: format(parseISO(d.date), "MMM d"),
  }));

  const toggleButtons: Days[] = [7, 30, 90];

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Cases Over Time</p>
        <div className="flex gap-1 rounded-lg border border-gray-700 p-0.5">
          {toggleButtons.map((d) => (
            <button
              key={d}
              onClick={() => onDaysChange(d)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                days === d
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <ChartSkeleton />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="label"
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#111827",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f9fafb",
                fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 12, color: "#9ca3af" }}
            />
            <Line
              type="monotone"
              dataKey="RED"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="AMBER"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="GREEN"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
