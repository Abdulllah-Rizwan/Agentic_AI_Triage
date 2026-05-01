"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { Inbox } from "lucide-react";
import { getCases, claimCase } from "@/lib/api";
import type { CaseListItem } from "@/lib/api";
import { CaseCard } from "@/components/CaseCard";
import { SoapReportPanel } from "@/components/SoapReportPanel";
import { CaseHistoryTable } from "@/components/CaseHistoryTable";
import { useSocket } from "@/lib/socket";

const CasesMap = dynamic(() => import("@/components/CasesMap").then((m) => m.CasesMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-gray-800" />,
});

type FilterMode = "ALL" | "RED" | "AMBER";

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
      <div className="flex justify-between">
        <div className="h-5 w-20 animate-pulse rounded-full bg-gray-700" />
        <div className="h-4 w-16 animate-pulse rounded bg-gray-700" />
      </div>
      <div className="h-4 w-full animate-pulse rounded bg-gray-700" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-gray-700" />
    </div>
  );
}

export default function CasesPage() {
  const { data: session } = useSession();
  const { socket } = useSocket(session?.user?.access_token, session?.user?.org_id);

  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [historyCases, setHistoryCases] = useState<CaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("ALL");
  const [sort, setSort] = useState<"received_at:desc" | "severity:desc">("received_at:desc");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [newCaseIds, setNewCaseIds] = useState<Set<string>>(new Set());

  const loadCases = useCallback(async () => {
    try {
      setLoading(true);
      const triage = filter === "ALL" ? "RED,AMBER,GREEN" : filter;
      const [activeRes, historyRes] = await Promise.all([
        getCases({ triage_level: triage, sort }),
        getCases({ status: "RESOLVED,CLOSED", limit: 20 }),
      ]);
      setCases(activeRes.cases);
      setHistoryCases(historyRes.cases);
    } catch {
      // keep existing list on error
    } finally {
      setLoading(false);
    }
  }, [filter, sort]);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  useEffect(() => {
    if (!socket) return;

    const handleNewCase = (data: {
      caseId: string;
      triageLevel: string;
      lat: number;
      lng: number;
      chiefComplaint: string;
      receivedAt: string;
    }) => {
      const newCase: CaseListItem = {
        id: data.caseId,
        triage_level: data.triageLevel as CaseListItem["triage_level"],
        status: "PENDING",
        chief_complaint: data.chiefComplaint,
        triage_reason: "",
        lat: data.lat,
        lng: data.lng,
        severity: 0,
        received_at: data.receivedAt,
        has_soap: false,
        claimed_by_org_id: null,
      };
      setCases((prev) => [newCase, ...prev]);
      setNewCaseIds((prev) => new Set(prev).add(data.caseId));
      setTimeout(() => {
        setNewCaseIds((prev) => {
          const next = new Set(prev);
          next.delete(data.caseId);
          return next;
        });
      }, 5000);
    };

    const handleSoapReady = ({ caseId }: { caseId: string }) => {
      setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, has_soap: true } : c)));
    };

    const handleClaimed = ({ caseId }: { caseId: string }) => {
      setCases((prev) =>
        prev.map((c) => (c.id === caseId ? { ...c, status: "ACKNOWLEDGED" } : c))
      );
    };

    socket.on("case:new", handleNewCase);
    socket.on("case:soap_ready", handleSoapReady);
    socket.on("case:claimed", handleClaimed);

    return () => {
      socket.off("case:new", handleNewCase);
      socket.off("case:soap_ready", handleSoapReady);
      socket.off("case:claimed", handleClaimed);
    };
  }, [socket]);

  const handleClaim = async (id: string) => {
    try {
      await claimCase(id);
      setCases((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "ACKNOWLEDGED" } : c))
      );
    } catch {
      // ignore optimistic update on error
    }
  };

  const counts = {
    ALL: cases.length,
    RED: cases.filter((c) => c.triage_level === "RED").length,
    AMBER: cases.filter((c) => c.triage_level === "AMBER").length,
  };

  const filterButtons: { mode: FilterMode; label: string }[] = [
    { mode: "ALL", label: "All" },
    { mode: "RED", label: "Critical" },
    { mode: "AMBER", label: "Urgent" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Active cases + map */}
      <div className="flex h-[70vh] gap-6">
        {/* Left column */}
        <div className="flex w-[60%] flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              {filterButtons.map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => setFilter(mode)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                    filter === mode
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  {label}
                  <span className="rounded-full bg-gray-600 px-1.5 py-0.5 text-xs">
                    {counts[mode]}
                  </span>
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 focus:outline-none"
              >
                <option value="received_at:desc">Newest First</option>
                <option value="severity:desc">Most Severe</option>
              </select>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
            ) : cases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Inbox size={40} className="mb-3 text-gray-600" />
                <p className="text-sm text-gray-500">No active cases</p>
              </div>
            ) : (
              cases.map((c) => (
                <CaseCard
                  key={c.id}
                  case={c}
                  onClaim={handleClaim}
                  onViewSoap={setSelectedCaseId}
                  isNew={newCaseIds.has(c.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right column: map */}
        <div className="w-[40%] overflow-hidden rounded-xl border border-gray-800">
          <CasesMap cases={cases} onCaseClick={setSelectedCaseId} />
        </div>
      </div>

      {/* Case history */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Past Cases
        </h2>
        {loading ? (
          <div className="h-32 animate-pulse rounded-xl border border-gray-800 bg-gray-900" />
        ) : (
          <CaseHistoryTable cases={historyCases} />
        )}
      </div>

      <SoapReportPanel caseId={selectedCaseId} onClose={() => setSelectedCaseId(null)} />
    </div>
  );
}
