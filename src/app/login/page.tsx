"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/client";
import { loginSchema } from "@/lib/validators";
import { useToast } from "@/components/providers";

type FormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const form = useForm<FormValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "amira.shah@northwind.demo", password: "Northwind#2026", portal: "company" } });

  async function onSubmit(values: FormValues) {
    try {
      const result = await api<{ redirect: string }>("/api/app/auth/login", { method: "POST", body: JSON.stringify(values) });
      router.push(result.redirect);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Sign-in failed.", "err");
    }
  }

  return (
    <main className="grid min-h-screen md:grid-cols-[0.9fr_1.1fr]">
      <section className="hidden bg-navy px-10 py-12 text-white md:block">
        <div className="font-serif text-3xl">Strata</div>
        <p className="mt-6 max-w-sm text-white/75">A procurement control room for invitations, live reverse auctions, direct negotiation, and savings that can be traced to a baseline.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={form.handleSubmit(onSubmit)} className="card w-full max-w-md p-6">
          <h1 className="text-2xl font-semibold">Company sign in</h1>
          <p className="mt-1 text-sm text-muted">Procurement teams only. Suppliers use the vendor portal.</p>
          <label className="field mt-5"><span>Email</span><input className="control" {...form.register("email")} /></label>
          {form.formState.errors.email ? <p className="mt-1 text-xs text-red-700">{form.formState.errors.email.message}</p> : null}
          <label className="field mt-3"><span>Password</span><input type="password" className="control" {...form.register("password")} /></label>
          {form.formState.errors.password ? <p className="mt-1 text-xs text-red-700">{form.formState.errors.password.message}</p> : null}
          <button className="btn btn-primary mt-5 w-full" disabled={form.formState.isSubmitting}>Sign in</button>
          <div className="mt-4 rounded-xl bg-paper p-3 text-xs leading-5 text-muted">
            Demo workspace: amira.shah@northwind.demo / Northwind#2026. Manager: rohan.mehta@northwind.demo / Manage#2026. Staff: leela.nair@northwind.demo / Staff#2026. Super admin: platform@strata.demo / Super#2026.
          </div>
          <div className="mt-4 flex justify-between text-sm">
            <Link href="/register" className="font-semibold text-navy-2">Create workspace</Link>
            <Link href="/vendor/login" className="text-muted">Vendor portal</Link>
          </div>
        </form>
      </section>
    </main>
  );
}
