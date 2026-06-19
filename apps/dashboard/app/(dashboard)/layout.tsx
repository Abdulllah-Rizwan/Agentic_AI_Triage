"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import MedicalCrossLogo from "@/components/MedicalCrossLogo";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings,
  Stethoscope,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useSocket } from "@/lib/socket";
import { useTheme } from "@/components/ThemeProvider";

const baseNavItems = [
  { href: "/cases",        label: "Cases",        icon: LayoutDashboard },
  { href: "/analytics",    label: "Analytics",    icon: BarChart3 },
  { href: "/appointments", label: "Appointments", icon: CalendarDays, hospitalOnly: true },
  { href: "/resources",    label: "Resources",    icon: BookOpen },
  { href: "/settings",     label: "Settings",     icon: Settings },
];

const baseAdminItems = [
  { href: "/admin/knowledge",     label: "Knowledge Base", icon: FileText,      hospitalOnly: false },
  { href: "/admin/practitioners", label: "Practitioners",  icon: Stethoscope,   hospitalOnly: false },
  { href: "/admin/organizations", label: "Organizations",  icon: Building2,     hospitalOnly: false },
  { href: "/admin/system",        label: "System Health",  icon: AlertTriangle, hospitalOnly: false },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isConnected } = useSocket(session?.user?.access_token, session?.user?.org_id);
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggle } = useTheme();

  const isHospital = session?.user?.org_type === "HOSPITAL";
  const navItems   = baseNavItems.filter((i) => !i.hospitalOnly || isHospital);
  const adminItems = baseAdminItems.filter((i) => !i.hospitalOnly || isHospital);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const linkClass = (href: string) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive(href)
        ? "bg-gray-800 text-white"
        : "text-gray-400 hover:bg-gray-800 hover:text-white"
    }`;

  return (
    <div className="flex h-screen bg-gray-950">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className={`relative flex h-full flex-col border-r border-gray-800 bg-gray-900 transition-all duration-200 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        {/* Logo / brand */}
        <div className="flex h-16 items-center px-4 overflow-hidden">
          {collapsed ? (
            <MedicalCrossLogo size={32} />
          ) : (
            <div className="flex items-center gap-2">
              <MedicalCrossLogo size={36} className="shrink-0" />
              <span className="text-lg font-bold text-white truncate">MediReach</span>
            </div>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 px-2 py-2">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`${linkClass(href)} ${collapsed ? "justify-center px-0" : ""}`}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          ))}
        </nav>

        {/* Admin section */}
        {session?.user?.role === "ADMIN" && (
          <div className="border-t border-gray-800 px-2 py-4">
            {!collapsed && (
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Admin
              </p>
            )}
            <nav className="space-y-1">
              {adminItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  title={collapsed ? label : undefined}
                  className={`${linkClass(href)} ${collapsed ? "justify-center px-0" : ""}`}
                >
                  <Icon size={16} className="shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              ))}
            </nav>
          </div>
        )}

        {/* Sign out */}
        <div className="border-t border-gray-800 px-2 py-3">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title={collapsed ? "Sign out" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white ${
              collapsed ? "justify-center px-0" : ""
            }`}
          >
            <LogOut size={16} className="shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>

        {/* Collapse toggle — pinned to the right edge */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="absolute -right-3 top-[72px] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-700 bg-gray-900 text-gray-400 shadow transition-colors hover:bg-gray-800 hover:text-white"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-16 items-center justify-between border-b border-gray-800 bg-gray-900 px-6">
          <span className="text-sm font-medium text-gray-300 truncate">
            {session?.user?.org_name ?? ""}
          </span>
          <div className="flex items-center gap-4 shrink-0">
            {/* Theme toggle */}
            <button
              onClick={toggle}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200"
            >
              {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>

            {/* Socket status */}
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
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-gray-950 p-6">{children}</main>
      </div>
    </div>
  );
}
