"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, useApi } from "@/lib/client";
import { formatDuration, formatMoney, formatWhen, remainingMs, titleCaseStatus } from "@/lib/format";
import { useToast } from "@/components/providers";

type BidRoom = {
  serverNow: string;
  companyName: string;
  timezone: string;
  currency: string;
  vendor: { name: string; badge: string | null; portalEnabled: boolean };
  request: { referenceCode: string; title: string; deliveryLocation: string | null; terms: string | null; maxBudgetPaise: number | null };
  items: Array<{ id: string; productName: string; grade: string | null; quantity: number | null; unit: string | null; specifications: string | null }>;
  session: { phase: string; startsAt: string; endsAt: string; visibilityMode: string; minIncrementPaise: number; extensionCount: number };
  documents: Array<{ id: string; fileName: string }>;
  ownBids: Array<{ id: string; amountPaise: number; note: string | null; isFinal: boolean; createdAt: string }>;
  ranking: Array<{ rank: number; vendorName: string; amountPaise: number; status: string; isYou?: boolean }> | null;
  ownRank: number | null;
  winningPricePaise: number | null;
  gapPaise: number | null;
  minimumNextPaise: number | null;
  lockedFinal: boolean;
  termsAccepted: boolean;
  extensions: Array<{ id: string; status: string; reason: string; companyNote: string | null }>;
  disclaimer: string;
};

