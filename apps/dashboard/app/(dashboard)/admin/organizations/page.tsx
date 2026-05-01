"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { getOrganizations } from "@/lib/api";
import type { OrgItem } from "@/lib/api";
import { OrgTable } from "@/components/admin/OrgTable";

function countByStatus(orgs: OrgItem[], status: string) {
  return orgs.filter((o) => o.status === status).length;
}

function Pill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <span className={`text-sm font-medium ${color}`}>
      {count} {label}
    </span>
  );
}

export default function AdminOrganizationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.replace("/cases");
    }
  }, [status, session, router]);

  const [organizations, setOrganizations] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await getOrganizations();
      setOrganizations(res.organizations);
    } catch {
      // keep existing state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const pending   = countByStatus(organizations, "PENDING_APPROVAL");
  const active    = countByStatus(organizations, "ACTIVE");
  const suspended = countByStatus(organizations, "SUSPENDED");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Organisation Management</h1>
        {!loading && (
          <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
            <Pill count={pending}   label={`pending approval`}  color={pending > 0 ? "text-amber-400" : "text-gray-500"} />
            <span>·</span>
            <Pill count={active}    label="active"    color="text-green-400" />
            <span>·</span>
            <Pill count={suspended} label="suspended" color={suspended > 0 ? "text-red-400" : "text-gray-500"} />
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-800" />
          ))}
        </div>
      ) : (
        <OrgTable organizations={organizations} onRefresh={loadOrgs} />
      )}
    </div>
  );
}
