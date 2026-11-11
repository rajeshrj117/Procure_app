"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/client";
import { registerSchema } from "@/lib/validators";
import { useToast } from "@/components/providers";

type FormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const toast = useToast();
  const form = useForm<FormValues>({ resolver: zodResolver(registerSchema), defaultValues: { country: "India", companyName: "", name: "", email: "", password: "", city: "" } });

  async function onSubmit(values: FormValues) {
    try {
      const result = await api<{ redirect: string }>("/api/app/auth/register", { method: "POST", body: JSON.stringify(values) });
      toast("Workspace created.");
      router.push(result.redirect);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Could not create the workspace.", "err");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <form onSubmit={form.handleSubmit(onSubmit)} className="card w-full max-w-lg p-6">
        <h1 className="text-2xl font-semibold">Create a company workspace</h1>
        <p className="mt-1 text-sm text-muted">New workspaces start empty. Supplier records are added by your team or an approved integration.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="field sm:col-span-2"><span>Company</span><input className="control" {...form.register("companyName")} /></label>
          <label className="field"><span>Your name</span><input className="control" {...form.register("name")} /></label>
          <label className="field"><span>Work email</span><input className="control" {...form.register("email")} /></label>
          <label className="field"><span>City</span><input className="control" {...form.register("city")} /></label>
          <label className="field"><span>Country</span><input className="control" {...form.register("country")} /></label>
          <label className="field sm:col-span-2"><span>Password</span><input type="password" className="control" {...form.register("password")} /></label>
        </div>
        {form.formState.errors.root?.message || Object.values(form.formState.errors)[0]?.message ? <p className="mt-3 text-sm text-red-700">{Object.values(form.formState.errors)[0]?.message as string}</p> : null}
        <button className="btn btn-primary mt-5" disabled={form.formState.isSubmitting}>Create workspace</button>
        <Link href="/login" className="mt-4 block text-sm text-muted">Already registered? Sign in</Link>
      </form>
    </main>
  );
}
