"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/client";
import { requestSchema } from "@/lib/validators";
import { useToast } from "@/components/providers";
import type { DiscoverRow, Interpretation } from "@/lib/types";

type FormValues = z.infer<typeof requestSchema>;
type Extracted = { productName: string; grade: string | null; quantity: number | null; unit: string | null; category: string | null; specifications: string | null; targetPriceRupees: number | null; confidence: number; extractionNote: string | null };

const sample = `Product,Grade,Quantity,Unit,Specifications,Target Price,Category
Iron Rod,Grade 2,5000,KG,TMT bar Fe500D,92,Steel
Steel Plate,Grade A,2000,KG,IS 2062,74,Steel`;

export default function NewRequestPage() {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"discovery" | "manual" | "document">("discovery");
  const [query, setQuery] = useState("Iron rod grade 2");
  const [location, setLocation] = useState("Pune");
  const [quantity, setQuantity] = useState("5000");
  const [unit, setUnit] = useState("KG");
  const [found, setFound] = useState<{ interpretation: Interpretation; results: DiscoverRow[]; warnings: string[]; interpretationSource: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [extracted, setExtracted] = useState<Extracted[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { title: "", workflow: "manual", visibilityMode: "anonymous", currency: "INR", items: [{ productName: "", quantity: 1, unit: "KG", confirmed: true, needsReview: false }] },
  });
  const lines = useFieldArray({ control: form.control, name: "items" });

  async function search() {
    const data = await api<{ interpretation: Interpretation; results: DiscoverRow[]; warnings: string[]; interpretationSource: string }>(`/api/app/discover?q=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`);
    setFound(data);
    setSelected([]);
  }

  async function createFromDiscovery() {
    if (!found?.interpretation.product) {
      toast("Enter a product the workspace can match.", "err");
      return;
    }
    const result = await api<{ id: string }>("/api/app/requests", {
      method: "POST",
      body: JSON.stringify({
        title: `${found.interpretation.product}${found.interpretation.grade ? ` ${found.interpretation.grade}` : ""}`,
        workflow: "discovery",
        deliveryLocation: location,
        visibilityMode: "anonymous",
        items: [{ productName: found.interpretation.product, grade: found.interpretation.grade, quantity: Number(quantity) || null, unit, category: found.interpretation.category, confirmed: true, needsReview: false }],
      }),
    });
    if (selected.length) sessionStorage.setItem(`invite:${result.id}`, JSON.stringify(selected));
    toast("Requirement saved. Review suppliers before inviting.");
    router.push(`/actions/${result.id}?tab=discover`);
  }

  async function onManual(values: FormValues) {
    const result = await api<{ id: string }>("/api/app/requests", { method: "POST", body: JSON.stringify({ ...values, workflow: "manual", items: values.items.map((item) => ({ ...item, confirmed: true, needsReview: false })) }) });
    router.push(`/actions/${result.id}`);
  }

  async function upload(file?: File, csv?: string) {
    const formData = new FormData();
    if (file) formData.set("file", file);
    if (csv) formData.set("csv", csv);
    const result = await api<{ items: Extracted[]; warnings: string[] }>("/api/app/documents", { method: "POST", body: formData });
    setExtracted(result.items);
    setWarnings(result.warnings);
    setReviewed(false);
  }

  async function saveExtracted() {
    if (!reviewed) {
      toast("Confirm that you reviewed the extracted values.", "err");
      return;
    }
    if (!extracted.length) {
      toast("Nothing was extracted. Add lines manually.", "err");
      return;
    }
    const result = await api<{ id: string }>("/api/app/requests", {
      method: "POST",
      body: JSON.stringify({
        title: extracted[0]?.productName || "Uploaded requirement",
        workflow: "document",
        deliveryLocation: location,
        items: extracted.map((item) => ({ ...item, confirmed: true, needsReview: false })),
      }),
    });
    toast("Reviewed requirements saved.");
    router.push(`/actions/${result.id}?tab=discover`);
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Actions</p>
        <h1 className="text-2xl font-semibold">Create a procurement request</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        {[["discovery", "Smart discovery"], ["manual", "Manual request"], ["document", "Upload requirements"]].map(([id, label]) => (
          <button key={id} className={`btn ${mode === id ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode(id as typeof mode)}>{label}</button>
        ))}
      </div>
      {mode === "discovery" ? (
        <section className="card p-4">
          <p className="text-sm text-muted">Search your approved supplier directory. Strata does not scrape restricted sites or invent vendors.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-[1.4fr_0.7fr_0.4fr_0.4fr_auto]">
            <input className="control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Iron rod grade 2" />
            <input className="control" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Delivery city" />
            <input className="control" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Qty" />
            <input className="control" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Unit" />
            <button className="btn btn-primary" onClick={() => void search().catch((error) => toast(error instanceof ApiError ? error.message : "Search failed", "err"))}>Search</button>
          </div>
          {found ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-paper p-3 text-sm">Interpreted by {found.interpretationSource}: {found.interpretation.product || "product unclear"} {found.interpretation.grade || ""} {found.interpretation.location ? `in ${found.interpretation.location}` : ""}. Confirm this reading before inviting anyone.</div>
              {found.warnings.map((warning) => <p key={warning} className="text-sm text-[#7a5410]">{warning}</p>)}
              <DiscoverTable rows={found.results} selected={selected} onToggle={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} />
              <button className="btn btn-pine" onClick={() => void createFromDiscovery()}>Save requirement {selected.length ? `and keep ${selected.length} selected` : ""}</button>
            </div>
          ) : null}
        </section>
      ) : null}
      {mode === "manual" ? (
        <form className="card space-y-3 p-4" onSubmit={form.handleSubmit(onManual, () => toast("Check the required fields.", "err"))}>
          <label className="field"><span>Requirement title</span><input className="control" {...form.register("title")} /></label>
          <label className="field"><span>Description</span><textarea className="control min-h-20" {...form.register("description")} /></label>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="field"><span>Category</span><input className="control" {...form.register("category")} /></label>
            <label className="field"><span>Delivery location</span><input className="control" {...form.register("deliveryLocation")} /></label>
            <label className="field"><span>Expected delivery</span><input type="date" className="control" {...form.register("expectedDeliveryDate")} /></label>
            <label className="field"><span>Maximum budget (INR)</span><input type="number" className="control" {...form.register("maxBudgetRupees", { setValueAs: (value) => value === "" || value == null ? null : Number(value) })} /></label>
            <label className="field"><span>Target is captured per line</span><input className="control" disabled value="Per-unit target on each row" /></label>
          </div>
          {lines.fields.map((field, index) => (
            <div key={field.id} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-6">
              <input className="control md:col-span-2" placeholder="Product" {...form.register(`items.${index}.productName`)} />
              <input className="control" placeholder="Grade" {...form.register(`items.${index}.grade`)} />
              <input className="control" type="number" placeholder="Qty" {...form.register(`items.${index}.quantity`, { setValueAs: (value) => value === "" || value == null ? null : Number(value) })} />
              <input className="control" placeholder="Unit" {...form.register(`items.${index}.unit`)} />
              <input className="control" type="number" placeholder="Target / unit" {...form.register(`items.${index}.targetPriceRupees`, { setValueAs: (value) => value === "" || value == null ? null : Number(value) })} />
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => lines.append({ productName: "", quantity: 1, unit: "KG", confirmed: true, needsReview: false })}>Add product</button>
            <button className="btn btn-primary" disabled={form.formState.isSubmitting}>Save manual request</button>
          </div>
        </form>
      ) : null}
      {mode === "document" ? (
        <section className="card space-y-3 p-4">
          <p className="text-sm text-muted">Upload Excel, CSV, PDF, or Word. Extracted values stay unconfirmed until you review them. Nothing is silently accepted.</p>
          <div className="flex flex-wrap gap-2">
            <label className="btn btn-ghost">Upload file<input type="file" className="hidden" accept=".pdf,.xlsx,.xls,.csv,.docx,.txt,.png,.jpg,.jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file).catch((error) => toast(error instanceof ApiError ? error.message : "Upload failed", "err")); }} /></label>
            <button className="btn btn-ghost" onClick={() => void upload(undefined, sample)}>Use sample iron rod sheet</button>
            <a className="btn btn-ghost" href="/api/app/templates/requirements">Download template</a>
          </div>
          <textarea className="control min-h-28 font-mono text-xs" defaultValue={sample} id="paste-sheet" />
          <button className="btn btn-ghost" onClick={() => void upload(undefined, (document.getElementById("paste-sheet") as HTMLTextAreaElement).value)}>Extract pasted table</button>
          {warnings.map((warning) => <p key={warning} className="text-sm text-[#7a5410]">{warning}</p>)}
          {extracted.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Product</th><th>Grade</th><th>Qty</th><th>Unit</th><th>Target</th><th>Note</th></tr></thead>
                <tbody>
                  {extracted.map((item, index) => (
                    <tr key={`${item.productName}-${index}`}>
                      <td><input className="control" value={item.productName} onChange={(event) => setExtracted((rows) => rows.map((row, i) => i === index ? { ...row, productName: event.target.value } : row))} /></td>
                      <td><input className="control" value={item.grade || ""} onChange={(event) => setExtracted((rows) => rows.map((row, i) => i === index ? { ...row, grade: event.target.value } : row))} /></td>
                      <td><input className="control" value={item.quantity ?? ""} onChange={(event) => setExtracted((rows) => rows.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) } : row))} /></td>
                      <td><input className="control" value={item.unit || ""} onChange={(event) => setExtracted((rows) => rows.map((row, i) => i === index ? { ...row, unit: event.target.value } : row))} /></td>
                      <td><input className="control" value={item.targetPriceRupees ?? ""} onChange={(event) => setExtracted((rows) => rows.map((row, i) => i === index ? { ...row, targetPriceRupees: Number(event.target.value) } : row))} /></td>
                      <td className="text-xs text-muted">{item.extractionNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed the extracted values and corrected anything uncertain.</label>
          <label className="field max-w-sm"><span>Delivery city</span><input className="control" value={location} onChange={(event) => setLocation(event.target.value)} /></label>
          <button className="btn btn-primary" onClick={() => void saveExtracted()}>Save approved requirements</button>
        </section>
      ) : null}
    </div>
  );
}

export function DiscoverTable({ rows, selected, onToggle }: { rows: DiscoverRow[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr><th></th><th>Supplier</th><th>Location</th><th>Product</th><th>Grade</th><th>Available</th><th>Quoted price</th><th>Distance</th><th>Delivery</th><th>Rating</th><th>Contact</th><th>Price updated</th><th>Source</th><th>Last verified</th></tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => {
            const id = row.vendorId || row.externalId || row.vendorName;
            return (
              <tr key={`${id}-${row.productName}`}>
                <td><input type="checkbox" checked={selected.includes(id)} onChange={() => onToggle(id)} aria-label={`Select ${row.vendorName}`} /></td>
                <td>{row.vendorName} {row.badge ? <div className="badge badge-amber mt-1">{row.badge}</div> : null}</td>
                <td>{row.city || "—"}{row.state ? `, ${row.state}` : ""}</td>
                <td>{row.productName}</td>
                <td>{row.grade || "—"}</td>
                <td>{row.availableQty ?? "—"} {row.unit || ""}</td>
                <td className="tabular-nums">INR {(row.pricePaise / 100).toLocaleString("en-IN")}</td>
                <td>{row.distanceKm == null ? "Unknown" : `${row.distanceKm} km`}</td>
                <td>{row.deliveryDays == null ? "—" : `${row.deliveryDays} days`}</td>
                <td>{row.rating ?? "—"}</td>
                <td>{row.email || "—"}<div className="text-xs text-muted">{row.phone || "Phone not on file"}</div></td>
                <td>{row.priceUpdatedAt ? new Date(row.priceUpdatedAt).toLocaleDateString("en-IN") : "—"}</td>
                <td className="max-w-56 text-xs">{row.source || "—"}</td>
                <td className="text-xs">{row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString("en-IN") : "Not verified"}</td>
              </tr>
            );
          }) : <tr><td colSpan={14}>No matching records. Add a supplier or connect an approved directory.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
