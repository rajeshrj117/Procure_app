"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError, useApi } from "@/lib/client";
import { formatMoney, titleCaseStatus } from "@/lib/format";
import { useToast } from "@/components/providers";

type View = {
  companyName: string;
  currency: string;
  vendorName: string;
  badge: string | null;
  disclaimer: string;
  request: { referenceCode: string; title: string } | null;
  items: Array<{ id: string; productName: string; quantity: number | null; unit: string | null }>;
  negotiation: { status: string; agreedPaise: number | null; messages: Array<{ id: string; senderName: string; body: string; offerPaise: number | null; action: string }> };
};

export default function NegotiatePage() {
  const params = useParams<{ token: string }>();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<View>(`/api/app/negotiate-link/${params.token}`);
  const [offer, setOffer] = useState("");
  const [message, setMessage] = useState("");

  async function send(action: "counter" | "accept" | "reject" | "message") {
    try {
      await api(`/api/app/negotiate-link/${params.token}/message`, { method: "POST", body: JSON.stringify({ action, message: message || action, offerRupees: offer ? Number(offer) : null }) });
      toast("Response recorded.");
      setMessage("");
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not send.", "err");
    }
  }

  if (loading) return <main className="p-8 text-sm">Loading negotiation…</main>;
  if (error || !data) return <main className="p-8 text-sm text-red-700">{error}</main>;
  return (
    <main className="min-h-screen bg-paper px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="card p-4">
          <p className="text-xs uppercase tracking-wide text-muted">{data.companyName}</p>
          <h1 className="text-2xl font-semibold">{data.request?.title || "Direct negotiation"}</h1>
          <p className="text-sm">{data.vendorName} {data.badge ? <span className="badge badge-amber">{data.badge}</span> : null}</p>
          <p className="mt-2 text-sm text-muted">{data.disclaimer}</p>
          <p className="mt-1 text-sm">Status: {titleCaseStatus(data.negotiation.status)} {data.negotiation.agreedPaise ? `· ${formatMoney(data.negotiation.agreedPaise, data.currency)}` : ""}</p>
        </header>
        <section className="card space-y-2 p-4">
          {data.negotiation.messages.map((item) => <div key={item.id} className="rounded-xl bg-white px-3 py-2 text-sm"><strong>{item.senderName}</strong> · {item.action} {item.offerPaise ? formatMoney(item.offerPaise, data.currency) : ""}<div>{item.body}</div></div>)}
        </section>
        <section className="card space-y-3 p-4">
          <input className="control" placeholder="Counter amount" value={offer} onChange={(event) => setOffer(event.target.value)} />
          <textarea className="control min-h-20" placeholder="Message" value={message} onChange={(event) => setMessage(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => void send("counter")}>Counteroffer</button>
            <button className="btn btn-pine" onClick={() => void send("accept")}>Accept current offer</button>
            <button className="btn btn-ghost" onClick={() => void send("reject")}>Reject</button>
            <button className="btn btn-ghost" onClick={() => void send("message")}>Send message</button>
          </div>
        </section>
      </div>
    </main>
  );
}
