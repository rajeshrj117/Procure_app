"use client";

import { useState } from "react";
import { CategoryChart, ParticipationChart } from "@/components/charts";
import { api, useApi } from "@/lib/client";
import { formatMoney } from "@/lib/format";

type Report = {
  currency: string;
  disclaimer: string;
  summary: { expenditurePaise: number; savingsPaise: number; savingsPercent: number | null; requests: number; awarded: number; negotiations: number; agreed: number; averageReductionPercent: number | null };
  purchases: Array<{ reference: string; title: string; category: string | null; vendor: string; awardedPaise: number | null; savingsPaise: number | null; awardMode: string | null }>;
  participation: Array<{ vendor: string; badge: string | null; invited: number; responded: number; wins: number; onTime: number }>;
  bidding: Array<{ request: string | undefined; bids: number; lowestPaise: number | null; highestPaise: number | null; extensions: number }>;
  negotiations: Array<{ request: string | undefined; vendor: string; status: string; agreedPaise: number | null }>;
  ai: Array<{ action: string; detail: string; createdAt: string }>;
};

export default function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data, error, loading } = useApi<Report>(`/api/app/reports?from=${from}&to=${to}`);

  async function download(format: string) {
    const res = await fetch(`/api/app/reports/export?format=${format}&from=${from}&to=${to}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `strata-procurement.${format === "excel" ? "xlsx" : format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Reports</p>
          <h1 className="text-2xl font-semibold">Procurement analytics</h1>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => void download("csv")}>CSV</button>
          <button className="btn btn-ghost" onClick={() => void download("excel")}>Excel</button>
          <button className="btn btn-primary" onClick={() => void download("pdf")}>PDF</button>
        </div>
      </div>
      <div className="flex gap-2">
        <input type="date" className="control max-w-44" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input type="date" className="control max-w-44" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      {loading ? <p className="text-sm text-muted">Building report…</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {data ? (
        <>
          <p className="text-sm text-[#7a5410]">{data.disclaimer}</p>
          <section className="grid gap-3 md:grid-cols-4">
            {[
              ["Expenditure", formatMoney(data.summary.expenditurePaise, data.currency)],
              ["Net savings", formatMoney(data.summary.savingsPaise, data.currency)],
              ["Savings %", data.summary.savingsPercent == null ? "—" : `${data.summary.savingsPercent.toFixed(1)}%`],
              ["Avg bid reduction", data.summary.averageReductionPercent == null ? "—" : `${data.summary.averageReductionPercent.toFixed(1)}%`],
            ].map(([label, value]) => <article key={label} className="card p-4"><div className="text-xs uppercase text-muted">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></article>)}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="card p-4"><h2 className="mb-3 font-semibold">Savings by category</h2><CategoryChart data={Object.values(data.purchases.reduce<Record<string, { category: string; savings: number }>>((map, row) => { const key = row.category || "Other"; map[key] = { category: key, savings: (map[key]?.savings || 0) + Math.max(row.savingsPaise || 0, 0) / 100 }; return map; }, {}))} /></article>
            <article className="card p-4"><h2 className="mb-3 font-semibold">Participation</h2><ParticipationChart data={data.participation.slice(0, 6).map((row) => ({ name: row.vendor.split(" ")[0] || row.vendor, invited: row.invited, responded: row.responded }))} /></article>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Request</th><th>Supplier</th><th>Awarded</th><th>Savings</th><th>Mode</th></tr></thead>
              <tbody>{data.purchases.map((row) => <tr key={row.reference}><td>{row.reference} · {row.title}</td><td>{row.vendor}</td><td>{formatMoney(row.awardedPaise, data.currency)}</td><td>{formatMoney(row.savingsPaise, data.currency)}</td><td>{row.awardMode || "—"}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Session</th><th>Bids</th><th>Lowest</th><th>Highest</th><th>Extensions</th></tr></thead>
              <tbody>{data.bidding.map((row) => <tr key={row.request}><td>{row.request}</td><td>{row.bids}</td><td>{formatMoney(row.lowestPaise, data.currency)}</td><td>{formatMoney(row.highestPaise, data.currency)}</td><td>{row.extensions}</td></tr>)}</tbody>
            </table>
          </div>
          <section className="card p-4">
            <h2 className="font-semibold">Direct negotiations</h2>
            <ul className="mt-2 text-sm">{data.negotiations.map((row, index) => <li key={`${row.request}-${index}`}>{row.request} · {row.vendor} · {row.status} · {formatMoney(row.agreedPaise, data.currency)}</li>)}</ul>
          </section>
          <section className="card p-4">
            <h2 className="font-semibold">AI vendor simulation</h2>
            <ul className="mt-2 text-sm">{data.ai.length ? data.ai.map((row, index) => <li key={index}>{row.detail}</li>) : <li>No simulation activity yet. Enable AI vendors in settings.</li>}</ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
