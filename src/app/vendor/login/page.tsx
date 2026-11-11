"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/providers";

export default function VendorLoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("quotes@apexsteel.demo");
  const [password, setPassword] = useState("Vendor#2026");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await api<{ redirect: string }>("/api/app/auth/login", { method: "POST", body: JSON.stringify({ email, password, portal: "vendor" }) });
      router.push(result.redirect);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Sign-in failed.", "err");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <form onSubmit={submit} className="card w-full max-w-md p-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Vendor portal</p>
        <h1 className="mt-2 text-2xl font-semibold">Supplier sign in</h1>
        <p className="mt-1 text-sm text-muted">Use the portal password issued by the buying company, or open the secure link in your invitation.</p>
        <label className="field mt-5"><span>Email</span><input className="control" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="field mt-3"><span>Password</span><input type="password" className="control" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="btn btn-primary mt-5 w-full" disabled={pending}>Enter portal</button>
        <div className="mt-4 rounded-xl bg-amber-soft p-3 text-xs leading-5 text-[#7a5410]">Demo supplier: quotes@apexsteel.demo / Vendor#2026. This account is labeled DEMO DIRECTORY and cannot create a real purchase commitment.</div>
        <Link href="/login" className="mt-4 block text-sm text-muted">Company sign in</Link>
      </form>
    </main>
  );
}
