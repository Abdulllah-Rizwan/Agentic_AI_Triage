"use client";

type TriageLevel = "RED" | "AMBER" | "GREEN";

interface Props {
  level: TriageLevel;
}

const config: Record<TriageLevel, { className: string; label: string }> = {
  RED: { className: "bg-red-600 text-white", label: "CRITICAL" },
  AMBER: { className: "bg-amber-500 text-white", label: "URGENT" },
  GREEN: { className: "bg-green-600 text-white", label: "MINOR" },
};

export function TriageBadge({ level }: Props) {
  const { className, label } = config[level];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
