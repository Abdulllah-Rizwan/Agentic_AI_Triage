"use client";

import { useRef, useState } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { uploadDocument } from "@/lib/api";

interface Props {
  onSuccess: () => void;
}

interface FormState {
  title: string;
  author: string;
  source: string;
  url: string;
  description: string;
}

const empty: FormState = { title: "", author: "", source: "", url: "", description: "" };

export function DocumentUploadForm({ onSuccess }: Props) {
  const [form, setForm] = useState<FormState>(empty);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function handleFile(f: File) {
    if (!f.name.endsWith(".txt")) {
      setError("Only .txt files are accepted.");
      return;
    }
    setFile(f);
    setError(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!file) { setError("Please select a .txt file."); return; }

    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("title", form.title.trim());
      if (form.author.trim()) fd.append("author", form.author.trim());
      if (form.source.trim()) fd.append("source", form.source.trim());
      if (form.url.trim()) fd.append("url", form.url.trim());
      if (form.description.trim()) fd.append("description", form.description.trim());
      fd.append("file", file);
      await uploadDocument(fd);
      setForm(empty);
      setFile(null);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-gray-500 focus:outline-none transition-colors";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-400">
          Title <span className="text-red-400">*</span>
        </label>
        <input
          className={inputClass}
          value={form.title}
          onChange={set("title")}
          placeholder="e.g. WHO Flood Response Guidelines"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-400">Author</label>
        <input
          className={inputClass}
          value={form.author}
          onChange={set("author")}
          placeholder="World Health Organization"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-400">Source</label>
        <input
          className={inputClass}
          value={form.source}
          onChange={set("source")}
          placeholder="WHO"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-400">URL</label>
        <input
          type="url"
          className={inputClass}
          value={form.url}
          onChange={set("url")}
          placeholder="https://www.who.int/..."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-400">Description</label>
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          value={form.description}
          onChange={set("description")}
          placeholder="Optional summary of the document content"
        />
      </div>

      {/* Drop zone */}
      <div
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? "border-blue-500 bg-blue-950/20"
            : file
            ? "border-green-600 bg-green-950/20"
            : "border-gray-700 hover:border-gray-500"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {file ? (
          <>
            <FileText size={20} className="text-green-400" />
            <p className="text-sm font-medium text-green-400">{file.name}</p>
            <p className="text-xs text-gray-500">
              {(file.size / 1024).toFixed(1)} KB · click to change
            </p>
          </>
        ) : (
          <>
            <Upload size={20} className="text-gray-500" />
            <p className="text-sm text-gray-400">
              Drop a <span className="font-medium text-white">.txt</span> file here or{" "}
              <span className="text-blue-400 underline underline-offset-2">browse</span>
            </p>
            <p className="text-xs text-gray-600">Plain text files only</p>
          </>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Uploading…
          </>
        ) : (
          "Upload and Process"
        )}
      </button>
    </form>
  );
}
