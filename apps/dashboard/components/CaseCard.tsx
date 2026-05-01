"use client";

import { formatDistanceToNow } from "date-fns";
import { MapPin } from "lucide-react";
import { TriageBadge } from "./TriageBadge";
import type { CaseListItem } from "@/lib/api";

interface Props {
  case: CaseListItem;
  onClaim: (id: string) => void;
  onViewSoap: (id: string) => void;
  isNew?: boolean;
}

export function CaseCard({ case: c, onClaim, onViewSoap, isNew }: Props) {
  const isClaimed = c.status !== "PENDING";

  return (
    <div
      className={`rounded-xl border bg-gray-900 p-4 transition-colors hover:border-gray-600 ${
        isNew ? "border-blue-700 animate-pulse-once" : "border-gray-800"
      }`}
    >
      {/* Row 1: triage badge + time */}
      <div className="flex items-center justify-between">
        <TriageBadge level={c.triage_level} />
        <span className="text-xs text-gray-500">
          {formatDistanceToNow(new Date(c.received_at), { addSuffix: true })}
        </span>
      </div>

      {/* Row 2: chief complaint */}
      <p className="mt-2 line-clamp-2 text-sm font-medium text-white">{c.chief_complaint}</p>

      {/* Row 3: triage reason */}
      <p className="mt-1 line-clamp-1 text-xs text-gray-400">{c.triage_reason}</p>

      {/* Row 4: location + actions */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <MapPin size={11} />
          <span>
            {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {c.has_soap && (
            <button
              onClick={() => onViewSoap(c.id)}
              className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              View SOAP
            </button>
          )}

          {c.status === "PENDING" ? (
            <button
              onClick={() => onClaim(c.id)}
              className="rounded-md border border-green-700 px-2.5 py-1 text-xs text-green-400 transition hover:border-green-500 hover:text-green-300"
            >
              Claim
            </button>
          ) : (
            <span className="rounded-md border border-gray-800 bg-gray-800 px-2.5 py-1 text-xs text-gray-500">
              Claimed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
