"use client";

import type { LucideIcon } from "lucide-react";
import { FileText } from "lucide-react";

interface Props {
  title: string;
  description: string;
  badge: string;
  actionLabel: string;
  actionHref?: string;
  onAction?: () => void;
  icon?: LucideIcon;
}

export function ResourceCard({
  title,
  description,
  badge,
  actionLabel,
  actionHref,
  onAction,
  icon: Icon = FileText,
}: Props) {
  return (
    <div className="relative flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between">
        <Icon size={20} className="mt-0.5 text-blue-500" />
        <span className="rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400">
          {badge}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <p className="font-medium text-white">{title}</p>
        <p className="text-sm text-gray-400">{description}</p>
      </div>

      <div className="mt-auto pt-2">
        {actionHref ? (
          <a
            href={actionHref}
            className="inline-flex items-center rounded-lg border border-gray-700 bg-transparent px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
          >
            {actionLabel}
          </a>
        ) : (
          <button
            onClick={onAction}
            className="inline-flex items-center rounded-lg border border-gray-700 bg-transparent px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
