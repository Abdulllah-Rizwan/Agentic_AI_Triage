"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Check, Eye, EyeOff, KeyRound, Bell, SlidersHorizontal, User } from "lucide-react";
import { changePassword } from "@/lib/api";

// ── Preference keys stored in localStorage ────────────────────────────────────
const PREF_CASE_FILTER  = "settings_default_case_filter";
const PREF_SOUND_ALERTS = "settings_sound_alerts";
const PREF_NEW_CASE_NOTIF = "settings_new_case_notif";

// ── Small helpers ─────────────────────────────────────────────────────────────

function Card({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-5 flex items-center gap-2.5 border-b border-gray-800 pb-4">
        <Icon size={16} className="text-gray-400" />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-gray-800" />;
}

const roleBadge: Record<string, string> = {
  ADMIN: "bg-purple-950 text-purple-300 border-purple-800",
  RESPONDER: "bg-blue-950 text-blue-300 border-blue-800",
  VIEWER: "bg-gray-800 text-gray-300 border-gray-700",
};

// ── Change Password card ───────────────────────────────────────────────────────

function PasswordCard() {
  const [current, setCurrent]     = useState("");
  const [next, setNext]           = useState("");
  const [confirm, setConfirm]     = useState("");
  const [showCur, setShowCur]     = useState(false);
  const [showNew, setShowNew]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }

    setLoading(true);
    try {
      await changePassword(current, next);
      setSuccess(true);
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("401") || msg.toLowerCase().includes("incorrect")
        ? "Current password is incorrect."
        : "Failed to update password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function ToggleBtn({ show, onToggle }: { show: boolean; onToggle: () => void }) {
    return (
      <button type="button" onClick={onToggle} className="text-gray-500 hover:text-gray-300">
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    );
  }

  function PwInput({
    label, value, onChange, show, onToggle, placeholder,
  }: {
    label: string; value: string; onChange: (v: string) => void;
    show: boolean; onToggle: () => void; placeholder?: string;
  }) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-400">{label}</label>
        <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 focus-within:border-blue-500">
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder-gray-600"
          />
          <ToggleBtn show={show} onToggle={onToggle} />
        </div>
      </div>
    );
  }

  return (
    <Card title="Change Password" icon={KeyRound}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <PwInput
          label="Current Password"
          value={current}
          onChange={setCurrent}
          show={showCur}
          onToggle={() => setShowCur((v) => !v)}
        />
        <PwInput
          label="New Password"
          value={next}
          onChange={setNext}
          show={showNew}
          onToggle={() => setShowNew((v) => !v)}
          placeholder="Minimum 8 characters"
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-400">Confirm New Password</label>
          <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 focus-within:border-blue-500">
            <input
              type={showNew ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder-gray-600"
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        )}
        {success && (
          <div className="flex items-center gap-2 rounded-lg border border-green-900 bg-green-950 px-3 py-2 text-xs text-green-400">
            <Check size={13} />
            Password updated successfully.
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !current || !next || !confirm}
          className="mt-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          {loading ? "Updating…" : "Update Password"}
        </button>
      </form>
    </Card>
  );
}

// ── Preferences card ──────────────────────────────────────────────────────────

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        enabled ? "bg-blue-600" : "bg-gray-700"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function PreferenceRow({ label, description, enabled, onChange }: {
  label: string; description: string; enabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className="text-xs text-gray-500">{description}</span>
      </div>
      <Toggle enabled={enabled} onChange={onChange} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const caseFilterOptions = [
  { value: "ALL",             label: "All cases" },
  { value: "RED,AMBER",       label: "Critical + Urgent only" },
  { value: "RED",             label: "Critical only" },
];

export default function SettingsPage() {
  const { data: session } = useSession();
  const user = session?.user;

  // Case filter preference
  const [defaultFilter, setDefaultFilter] = useState("ALL");
  // Notification preferences
  const [soundAlerts, setSoundAlerts]       = useState(false);
  const [newCaseNotif, setNewCaseNotif]     = useState(false);
  const [savedPrefs, setSavedPrefs]         = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    setDefaultFilter(localStorage.getItem(PREF_CASE_FILTER)  ?? "ALL");
    setSoundAlerts(localStorage.getItem(PREF_SOUND_ALERTS)     === "true");
    setNewCaseNotif(localStorage.getItem(PREF_NEW_CASE_NOTIF) === "true");
  }, []);

  function savePreferences() {
    localStorage.setItem(PREF_CASE_FILTER,   defaultFilter);
    localStorage.setItem(PREF_SOUND_ALERTS,  String(soundAlerts));
    localStorage.setItem(PREF_NEW_CASE_NOTIF, String(newCaseNotif));
    setSavedPrefs(true);
    setTimeout(() => setSavedPrefs(false), 2500);
  }

  const memberSince = user
    ? new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : "—";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-white">Settings</h1>

      <div className="grid grid-cols-2 gap-6">
        {/* ── Account info ──────────────────────────────────────────────── */}
        <Card title="Account" icon={User}>
          <div className="flex flex-col divide-y divide-gray-800">
            <Row label="Email" value={user?.email ?? "—"} />
            <div className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-gray-400">Role</span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  roleBadge[user?.role ?? ""] ?? "bg-gray-800 text-gray-300"
                }`}
              >
                {user?.role ?? "—"}
              </span>
            </div>
            <Row label="Organisation"  value={user?.org_name ?? "—"} />
            <Row label="Member since"  value={memberSince} />
          </div>
        </Card>

        {/* ── Change password ────────────────────────────────────────────── */}
        <PasswordCard />

        {/* ── Case view ──────────────────────────────────────────────────── */}
        <Card title="Case View Preferences" icon={SlidersHorizontal}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-400">
                Default filter on Cases page
              </label>
              <div className="flex flex-col gap-2">
                {caseFilterOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-800 px-4 py-2.5 transition-colors hover:bg-gray-800"
                  >
                    <input
                      type="radio"
                      name="caseFilter"
                      value={opt.value}
                      checked={defaultFilter === opt.value}
                      onChange={() => setDefaultFilter(opt.value)}
                      className="accent-blue-500"
                    />
                    <span className="text-sm text-gray-300">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={savePreferences}
              className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              {savedPrefs ? (
                <><Check size={14} /> Saved</>
              ) : "Save Preferences"}
            </button>
          </div>
        </Card>

        {/* ── Notifications ──────────────────────────────────────────────── */}
        <Card title="Notifications" icon={Bell}>
          <div className="flex flex-col divide-y divide-gray-800">
            <PreferenceRow
              label="Sound alert for new RED cases"
              description="Play a short alert tone when a critical case arrives."
              enabled={soundAlerts}
              onChange={(v) => { setSoundAlerts(v); localStorage.setItem(PREF_SOUND_ALERTS, String(v)); }}
            />
            <PreferenceRow
              label="New case banner"
              description="Show a notification banner in the browser tab on incoming cases."
              enabled={newCaseNotif}
              onChange={(v) => { setNewCaseNotif(v); localStorage.setItem(PREF_NEW_CASE_NOTIF, String(v)); }}
            />
          </div>
          <p className="mt-4 text-xs text-gray-600">
            Preferences are saved to this browser automatically.
          </p>
        </Card>
      </div>
    </div>
  );
}
