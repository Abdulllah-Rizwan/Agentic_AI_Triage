"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  FileText,
  Upload,
  Trash2,
  Download,
  X,
  Plus,
  Loader2,
} from "lucide-react";
import {
  getGuidelines,
  uploadGuideline,
  deleteGuideline,
  downloadGuideline,
  type GuidelineItem,
} from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Upload modal ──────────────────────────────────────────────────────────────

interface UploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
}

function UploadModal({ onClose, onUploaded }: UploadModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    if (!file) { setError("Please select a file."); return; }

    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      if (description.trim()) fd.append("description", description.trim());
      fd.append("file", file);
      await uploadGuideline(fd);
      onUploaded();
      onClose();
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-base font-semibold text-white">Upload Guideline</p>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-400">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. WHO Emergency Field Handbook"
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-400">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Brief description of the document"
              className="resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-400">File *</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-700 px-4 py-5 text-center transition-colors hover:border-gray-500"
            >
              {file ? (
                <>
                  <FileText size={20} className="text-blue-400" />
                  <p className="text-sm font-medium text-white">{file.name}</p>
                  <p className="text-xs text-gray-500">{formatBytes(file.size)}</p>
                </>
              ) : (
                <>
                  <Upload size={20} className="text-gray-600" />
                  <p className="text-sm text-gray-400">Click to browse</p>
                  <p className="text-xs text-gray-600">PDF, DOC, or any format · max 100 MB</p>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-700 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {loading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const contacts = [
  { name: "Aga Khan Hospital Emergency", number: "021-3493-0051", type: "Hospital" },
  { name: "EDHI Foundation", number: "115", type: "Ambulance" },
  { name: "Pakistan Red Crescent", number: "1716", type: "Relief" },
  { name: "NDMA Helpline", number: "1700", type: "Government" },
];

const typeColors: Record<string, string> = {
  Hospital: "text-blue-400",
  Ambulance: "text-red-400",
  Relief: "text-amber-400",
  Government: "text-green-400",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </h2>
  );
}

export default function ResourcesPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const [guidelines, setGuidelines] = useState<GuidelineItem[]>([]);
  const [loadingGuidelines, setLoadingGuidelines] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadGuidelines = useCallback(async () => {
    try {
      const data = await getGuidelines();
      setGuidelines(data.guidelines);
    } catch {
      // silent — empty state shown
    } finally {
      setLoadingGuidelines(false);
    }
  }, []);

  useEffect(() => { loadGuidelines(); }, [loadGuidelines]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this guideline? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await deleteGuideline(id);
      setGuidelines((prev) => prev.filter((g) => g.id !== id));
    } catch {
      alert("Delete failed. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDownload(g: GuidelineItem) {
    setDownloadingId(g.id);
    try {
      await downloadGuideline(g.id, g.original_filename);
    } catch {
      alert("Download failed. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={loadGuidelines}
        />
      )}

      <div className="flex flex-col gap-8">
        <h1 className="text-lg font-semibold text-white">Medical Resources</h1>

        {/* Section 1 — Guidelines */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <SectionHeading>Guidelines</SectionHeading>
            {isAdmin && (
              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
              >
                <Plus size={12} />
                Upload
              </button>
            )}
          </div>

          {loadingGuidelines ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-gray-600" />
            </div>
          ) : guidelines.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-800 py-12 text-center">
              <FileText size={28} className="text-gray-700" />
              <p className="text-sm font-medium text-gray-500">No guidelines uploaded yet</p>
              {isAdmin && (
                <p className="text-xs text-gray-600">
                  Click <span className="font-medium text-gray-500">Upload</span> above to add the first document.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {guidelines.map((g) => (
                <div
                  key={g.id}
                  className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <FileText size={20} className="mt-0.5 shrink-0 text-blue-500" />
                    <span className="rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400">
                      {g.original_filename.split(".").pop()?.toUpperCase() ?? "FILE"}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-white">{g.title}</p>
                    {g.description && (
                      <p className="text-sm text-gray-400">{g.description}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-600">
                      {formatBytes(g.file_size_bytes)} · {formatDate(g.uploaded_at)}
                    </p>
                  </div>

                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleDownload(g)}
                      disabled={downloadingId === g.id}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-50"
                    >
                      {downloadingId === g.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      Download
                    </button>

                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(g.id)}
                        disabled={deletingId === g.id}
                        className="rounded-lg border border-gray-700 p-2 text-gray-500 transition-colors hover:border-red-900 hover:bg-red-950 hover:text-red-400 disabled:opacity-50"
                      >
                        {deletingId === g.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 2 — Emergency Directory */}
        <section className="flex flex-col gap-3">
          <SectionHeading>Emergency Directory</SectionHeading>
          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Organisation
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Number
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => (
                  <tr
                    key={c.number}
                    className={`transition-colors hover:bg-gray-800 ${
                      i < contacts.length - 1 ? "border-b border-gray-800" : ""
                    }`}
                  >
                    <td className="px-5 py-3.5 text-sm font-medium text-white">
                      {c.name}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-sm text-gray-300">
                      {c.number}
                    </td>
                    <td className={`px-5 py-3.5 text-sm font-medium ${typeColors[c.type] ?? "text-gray-400"}`}>
                      {c.type}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
