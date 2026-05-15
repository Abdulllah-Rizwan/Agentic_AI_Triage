"use client";

import { useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Archive, RefreshCw, Trash2, Inbox, Eye } from "lucide-react";
import { parseAPIDate } from "@/lib/dateUtils";
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
  onView: (doc: DocumentItem) => void;
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

export function DocumentTable({ documents, onRefresh, isLoading, onView }: Props) {
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Start/stop polling for each PROCESSING document
  useEffect(() => {
    const processing = documents.filter((d) => d.status === "PROCESSING");
    const processingIds = new Set(processing.map((d) => d.id));

    // Stop polling for docs no longer processing
    for (const [id, timer] of Array.from(pollingRef.current.entries())) {
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
      for (const timer of Array.from(pollingRef.current.values())) clearInterval(timer);
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
      <table className="w-full table-fixed text-left">
        <colgroup>
          <col style={{ width: "24%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "20%" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-gray-800 bg-gray-800">
            {["Title", "Status", "Chunks", "Size", "Uploaded by", "Date", "Actions"].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
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
              <td className="px-4 py-3">
                <button
                  onClick={() => onView(doc)}
                  className="group w-full min-w-0 text-left"
                  title="Read document"
                >
                  <p className="truncate font-medium text-white group-hover:text-blue-400 transition-colors">
                    {doc.title}
                  </p>
                  <p className="truncate text-xs text-gray-500">{doc.filename}</p>
                </button>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={doc.status} />
              </td>
              <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                {doc.chunk_count != null ? doc.chunk_count.toLocaleString() : "—"}
              </td>
              <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                {formatSize(doc.file_size_bytes)}
              </td>
              <td className="px-4 py-3 overflow-hidden">
                <p className="truncate text-xs text-gray-400">{doc.uploaded_by_email}</p>
              </td>
              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap overflow-hidden">
                {formatDistanceToNow(parseAPIDate(doc.uploaded_at), { addSuffix: true })}
              </td>
              <td className="px-4 py-3 overflow-hidden">
                {doc.status === "PROCESSING" ? (
                  <Loader2 size={14} className="animate-spin text-gray-500" />
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => onView(doc)}
                      title="Read content"
                      className="rounded border border-blue-800 px-2 py-1 text-xs text-blue-400 transition-colors hover:border-blue-600 hover:text-blue-300"
                    >
                      <Eye size={12} />
                    </button>
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
