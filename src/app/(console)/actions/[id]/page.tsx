"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, useApi } from "@/lib/client";
import { formatDuration, formatMoney, formatWhen, remainingMs, titleCaseStatus } from "@/lib/format";
import { useToast } from "@/components/providers";
import type { DiscoverRow, ExtensionDto, InvitationDto, ItemDto, NegotiationDto, RankRow, RequestDto, SessionDto } from "@/lib/types";

type Dossier = {
  request: RequestDto;
  items: ItemDto[];
  session: SessionDto | null;
  invitations: InvitationDto[];
  ranking: RankRow[];
  operationalRanking: RankRow[];
  aiRanking: RankRow[];
  extensions: ExtensionDto[];
  negotiations: NegotiationDto[];
  documents: Array<{ id: string; fileName: string; scanStatus: string }>;
  activities: Array<{ id: string; action: string; actorName: string | null; createdAt: string }>;
  serverNow: string;
};

const tabs = ["Overview", "Requirements", "Discover", "Invitations", "Live bidding", "Negotiation", "Documents", "Activity"] as const;

export default function RequestDeskPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Dossier>(`/api/app/requests/${params.id}`);
  const [tab, setTab] = useState<(typeof tabs)[number]>(search.get("tab") === "discover" ? "Discover" : "Overview");
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [query, setQuery] = useState(data?.items[0]?.productName || "Iron rod grade 2");
  const [results, setResults] = useState<DiscoverRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!data?.session || data.session.phase === "closed") return;
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [data?.session?.phase, reload]);
  useEffect(() => {
    if (data?.items[0]?.productName) setQuery(`${data.items[0].productName} ${data.items[0].grade || ""}`.trim());
  }, [data?.items]);

  const left = useMemo(() => data?.session ? formatDuration(remainingMs(data.session.endsAt, data.serverNow, now)) : "—", [data, now]);

  async function run(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      toast(ok);
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Action failed.", "err");
    }
  }

  if (loading) return <p className="text-sm text-muted">Opening request…</p>;
  if (error || !data) return <p className="text-sm text-red-700">{error}</p>;
  const { request, session } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{request.referenceCode}</p>
          <h1 className="text-2xl font-semibold">{request.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="badge badge-navy">{titleCaseStatus(session?.phase || request.status)}</span>
            <span className="badge badge-slate">{titleCaseStatus(request.visibilityMode)} visibility</span>
            {request.awardMode === "demo" ? <span className="badge badge-amber">Demo decision</span> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted">{session?.phase === "scheduled" ? "Opens in" : "Official time left"}</div>
          <div className="font-mono text-3xl tabular-nums">{session ? (session.phase === "scheduled" ? formatDuration(remainingMs(session.startsAt, data.serverNow, now)) : left) : "—"}</div>
          <div className="text-xs text-muted">{session ? `Closes ${formatWhen(session.endsAt)}` : "No session yet"}</div>
        </div>
      </div>
      <div className="flex gap-2 overflow-auto">
        {tabs.map((item) => <button key={item} className={`btn ${tab === item ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(item)}>{item}</button>)}
      </div>

      {tab === "Overview" ? (
        <section className="grid gap-4 md:grid-cols-3">
          <article className="card p-4"><div className="text-xs uppercase text-muted">Baseline</div><div className="mt-1 text-xl font-semibold">{formatMoney(request.baselinePaise, request.currency)}</div><p className="mt-2 text-sm text-muted">{request.baselineLabel || "No baseline recorded."}</p></article>
          <article className="card p-4"><div className="text-xs uppercase text-muted">Awarded</div><div className="mt-1 text-xl font-semibold">{formatMoney(request.awardedPaise, request.currency)}</div><p className="mt-2 text-sm text-muted">{request.savingsPaise == null ? "Savings are not calculated until a baseline and decision exist." : `Difference versus baseline: ${formatMoney(request.savingsPaise, request.currency)}`}</p></article>
          <article className="card p-4"><div className="text-xs uppercase text-muted">Delivery</div><div className="mt-1 font-semibold">{request.deliveryLocation || "Not set"}</div><p className="mt-2 text-sm text-muted">{request.expectedDeliveryDate ? formatWhen(request.expectedDeliveryDate) : "Date not set"}</p></article>
        </section>
      ) : null}

      {tab === "Requirements" ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Product</th><th>Grade</th><th>Qty</th><th>Unit</th><th>Target / unit</th><th>Confirmed</th></tr></thead>
            <tbody>{data.items.map((item) => <tr key={item.id}><td>{item.productName}</td><td>{item.grade || "—"}</td><td>{item.quantity ?? "—"}</td><td>{item.unit || "—"}</td><td>{formatMoney(item.targetPricePaise, request.currency)}</td><td>{item.confirmed ? "Yes" : "Needs review"}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}

      {tab === "Discover" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input className="control max-w-md" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className="btn btn-primary" onClick={() => void run(async () => {
              const found = await api<{ results: DiscoverRow[]; warnings: string[] }>(`/api/app/discover?q=${encodeURIComponent(query)}&location=${encodeURIComponent(request.deliveryCity || "")}`);
              setResults(found.results);
              setWarnings(found.warnings);
            }, "Directory searched.")}>Search suppliers</button>
            <button className="btn btn-ghost" onClick={() => setSelected(results.map((row) => row.vendorId).filter((id): id is string => Boolean(id)))}>Select all</button>
            <button className="btn btn-ghost" onClick={() => setSelected([])}>Deselect all</button>
            <button className="btn btn-pine" disabled={!selected.length} onClick={() => setInviteOpen(true)}>Invite Selected Vendors ({selected.length})</button>
          </div>
          {warnings.map((warning) => <p key={warning} className="text-sm text-[#7a5410]">{warning}</p>)}
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th></th><th>Supplier</th><th>Location</th><th>Product</th><th>Grade</th><th>Available</th><th>Price</th><th>Distance</th><th>Delivery</th><th>Rating</th><th>Contact</th><th>Updated</th><th>Source / verified</th></tr></thead>
              <tbody>
                {results.map((row) => (
                  <tr key={`${row.vendorId}-${row.productName}`}>
                    <td>{row.vendorId ? <input type="checkbox" checked={selected.includes(row.vendorId)} onChange={() => setSelected((current) => current.includes(row.vendorId!) ? current.filter((id) => id !== row.vendorId) : [...current, row.vendorId!])} /> : "—"}</td>
                    <td>{row.vendorName}{row.badge ? <div className="badge badge-amber mt-1">{row.badge}</div> : null}</td>
                    <td>{row.city || "—"}</td>
                    <td>{row.productName}</td>
                    <td>{row.grade || "—"}</td>
                    <td>{row.availableQty ?? "—"} {row.unit}</td>
                    <td>{formatMoney(row.pricePaise, request.currency)}</td>
                    <td>{row.distanceKm == null ? "Unknown" : `${row.distanceKm} km`}</td>
                    <td>{row.deliveryDays ?? "—"}</td>
                    <td>{row.rating ?? "—"}</td>
                    <td>{row.email || "—"}</td>
                    <td>{row.priceUpdatedAt ? formatWhen(row.priceUpdatedAt) : "—"}</td>
                    <td className="max-w-64 text-xs">{row.source}<div>{row.lastVerifiedAt ? formatWhen(row.lastVerifiedAt) : "Not verified"}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "Invitations" ? (
        <div className="space-y-3">
          <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>Invite Selected Vendors</button>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Supplier</th><th>Status</th><th>Email</th><th>Opened</th><th>Link</th></tr></thead>
              <tbody>
                {data.invitations.map((row) => (
                  <tr key={row.id}>
                    <td>{row.vendorName} {row.badge ? <span className="badge badge-amber">{row.badge}</span> : null} {row.simulationOnly ? <span className="badge badge-slate">Simulation only</span> : null}</td>
                    <td>{titleCaseStatus(row.status)}</td>
                    <td>{titleCaseStatus(row.emailStatus)}<div className="text-xs text-muted">{row.email}</div></td>
                    <td>{formatWhen(row.openedAt)}</td>
                    <td>{row.token && !row.simulationOnly ? <button className="text-sm font-semibold text-navy-2" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/bid/${row.token}`)}>Copy secure link</button> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "Live bidding" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={() => void run(() => api(`/api/app/requests/${request.id}/close`, { method: "POST" }), "Bidding closed.")}>Close session</button>
            <button className="btn btn-ghost" onClick={() => void run(() => api(`/api/app/requests/${request.id}/simulate`, { method: "POST", body: "{}" }), "AI simulation updated.")}>Run AI simulation</button>
            <select className="control max-w-56" value={session?.visibilityMode || request.visibilityMode} onChange={(event) => void run(() => api(`/api/app/requests/${request.id}/visibility`, { method: "POST", body: JSON.stringify({ visibilityMode: event.target.value }) }), "Visibility updated for this session.")}>
              <option value="open">Open bidding</option>
              <option value="anonymous">Anonymous bidding</option>
              <option value="blind">Blind bidding</option>
              <option value="company_only">Company-only bidding</option>
            </select>
          </div>
          <p className="text-sm text-muted">Operational ranking excludes SIMULATED / AI DEMO bids. Demo directory suppliers stay badged and cannot be treated as a live market.</p>
          <Ranking title="Decision board" rows={data.ranking} currency={request.currency} onAward={(vendorId, demo) => void run(() => api(`/api/app/requests/${request.id}/award`, { method: "POST", body: JSON.stringify({ vendorId, closeNow: true, acknowledgeDemo: demo ? ack : false }) }), "Decision recorded.")} ack={ack} setAck={setAck} />
          {data.operationalRanking.length !== data.ranking.length ? <p className="text-sm text-muted">Operational-only rows: {data.operationalRanking.length}. The board above includes demo directory quotations where present.</p> : null}
          <Ranking title="AI simulation board — SIMULATED / AI DEMO" rows={data.aiRanking} currency={request.currency} />
          <article className="card p-4">
            <h2 className="font-semibold">Extension requests</h2>
            <p className="mt-1 text-sm text-muted">Approval changes the official schedule for every invited supplier. It is never applied to one vendor only.</p>
            <div className="mt-3 space-y-3">
              {data.extensions.length ? data.extensions.map((row) => (
                <div key={row.id} className="rounded-xl border border-line p-3 text-sm">
                  <div className="font-semibold">{row.vendorName} · {row.requestedMinutes} min · {titleCaseStatus(row.status)}</div>
                  <p className="mt-1">{row.reason}</p>
                  {row.message ? <p className="text-muted">{row.message}</p> : null}
                  {row.status === "pending" ? (
                    <div className="mt-2 flex gap-2">
                      <button className="btn btn-pine" onClick={() => void run(() => api(`/api/app/extensions/${row.id}/review`, { method: "POST", body: JSON.stringify({ decision: "approve", approvedMinutes: row.requestedMinutes, note: "Approved for every invited supplier." }) }), "Schedule updated for all suppliers.")}>Approve</button>
                      <button className="btn btn-ghost" onClick={() => void run(() => api(`/api/app/extensions/${row.id}/review`, { method: "POST", body: JSON.stringify({ decision: "reject", note: "Deadline unchanged." }) }), "Request declined.")}>Reject</button>
                      <button className="btn btn-ghost" onClick={() => void run(() => api(`/api/app/extensions/${row.id}/review`, { method: "POST", body: JSON.stringify({ decision: "clarification", note: "Please add the operational reason." }) }), "Clarification requested.")}>Ask for clarification</button>
                    </div>
                  ) : null}
                </div>
              )) : <p className="text-sm text-muted">No extension requests.</p>}
            </div>
          </article>
        </section>
      ) : null}

      {tab === "Negotiation" ? <NegotiationPanel requestId={request.id} currency={request.currency} vendors={data.invitations} negotiations={data.negotiations} onDone={() => void reload()} /> : null}
      {tab === "Documents" ? (
        <div className="space-y-3">
          <label className="btn btn-ghost">Upload supporting file<input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.set("file", file); form.set("requestId", request.id); void run(() => api("/api/app/documents", { method: "POST", body: form }), "Document stored."); }} /></label>
          <ul className="text-sm">{data.documents.map((doc) => <li key={doc.id}><a className="font-semibold text-navy-2" href={`/api/app/documents/${doc.id}`}>{doc.fileName}</a> · scan {doc.scanStatus}</li>)}</ul>
        </div>
      ) : null}
      {tab === "Activity" ? <ul className="space-y-2 text-sm">{data.activities.map((item) => <li key={item.id} className="card px-3 py-2">{formatWhen(item.createdAt)} · {item.actorName || "System"} · {item.action}</li>)}</ul> : null}
      {inviteOpen ? <InviteDrawer requestId={request.id} vendorIds={selected.length ? selected : data.invitations.map((row) => row.vendorId)} onClose={() => setInviteOpen(false)} onDone={() => { setInviteOpen(false); void reload(); }} /> : null}
    </div>
  );
}

