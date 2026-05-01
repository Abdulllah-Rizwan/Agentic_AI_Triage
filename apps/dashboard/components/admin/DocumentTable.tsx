"use client";

import { useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Archive, RefreshCw, Trash2, Inbox } from "lucide-react";
import {
  archiveDocument,
  reprocessDocument,
  deleteDocument,
  getDocumentById,
} from "@/lib/api";
import type { DocumentItem } from "@/lib/api";

interface Props {
  documents: DocumentItem[];
  onRefresh: () => void;
  isLoading: boolean;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PROCESSING":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-900/40 px-2.5 py-0.5 text-xs font-medium text-amber-400">
          <Loader2 size={10} className="animate-spin" />
          Processing
        </span>
      );
    case "ACTIVE":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-900/40 px-2.5 py-0.5 text-xs font-medium text-green-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
          Active
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-900/40 px-2.5 py-0.5 text-xs font-medium text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          Failed
        </span>
      );
    case "ARCHIVED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
          Archived
        </span>
      );
    default:
      return <span className="text-xs text-gray-500">{status}</span>;
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function DocumentTable({ documents, onRefresh, isLoading }: Props) {
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Start/stop polling for each PROCESSING document
  useEffect(() => {
    const processing = documents.filter((d) => d.status === "PROCESSING");
    const processingIds = new Set(processing.map((d) => d.id));

    // Stop polling for docs no longer processing
    for (const [id, timer] of pollingRef.current.entries()) {
      if (!processingIds.has(id)) {
        clearInterval(timer);
        pollingRef.current.delete(id);
      }
    }

    // Start polling for new processing docs
    for (const doc of processing) {
      if (pollingRef.current.has(doc.id)) continue;
      const timer = setInterval(async () => {
        try {
          const updated = await getDocumentById(doc.id);
          if (updated.status !== "PROCESSING") {
            clearInterval(timer);
            pollingRef.current.delete(doc.id);
            onRefresh();
          }
        } catch {
          // ignore transient errors
        }
      }, 5000);
      pollingRef.current.set(doc.id, timer);
    }

    return () => {
      // Clear all on unmount
      for (const timer of pollingRef.current.values()) clearInterval(timer);
      pollingRef.current.clear();
    };
  }, [documents, onRefresh]);

  async function handleArchive(id: string) {
    try { await archiveDocument(id); onRefresh(); } catch { /* ignore */ }
  }

  async function handleReprocess(id: string) {
    try { await reprocessDocument(id); onRefresh(); } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this document and all its chunks? This cannot be undone.")) return;
    try { await deleteDocument(id); onRefresh(); } catch { /* ignore */ }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-800" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900 py-14 text-center">
        <Inbox size={32} className="mb-3 text-gray-600" />
        <p className="text-sm text-gray-500">No documents uploaded yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-800">
            {["Title", "Status", "Chunks", "Size", "Uploaded by", "Date", "Actions"].map((h) => (
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
          {documents.map((doc, i) => (
            <tr
              key={doc.id}
              className={`border-b border-gray-800 text-sm transition-colors hover:bg-gray-800 ${
                i === documents.length - 1 ? "border-0" : ""
              }`}
            >
              <td className="max-w-[180px] px-4 py-3">
                <p className="truncate font-medium text-white">{doc.title}</p>
                <p className="truncate text-xs text-gray-500">{doc.filename}</p>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={doc.status} />
              </td>
              <td className="px-4 py-3 text-gray-400">
                {doc.chunk_count != null ? doc.chunk_count.toLocaleString() : "—"}
              </td>
              <td className="px-4 py-3 text-gray-400">
                {formatSize(doc.file_size_bytes)}
              </td>
              <td className="max-w-[140px] px-4 py-3">
                <p className="truncate text-xs text-gray-400">{doc.uploaded_by_email}</p>
              </td>
              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                {formatDistanceToNow(new Date(doc.uploaded_at), { addSuffix: true })}
              </td>
              <td className="px-4 py-3">
                {doc.status === "PROCESSING" ? (
                  <Loader2 size={14} className="animate-spin text-gray-500" />
                ) : (
                  <div className="flex items-center gap-2">
                    {doc.status === "ACTIVE" && (
                      <button
                        onClick={() => handleArchive(doc.id)}
                        title="Archive"
                        className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
                      >
                        <Archive size={12} />
                      </button>
                    )}
                    {doc.status === "FAILED" && (
                      <button
                        onClick={() => handleReprocess(doc.id)}
                        title="Re-process"
                        className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-400 transition-colors hover:border-amber-500 hover:text-amber-300"
                      >
                        <RefreshCw size={12} />
                      </button>
                    )}
                    {(doc.status === "FAILED" || doc.status === "ARCHIVED") && (
                      <button
                        onClick={() => handleDelete(doc.id)}
                        title="Delete"
                        className="rounded border border-red-800 px-2 py-1 text-xs text-red-400 transition-colors hover:border-red-600 hover:text-red-300"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
