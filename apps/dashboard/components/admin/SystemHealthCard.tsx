"use client";

import { CheckCircle, XCircle } from "lucide-react";

interface Props {
  label: string;
  status: "ok" | "down";
  value?: string;
  lastChecked: string;
}

export function SystemHealthCard({ label, status, value, lastChecked }: Props) {
  const ok = status === "ok";

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-gray-900 p-5 ${
        ok ? "border-gray-800" : "border-red-900/60"
      }`}
    >
      {/* Coloured left accent bar */}
      <div
        className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${
          ok ? "bg-green-500" : "bg-red-500"
        }`}
      />

      <div className="ml-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white">{label}</p>
          {ok ? (
            <CheckCircle size={18} className="text-green-400" />
          ) : (
            <XCircle size={18} className="text-red-400" />
          )}
        </div>

        <p className={`text-xs font-medium ${ok ? "text-green-400" : "text-red-400"}`}>
          {ok ? (value ?? "Operational") : "Down"}
        </p>

        <p className="text-xs text-gray-600">
          Checked {lastChecked}
        </p>
      </div>
    </div>
  );
}