function Ranking({ title, rows, currency, onAward, ack, setAck }: { title: string; rows: RankRow[]; currency: string; onAward?: (vendorId: string, demo: boolean) => void; ack?: boolean; setAck?: (value: boolean) => void }) {
  return (
    <article className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3 font-semibold">{title}</div>
      <table className="data">
        <thead><tr><th>Rank</th><th>Supplier</th><th>Bid amount</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.bidId}>
              <td>{row.rank}</td>
              <td>{row.vendorName} {row.badge ? <span className="badge badge-amber">{row.badge}</span> : null}</td>
              <td className="tabular-nums">{formatMoney(row.amountPaise, currency)} {row.isFinal ? <span className="badge badge-navy">Final</span> : null}</td>
              <td>{row.status}</td>
              <td>{onAward && row.simulationKind !== "ai_demo" ? (
                <div className="flex items-center gap-2">
                  {row.badge ? <label className="text-xs"><input type="checkbox" checked={ack} onChange={(event) => setAck?.(event.target.checked)} /> Demo only</label> : null}
                  <button className="btn btn-ghost" onClick={() => onAward(row.vendorId, Boolean(row.badge))}>Select</button>
                </div>
              ) : <span className="text-xs text-muted">{row.simulationKind === "ai_demo" ? "Not awardable" : ""}</span>}</td>
            </tr>
          )) : <tr><td colSpan={5}>No quotations on this board.</td></tr>}
        </tbody>
      </table>
    </article>
  );
}

