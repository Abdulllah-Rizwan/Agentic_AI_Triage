"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getSystemHealth, getQueueStats, getKBStats } from "@/lib/api";
import type { HealthResponse, QueueResponse, StatsResponse } from "@/lib/api";
import { SystemHealthCard } from "@/components/admin/SystemHealthCard";

const POLL_INTERVAL = 30_000;

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

export default function AdminSystemPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.replace("/cases");
    }
  }, [status, session, router]);

  const [health, setHealth]   = useState<HealthResponse | null>(null);
  const [queue, setQueue]     = useState<QueueResponse | null>(null);
  const [stats, setStats]     = useState<StatsResponse | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [loading, setLoading] = useState(true);

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const counterRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [h, q, s] = await Promise.all([
        getSystemHealth(),
        getQueueStats(),
        getKBStats(),
      ]);
      setHealth(h);
      setQueue(q);
      setStats(s);
      setSecondsAgo(0);
    } catch {
      // keep existing state on network error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, POLL_INTERVAL);

    // Tick the "last updated N seconds ago" counter every second
    counterRef.current = setInterval(
      () => setSecondsAgo((s) => s + 1),
      1000
    );

    return () => {
      if (timerRef.current)   clearInterval(timerRef.current);
      if (counterRef.current) clearInterval(counterRef.current);
    };
  }, [fetchAll]);

  const checkedLabel = health
    ? formatDistanceToNow(new Date(health.checked_at), { addSuffix: true })
    : "—";

  const highQueue =
    (queue?.soap_generation.pending ?? 0) > 50 ||
    (queue?.document_ingestion.pending ?? 0) > 50;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">System Health</h1>
        <p className="text-xs text-gray-500">
          Last updated {secondsAgo}s ago
          <button
            onClick={fetchAll}
            className="ml-3 text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors"
          >
            Refresh now
          </button>
        </p>
      </div>

      {/* Health cards 2×2 */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-800" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <SystemHealthCard
            label="API Server"
            status={health?.api === "ok" ? "ok" : "down"}
            value="Operational"
            lastChecked={checkedLabel}
          />
          <SystemHealthCard
            label="PostgreSQL"
            status={health?.postgres === "ok" ? "ok" : "down"}
            lastChecked={checkedLabel}
          />
          <SystemHealthCard
            label="Redis"
            status={health?.redis === "ok" ? "ok" : "down"}
            lastChecked={checkedLabel}
          />
          <SystemHealthCard
            label="Celery Workers"
            status={(health?.celery_workers ?? 0) > 0 ? "ok" : "down"}
            value={
              (health?.celery_workers ?? 0) > 0
                ? `${health!.celery_workers} worker${health!.celery_workers !== 1 ? "s" : ""} active`
                : "No workers running"
            }
            lastChecked={checkedLabel}
          />
        </div>
      )}

      {/* Queue panel */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Task Queue
        </h2>

        {highQueue && (
          <div className="flex items-center gap-2 rounded-xl border border-yellow-800 bg-yellow-950/30 px-4 py-3">
            <AlertTriangle size={15} className="text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-400">
              Queue depth is high — worker may be overwhelmed
            </p>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800">
                {["Queue", "Pending", "Active", "Failed"].map((h) => (
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
              {[
                {
                  label: "SOAP Generation",
                  data: queue?.soap_generation,
                },
                {
                  label: "Document Ingestion",
                  data: queue?.document_ingestion,
                },
              ].map(({ label, data }, i) => (
                <tr
                  key={label}
                  className={`text-sm transition-colors hover:bg-gray-800 ${
                    i === 0 ? "border-b border-gray-800" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-white">{label}</td>
                  <td className={`px-4 py-3 ${(data?.pending ?? 0) > 50 ? "font-bold text-yellow-400" : "text-gray-400"}`}>
                    {data?.pending ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{data?.active ?? "—"}</td>
                  <td className={`px-4 py-3 ${(data?.failed ?? 0) > 0 ? "text-red-400" : "text-gray-400"}`}>
                    {data?.failed ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* RAG stats */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Knowledge Base
        </h2>

        <div className="grid grid-cols-4 gap-4">
          <StatCell label="KB Version"        value={stats ? `v${stats.kb_version}` : "—"} />
          <StatCell label="Active Documents"  value={String(stats?.active_documents ?? "—")} />
          <StatCell label="Total Chunks"      value={stats ? stats.total_chunks.toLocaleString() : "—"} />
          <StatCell label="Index Size"        value={stats ? `${stats.index_size_mb.toFixed(1)} MB` : "—"} />
        </div>

        {/* Top retrieved documents */}
        {stats && stats.top_retrieved_documents.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            <div className="border-b border-gray-800 bg-gray-800 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Most Retrieved Documents (7 days)
              </p>
            </div>
            <table className="w-full text-left">
              <tbody>
                {stats.top_retrieved_documents
                  .sort((a, b) => b.retrievals_7d - a.retrievals_7d)
                  .slice(0, 5)
                  .map((doc, i) => (
                    <tr
                      key={doc.id}
                      className={`text-sm transition-colors hover:bg-gray-800 ${
                        i < stats.top_retrieved_documents.slice(0, 5).length - 1
                          ? "border-b border-gray-800"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-white">{doc.title}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="rounded-full bg-blue-900/40 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                          {doc.retrievals_7d.toLocaleString()} retrievals
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
