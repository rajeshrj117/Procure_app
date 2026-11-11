"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError, useApi } from "@/lib/client";
import { formatMoney, formatWhen } from "@/lib/format";
import { useToast } from "@/components/providers";
import type { VendorDto } from "@/lib/types";

type Detail = {
  vendor: VendorDto;
  catalog: Array<{ id: string; productName: string; grade: string | null; availableQty: number | null; unit: string | null; pricePaise: number; deliveryDays: number | null; source: string | null; lastVerifiedAt: string | null }>;
  priceHistory: Array<{ id: string; productName: string; pricePaise: number; source: string | null; recordedAt: string }>;
  quotations: Array<{ id: string; requestId: string; amountPaise: number; createdAt: string }>;
  invitations: number;
  documents: Array<{ id: string; fileName: string; scanStatus: string }>;
};

export default function VendorDetailPage() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Detail>(`/api/app/vendors/${params.id}`);
  const [password, setPassword] = useState<string | null>(null);
  const [product, setProduct] = useState("");
  const [grade, setGrade] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("KG");

  if (loading) return <p className="text-sm text-muted">Loading supplier…</p>;
  if (error || !data) return <p className="text-sm text-red-700">{error}</p>;
  const vendor = data.vendor;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{vendor.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {vendor.badge ? <span className="badge badge-amber">{vendor.badge}</span> : <span className="badge badge-slate">{vendor.verificationStatus}</span>}
            <span className="badge badge-navy">{vendor.active ? "Active" : "Inactive"}</span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted">{vendor.source}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => void api(`/api/app/vendors/${vendor.id}`, { method: "PATCH", body: JSON.stringify({ active: !vendor.active }) }).then(() => reload())}>{vendor.active ? "Deactivate" : "Activate"}</button>
          <button className="btn btn-primary" onClick={() => void api<{ password: string }>(`/api/app/vendors/${vendor.id}/portal`, { method: "POST", body: "{}" }).then((result) => setPassword(result.password)).catch((err) => toast(err instanceof ApiError ? err.message : "Portal access failed", "err"))}>Grant portal access</button>
        </div>
      </div>
      {password ? <div className="rounded-xl border border-[#ead7b0] bg-amber-soft p-3 text-sm">Portal password, shown once: <strong>{password}</strong></div> : null}
      <section className="grid gap-3 md:grid-cols-4">
        {[["Contact", vendor.contactPerson || "—"], ["Email", vendor.email], ["Phone", vendor.phone || "Not on file"], ["City", `${vendor.city || "—"}, ${vendor.country}`], ["GST", vendor.gstNumber || "Not on file"], ["Payment", vendor.paymentTerms || "—"], ["Score", String(vendor.performanceScore)], ["On time", `${vendor.onTimeDeliveryRate}%`]].map(([label, value]) => (
          <article key={label} className="card p-3"><div className="text-xs uppercase text-muted">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></article>
        ))}
      </section>
      <section className="card p-4">
        <h2 className="font-semibold">Catalog and quotations</h2>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          void api("/api/app/catalog", { method: "POST", body: JSON.stringify({ vendorId: vendor.id, productName: product, grade, priceRupees: Number(price), unit }) }).then(() => { toast("Catalog price recorded as company-entered."); setProduct(""); void reload(); }).catch((err) => toast(err instanceof ApiError ? err.message : "Could not save price", "err"));
        }}>
          <input className="control max-w-48" placeholder="Product" value={product} onChange={(event) => setProduct(event.target.value)} />
          <input className="control max-w-32" placeholder="Grade" value={grade} onChange={(event) => setGrade(event.target.value)} />
          <input className="control max-w-32" placeholder="Price / unit" value={price} onChange={(event) => setPrice(event.target.value)} />
          <input className="control max-w-24" value={unit} onChange={(event) => setUnit(event.target.value)} />
          <button className="btn btn-ghost">Add quoted price</button>
        </form>
        <div className="table-wrap mt-3">
          <table className="data">
            <thead><tr><th>Product</th><th>Grade</th><th>Available</th><th>Price</th><th>Delivery</th><th>Source</th><th>Last verified</th></tr></thead>
            <tbody>{data.catalog.map((item) => <tr key={item.id}><td>{item.productName}</td><td>{item.grade || "—"}</td><td>{item.availableQty ?? "—"} {item.unit}</td><td>{formatMoney(item.pricePaise)}</td><td>{item.deliveryDays ?? "—"} days</td><td className="max-w-64 text-xs">{item.source}</td><td>{item.lastVerifiedAt ? formatWhen(item.lastVerifiedAt) : "Not verified"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="card p-4"><h2 className="font-semibold">Price history</h2><ul className="mt-2 space-y-2 text-sm">{data.priceHistory.map((row) => <li key={row.id}>{formatWhen(row.recordedAt)} · {row.productName} · {formatMoney(row.pricePaise)} · {row.source}</li>)}</ul></article>
        <article className="card p-4"><h2 className="font-semibold">Previous quotations</h2><p className="text-sm text-muted">{data.invitations} invitations.</p><ul className="mt-2 space-y-2 text-sm">{data.quotations.map((row) => <li key={row.id}>{formatWhen(row.createdAt)} · {formatMoney(row.amountPaise)} · request {row.requestId}</li>)}</ul></article>
      </section>
      <section className="card p-4">
        <h2 className="font-semibold">Documents</h2>
        <label className="btn btn-ghost mt-3">Upload<input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.set("file", file); form.set("vendorId", vendor.id); void api("/api/app/documents", { method: "POST", body: form }).then(() => reload()); }} /></label>
        <ul className="mt-3 text-sm">{data.documents.map((doc) => <li key={doc.id}><a href={`/api/app/documents/${doc.id}`}>{doc.fileName}</a> · {doc.scanStatus}</li>)}</ul>
      </section>
    </div>
  );
}
