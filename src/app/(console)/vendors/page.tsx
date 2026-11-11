"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError, useApi } from "@/lib/client";
import { useToast } from "@/components/providers";
import type { VendorDto } from "@/lib/types";

export default function VendorsPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [includeAi, setIncludeAi] = useState(false);
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useApi<{ vendors: VendorDto[] }>(`/api/app/vendors?q=${encodeURIComponent(q)}&includeAi=${includeAi ? "1" : "0"}`);


  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Vendors</p>
          <h1 className="text-2xl font-semibold">Supplier directory</h1>
        </div>
        <div className="flex gap-2">
          <a className="btn btn-ghost" href="/api/app/templates/vendors">Template</a>
          <label className="btn btn-ghost">Import<input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const formData = new FormData();
            formData.set("file", file);
            void api<{ created: number; errors: string[] }>("/api/app/vendors/import", { method: "POST", body: formData }).then((result) => { toast(`Imported ${result.created}. ${result.errors[0] || ""}`); void reload(); }).catch((err) => toast(err instanceof ApiError ? err.message : "Import failed", "err"));
          }} /></label>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>Add vendor</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="control max-w-sm" placeholder="Search name, city, category" value={q} onChange={(event) => setQ(event.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeAi} onChange={(event) => setIncludeAi(event.target.checked)} /> Show SIMULATED / AI DEMO profiles</label>
      </div>
      {loading ? <p className="text-sm text-muted">Loading suppliers…</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Company</th><th>Location</th><th>Categories</th><th>Status</th><th>Score</th><th>Portal</th></tr></thead>
          <tbody>
            {data?.vendors.map((vendor) => (
              <tr key={vendor.id}>
                <td><Link className="font-semibold text-navy-2" href={`/vendors/${vendor.id}`}>{vendor.name}</Link>{vendor.badge ? <div className="badge badge-amber mt-1">{vendor.badge}</div> : null}</td>
                <td>{vendor.city || "—"}, {vendor.state || vendor.country}</td>
                <td>{vendor.categories.join(", ") || "—"}</td>
                <td>{vendor.active ? vendor.verificationStatus : "Inactive"}</td>
                <td className="tabular-nums">{vendor.performanceScore} / {vendor.onTimeDeliveryRate}% on time</td>
                <td>{vendor.portalEnabled ? "Enabled" : "No access"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <form className="card max-h-[90vh] w-full max-w-lg overflow-auto p-5" onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            void api("/api/app/vendors", { method: "POST", body: JSON.stringify({
              name: formData.get("name"),
              email: formData.get("email"),
              contactPerson: formData.get("contactPerson"),
              phone: formData.get("phone"),
              city: formData.get("city"),
              country: "India",
              categories: String(formData.get("categories") || "").split(",").map((item) => item.trim()).filter(Boolean),
              gstNumber: formData.get("gstNumber"),
              paymentTerms: formData.get("paymentTerms"),
            }) }).then(async () => {
              toast("Supplier added. Source is recorded as company-entered, not independently verified.");
              setOpen(false);
              await reload();
            }).catch((err) => toast(err instanceof ApiError ? err.message : "Could not add supplier.", "err"));
          }}>
            <h2 className="text-xl font-semibold">Add vendor</h2>
            <div className="mt-3 grid gap-3">
              <label className="field"><span>Company name</span><input name="name" className="control" required /></label>
              <label className="field"><span>Email</span><input name="email" type="email" className="control" required /></label>
              <label className="field"><span>Contact desk</span><input name="contactPerson" className="control" /></label>
              <label className="field"><span>Phone</span><input name="phone" className="control" /></label>
              <label className="field"><span>City</span><input name="city" className="control" /></label>
              <label className="field"><span>Categories, comma separated</span><input name="categories" className="control" /></label>
              <label className="field"><span>GST</span><input name="gstNumber" className="control" /></label>
              <label className="field"><span>Payment terms</span><input name="paymentTerms" className="control" /></label>
            </div>
            <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary">Save</button></div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
