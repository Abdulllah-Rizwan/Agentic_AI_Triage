"use client";

import { useEffect, useState } from "react";
import { X, MapPin, Phone, User, Activity } from "lucide-react";
import { format } from "date-fns";
import { getCaseById } from "@/lib/api";
import type { CaseDetail } from "@/lib/api";
import { TriageBadge } from "./TriageBadge";
import { parseAPIDate } from "@/lib/dateUtils";

interface Props {
  caseId: string | null;
  onClose: () => void;
}

const soapSections = [
  { key: "subjective" as const, label: "S — Subjective", border: "border-l-blue-500" },
  { key: "objective" as const, label: "O — Objective", border: "border-l-purple-500" },
  { key: "assessment" as const, label: "A — Assessment", border: "border-l-amber-500" },
  { key: "plan" as const, label: "P — Plan", border: "border-l-green-500" },
];

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded bg-gray-700 ${className}`} />;
}

function SeverityBar({ value }: { value: number }) {
  const color =
    value >= 8 ? "bg-red-500" : value >= 5 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-700">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-medium text-gray-300">
        {value}/10
      </span>
    </div>
  );
}

export function SoapReportPanel({ caseId, onClose }: Props) {
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  useEffect(() => {
    if (!caseId) { setCaseDetail(null); return; }
    setLoading(true);
    setSummaryExpanded(false);
    getCaseById(caseId)
      .then(setCaseDetail)
      .catch(() => setCaseDetail(null))
      .finally(() => setLoading(false));
  }, [caseId]);

  if (!caseId) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[520px] flex-col border-l border-gray-800 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Case Details</h2>
            {caseDetail && (
              <p className="mt-0.5 font-mono text-xs text-gray-500">
                #{caseDetail.id.slice(0, 8).toUpperCase()}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="space-y-4">
              <SkeletonLine className="w-1/3" />
              <SkeletonLine className="w-2/3" />
              <SkeletonLine />
              <SkeletonLine className="w-3/4" />
              <SkeletonLine className="w-1/2" />
            </div>
          ) : !caseDetail ? (
            <p className="text-sm text-gray-500">Failed to load case details.</p>
          ) : (
            <div className="space-y-5">

              {/* ── Patient ─────────────────────────────────────────────── */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5">
                  {caseDetail.patient_name && (
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <User size={13} className="text-gray-500 shrink-0" />
                      {caseDetail.patient_name}
                    </div>
                  )}
                  {caseDetail.patient_phone && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Phone size={13} className="text-gray-500 shrink-0" />
                      {caseDetail.patient_phone}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <MapPin size={13} className="shrink-0" />
                    {caseDetail.lat.toFixed(5)}, {caseDetail.lng.toFixed(5)}
                  </div>
                </div>
                <div className="shrink-0">
                  <TriageBadge level={caseDetail.triage_level} />
                </div>
              </div>

              {/* Status + time */}
              <div className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2 text-xs text-gray-400">
                <span>
                  Status:{" "}
                  <span className="font-medium text-gray-200">{caseDetail.status}</span>
                </span>
                <span>
                  {format(parseAPIDate(caseDetail.received_at), "MMM d, yyyy · HH:mm")}
                </span>
              </div>

              {/* ── Chief complaint ─────────────────────────────────────── */}
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Chief Complaint
                </p>
                <p className="text-sm font-medium leading-snug text-white">
                  {caseDetail.chief_complaint}
                </p>
                <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
                  {caseDetail.triage_reason}
                </p>
              </div>

              {/* ── Severity ────────────────────────────────────────────── */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Activity size={12} className="text-gray-500" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Severity
                  </p>
                </div>
                <SeverityBar value={caseDetail.severity} />
              </div>

              {/* ── Symptoms ────────────────────────────────────────────── */}
              {caseDetail.symptoms && caseDetail.symptoms.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Reported Symptoms
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {caseDetail.symptoms.map((s, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Conversation summary ─────────────────────────────────── */}
              {caseDetail.conversation_summary && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Assessment Summary
                  </p>
                  <div className="rounded-lg bg-gray-800 p-3">
                    <p className="text-xs leading-relaxed text-gray-300">
                      {summaryExpanded
                        ? caseDetail.conversation_summary
                        : caseDetail.conversation_summary.slice(0, 200) +
                          (caseDetail.conversation_summary.length > 200 ? "…" : "")}
                    </p>
                    {caseDetail.conversation_summary.length > 200 && (
                      <button
                        onClick={() => setSummaryExpanded((v) => !v)}
                        className="mt-1.5 text-xs text-blue-400 hover:text-blue-300"
                      >
                        {summaryExpanded ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── SOAP Report ──────────────────────────────────────────── */}
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  SOAP Report
                </p>
                {caseDetail.soap_report ? (
                  <div className="space-y-3">
                    {soapSections.map(({ key, label, border }) => (
                      <div
                        key={key}
                        className={`rounded-lg border-l-4 bg-gray-800 p-4 ${border}`}
                      >
                        <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                          {label}
                        </p>
                        <p className="text-sm leading-relaxed text-gray-300">
                          {caseDetail.soap_report![key]}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-700 p-6 text-center">
                    <p className="text-sm text-gray-500">SOAP report not yet available.</p>
                    <p className="mt-1 text-xs text-gray-600">
                      {caseDetail.triage_level === "GREEN"
                        ? "GREEN cases do not generate SOAP reports."
                        : "The report is being generated — check back in a moment."}
                    </p>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        {caseDetail?.soap_report && (
          <div className="border-t border-gray-800 px-6 py-3">
            <p className="text-xs text-gray-500">
              Generated by {caseDetail.soap_report.model_used} ·{" "}
              {format(parseAPIDate(caseDetail.soap_report.generated_at), "PPp")}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