export default function BidRoomPage() {
  const params = useParams<{ token: string }>();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<BidRoom>(`/api/app/bid/${params.token}`);
  const [now, setNow] = useState(Date.now());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [finalBid, setFinal] = useState(false);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(120);
  const [password, setPassword] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [reload]);

  if (loading) return <main className="grid min-h-screen place-items-center text-sm text-muted">Opening secure room…</main>;
  if (error || !data) return <main className="grid min-h-screen place-items-center px-6 text-sm text-red-700">{error}</main>;
  const clock = data.session.phase === "scheduled" ? remainingMs(data.session.startsAt, data.serverNow, now) : remainingMs(data.session.endsAt, data.serverNow, now);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/app/bid/${params.token}/submit`, { method: "POST", body: JSON.stringify({ amountRupees: Number(amount), note, isFinal: finalBid, acceptedTerms: true }) });
      toast("Quotation recorded. Previous bids are kept.");
      setAmount("");
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Bid rejected.", "err");
    }
  }

  return (
    <main className="min-h-screen bg-paper px-4 py-6 text-ink md:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{data.companyName}</p>
              <h1 className="text-2xl font-semibold">{data.request.title}</h1>
              <p className="text-sm text-muted">{data.request.referenceCode} · {data.vendor.name}</p>
              {data.vendor.badge ? <span className="badge badge-amber mt-2">{data.vendor.badge}</span> : null}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase text-muted">{titleCaseStatus(data.session.phase)}</div>
              <div className="font-mono text-2xl tabular-nums">{formatDuration(clock)}</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">{data.disclaimer}</p>
          {data.session.extensionCount ? <p className="mt-2 text-sm text-[#7a5410]">The official schedule was revised. Every invited supplier sees the same closing time: {formatWhen(data.session.endsAt, data.timezone)}.</p> : null}
        </header>
        <section className="card p-4">
          <h2 className="font-semibold">Requirement</h2>
          <ul className="mt-2 space-y-2 text-sm">{data.items.map((item) => <li key={item.id}>{item.productName} {item.grade ? `· ${item.grade}` : ""} · {item.quantity ?? "qty tbc"} {item.unit} {item.specifications ? `· ${item.specifications}` : ""}</li>)}</ul>
          {data.documents.length ? <div className="mt-2 text-sm">{data.documents.map((doc) => <a key={doc.id} className="mr-3 font-semibold text-navy-2" href={`/api/app/documents/${doc.id}?token=${params.token}`}>{doc.fileName}</a>)}</div> : null}
          <p className="mt-2 text-sm">Delivery: {data.request.deliveryLocation || "See buyer note"}</p>
          <p className="text-sm text-muted">Opens {formatWhen(data.session.startsAt, data.timezone)} · Closes {formatWhen(data.session.endsAt, data.timezone)} · Visibility {titleCaseStatus(data.session.visibilityMode)}</p>
        </section>
        <section className="card p-4">
          <h2 className="font-semibold">Your position</h2>
          {data.ranking ? (
            <table className="data mt-2">
              <thead><tr><th>Rank</th><th>Supplier</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>{data.ranking.map((row) => <tr key={`${row.rank}-${row.vendorName}`}><td>{row.rank}</td><td>{row.vendorName}</td><td>{formatMoney(row.amountPaise, data.currency)}</td><td>{row.status}</td></tr>)}</tbody>
            </table>
          ) : <p className="mt-2 text-sm text-muted">Competing prices are hidden in this visibility mode. Only the buyer sees the full ranking.</p>}
          <p className="mt-2 text-sm">Your rank: {data.ownRank ?? "—"}. {data.gapPaise != null && data.gapPaise > 0 ? `You are ${formatMoney(data.gapPaise, data.currency)} above the leading visible price.` : data.winningPricePaise ? "You are level with or ahead of the visible leading price." : ""}</p>
          <ul className="mt-2 text-sm text-muted">{data.ownBids.map((bid) => <li key={bid.id}>{formatWhen(bid.createdAt, data.timezone)} · {formatMoney(bid.amountPaise, data.currency)} {bid.isFinal ? "· final" : ""} {bid.note ? `· ${bid.note}` : ""}</li>)}</ul>
        </section>
        <form className="card space-y-3 p-4" onSubmit={submit}>
          <h2 className="font-semibold">Submit quotation</h2>
          <p className="text-sm text-muted">Enter the total price in {data.currency}. {data.minimumNextPaise ? `Your next price must be ${formatMoney(data.minimumNextPaise, data.currency)} or lower.` : "This will be your opening quotation."} Minimum step {formatMoney(data.session.minIncrementPaise, data.currency)}.</p>
          <input className="control" inputMode="decimal" placeholder="Total quotation" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <textarea className="control min-h-20" placeholder="Note to the buyer" value={note} onChange={(event) => setNote(event.target.value)} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> I accept the terms: {data.request.terms}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={finalBid} onChange={(event) => setFinal(event.target.checked)} /> Submit as final quotation. This cannot be revised.</label>
          <button className="btn btn-primary w-full" disabled={!accepted || data.lockedFinal || data.session.phase !== "live"}>Submit bid</button>
        </form>
        <form className="card space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void api(`/api/app/bid/${params.token}/extension`, { method: "POST", body: JSON.stringify({ reason, requestedMinutes: minutes, message: reason }) }).then(() => { toast("Request sent. If approved, every supplier gets the same new deadline."); void reload(); }).catch((err) => toast(err instanceof ApiError ? err.message : "Request failed", "err")); }}>
          <h2 className="font-semibold">Request More Time</h2>
          <textarea className="control min-h-20" placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <input className="control" type="number" min={15} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} />
          <button className="btn btn-ghost">Request More Time</button>
          {data.extensions.map((row) => <p key={row.id} className="text-sm">{titleCaseStatus(row.status)}: {row.reason} {row.companyNote ? `· ${row.companyNote}` : ""}</p>)}
        </form>
        {!data.vendor.portalEnabled ? (
          <form className="card space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void api(`/api/app/bid/${params.token}/activate`, { method: "POST", body: JSON.stringify({ password, contactName: data.vendor.name }) }).then(() => { window.location.href = "/portal"; }); }}>
            <h2 className="font-semibold">Save portal access</h2>
            <input type="password" className="control" placeholder="Create a portal password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <button className="btn btn-ghost">Activate portal</button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
