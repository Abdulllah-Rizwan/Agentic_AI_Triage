"use client";

import { useEffect, useCallback, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { getAdminDocuments, getKBStats } from "@/lib/api";
import type { DocumentItem, StatsResponse } from "@/lib/api";
import { DocumentUploadForm } from "@/components/admin/DocumentUploadForm";
import { DocumentTable } from "@/components/admin/DocumentTable";
import { useSocket } from "@/lib/socket";

export default function AdminKnowledgePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.replace("/cases");
    }
  }, [status, session, router]);

  const { socket } = useSocket(session?.user?.access_token, session?.user?.org_id);

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [docsRes, statsRes] = await Promise.all([
        getAdminDocuments(),
        getKBStats(),
      ]);
      setDocuments(docsRes.documents);
      setStats(statsRes);
    } catch {
      // keep existing state on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Refresh on Socket.IO kb:updated event
  useEffect(() => {
    if (!socket) return;
    socket.on("kb:updated", loadAll);
    return () => { socket.off("kb:updated", loadAll); };
  }, [socket, loadAll]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Knowledge Base Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload medical documents to expand the AI knowledge base. Mobile apps sync
          the updated index automatically on next launch.
        </p>
      </div>

      <div className="flex gap-6 items-start">
        {/* Upload form — 35% */}
        <div className="w-[35%] shrink-0 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <p className="mb-4 text-sm font-semibold text-white">Upload New Document</p>
          <DocumentUploadForm onSuccess={loadAll} />
        </div>

        {/* Document table — 65% */}
        <div className="flex flex-1 flex-col gap-4">
          <DocumentTable
            documents={documents}
            onRefresh={loadAll}
            isLoading={loading}
          />

          {/* Stats footer */}
          {stats && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-3">
              <p className="text-xs text-gray-400">
                <span className="font-medium text-white">
                  Knowledge Base v{stats.kb_version}
                </span>
                {" · "}
                {stats.active_documents} active document{stats.active_documents !== 1 ? "s" : ""}
                {" · "}
                {stats.total_chunks.toLocaleString()} chunks
                {" · "}
                Last updated{" "}
                {formatDistanceToNow(new Date(stats.last_updated), { addSuffix: true })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile sync note */}
      <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 px-5 py-3">
        <p className="text-xs text-blue-400">
          When a document becomes active, the knowledge base version is incremented.
          Mobile apps running online will silently download the updated index on their
          next launch.
        </p>
      </div>
    </div>
  );
}
