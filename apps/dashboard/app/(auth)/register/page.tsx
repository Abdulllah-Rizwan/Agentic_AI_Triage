"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { registerOrg } from "@/lib/api";

const ORG_TYPES = [
  { value: "NGO",         label: "NGO" },
  { value: "HOSPITAL",    label: "Hospital" },
  { value: "GOVT",        label: "Government Agency" },
  { value: "RELIEF_CAMP", label: "Relief Camp" },
];

export default function RegisterPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    org_name:    "",
    org_type:    "NGO",
    email:       "",
    password:    "",
    access_code: "",
  });
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.access_code.length < 4) {
      setError("Access code must be at least 4 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await registerOrg(form);
      setSuccess(res.message);
      // If auto-approved, redirect to login after 2 seconds
      if (res.message.includes("log in now")) {
        setTimeout(() => router.push("/login"), 2000);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8 shadow-2xl">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">MediReach</h1>
          <p className="mt-1 text-sm text-gray-400">Register your organization</p>
        </div>

        {success ? (
          <div className="rounded-lg border border-green-800 bg-green-950 px-4 py-4 text-sm text-green-300">
            <p className="font-semibold">Registration successful</p>
            <p className="mt-1 text-green-400">{success}</p>
            {success.includes("log in now") && (
              <p className="mt-2 text-xs text-green-500">Redirecting to login…</p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="org_name" className="mb-1.5 block text-sm text-gray-300">
                Organization Name
              </label>
              <input
                id="org_name"
                type="text"
                value={form.org_name}
                onChange={set("org_name")}
                required
                minLength={2}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
                placeholder="e.g. Aga Khan Hospital Karachi"
              />
            </div>

            <div>
              <label htmlFor="org_type" className="mb-1.5 block text-sm text-gray-300">
                Organization Type
              </label>
              <select
                id="org_type"
                value={form.org_type}
                onChange={set("org_type")}
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
              >
                {ORG_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="access_code" className="mb-1.5 block text-sm text-gray-300">
                Access Code
                <span className="ml-1 text-xs text-gray-500">(unique short ID for your org, 4–20 chars)</span>
              </label>
              <input
                id="access_code"
                type="text"
                value={form.access_code}
                onChange={set("access_code")}
                required
                minLength={4}
                maxLength={20}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
                placeholder="e.g. AKH-KHI"
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm text-gray-300">
                Admin Email
              </label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={set("email")}
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
                placeholder="you@organization.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm text-gray-300">
                Password
                <span className="ml-1 text-xs text-gray-500">(min 8 characters)</span>
              </label>
              <input
                id="password"
                type="password"
                value={form.password}
                onChange={set("password")}
                required
                minLength={8}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 disabled:opacity-60"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Register Organization
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-gray-300 underline underline-offset-2 hover:text-white">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
