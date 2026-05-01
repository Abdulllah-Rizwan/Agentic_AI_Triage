"use client";

import Link from "next/link";
import { format } from "date-fns";
import { FileText, Inbox } from "lucide-react";
import { TriageBadge } from "@/components/TriageBadge";
import type { CaseListItem } from "@/lib/api";

// The API returns resolved_at on list items even though the shared type omits it
type CaseListItemWithResolved = CaseListItem & { resolved_at?: string | null };

interface Props {
  cases: CaseListItem[];
}

function formatDuration(receivedAt: string, resolvedAt?: string | null): string {
  if (!resolvedAt) return "—";
  const ms = new Date(resolvedAt).getTime() - new Date(receivedAt).getTime();
  if (ms < 0) return "—";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function StatusPill({ status }: { status: CaseListItem["status"] }) {
  const map: Record<string, string> = {
    RESOLVED: "bg-green-900 text-green-300",
    CLOSED: "bg-gray-700 text-gray-400",
    PENDING: "bg-amber-900 text-amber-300",
    ACKNOWLEDGED: "bg-blue-900 text-blue-300",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-700 text-gray-400"}`}>
      {status}
    </span>
  );
}

export function CaseHistoryTable({ cases }: Props) {
  if (cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-gray-800 bg-gray-900">
        <Inbox size={36} className="mb-3 text-gray-600" />
        <p className="text-sm text-gray-500">No resolved cases yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-800">
            {["Case ID", "Status", "Triage", "Chief Complaint", "Location", "Received", "Duration", ""].map(
              (h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {(cases as CaseListItemWithResolved[]).map((c, i) => (
            <tr
              key={c.id}
              className={`border-b border-gray-800 text-sm text-gray-300 transition-colors hover:bg-gray-800 ${
                i % 2 === 1 ? "bg-gray-900/60" : "bg-gray-900"
              }`}
            >
              <td className="px-4 py-3 font-mono text-gray-500">
                {c.id.slice(0, 8)}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={c.status} />
              </td>
              <td className="px-4 py-3">
                <TriageBadge level={c.triage_level} />
              </td>
              <td className="px-4 py-3 max-w-[200px] truncate">
                {c.chief_complaint.length > 40
                  ? c.chief_complaint.slice(0, 40) + "…"
                  : c.chief_complaint}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-gray-400">
                {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                {format(new Date(c.received_at), "MMM d, yyyy HH:mm")}
              </td>
              <td className="px-4 py-3 text-gray-400">
                {formatDuration(c.received_at, c.resolved_at)}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/cases/${c.id}`}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <FileText size={12} />
                  View Report
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
