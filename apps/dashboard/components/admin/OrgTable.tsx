"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { X, Inbox } from "lucide-react";
import { approveOrg, suspendOrg } from "@/lib/api";
import type { OrgItem } from "@/lib/api";

interface Props {
  organizations: OrgItem[];
  onRefresh: () => void;
}

// ── Type badge ────────────────────────────────────────────────────────────────

const typeStyles: Record<string, string> = {
  NGO:         "bg-blue-900/40 text-blue-400",
  HOSPITAL:    "bg-purple-900/40 text-purple-400",
  GOVT:        "bg-red-900/40 text-red-400",
  RELIEF_CAMP: "bg-orange-900/40 text-orange-400",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${typeStyles[type] ?? "bg-gray-800 text-gray-400"}`}>
      {type.replace("_", " ")}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PENDING_APPROVAL":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-900/40 px-2.5 py-0.5 text-xs font-medium text-amber-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          Pending
        </span>
      );
    case "ACTIVE":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-900/40 px-2.5 py-0.5 text-xs font-medium text-green-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
          Active
        </span>
      );
    case "SUSPENDED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-900/40 px-2.5 py-0.5 text-xs font-medium text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          Suspended
        </span>
      );
    default:
      return <span className="text-xs text-gray-500">{status}</span>;
  }
}

// ── Suspend confirmation modal ────────────────────────────────────────────────

interface SuspendModalProps {
  org: OrgItem;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function SuspendModal({ org, onConfirm, onCancel }: SuspendModalProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (!reason.trim()) return;
    setBusy(true);
    onConfirm(reason.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-semibold text-white">Suspend Organisation</p>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-400">
          Suspending <span className="font-medium text-white">{org.name}</span> will
          prevent all users in this organisation from logging in. Existing sessions
          expire within 15 minutes.
        </p>

        <div className="flex flex-col gap-1.5 mb-4">
          <label className="text-xs font-medium text-gray-400">
            Reason <span className="text-red-400">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason for suspension…"
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-gray-500 focus:outline-none"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-700 py-2 text-sm text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!reason.trim() || busy}
            className="flex-1 rounded-lg bg-red-700 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Suspending…" : "Confirm Suspend"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main table ────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  PENDING_APPROVAL: 0,
  ACTIVE: 1,
  SUSPENDED: 2,
};

export function OrgTable({ organizations, onRefresh }: Props) {
  const [suspendTarget, setSuspendTarget] = useState<OrgItem | null>(null);

  const sorted = [...organizations].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
  );

  async function handleApprove(id: string) {
    try { await approveOrg(id); onRefresh(); } catch { /* ignore */ }
  }

  async function handleSuspend(id: string, reason: string) {
    try { await suspendOrg(id, reason); onRefresh(); } catch { /* ignore */ }
    finally { setSuspendTarget(null); }
  }

  async function handleReactivate(id: string) {
    // Reactivate = approve endpoint resets status to ACTIVE
    try { await approveOrg(id); onRefresh(); } catch { /* ignore */ }
  }

  if (organizations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900 py-16 text-center">
        <Inbox size={32} className="mb-3 text-gray-600" />
        <p className="text-sm text-gray-500">No organisations registered yet</p>
      </div>
    );
  }

  return (
    <>
      {suspendTarget && (
        <SuspendModal
          org={suspendTarget}
          onConfirm={(reason) => handleSuspend(suspendTarget.id, reason)}
          onCancel={() => setSuspendTarget(null)}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-800">
              {["Name", "Type", "Status", "Users", "Cases", "Registered", "Actions"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((org, i) => (
              <tr
                key={org.id}
                className={`border-b border-gray-800 text-sm transition-colors hover:bg-gray-800 ${
                  i === sorted.length - 1 ? "border-0" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{org.name}</p>
                  <p className="text-xs text-gray-500 font-mono">{org.access_code}</p>
                </td>
                <td className="px-4 py-3">
                  <TypeBadge type={org.type} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={org.status} />
                </td>
                <td className="px-4 py-3 text-gray-400">{org.user_count}</td>
                <td className="px-4 py-3 text-gray-400">{org.case_count}</td>
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {formatDistanceToNow(new Date(org.created_at), { addSuffix: true })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {org.status === "PENDING_APPROVAL" && (
                      <>
                        <button
                          onClick={() => handleApprove(org.id)}
                          className="rounded border border-green-700 px-2.5 py-1 text-xs font-medium text-green-400 transition-colors hover:border-green-500 hover:bg-green-900/20 hover:text-green-300"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleSuspend(org.id, "Registration rejected by admin.")}
                          className="rounded border border-red-800 px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:border-red-600 hover:bg-red-900/20 hover:text-red-300"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {org.status === "ACTIVE" && (
                      <button
                        onClick={() => setSuspendTarget(org)}
                        className="rounded border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
                      >
                        Suspend
                      </button>
                    )}
                    {org.status === "SUSPENDED" && (
                      <button
                        onClick={() => handleReactivate(org.id)}
                        className="rounded border border-blue-800 px-2.5 py-1 text-xs font-medium text-blue-400 transition-colors hover:border-blue-600 hover:bg-blue-900/20 hover:text-blue-300"
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