function InviteDrawer({ requestId, vendorIds, onClose, onDone }: { requestId: string; vendorIds: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const start = new Date();
  const end = new Date(Date.now() + 24 * 3600000);
  const [startsAt, setStartsAt] = useState(toLocal(start));
  const [endsAt, setEndsAt] = useState(toLocal(end));
  const [visibilityMode, setVisibility] = useState("anonymous");
  const [minIncrementRupees, setIncrement] = useState(500);
  const [terms, setTerms] = useState("Submit a total landed quotation. A recorded decision is not an e-signed contract.");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <form className="card max-h-[90vh] w-full max-w-xl overflow-auto p-5" onSubmit={(event) => {
        event.preventDefault();
        void api(`/api/app/requests/${requestId}/invite`, { method: "POST", body: JSON.stringify({ vendorIds, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), visibilityMode, minIncrementRupees, terms }) })
          .then(() => { toast("Invitations recorded. Secure links are ready; email sends only when a provider is configured."); onDone(); })
          .catch((error) => toast(error instanceof ApiError ? error.message : "Invite failed.", "err"));
      }}>
        <h2 className="text-xl font-semibold">Invite Selected Vendors</h2>
        <p className="mt-1 text-sm text-muted">{vendorIds.length} selected. The same schedule is sent to every supplier.</p>
        <label className="field mt-3"><span>Bidding opens</span><input type="datetime-local" className="control" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <label className="field mt-3"><span>Bidding closes</span><input type="datetime-local" className="control" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
        <label className="field mt-3"><span>Visibility</span>
          <select className="control" value={visibilityMode} onChange={(event) => setVisibility(event.target.value)}>
            <option value="open">Open — names and prices visible</option>
            <option value="anonymous">Anonymous — prices without names</option>
            <option value="blind">Blind — no competitor prices</option>
            <option value="company_only">Company only</option>
          </select>
        </label>
        <label className="field mt-3"><span>Minimum improvement (INR)</span><input type="number" className="control" value={minIncrementRupees} onChange={(event) => setIncrement(Number(event.target.value))} /></label>
        <label className="field mt-3"><span>Terms</span><textarea className="control min-h-24" value={terms} onChange={(event) => setTerms(event.target.value)} /></label>
        <div className="mt-3 rounded-xl bg-paper p-3 text-sm text-muted">Preview: invitation includes company, requirement, quantity, delivery, open and close times, and a supplier-specific secure link. Demo addresses are logged, not delivered.</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Invite Selected Vendors</button>
        </div>
      </form>
    </div>
  );
}

