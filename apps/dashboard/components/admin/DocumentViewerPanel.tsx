"use client";

import { useEffect, useState } from "react";
import { X, FileText, Hash, HardDrive, Calendar } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getDocumentContent } from "@/lib/api";
import { parseAPIDate } from "@/lib/dateUtils";
import type { DocumentItem } from "@/lib/api";

interface Props {
  doc: DocumentItem | null;
  onClose: () => void;
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded bg-gray-700 ${className}`} />;
}

export function DocumentViewerPanel({ doc, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) { setContent(null); return; }
    setLoading(true);
    setError(null);
    setContent(null);
    getDocumentContent(doc.id)
      .then((res) => setContent(res.content))
      .catch((err) => setError(err.message ?? "Failed to load content"))
      .finally(() => setLoading(false));
  }, [doc?.id]);

  if (!doc) return null;

  const wordCount = content
    ? content.trim().split(/\s+/).length.toLocaleString()
    : null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[600px] flex-col border-l border-gray-800 bg-gray-900 shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-800 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText size={15} className="shrink-0 text-blue-400" />
              <h2 className="truncate text-base font-semibold text-white">{doc.title}</h2>
            </div>
            <p className="mt-0.5 font-mono text-xs text-gray-500">{doc.filename}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Meta strip */}
        <div className="flex items-center gap-4 border-b border-gray-800 bg-gray-800/40 px-6 py-2.5 text-xs text-gray-400">
          {doc.chunk_count != null && (
            <span className="flex items-center gap-1.5">
              <Hash size={11} />
              {doc.chunk_count.toLocaleString()} chunks
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <HardDrive size={11} />
            {doc.file_size_bytes >= 1_048_576
              ? `${(doc.file_size_bytes / 1_048_576).toFixed(1)} MB`
              : `${(doc.file_size_bytes / 1024).toFixed(1)} KB`}
          </span>
          {wordCount && (
            <span className="flex items-center gap-1.5">
              <FileText size={11} />
              {wordCount} words
            </span>
          )}
          <span className="flex items-center gap-1.5 ml-auto">
            <Calendar size={11} />
            Uploaded {formatDistanceToNow(parseAPIDate(doc.uploaded_at), { addSuffix: true })}
          </span>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="space-y-3">
              <SkeletonLine className="w-3/4" />
              <SkeletonLine />
              <SkeletonLine className="w-5/6" />
              <SkeletonLine className="w-2/3" />
              <div className="mt-4" />
              <SkeletonLine />
              <SkeletonLine className="w-4/5" />
              <SkeletonLine className="w-3/4" />
              <SkeletonLine />
              <SkeletonLine className="w-1/2" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-800/50 bg-red-950/20 p-4">
              <p className="text-sm text-red-400">{error}</p>
              {doc.status !== "ACTIVE" && (
                <p className="mt-1.5 text-xs text-red-500/70">
                  This document is not yet active. Content may not be readable until processing completes.
                </p>
              )}
            </div>
          ) : content ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-gray-300">
              {content}
            </pre>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 px-6 py-3">
          <p className="text-xs text-gray-500">
            Uploaded by {doc.uploaded_by_email}
            {doc.processed_at &&
              ` · Indexed ${formatDistanceToNow(parseAPIDate(doc.processed_at), { addSuffix: true })}`}
          </p>
        </div>
      </div>
    </>
  );
}
