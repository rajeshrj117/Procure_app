import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, authSessions, companies, emailLogs, notifications, users, vendors } from "@/db/schema";

const scryptAsync = promisify(scrypt);
export const SESSION_COOKIE = "procure_session";
const SESSION_DAYS = 7;

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200, token?: string | null) {
  const res = NextResponse.json(data, { status });
  if (token) {
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
  }
  return res;
}

export function clearSession(data: unknown, status = 200) {
  const res = NextResponse.json(data, { status });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

export function fail(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

export async function readJson<T>(req: Request) {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError("Invalid JSON body.", 400);
  }
}

export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "local";
}

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new HttpError("Too many requests. Wait a moment and try again.", 429);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const keyBuf = Buffer.from(key, "hex");
  if (buf.length !== keyBuf.length) return false;
  return timingSafeEqual(buf, keyBuf);
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  company_admin: "Company Admin",
  procurement_manager: "Procurement Manager",
  procurement_staff: "Procurement Staff",
  vendor: "Vendor",
};

const PERMISSIONS: Record<string, string[]> = {
  super_admin: ["*"],
  company_admin: ["*"],
  procurement_manager: [
    "requests.write",
    "requests.award",
    "vendors.write",
    "reports.read",
    "ai.configure",
    "users.read",
    "negotiate",
    "negotiate.agree",
    "invite",
    "settings.write",
  ],
  procurement_staff: ["requests.write", "vendors.write", "reports.read", "invite", "negotiate"],
};

export function permissionsFor(role: string) {
  if ((PERMISSIONS[role] ?? []).includes("*")) {
    return [
      "requests.write",
      "requests.award",
      "vendors.write",
      "reports.read",
      "ai.configure",
      "users.read",
      "users.write",
      "negotiate",
      "negotiate.agree",
      "invite",
      "settings.write",
    ];
  }
  return PERMISSIONS[role] ?? [];
}

export function can(role: string, permission: string) {
  const list = PERMISSIONS[role] ?? [];
  return list.includes("*") || list.includes(permission);
}

export function assertCan(role: string, permission: string) {
  if (!can(role, permission)) throw new HttpError("You do not have permission for this action.", 403);
}

export type UserActor = {
  actorType: "user";
  sessionId: string;
  user: typeof users.$inferSelect;
  company: typeof companies.$inferSelect;
  vendor: null;
};

export type VendorActor = {
  actorType: "vendor";
  sessionId: string;
  user: null;
  company: typeof companies.$inferSelect;
  vendor: typeof vendors.$inferSelect;
};

export function readCookie(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)procure_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function getActor(req: Request): Promise<UserActor | VendorActor | null> {
  const token = readCookie(req);
  if (!token) return null;
  const [session] = await db.select().from(authSessions).where(eq(authSessions.tokenHash, sha256(token))).limit(1);
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.delete(authSessions).where(eq(authSessions.id, session.id));
    return null;
  }
  if (session.actorType === "user" && session.userId) {
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user?.active) return null;
    const [company] = await db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1);
    if (!company) return null;
    return { actorType: "user", sessionId: session.id, user, company, vendor: null };
  }
  if (session.actorType === "vendor" && session.vendorId) {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, session.vendorId)).limit(1);
    if (!vendor?.active || !vendor.portalEnabled) return null;
    const [company] = await db.select().from(companies).where(eq(companies.id, vendor.companyId)).limit(1);
    if (!company) return null;
    return { actorType: "vendor", sessionId: session.id, user: null, company, vendor };
  }
  return null;
}

export async function requireUser(req: Request) {
  const actor = await getActor(req);
  if (!actor || actor.actorType !== "user") throw new HttpError("Sign in required.", 401);
  return actor;
}

export async function requireVendor(req: Request) {
  const actor = await getActor(req);
  if (!actor || actor.actorType !== "vendor") throw new HttpError("Vendor sign-in required.", 401);
  return actor;
}

export async function createSession(actorType: "user" | "vendor", id: string) {
  const token = newToken();
  await db.insert(authSessions).values({
    id: newId("ses"),
    tokenHash: sha256(token),
    actorType,
    userId: actorType === "user" ? id : null,
    vendorId: actorType === "vendor" ? id : null,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return token;
}

export async function audit(entry: {
  companyId: string;
  actorType: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await db.insert(activityLogs).values({
    id: newId("act"),
    companyId: entry.companyId,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    actorName: entry.actorName ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? null,
  });
}

export async function notifyCompany(
  companyId: string,
  payload: { title: string; body: string; type: string; href?: string | null },
) {
  const members = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.active, true)));
  if (!members.length) return;
  await db.insert(notifications).values(
    members.map((member) => ({
      id: newId("ntf"),
      companyId,
      userId: member.id,
      vendorId: null,
      title: payload.title,
      body: payload.body,
      type: payload.type,
      href: payload.href ?? null,
      isRead: false,
    })),
  );
}

export async function notifyVendor(
  companyId: string,
  vendorId: string,
  payload: { title: string; body: string; type: string; href?: string | null },
) {
  await db.insert(notifications).values({
    id: newId("ntf"),
    companyId,
    userId: null,
    vendorId,
    title: payload.title,
    body: payload.body,
    type: payload.type,
    href: payload.href ?? null,
    isRead: false,
  });
}

export function isDeliverableEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (!value.includes("@")) return false;
  if (value.endsWith(".demo") || value.endsWith(".invalid")) return false;
  if (value.endsWith("@example.com") || value.endsWith("@example.org") || value.endsWith("@example.net")) return false;
  return true;
}

export function appBaseUrl(req?: Request) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const host = req?.headers.get("x-forwarded-host") || req?.headers.get("host");
  if (!host) return "http://localhost:3000";
  const proto = req?.headers.get("x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY);
}

export async function sendEmail(input: {
  companyId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  relatedType?: string;
  relatedId?: string;
  fromName?: string | null;
}) {
  const id = newId("eml");
  let status = "logged_only";
  let provider: string | null = null;
  let error: string | null = null;

  if (!isDeliverableEmail(input.to)) {
    status = "suppressed_demo";
    error = "Demo or example address. The message was recorded, not delivered to a real inbox.";
  } else if (process.env.RESEND_API_KEY) {
    provider = "resend";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || `${input.fromName || "Strata Procure"} <onboarding@resend.dev>`,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        status = "failed";
        error = (await res.text()).slice(0, 500);
      } else status = "sent";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Email provider error";
    }
  } else if (process.env.SENDGRID_API_KEY) {
    provider = "sendgrid";
    const from = process.env.EMAIL_FROM || "noreply@localhost";
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: input.to }] }],
          from: { email: from, name: input.fromName || "Strata Procure" },
          subject: input.subject,
          content: [
            { type: "text/plain", value: input.text },
            { type: "text/html", value: input.html },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        status = "failed";
        error = (await res.text()).slice(0, 500);
      } else status = "sent";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Email provider error";
    }
  } else {
    error = "No RESEND_API_KEY or SENDGRID_API_KEY configured. The secure link is available in the workspace.";
  }

  await db.insert(emailLogs).values({
    id,
    companyId: input.companyId,
    toAddress: input.to,
    subject: input.subject,
    bodyHtml: input.html,
    bodyText: input.text,
    status,
    provider,
    error,
    relatedType: input.relatedType ?? null,
    relatedId: input.relatedId ?? null,
  });
  return { id, status, provider, error };
}

export function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function asDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError("Enter a valid date.", 400);
  return date;
}
