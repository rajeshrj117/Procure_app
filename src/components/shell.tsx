"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Bell, Building2, History, LayoutDashboard, ListChecks, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { clsx } from "@/lib/format";
import { useToast } from "./providers";

type Bootstrap = {
  actorType: "user" | "vendor";
  user?: { name: string; email: string; roleLabel: string };
  company?: { name: string; isDemo: boolean; currency: string };
  unread?: number;
  liveSessions?: number;
};

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/actions", label: "Actions", icon: ListChecks },
  { href: "/vendors", label: "Vendors", icon: Building2 },
  { href: "/history", label: "History", icon: History },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [notes, setNotes] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ type: string; label: string; href: string }>>([]);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; body: string; href: string | null; isRead: boolean }>>([]);

  useEffect(() => {
    api<Bootstrap>("/api/app/bootstrap")
      .then((data) => {
        if (data.actorType === "vendor") {
          router.replace("/portal");
          return;
        }
        setBoot(data);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/login");
      });
  }, [router]);

  useEffect(() => {
    setOpen(false);
    setMenu(false);
    setNotes(false);
  }, [path]);

  async function search(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    const data = await api<{ results: Array<{ type: string; label: string; href: string }> }>(`/api/app/search?q=${encodeURIComponent(value)}`);
    setHits(data.results);
  }

  async function openNotes() {
    setNotes((value) => !value);
    const data = await api<{ notifications: Array<{ id: string; title: string; body: string; href: string | null; isRead: boolean }> }>("/api/app/notifications");
    setNotifications(data.notifications);
  }

  async function logout() {
    await api("/api/app/auth/logout", { method: "POST" });
    toast("Signed out.");
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <aside className={clsx("fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy text-white transition-transform md:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-sm font-bold">S</div>
          <div>
            <div className="font-serif text-lg leading-none">Strata</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/55">Procurement OS</div>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = path === item.href || path.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm", active ? "bg-white/10 text-white" : "text-white/75 hover:bg-white/10 hover:text-white")}>
                <Icon size={18} />
                <span className="flex-1">{item.label}</span>
                {item.href === "/actions" && boot?.liveSessions ? <span className="rounded-full bg-pine px-2 py-0.5 text-[11px]">{boot.liveSessions}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs text-white/60">
          <div className="font-semibold text-white/85">{boot?.company?.name ?? "Workspace"}</div>
          <div className="mt-1">Company data stays isolated to this tenant.</div>
        </div>
      </aside>
      {open ? <button className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} aria-label="Close menu" /> : null}
      <div className="md:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur md:px-6">
          <button className="grid h-9 w-9 place-items-center rounded-lg border border-line md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="relative hidden min-w-0 flex-1 md:block">
            <Search size={16} className="absolute left-3 top-2.5 text-muted" />
            <input value={query} onChange={(event) => void search(event.target.value)} placeholder="Search requests, suppliers, references" className="control pl-9" />
            {hits.length ? (
              <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-white shadow-lg">
                {hits.map((hit) => (
                  <Link key={hit.href} href={hit.href} className="block px-3 py-2 text-sm hover:bg-paper" onClick={() => setHits([])}>
                    <span className="mr-2 text-[11px] uppercase tracking-wide text-muted">{hit.type}</span>
                    {hit.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/settings" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted hover:text-ink" aria-label="Settings">
              <Settings size={17} />
            </Link>
            <button className="relative grid h-9 w-9 place-items-center rounded-lg border border-line text-muted hover:text-ink" onClick={() => void openNotes()} aria-label="Notifications">
              <Bell size={17} />
              {boot?.unread ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-pine" /> : null}
            </button>
            <button className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-left" onClick={() => setMenu((value) => !value)}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-navy text-xs text-white">{boot?.user?.name?.slice(0, 1) ?? "U"}</span>
              <span className="hidden sm:block">
                <span className="block text-sm font-semibold leading-4">{boot?.user?.name ?? "Account"}</span>
                <span className="text-[11px] text-muted">{boot?.user?.roleLabel}</span>
              </span>
            </button>
          </div>
          {menu ? (
            <div className="absolute right-4 top-14 w-56 rounded-xl border border-line bg-white p-2 shadow-xl">
              <Link href="/settings" className="block rounded-lg px-3 py-2 text-sm hover:bg-paper">Account & settings</Link>
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-paper" onClick={() => void logout()}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          ) : null}
          {notes ? (
            <div className="absolute right-16 top-14 w-80 rounded-xl border border-line bg-white p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                Notifications
                <button onClick={() => setNotes(false)} aria-label="Close notifications"><X size={14} /></button>
              </div>
              <div className="max-h-80 space-y-2 overflow-auto">
                {notifications.length ? notifications.map((note) => (
                  <Link key={note.id} href={note.href || "/dashboard"} className="block rounded-lg bg-paper px-3 py-2 text-sm">
                    <div className="font-semibold">{note.title}</div>
                    <div className="text-muted">{note.body}</div>
                  </Link>
                )) : <div className="text-sm text-muted">No notifications.</div>}
              </div>
              <button className="mt-2 text-xs font-semibold text-navy-2" onClick={() => void api("/api/app/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) })}>Mark all read</button>
            </div>
          ) : null}
        </header>
        {boot?.company?.isDemo ? (
          <div className="border-b border-[#ead7b0] bg-amber-soft px-4 py-2 text-sm text-[#7a5410] md:px-6">
            Northwind is a demo workspace. Directory suppliers, historical awards, and prices are simulated seed data — not live market quotes.
          </div>
        ) : null}
        <main className="px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
