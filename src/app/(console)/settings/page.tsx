"use client";

import { useState } from "react";
import { api, ApiError, useApi } from "@/lib/client";
import { useToast } from "@/components/providers";

type Settings = {
  user: { name: string; email: string; roleLabel: string };
  company: { name: string; legalName: string | null; city: string | null; currency: string; timezone: string; gstNumber: string | null; emailFromName: string | null; directoryWebhookUrl: string | null; defaultVisibility: string; minBidIncrementPaise: number };
  permissions: string[];
  integrations: { grok: boolean; email: boolean; directory: boolean; malwareScan: boolean };
  team: Array<{ id: string; name: string; email: string; role: string; roleLabel: string; active: boolean }>;
  ai: { enabled: boolean; vendorCount: number; strategy: string; speedSeconds: number; minPricePaise: number | null; maxDiscountPercent: number } | null;
  aiActivity: Array<{ id: string; detail: string; createdAt: string }>;
};

export default function SettingsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Settings>("/api/app/settings");
  const [tab, setTab] = useState("Account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("procurement_staff");

  if (loading || !data) return <p className="text-sm text-muted">{error || "Loading settings…"}</p>;
  const canUsers = data.permissions.includes("users.write");
  const canSettings = data.permissions.includes("settings.write");
  const canAi = data.permissions.includes("ai.configure");

  async function save(body: unknown, ok: string) {
    try {
      await api("/api/app/settings", { method: "PATCH", body: JSON.stringify(body) });
      toast(ok);
      await reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save.", "err");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Settings</p>
        <h1 className="text-2xl font-semibold">Workspace configuration</h1>
      </div>
      <div className="flex gap-2">{["Account", "Team", "Integrations", "AI vendors"].map((item) => <button key={item} className={`btn ${tab === item ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(item)}>{item}</button>)}</div>
      {tab === "Account" ? (
        <form className="card grid max-w-xl gap-3 p-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ name: form.get("name"), city: form.get("city"), currency: form.get("currency"), timezone: form.get("timezone"), gstNumber: form.get("gst"), emailFromName: form.get("from"), defaultVisibility: form.get("visibility"), minIncrementRupees: Number(form.get("increment")) }, "Account saved."); }}>
          <label className="field"><span>Company</span><input name="name" className="control" defaultValue={data.company.name} /></label>
          <label className="field"><span>City</span><input name="city" className="control" defaultValue={data.company.city || ""} /></label>
          <label className="field"><span>Currency</span><input name="currency" className="control" defaultValue={data.company.currency} /></label>
          <label className="field"><span>Timezone</span><input name="timezone" className="control" defaultValue={data.company.timezone} /></label>
          <label className="field"><span>GST</span><input name="gst" className="control" defaultValue={data.company.gstNumber || ""} /></label>
          <label className="field"><span>Email from name</span><input name="from" className="control" defaultValue={data.company.emailFromName || ""} /></label>
          <label className="field"><span>Default visibility</span><select name="visibility" className="control" defaultValue={data.company.defaultVisibility}><option value="open">Open</option><option value="anonymous">Anonymous</option><option value="blind">Blind</option><option value="company_only">Company only</option></select></label>
          <label className="field"><span>Minimum bid improvement (INR)</span><input name="increment" type="number" className="control" defaultValue={data.company.minBidIncrementPaise / 100} /></label>
          <p className="text-sm text-muted">Signed in as {data.user.name}, {data.user.roleLabel}.</p>
          <button className="btn btn-primary w-fit" disabled={!canSettings}>Save account</button>
        </form>
      ) : null}
      {tab === "Team" ? (
        <section className="space-y-3">
          <div className="table-wrap"><table className="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>{data.team.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.roleLabel}</td><td>{canUsers ? <button className="text-sm" onClick={() => void api(`/api/app/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ active: !user.active }) }).then(() => reload())}>{user.active ? "Deactivate" : "Activate"}</button> : null}</td></tr>)}</tbody></table></div>
          {canUsers ? <form className="card grid gap-2 p-4 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void api("/api/app/users", { method: "POST", body: JSON.stringify({ name, email, password, role }) }).then(() => { toast("User added."); void reload(); }).catch((err) => toast(err instanceof ApiError ? err.message : "Could not add user", "err")); }}>
            <input className="control" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
            <input className="control" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <input className="control" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <select className="control" value={role} onChange={(event) => setRole(event.target.value)}><option value="company_admin">Company Admin</option><option value="procurement_manager">Procurement Manager</option><option value="procurement_staff">Procurement Staff</option></select>
            <button className="btn btn-primary w-fit">Add user</button>
          </form> : <p className="text-sm text-muted">Only company admins can add users.</p>}
        </section>
      ) : null}
      {tab === "Integrations" ? (
        <form className="card max-w-xl space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ directoryWebhookUrl: form.get("url"), directoryWebhookToken: form.get("token") }, "Integration settings saved."); }}>
          <Status label="Grok" on={data.integrations.grok} detail="Set XAI_API_KEY or GROK_API_KEY on the server. Keys never reach the browser." />
          <Status label="Email" on={data.integrations.email} detail="Set RESEND_API_KEY or SENDGRID_API_KEY. Without it, invitations are logged and secure links still work." />
          <Status label="Malware scan" on={data.integrations.malwareScan} detail="Optional MALWARE_SCAN_WEBHOOK. Files are not marked clean unless a scanner accepts them." />
          <label className="field"><span>Approved supplier directory URL</span><input name="url" className="control" defaultValue={data.company.directoryWebhookUrl || ""} placeholder="https://directory.example/search" /></label>
          <label className="field"><span>Directory token</span><input name="token" className="control" placeholder="Stored server-side, not shown again" /></label>
          <p className="text-sm text-muted">The directory must return source, price, and an id. Rows missing those fields are dropped. Strata does not scrape websites.</p>
          <button className="btn btn-primary" disabled={!canSettings}>Save integration</button>
        </form>
      ) : null}
      {tab === "AI vendors" ? (
        <form className="card max-w-xl space-y-3 p-4" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save({ ai: { enabled: form.get("enabled") === "on", vendorCount: Number(form.get("count")), strategy: form.get("strategy"), speedSeconds: Number(form.get("speed")), maxDiscountPercent: Number(form.get("discount")), minPriceRupees: form.get("floor") ? Number(form.get("floor")) : null } }, "AI vendor settings saved.");
        }}>
          <label className="flex items-center gap-3 text-sm font-semibold"><input name="enabled" type="checkbox" defaultChecked={data.ai?.enabled} disabled={!canAi} /> Master AI vendors switch</label>
          <p className="text-sm text-muted">When on, simulated bidders can be added to a session. They are labeled SIMULATED / AI DEMO, cannot be awarded, and are hidden from real suppliers.</p>
          <label className="field"><span>Number of AI vendors</span><input name="count" type="number" min={1} max={5} className="control" defaultValue={data.ai?.vendorCount || 4} /></label>
          <label className="field"><span>Strategy</span><select name="strategy" className="control" defaultValue={data.ai?.strategy || "competitive"}><option value="aggressive">Aggressive pricing</option><option value="competitive">Competitive pricing</option><option value="conservative">Conservative pricing</option><option value="fixed_margin">Fixed-margin pricing</option><option value="randomized">Randomized demo bidding</option></select></label>
          <label className="field"><span>Bidding speed (seconds)</span><input name="speed" type="number" className="control" defaultValue={data.ai?.speedSeconds || 20} /></label>
          <label className="field"><span>Maximum discount from your anchor (%)</span><input name="discount" type="number" className="control" defaultValue={data.ai?.maxDiscountPercent || 12} /></label>
          <label className="field"><span>Optional minimum total (INR)</span><input name="floor" type="number" className="control" placeholder="Leave blank to use the discount cap" /></label>
          <button className="btn btn-primary" disabled={!canAi}>Save AI configuration</button>
          <div className="text-sm">{data.aiActivity.length ? data.aiActivity.map((row) => <p key={row.id}>{row.detail}</p>) : <p className="text-muted">No AI activity yet.</p>}</div>
        </form>
      ) : null}
    </div>
  );
}

function Status({ label, on, detail }: { label: string; on: boolean; detail: string }) {
  return <div className="rounded-xl bg-paper p-3 text-sm"><strong>{label}:</strong> {on ? "Configured" : "Not configured"}. <span className="text-muted">{detail}</span></div>;
}
