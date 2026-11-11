"use client";

import Link from "next/link";
import { useState } from "react";
import { CategoryChart, ParticipationChart, PerformanceChart, SpendChart } from "@/components/charts";
import { useToast } from "@/components/providers";
import { api, useApi } from "@/lib/client";
import { formatMoney, formatWhen, titleCaseStatus } from "@/lib/format";

type Dashboard = {
  currency: string;
  isDemo: boolean;
  kpis: { requests: number; liveSessions: number; vendors: number; invited: number; bids: number; pendingResponses: number; completedDeals: number; savingsPaise: number; avgSavingsPercent: number | null };
  charts: {
    monthly: Array<{ month: string; spend: number; estimated: number }>;
    savingsByCategory: Array<{ category: string; savings: number }>;
    vendorPerformance: Array<{ name: string; score: number; onTime: number }>;
    participation: Array<{ name: string; invited: number; responded: number }>;
    priceTrend: Array<{ month: string; price: number; vendor: string }>;
  };
  upcoming: Array<{ requestId: string; referenceCode: string; title: string; endsAt: string; phase: string }>;
  recent: Array<{ id: string; action: string; actorName: string | null; createdAt: string }>;
  bestVendors: Array<{ id: string; name: string; badge: string | null; score: number; onTime: number; city: string | null }>;
  notes: string[];
};

const prompts = [
  "Find the cheapest iron rod grade 2 vendors",
  "Which vendor offered the lowest price in the last awarded steel purchase?",
  "Which vendors have the best delivery record?",
  "Show vendors whose iron rod prices are above the workspace average",
];

export default function DashboardPage() {
  const toast = useToast();
  const { data, error, loading } = useApi<Dashboard>("/api/app/dashboard");
  const [question, setQuestion] = useState(prompts[0]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function ask(text = question) {
    setAsking(true);
    try {
      const result = await api<{ answer: string; source: string; warnings: string[] }>("/api/app/assistant", { method: "POST", body: JSON.stringify({ question: text }) });
      setAnswer(`${result.answer}\n\nSource: ${result.source === "grok" ? "Grok, grounded in workspace records" : "Workspace records"}. ${result.warnings[0] ?? ""}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Assistant failed.", "err");
    } finally {
      setAsking(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading control room…</p>;
  if (error || !data) return <p className="text-sm text-red-700">{error || "Could not load the dashboard."}</p>;
  const cards = [
    ["Procurement requests", data.kpis.requests],
    ["Active bidding", data.kpis.liveSessions],
    ["Suppliers", data.kpis.vendors],
    ["Invited suppliers", data.kpis.invited],
    ["Bids received", data.kpis.bids],
    ["Pending responses", data.kpis.pendingResponses],
    ["Completed deals", data.kpis.completedDeals],
    ["Recorded savings", formatMoney(data.kpis.savingsPaise, data.currency)],
    ["Avg. savings", data.kpis.avgSavingsPercent == null ? "—" : `${data.kpis.avgSavingsPercent.toFixed(1)}%`],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Dashboard</p>
          <h1 className="mt-1 text-2xl font-semibold">Procurement control room</h1>
        </div>
        <Link href="/actions/new" className="btn btn-primary">New request</Link>
      </div>
      {data.notes.map((note) => <div key={note} className="rounded-xl border border-[#ead7b0] bg-amber-soft px-4 py-3 text-sm text-[#7a5410]">{note}</div>)}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value]) => (
          <article key={label} className="card px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          </article>
        ))}
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <article className="card p-4"><h2 className="mb-3 font-semibold">Estimated versus actual</h2><SpendChart data={data.charts.monthly} /></article>
        <article className="card p-4"><h2 className="mb-3 font-semibold">Savings by category</h2><CategoryChart data={data.charts.savingsByCategory} /></article>
        <article className="card p-4"><h2 className="mb-3 font-semibold">Supplier performance</h2><PerformanceChart data={data.charts.vendorPerformance} /></article>
        <article className="card p-4"><h2 className="mb-3 font-semibold">Bidding participation</h2><ParticipationChart data={data.charts.participation} /></article>
      </section>
      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="card p-4">
          <h2 className="font-semibold">Procurement assistant</h2>
          <p className="mt-1 text-sm text-muted">Answers use stored quotations only. If Grok is configured, its draft is discarded when it introduces figures that are not in the workspace.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {prompts.map((prompt) => <button key={prompt} className="rounded-full border border-line px-3 py-1 text-xs" onClick={() => { setQuestion(prompt); void ask(prompt); }}>{prompt}</button>)}
          </div>
          <textarea className="control mt-3 min-h-20" value={question} onChange={(event) => setQuestion(event.target.value)} />
          <button className="btn btn-primary mt-3" disabled={asking} onClick={() => void ask()}>{asking ? "Checking records…" : "Ask"}</button>
          {answer ? <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-paper p-3 text-sm">{answer}</pre> : null}
        </article>
        <div className="space-y-4">
          <article className="card p-4">
            <h2 className="font-semibold">Upcoming deadlines</h2>
            <div className="mt-3 space-y-2">
              {data.upcoming.length ? data.upcoming.map((item) => (
                <Link key={item.requestId} href={`/actions/${item.requestId}`} className="block rounded-xl border border-line px-3 py-2 text-sm">
                  <div className="font-semibold">{item.referenceCode} · {item.title}</div>
                  <div className="text-muted">{titleCaseStatus(item.phase)} · closes {formatWhen(item.endsAt)}</div>
                </Link>
              )) : <p className="text-sm text-muted">No open deadlines.</p>}
            </div>
          </article>
          <article className="card p-4">
            <h2 className="font-semibold">Best recorded suppliers</h2>
            <div className="mt-3 space-y-2">
              {data.bestVendors.map((vendor) => (
                <Link key={vendor.id} href={`/vendors/${vendor.id}`} className="flex items-center justify-between rounded-xl bg-paper px-3 py-2 text-sm">
                  <span>{vendor.name} {vendor.badge ? <em className="ml-1 text-xs not-italic text-[#8a5a10]">{vendor.badge}</em> : null}</span>
                  <span className="tabular-nums text-muted">{vendor.score} · {vendor.onTime}% on time</span>
                </Link>
              ))}
            </div>
          </article>
          <article className="card p-4">
            <h2 className="font-semibold">Recent activity</h2>
            <div className="mt-3 space-y-2 text-sm">
              {data.recent.map((item) => <div key={item.id} className="flex justify-between gap-3"><span>{item.action.replaceAll(".", " · ")}</span><span className="text-muted">{item.actorName}</span></div>)}
            </div>
          </article>
        </div>
      </section>
      {data.charts.priceTrend.length ? (
        <article className="card p-4">
          <h2 className="font-semibold">Iron rod directory price history</h2>
          <p className="mb-3 text-sm text-muted">Demo price history, not a market index.</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Month</th><th>Supplier</th><th>Rate</th></tr></thead>
              <tbody>{data.charts.priceTrend.slice(-8).map((row, index) => <tr key={`${row.vendor}-${index}`}><td>{row.month}</td><td>{row.vendor}</td><td>{formatMoney(Math.round(row.price * 100), data.currency)} / KG</td></tr>)}</tbody>
            </table>
          </div>
        </article>
      ) : null}
    </div>
  );
}
