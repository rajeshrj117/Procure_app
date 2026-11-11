"use client";

import { useState } from "react";
import { useApi } from "@/lib/client";
import { formatWhen } from "@/lib/format";

type History = {
  activities: Array<{ id: string; actorName: string | null; action: string; entityType: string; entityId: string | null; metadata: Record<string, unknown> | null; createdAt: string }>;
  emails: Array<{ id: string; to: string; subject: string; status: string; error: string | null; createdAt: string; bodyText: string }>;
};

export default function HistoryPage() {
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading } = useApi<History>(`/api/app/history?q=${encodeURIComponent(q)}&entity=${encodeURIComponent(entity)}`);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">History</p>
        <h1 className="text-2xl font-semibold">Audit trail</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="control max-w-sm" placeholder="Filter by product, supplier, user, action" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="control max-w-56" value={entity} onChange={(event) => setEntity(event.target.value)}>
          <option value="">All entities</option>
          <option value="procurement_request">Requests</option>
          <option value="negotiation">Negotiations</option>
          <option value="document">Documents</option>
          <option value="assistant">AI activity</option>
        </select>
      </div>
      {loading ? <p className="text-sm text-muted">Loading history…</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
          <tbody>
            {data?.activities.map((row) => (
              <tr key={row.id} onClick={() => setOpen(open === row.id ? null : row.id)}>
                <td>{formatWhen(row.createdAt)}</td>
                <td>{row.actorName || row.entityType}</td>
                <td>{row.action}</td>
                <td>{row.entityId || "—"}{open === row.id ? <pre className="mt-2 whitespace-pre-wrap text-xs text-muted">{JSON.stringify(row.metadata, null, 2)}</pre> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card p-4">
        <h2 className="font-semibold">Email delivery</h2>
        <div className="mt-3 space-y-2 text-sm">
          {data?.emails.map((row) => (
            <details key={row.id} className="rounded-xl border border-line px-3 py-2">
              <summary>{formatWhen(row.createdAt)} · {row.to} · {row.status} · {row.subject}</summary>
              <p className="mt-2 text-muted">{row.error}</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs">{row.bodyText}</pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
