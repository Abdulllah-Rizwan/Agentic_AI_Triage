"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  FileText,
  LayoutDashboard,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useSocket } from "@/lib/socket";

const navItems = [
  { href: "/cases", label: "Cases", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/resources", label: "Resources", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

const adminItems = [
  { href: "/admin/knowledge", label: "Knowledge Base", icon: FileText },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/system", label: "System Health", icon: AlertTriangle },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isConnected } = useSocket(session?.user?.access_token, session?.user?.org_id);

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="flex h-full w-60 flex-col border-r border-gray-800 bg-gray-900">
        <div className="flex h-16 items-center px-6">
          <span className="text-lg font-bold text-white">MediReach</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                pathname === href || pathname.startsWith(href + "/")
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        {session?.user?.role === "ADMIN" && (
          <div className="border-t border-gray-800 px-3 py-4">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Admin
            </p>
            <nav className="space-y-1">
              {adminItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    pathname === href || pathname.startsWith(href + "/")
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-16 items-center justify-between border-b border-gray-800 bg-gray-900 px-6">
          <span className="text-sm font-medium text-gray-300">
            {session?.user?.org_name ?? ""}
          </span>
          <div className="flex items-center gap-2 text-xs">
            {isConnected ? (
              <>
                <Wifi size={14} className="text-green-400" />
                <span className="text-green-400">Connected</span>
              </>
            ) : (
              <>
                <WifiOff size={14} className="text-gray-500" />
                <span className="text-gray-500">Disconnected</span>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-gray-950 p-6">{children}</main>
      </div>
    </div>
  );
}
