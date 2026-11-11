"use client";

import Link from "next/link";
import { useApi } from "@/lib/client";
import { formatMoney, formatWhen, titleCaseStatus } from "@/lib/format";

type Row = { id: string; referenceCode: string; title: string; status: string; category: string | null; workflow: string; updatedAt: string; savingsPaise: number | null; currency: string; awardMode: string | null };

export default function ActionsPage() {
  const { data, error, loading } = useApi<{ requests: Row[] }>("/api/app/requests");
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Actions</p>
          <h1 className="text-2xl font-semibold">Procurement requests</h1>
        </div>
        <Link href="/actions/new" className="btn btn-primary">New request</Link>
      </div>
      {loading ? <p className="text-sm text-muted">Loading requests…</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Reference</th><th>Title</th><th>Status</th><th>Category</th><th>Updated</th><th>Savings</th></tr></thead>
          <tbody>
            {data?.requests.length ? data.requests.map((row) => (
              <tr key={row.id}>
                <td><Link className="font-semibold text-navy-2" href={`/actions/${row.id}`}>{row.referenceCode}</Link></td>
                <td>{row.title}</td>
                <td><span className={`badge ${row.status.includes("award") ? "badge-pine" : row.status === "live" ? "badge-navy" : "badge-slate"}`}>{titleCaseStatus(row.status)}</span> {row.awardMode === "demo" ? <span className="badge badge-amber">Demo</span> : null}</td>
                <td>{row.category || "—"}</td>
                <td>{formatWhen(row.updatedAt)}</td>
                <td className="tabular-nums">{row.savingsPaise == null ? "—" : formatMoney(row.savingsPaise, row.currency)}</td>
              </tr>
            )) : <tr><td colSpan={6} className="text-muted">No requests yet. Create one from a search, a manual form, or an uploaded sheet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