function NegotiationPanel({ requestId, currency, vendors, negotiations, onDone }: { requestId: string; currency: string; vendors: InvitationDto[]; negotiations: NegotiationDto[]; onDone: () => void }) {
  const toast = useToast();
  const [vendorId, setVendorId] = useState(vendors[0]?.vendorId || "");
  const [offer, setOffer] = useState(100000);
  const [message, setMessage] = useState("Opening offer for the stated quantity, delivered to the site.");
  return (
    <div className="space-y-4">
      <form className="card grid gap-3 p-4 md:grid-cols-4" onSubmit={(event) => {
        event.preventDefault();
        void api(`/api/app/requests/${requestId}/negotiate`, { method: "POST", body: JSON.stringify({ vendorId, offerRupees: offer, message }) }).then(() => { toast("Offer sent."); onDone(); }).catch((error) => toast(error instanceof ApiError ? error.message : "Could not open negotiation.", "err"));
      }}>
        <select className="control" value={vendorId} onChange={(event) => setVendorId(event.target.value)}>{vendors.filter((row) => !row.simulationOnly).map((row) => <option key={row.vendorId} value={row.vendorId}>{row.vendorName}</option>)}</select>
        <input className="control" type="number" value={offer} onChange={(event) => setOffer(Number(event.target.value))} />
        <input className="control md:col-span-2" value={message} onChange={(event) => setMessage(event.target.value)} />
        <button className="btn btn-primary md:col-span-4 w-fit">Send direct offer</button>
      </form>
      {negotiations.map((row) => (
        <article key={row.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{row.vendorName} · {titleCaseStatus(row.status)} {row.badge ? <span className="badge badge-amber">{row.badge}</span> : null}</h3>
            <button className="btn btn-ghost" onClick={() => void api(`/api/app/negotiations/${row.id}/convert`, { method: "POST" }).then(onDone)}>Convert to bidding</button>
          </div>
          <p className="mt-1 text-sm text-muted">{row.disclaimer}</p>
          <div className="mt-3 space-y-2">
            {row.messages.map((item) => <div key={item.id} className="rounded-xl bg-paper px-3 py-2 text-sm"><strong>{item.senderName}</strong> · {item.action} {item.offerPaise ? `· ${formatMoney(item.offerPaise, currency)}` : ""}<div>{item.body}</div></div>)}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void api(`/api/app/negotiations/${row.id}/message`, { method: "POST", body: JSON.stringify({ action: "counter", message: String(form.get("message")), offerRupees: Number(form.get("offer")) }) }).then(() => { toast("Reply recorded."); onDone(); }).catch((error) => toast(error instanceof ApiError ? error.message : "Reply failed.", "err"));
          }}>
            <input name="offer" type="number" className="control max-w-40" placeholder="Amount" />
            <input name="message" className="control" placeholder="Counteroffer note" />
            <button className="btn btn-ghost">Counter</button>
          </form>
        </article>
      ))}
    </div>
  );
}

function toLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
