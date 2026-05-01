"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, MapPin, Phone, User } from "lucide-react";
import { format } from "date-fns";
import { getCaseById, claimCase, resolveCase } from "@/lib/api";
import type { CaseDetail } from "@/lib/api";
import { TriageBadge } from "@/components/TriageBadge";

const soapSections = [
  { key: "subjective" as const, label: "S — Subjective", border: "border-l-blue-500" },
  { key: "objective" as const, label: "O — Objective", border: "border-l-purple-500" },
  { key: "assessment" as const, label: "A — Assessment", border: "border-l-amber-500" },
  { key: "plan" as const, label: "P — Plan", border: "border-l-green-500" },
];

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    getCaseById(id)
      .then(setCaseDetail)
      .catch(() => router.push("/cases"))
      .finally(() => setLoading(false));
  }, [id, router]);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await claimCase(id);
      setCaseDetail((prev) =>
        prev ? { ...prev, status: "ACKNOWLEDGED", claimed_by_org_id: session?.user?.org_id ?? "" } : prev
      );
    } finally {
      setClaiming(false);
    }
  };

  const handleResolve = async () => {
    const outcome = prompt("Enter outcome summary:");
    if (!outcome) return;
    setResolving(true);
    try {
      await resolveCase(id, { outcome });
      setCaseDetail((prev) => (prev ? { ...prev, status: "RESOLVED" } : prev));
    } finally {
      setResolving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-24 animate-pulse rounded bg-gray-800" />
        <div className="h-40 animate-pulse rounded-xl bg-gray-800" />
      </div>
    );
  }

  if (!caseDetail) return null;

  const canResolve =
    caseDetail.status === "ACKNOWLEDGED" &&
    caseDetail.claimed_by_org_id === session?.user?.org_id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/cases" className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white">
          <ArrowLeft size={14} />
          Back to Cases
        </Link>
        <div className="flex items-center gap-3">
          {caseDetail.status === "PENDING" && (
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="rounded-lg border border-green-700 px-4 py-2 text-sm text-green-400 transition hover:border-green-500 disabled:opacity-50"
            >
              {claiming ? "Claiming…" : "Claim Case"}
            </button>
          )}
          {canResolve && (
            <button
              onClick={handleResolve}
              disabled={resolving}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-100 disabled:opacity-50"
            >
              {resolving ? "Resolving…" : "Mark Resolved"}
            </button>
          )}
          {caseDetail.claimed_by_org_id && caseDetail.status !== "RESOLVED" && (
            <span className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-400">
              Claimed
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left */}
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">Patient</h2>
              <TriageBadge level={caseDetail.triage_level} />
            </div>
            <div className="space-y-2">
              {caseDetail.patient_name && (
                <div className="flex items-center gap-2 text-sm text-white">
                  <User size={14} className="text-gray-500" />
                  {caseDetail.patient_name}
                </div>
              )}
              {caseDetail.patient_phone && (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Phone size={14} className="text-gray-500" />
                  {caseDetail.patient_phone}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <MapPin size={14} className="text-gray-500" />
                {caseDetail.lat.toFixed(6)}, {caseDetail.lng.toFixed(6)}
              </div>
            </div>
            <div className="mt-4 border-t border-gray-800 pt-3 text-xs text-gray-500">
              Received {format(new Date(caseDetail.received_at), "PPpp")}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-300">Triage</h2>
            <p className="text-sm font-medium text-white">{caseDetail.chief_complaint}</p>
            <p className="mt-1 text-xs text-gray-400">{caseDetail.triage_reason}</p>
            <div className="mt-3 text-xs text-gray-500">Severity: {caseDetail.severity}/10</div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-300">Reported Symptoms</h2>
            <div className="flex flex-wrap gap-2">
              {caseDetail.symptoms.map((s) => (
                <span key={s} className="rounded-full border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right: SOAP */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">SOAP Report</h2>
          {caseDetail.soap_report ? (
            <>
              {soapSections.map(({ key, label, border }) => (
                <div key={key} className={`rounded-xl border border-gray-800 border-l-4 bg-gray-900 p-5 ${border}`}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">{label}</p>
                  <p className="text-sm leading-relaxed text-gray-300">{caseDetail.soap_report![key]}</p>
                </div>
              ))}
              <p className="text-xs text-gray-600">
                Generated by {caseDetail.soap_report.model_used} · {format(new Date(caseDetail.soap_report.generated_at), "PPp")}
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center">
              <p className="text-sm text-gray-500">SOAP report not yet available.</p>
              <p className="mt-1 text-xs text-gray-600">
                {caseDetail.triage_level === "GREEN"
                  ? "GREEN cases do not generate SOAP reports."
                  : "Report is generating — refresh in a moment."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
