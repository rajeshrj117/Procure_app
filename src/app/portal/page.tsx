"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/lib/client";

type Portal = {
  vendor: { name: string; badge: string | null; email: string };
  companyName: string;
  invitations: Array<{ id: string; token: string; status: string; request: string; reference: string }>;
  negotiations: Array<{ id: string; status: string; token: string; agreedPaise: number | null }>;
  notifications: Array<{ id: string; title: string; body: string; href: string | null }>;
};

export default function PortalPage() {
  const router = useRouter();
  const { data, error, loading } = useApi<Portal>("/api/app/portal");
  if (loading) return <main className="p-8 text-sm text-muted">Loading portal…</main>;
  if (error || !data) return <main className="p-8 text-sm text-red-700">{error} <button className="underline" onClick={() => router.push("/vendor/login")}>Sign in</button></main>;
  return (
    <main className="min-h-screen bg-paper px-4 py-6 md:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{data.companyName}</p>
            <h1 className="text-2xl font-semibold">{data.vendor.name}</h1>
            {data.vendor.badge ? <span className="badge badge-amber mt-2">{data.vendor.badge}</span> : null}
          </div>
          <button className="btn btn-ghost" onClick={() => void api("/api/app/auth/logout", { method: "POST" }).then(() => router.push("/vendor/login"))}>Sign out</button>
        </header>
        <section className="card p-4">
          <h2 className="font-semibold">Invitations</h2>
          <div className="mt-3 space-y-2">
            {data.invitations.map((row) => (
              <Link key={row.id} href={`/bid/${row.token}`} className="block rounded-xl border border-line px-3 py-2 text-sm">
                <strong>{row.reference}</strong> · {row.request} · {row.status}
              </Link>
            ))}
          </div>
        </section>
        <section className="card p-4">
          <h2 className="font-semibold">Negotiations</h2>
          <div className="mt-3 space-y-2">{data.negotiations.map((row) => <Link key={row.id} className="block text-sm" href={`/negotiate/${row.token}`}>{row.status} · open thread</Link>)}</div>
        </section>
        <section className="card p-4">
          <h2 className="font-semibold">Notices</h2>
          <ul className="mt-2 space-y-2 text-sm">{data.notifications.map((row) => <li key={row.id}><strong>{row.title}.</strong> {row.body}</li>)}</ul>
        </section>
      </div>
    </main>
  );
}
