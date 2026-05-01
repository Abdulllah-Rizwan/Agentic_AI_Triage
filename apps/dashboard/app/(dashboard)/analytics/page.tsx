"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Users, AlertTriangle, Clock, CheckCircle, MapPin } from "lucide-react";
import { getAnalyticsSummary, getGeoData } from "@/lib/api";
import type { SummaryResponse, GeoResponse } from "@/lib/api";
import { KPICard } from "@/components/analytics/KPICard";
import { CasesTimelineChart } from "@/components/analytics/CasesTimelineChart";
import { TopSymptomsChart } from "@/components/analytics/TopSymptomsChart";

type Days = 7 | 30 | 90;

const GeoHeatmap = dynamic(
  () => import("@/components/analytics/GeoHeatmap").then((m) => m.GeoHeatmap),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-gray-800" />,
  }
);

function KPISkeleton() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-3">
      <div className="h-4 w-28 animate-pulse rounded bg-gray-700" />
      <div className="h-8 w-20 animate-pulse rounded bg-gray-700" />
      <div className="h-3 w-36 animate-pulse rounded bg-gray-700" />
    </div>
  );
}

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [geoPoints, setGeoPoints] = useState<GeoResponse["points"]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<Days>(7);

  useEffect(() => {
    getAnalyticsSummary()
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getGeoData(days)
      .then((r) => setGeoPoints(r.points))
      .catch(() => {});
  }, [days]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-white">Analytics</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <KPISkeleton key={i} />)
        ) : (
          <>
            <KPICard
              title="Total Cases"
              value={String(summary?.total_cases ?? 0)}
              subtitle="Last 7 days"
              icon={Users}
              accentColor="text-gray-500"
            />
            <KPICard
              title="Critical Cases"
              value={String(summary?.critical_cases ?? 0)}
              subtitle="Require immediate response"
              icon={AlertTriangle}
              accentColor="text-red-500"
            />
            <KPICard
              title="Avg Response Time"
              value={`${(summary?.avg_response_time_minutes ?? 0).toFixed(1)} min`}
              subtitle="Claim to resolve"
              icon={Clock}
              accentColor="text-gray-500"
            />
            <KPICard
              title="Resolution Rate"
              value={`${Math.round(summary?.resolution_rate_percent ?? 0)}%`}
              subtitle="Cases resolved"
              icon={CheckCircle}
              accentColor="text-green-500"
            />
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3">
          <CasesTimelineChart days={days} onDaysChange={setDays} />
        </div>
        <div className="col-span-2">
          <TopSymptomsChart days={days} />
        </div>
      </div>

      {/* Geo heatmap */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4">
          <MapPin size={14} className="text-gray-500" />
          <p className="text-sm font-semibold text-white">Geographic Distribution</p>
        </div>
        <div className="h-[400px]">
          <GeoHeatmap points={geoPoints} />
        </div>
      </div>
    </div>
  );
}
