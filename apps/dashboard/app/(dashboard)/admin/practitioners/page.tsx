"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, CalendarPlus } from "lucide-react";
import {
  adminGetPractitioners,
  adminCreatePractitioner,
  adminDeletePractitioner,
  adminAddSlots,
} from "@/lib/api";
import type { PractitionerItem } from "@/lib/api";

const SPECIALTIES = [
  "GENERAL_PHYSICIAN",
  "CARDIOLOGIST",
  "DERMATOLOGIST",
  "ORTHOPEDIC",
  "PEDIATRICIAN",
  "PULMONOLOGIST",
  "NEUROLOGIST",
  "OTHER",
];

const SPECIALTY_LABELS: Record<string, string> = {
  GENERAL_PHYSICIAN: "General Physician",
  CARDIOLOGIST: "Cardiologist",
  DERMATOLOGIST: "Dermatologist",
  ORTHOPEDIC: "Orthopedic",
  PEDIATRICIAN: "Pediatrician",
  PULMONOLOGIST: "Pulmonologist",
  NEUROLOGIST: "Neurologist",
  OTHER: "Other",
};

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h <= 18; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

const TIME_OPTIONS = generateTimeSlots();

export default function AdminPractitionersPage() {
  const [practitioners, setPractitioners] = useState<PractitionerItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState(SPECIALTIES[0]);
  const [city, setCity] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [customSpecialty, setCustomSpecialty] = useState("");
  const [creating, setCreating] = useState(false);

  // Slot manager
  const [slotPractitionerId, setSlotPractitionerId] = useState<string | null>(null);
  const [slotDate, setSlotDate] = useState("");
  const [slotTimes, setSlotTimes] = useState<string[]>([]);
  const [addingSlots, setAddingSlots] = useState(false);

  const load = () => {
    setLoading(true);
    adminGetPractitioners()
      .then((res) => setPractitioners(res.practitioners))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !city.trim() || !clinicName.trim()) return;
    setCreating(true);
    try {
      const resolvedSpecialty = specialty === "OTHER" ? customSpecialty.trim() || "OTHER" : specialty;
      await adminCreatePractitioner({ name, specialty: resolvedSpecialty, city, clinic_name: clinicName, phone: phone || undefined, bio: bio || undefined });
      setName(""); setCity(""); setClinicName(""); setPhone(""); setBio(""); setCustomSpecialty("");
      load();
    } catch {}
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this practitioner and all their slots?")) return;
    await adminDeletePractitioner(id).catch(() => {});
    load();
  };

  const toggleTime = (t: string) =>
    setSlotTimes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const handleAddSlots = async () => {
    if (!slotPractitionerId || !slotDate || slotTimes.length === 0) return;
    setAddingSlots(true);
    try {
      const slots = slotTimes.map((t) => ({ slot_date: slotDate, slot_time: t }));
      await adminAddSlots(slotPractitionerId, slots);
      setSlotDate(""); setSlotTimes([]); setSlotPractitionerId(null);
      load();
    } catch {}
    setAddingSlots(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Practitioners</h1>
        <p className="mt-1 text-sm text-gray-400">
          Add doctors to the platform and manage their available appointment slots.
        </p>
      </div>

      <div className="flex gap-6 items-start flex-wrap lg:flex-nowrap">
        {/* ── Practitioner list ── */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl border border-gray-800 bg-gray-900" />
              ))}
            </div>
          ) : practitioners.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900 py-16 text-center">
              <p className="text-sm text-gray-500">No practitioners added yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {practitioners.map((p) => (
                <div key={p.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white">{p.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {SPECIALTY_LABELS[p.specialty] ?? p.specialty} · {p.clinic_name}, {p.city}
                      </p>
                      {p.phone && <p className="text-xs text-gray-500 mt-0.5">{p.phone}</p>}
                      <p className="text-xs text-gray-500 mt-1">
                        {p.available_slot_count} slot{p.available_slot_count !== 1 ? "s" : ""} available
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setSlotPractitionerId(p.id === slotPractitionerId ? null : p.id)}
                        className="flex items-center gap-1 rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800 transition"
                        title="Add slots"
                      >
                        <CalendarPlus size={12} /> Slots
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="rounded-lg border border-gray-700 p-1.5 text-gray-400 hover:border-red-700 hover:text-red-400 transition"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Inline slot manager */}
                  {slotPractitionerId === p.id && (
                    <div className="mt-4 border-t border-gray-700 pt-4 space-y-3">
                      <p className="text-xs font-semibold text-gray-300">Add availability slots</p>
                      <div className="flex gap-3 flex-wrap">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Date</label>
                          <input
                            type="date"
                            value={slotDate}
                            onChange={(e) => setSlotDate(e.target.value)}
                            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:outline-none"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-2">Times (select all that apply)</label>
                        <div className="flex flex-wrap gap-2">
                          {TIME_OPTIONS.map((t) => (
                            <button
                              key={t}
                              onClick={() => toggleTime(t)}
                              className={`rounded-lg border px-3 py-1 text-xs transition ${
                                slotTimes.includes(t)
                                  ? "border-blue-600 bg-blue-900/40 text-blue-300"
                                  : "border-gray-700 text-gray-400 hover:bg-gray-800"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={handleAddSlots}
                        disabled={addingSlots || !slotDate || slotTimes.length === 0}
                        className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition"
                      >
                        {addingSlots ? "Adding…" : `Add ${slotTimes.length} slot${slotTimes.length !== 1 ? "s" : ""}`}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Create form ── */}
        <div className="w-full lg:w-80 shrink-0">
          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4"
          >
            <p className="font-semibold text-white">Add Practitioner</p>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Full Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr. Ahmed Khan"
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Specialty *</label>
              <select
                value={specialty}
                onChange={(e) => { setSpecialty(e.target.value); setCustomSpecialty(""); }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none"
              >
                {SPECIALTIES.map((s) => (
                  <option key={s} value={s}>{SPECIALTY_LABELS[s]}</option>
                ))}
              </select>
              {specialty === "OTHER" && (
                <input
                  value={customSpecialty}
                  onChange={(e) => setCustomSpecialty(e.target.value)}
                  placeholder="e.g. Oncologist, Psychiatrist…"
                  required
                  className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                />
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Clinic / Hospital *</label>
              <input
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder="Aga Khan Hospital"
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">City *</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Karachi"
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="021-XXXXXXXXX"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={2}
                placeholder="Brief description…"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition"
            >
              <Plus size={14} />
              {creating ? "Adding…" : "Add Practitioner"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
