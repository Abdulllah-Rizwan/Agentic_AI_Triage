"use client";

import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface Props {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  accentColor?: string;
  trend?: number;
}

export function KPICard({ title, value, subtitle, icon: Icon, accentColor = "text-gray-500", trend }: Props) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-gray-400">{title}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <Icon size={22} className={accentColor} />
      </div>
      {trend !== undefined && (
        <div className={`mt-4 flex items-center gap-1 text-xs ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>{trend >= 0 ? "+" : ""}{trend}% from last period</span>
        </div>
      )}
    </div>
  );
}
