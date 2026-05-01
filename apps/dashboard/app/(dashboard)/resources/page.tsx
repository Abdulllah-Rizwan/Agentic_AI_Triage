"use client";

import { useState } from "react";
import {
  FileText,
  Brain,
  Thermometer,
  Phone,
  BookOpen,
  X,
  ChevronRight,
} from "lucide-react";
import { ResourceCard } from "@/components/resources/ResourceCard";

function Modal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-semibold text-white">{title}</p>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="rounded-full bg-gray-800 p-4">
            <Brain size={28} className="text-gray-500" />
          </div>
          <p className="font-medium text-white">Coming Soon</p>
          <p className="text-sm text-gray-400">
            This interactive tool is under development and will be available in a
            future release.
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-full rounded-lg bg-gray-800 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}

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
  const [modal, setModal] = useState<string | null>(null);
  const [trainingProgress] = useState(0);

  return (
    <>
      {modal && <Modal title={modal} onClose={() => setModal(null)} />}

      <div className="flex flex-col gap-8">
        <h1 className="text-lg font-semibold text-white">Medical Resources</h1>

        {/* Section 1 — Guidelines */}
        <section className="flex flex-col gap-3">
          <SectionHeading>Guidelines</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            <ResourceCard
              title="WHO Emergency Field Handbook"
              description="Standard protocols for emergency medical response in disaster settings."
              badge="WHO"
              actionLabel="Download PDF"
              actionHref="#"
              icon={FileText}
            />
            <ResourceCard
              title="Pakistan NDMA Flood Response Protocol"
              description="National guidelines for medical response during flood emergencies."
              badge="NDMA"
              actionLabel="Download PDF"
              actionHref="#"
              icon={FileText}
            />
            <ResourceCard
              title="Earthquake Trauma Management Guide"
              description="Field guide for managing crush injuries and trauma after seismic events."
              badge="WHO"
              actionLabel="Download PDF"
              actionHref="#"
              icon={FileText}
            />
            <ResourceCard
              title="Pediatric Emergency Quick Reference"
              description="Age-adjusted triage and treatment guidelines for pediatric patients."
              badge="WHO"
              actionLabel="Download PDF"
              actionHref="#"
              icon={FileText}
            />
          </div>
        </section>

        {/* Section 2 — Interactive Tools */}
        <section className="flex flex-col gap-3">
          <SectionHeading>Interactive Tools</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            <ResourceCard
              title="Glasgow Coma Scale Calculator"
              description="Calculate GCS score for head injury assessment across eye, verbal, and motor responses."
              badge="Tool"
              actionLabel="Open Tool"
              onAction={() => setModal("Glasgow Coma Scale Calculator")}
              icon={Brain}
            />
            <ResourceCard
              title="Burn Surface Area Estimator"
              description="Rule of Nines calculator for estimating total body surface area affected by burns."
              badge="Tool"
              actionLabel="Open Tool"
              onAction={() => setModal("Burn Surface Area Estimator")}
              icon={Thermometer}
            />
          </div>
        </section>

        {/* Section 3 — Emergency Directory */}
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
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400" />
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => (
                  <tr
                    key={c.number}
                    className={`border-b border-gray-800 transition-colors hover:bg-gray-800 ${
                      i === contacts.length - 1 ? "border-0" : ""
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
                    <td className="px-5 py-3.5">
                      <a
                        href={`tel:${c.number}`}
                        className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-white"
                      >
                        <Phone size={12} />
                        Call
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4 — Training */}
        <section className="flex flex-col gap-3">
          <SectionHeading>Training</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-4 rounded-xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-start gap-3">
                <BookOpen size={20} className="mt-0.5 text-blue-500" />
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-white">AI System Onboarding Module</p>
                  <p className="text-sm text-gray-400">
                    Step-by-step guide to using MediReach: case management, SOAP reports,
                    and the knowledge base.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Progress</span>
                  <span>{trainingProgress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${trainingProgress}%` }}
                  />
                </div>
              </div>

              <button className="flex w-fit items-center gap-1.5 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white">
                Start Training
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
