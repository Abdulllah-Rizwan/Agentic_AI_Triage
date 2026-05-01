"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getSymptoms } from "@/lib/api";
import type { SymptomsResponse } from "@/lib/api";

interface Props {
  days: number;
}

function ChartSkeleton() {
  return (
    <div className="space-y-2 pt-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-5 animate-pulse rounded bg-gray-800"
          style={{ width: `${40 + i * 10}%` }}
        />
      ))}
    </div>
  );
}

export function TopSymptomsChart({ days }: Props) {
  const [data, setData] = useState<SymptomsResponse["symptoms"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSymptoms(days)
      .then((r) => setData(r.symptoms.slice(0, 10)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  const formatted = data.map((d) => ({
    symptom: d.symptom.length > 25 ? d.symptom.slice(0, 25) + "…" : d.symptom,
    count: d.count,
  }));

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <p className="mb-4 text-sm font-semibold text-white">Top Reported Symptoms</p>

      {loading ? (
        <ChartSkeleton />
      ) : formatted.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-gray-500">
          No symptom data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            layout="vertical"
            data={formatted}
            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="symptom"
              width={130}
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{
                backgroundColor: "#111827",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#f9fafb",
                fontSize: 12,
              }}
            />
            <Bar
              dataKey="count"
              fill="#3b82f6"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
