import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activityLogs,
  aiActivities,
  aiConfigs,
  authSessions,
  bids,
  companies,
  documents,
  emailLogs,
  invitations,
  negotiations,
  notifications,
  priceHistory,
  procurementRequests,
  requirementItems,
  users,
  vendorCatalog,
  vendors,
} from "@/db/schema";
import { num, rupeesToPaise, vendorBadge } from "@/lib/format";
import {
  aiConfigSchema,
  bidSchema,
  catalogSchema,
  extensionReviewSchema,
  extensionSchema,
  inviteSchema,
  itemSchema,
  loginSchema,
  negotiationMessageSchema,
  negotiationStartSchema,
  registerSchema,
  requestSchema,
  userSchema,
  vendorSchema,
} from "@/lib/validators";
import { ensureAiVendors, openingAmount, tickAi } from "./ai";
import {
  awardRequest,
  closeSession,
  convertNegotiation,
  createExtension,
  createNegotiation,
  inviteVendors,
  loadDossier,
  negotiationByToken,
  postNegotiationMessage,
  priceReference,
  publicBidPayload,
  rescheduleSession,
  reviewExtension,
  submitBidByToken,
} from "./bidding";
import {
  assertCan,
  audit,
  clean,
  clearSession,
  clientIp,
  createSession,
  emailConfigured,
  fail,
  getActor,
  hashPassword,
  HttpError,
  json,
  newId,
  newToken,
  permissionsFor,
  rateLimit,
  readCookie,
  readJson,
  requireUser,
  requireVendor,
  ROLE_LABEL,
  sha256,
  verifyPassword,
  asDate,
} from "./core";
import { discoverVendors } from "./discover";
import { assertAllowedFile, extractBuffer, parseCsv, readUpload, rowsToItems, saveUpload, scanStatusFor, textToItems } from "./documents";
import { grokConfigured } from "./grok";
import { resolveCity } from "./geo";
import { buildDashboard, buildReport, exportReport } from "./reports";
import { ensureSeeded } from "./seed";
import { answerQuestion } from "./assistant";

function parseBody<T>(schema: z.ZodType<T>, body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || "Check the form and try again.", 400);
  return parsed.data;
}

function like(value: string) {
  return `%${value.replace(/[%_]/g, "").slice(0, 80)}%`;
}

function vendorDto(row: typeof vendors.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contactPerson,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    country: row.country,
    categories: row.categories ?? [],
    grades: row.grades ?? [],
    gstNumber: row.gstNumber,
    verificationStatus: row.verificationStatus,
    performanceScore: row.performanceScore,
    onTimeDeliveryRate: row.onTimeDeliveryRate,
    paymentTerms: row.paymentTerms,
    deliveryCapabilities: row.deliveryCapabilities,
    active: row.active,
    isSimulated: row.isSimulated,
    simulationKind: row.simulationKind,
    badge: vendorBadge(row.simulationKind),
    portalEnabled: row.portalEnabled,
    source: row.source,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function userPayload(actor: Awaited<ReturnType<typeof requireUser>>) {
  return {
    ok: true,
    actorType: "user" as const,
    user: {
      id: actor.user.id,
      name: actor.user.name,
      email: actor.user.email,
      role: actor.user.role,
      roleLabel: ROLE_LABEL[actor.user.role] ?? actor.user.role,
      phone: actor.user.phone,
      title: actor.user.title,
    },
    company: {
      id: actor.company.id,
      name: actor.company.name,
      legalName: actor.company.legalName,
      industry: actor.company.industry,
      city: actor.company.city,
      state: actor.company.state,
      country: actor.company.country,
      currency: actor.company.currency,
      timezone: actor.company.timezone,
      taxPercent: Number(actor.company.taxPercent),
      isDemo: actor.company.isDemo,
      defaultVisibility: actor.company.defaultVisibility,
      minBidIncrementPaise: actor.company.minBidIncrementPaise,
      gstNumber: actor.company.gstNumber,
      emailFromName: actor.company.emailFromName,
      hasDirectoryToken: Boolean(actor.company.directoryWebhookToken || process.env.SUPPLIER_DIRECTORY_TOKEN),
      directoryWebhookUrl: actor.company.directoryWebhookUrl,
    },
    permissions: permissionsFor(actor.user.role),
    integrations: {
      grok: grokConfigured(),
      email: emailConfigured(),
      directory: Boolean(actor.company.directoryWebhookUrl || process.env.SUPPLIER_DIRECTORY_URL),
      malwareScan: Boolean(process.env.MALWARE_SCAN_WEBHOOK),
    },
  };
}

async function nextReference(companyId: string) {
  const result = await db.execute(sql`update companies set next_request_number = next_request_number + 1 where id = ${companyId} returning next_request_number`);
  const rows = (result as unknown as { rows?: Array<{ next_request_number: number }> }).rows;
  const value = rows?.[0]?.next_request_number;
  if (!value) throw new HttpError("Could not allocate a reference code.", 500);
  return `PR-${value}`;
}

export async function handle(req: Request, slug: string[]) {
  try {
    await ensureSeeded();
    return await dispatch(req, slug);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.message, error.status);
    console.error(error);
    return fail(error instanceof Error ? error.message : "Unexpected server error.", 500);
  }
}

async function dispatch(req: Request, slug: string[]) {
  const [a, b, c] = slug;
  const method = req.method;
  const url = new URL(req.url);

  if (a === "auth" && b === "login" && method === "POST") {
    const body = parseBody(loginSchema, await readJson(req));
    rateLimit(`login:${clientIp(req)}:${body.email}`, 12, 10 * 60 * 1000);
    if (body.portal === "vendor") {
      const [vendor] = await db.select().from(vendors).where(eq(vendors.email, body.email.toLowerCase())).limit(1);
      if (!vendor?.portalPasswordHash || !vendor.portalEnabled || !(await verifyPassword(body.password, vendor.portalPasswordHash))) {
        throw new HttpError("Email or password is incorrect.", 401);
      }
      const token = await createSession("vendor", vendor.id);
      return json({ ok: true, actorType: "vendor", redirect: "/portal" }, 200, token);
    }
    const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
    if (!user?.active || !(await verifyPassword(body.password, user.passwordHash))) throw new HttpError("Email or password is incorrect.", 401);
    const token = await createSession("user", user.id);
    await audit({ companyId: user.companyId, actorType: "user", actorId: user.id, actorName: user.name, action: "auth.login", entityType: "user", entityId: user.id, metadata: {} });
    return json({ ok: true, actorType: "user", redirect: "/dashboard" }, 200, token);
  }

  if (a === "auth" && b === "register" && method === "POST") {
    const body = parseBody(registerSchema, await readJson(req));
    rateLimit(`register:${clientIp(req)}`, 8, 30 * 60 * 1000);
    const email = body.email.toLowerCase();
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new HttpError("An account with that email already exists.", 409);
    const city = resolveCity(body.city);
    const companyId = newId("cmp");
    const userId = newId("usr");
    await db.insert(companies).values({
      id: companyId,
      name: body.companyName,
      city: body.city,
      state: city?.state ?? null,
      country: body.country,
      isDemo: false,
    });
    await db.insert(users).values({
      id: userId,
      companyId,
      email,
      passwordHash: await hashPassword(body.password),
      name: body.name,
      role: "company_admin",
      title: "Company Admin",
    });
    await db.insert(aiConfigs).values({ companyId, enabled: false, vendorCount: 4, strategy: "competitive", speedSeconds: 20, maxDiscountPercent: "12" });
    const token = await createSession("user", userId);
    return json({ ok: true, redirect: "/dashboard" }, 200, token);
  }

  if (a === "auth" && b === "logout" && method === "POST") {
    const raw = readCookie(req);
    if (raw) await db.delete(authSessions).where(eq(authSessions.tokenHash, sha256(raw)));
    return clearSession({ ok: true });
  }

  if (a === "bid" && b && method === "GET" && !c) return json(await publicBidPayload(b));
  if (a === "bid" && b && c === "submit" && method === "POST") {
    rateLimit(`bid:${b}`, 30, 60 * 1000);
    const body = parseBody(bidSchema, await readJson(req));
    return json(await submitBidByToken(b, { amountPaise: rupeesToPaise(body.amountRupees), note: body.note, isFinal: body.isFinal, acceptedTerms: true }));
  }
  if (a === "bid" && b && c === "extension" && method === "POST") {
    const body = parseBody(extensionSchema, await readJson(req));
    await createExtension(b, body);
    return json(await publicBidPayload(b));
  }
  if (a === "bid" && b && c === "activate" && method === "POST") {
    const body = parseBody(z.object({ password: z.string().min(8).max(72), contactName: z.string().trim().min(2).max(80) }), await readJson(req));
    const payload = await publicBidPayload(b);
    await db.update(vendors).set({ portalEnabled: true, portalPasswordHash: await hashPassword(body.password), contactPerson: body.contactName, updatedAt: new Date() }).where(eq(vendors.id, payload.vendor.id));
    const token = await createSession("vendor", payload.vendor.id);
    return json({ ok: true, redirect: "/portal" }, 200, token);
  }
  if (a === "negotiate-link" && b && method === "GET" && !c) return json(await negotiationByToken(b));
  if (a === "documents" && b && method === "GET" && url.searchParams.get("token")) {
    const token = url.searchParams.get("token") || "";
    const [invitation] = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
    if (!invitation) throw new HttpError("Document not found.", 404);
    const [doc] = await db.select().from(documents).where(and(eq(documents.id, b), eq(documents.requestId, invitation.requestId))).limit(1);
    if (!doc) throw new HttpError("Document not found.", 404);
    const bytes = await readUpload(doc.storagePath);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": doc.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${doc.fileName.replace(/"/g, "")}"` } });
  }
  if (a === "negotiate-link" && b && c === "message" && method === "POST") {
    const body = parseBody(negotiationMessageSchema, await readJson(req));
    const [negotiation] = await db.select().from(negotiations).where(eq(negotiations.vendorToken, b)).limit(1);
    if (!negotiation) throw new HttpError("Negotiation link not found.", 404);
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, negotiation.vendorId)).limit(1);
    if (!vendor) throw new HttpError("Supplier not found.", 404);
    await postNegotiationMessage({
      token: b,
      actor: { kind: "vendor", vendor, name: vendor.name },
      action: body.action,
      message: body.message,
      offerPaise: body.offerRupees ? rupeesToPaise(body.offerRupees) : null,
    });
    return json(await negotiationByToken(b));
  }

  if (a === "portal" && method === "GET") {
    const actor = await requireVendor(req);
    const invites = await db.select().from(invitations).where(eq(invitations.vendorId, actor.vendor.id)).orderBy(desc(invitations.createdAt));
    const requestIds = invites.map((row) => row.requestId);
    const requestRows = requestIds.length ? await db.select().from(procurementRequests).where(inArray(procurementRequests.id, requestIds)) : [];
    const negs = await db.select().from(negotiations).where(eq(negotiations.vendorId, actor.vendor.id)).orderBy(desc(negotiations.updatedAt));
    const notes = await db.select().from(notifications).where(eq(notifications.vendorId, actor.vendor.id)).orderBy(desc(notifications.createdAt)).limit(20);
    return json({
      ok: true,
      vendor: vendorDto(actor.vendor),
      companyName: actor.company.name,
      invitations: invites.filter((row) => !row.simulationOnly).map((row) => ({
        id: row.id,
        token: row.token,
        status: row.status,
        request: requestRows.find((request) => request.id === row.requestId)?.title ?? "Requirement",
        reference: requestRows.find((request) => request.id === row.requestId)?.referenceCode ?? "",
        requestId: row.requestId,
      })),
      negotiations: negs.map((row) => ({ id: row.id, status: row.status, token: row.vendorToken, requestId: row.requestId, agreedPaise: row.agreedPaise })),
      notifications: notes.map((row) => ({ id: row.id, title: row.title, body: row.body, isRead: row.isRead, createdAt: row.createdAt.toISOString(), href: row.href })),
    });
  }

  const actor = await getActor(req);
  if (!actor || actor.actorType !== "user") throw new HttpError("Sign in required.", 401);
  const companyId = actor.company.id;

  if (a === "bootstrap" && method === "GET") {
    const unreadRows = await db.select().from(notifications).where(and(eq(notifications.userId, actor.user.id), eq(notifications.isRead, false)));
    const dashboard = await buildDashboard(companyId);
    return json({ ...userPayload(actor), unread: unreadRows.length, liveSessions: dashboard.kpis.liveSessions });
  }
  if (a === "dashboard" && method === "GET") return json({ ok: true, ...(await buildDashboard(companyId)) });
  if (a === "assistant" && method === "POST") {
    rateLimit(`ai:${actor.user.id}`, 20, 10 * 60 * 1000);
    const body = parseBody(z.object({ question: z.string().trim().min(3).max(500) }), await readJson(req));
    return json(await answerQuestion(companyId, body.question, actor.user.name));
  }
  if (a === "discover" && method === "GET") {
    return json({
      ok: true,
      ...(await discoverVendors({
        companyId,
        query: url.searchParams.get("q") || "",
        product: url.searchParams.get("product"),
        grade: url.searchParams.get("grade"),
        location: url.searchParams.get("location"),
        maxDistanceKm: url.searchParams.get("maxDistance") ? Number(url.searchParams.get("maxDistance")) : null,
        minRating: url.searchParams.get("minRating") ? Number(url.searchParams.get("minRating")) : null,
        sort: url.searchParams.get("sort"),
      })),
    });
  }
  if (a === "search" && method === "GET") {
    const q = url.searchParams.get("q")?.trim() || "";
    if (q.length < 2) return json({ ok: true, results: [] });
    const requestRows = await db.select().from(procurementRequests).where(and(eq(procurementRequests.companyId, companyId), or(ilike(procurementRequests.title, like(q)), ilike(procurementRequests.referenceCode, like(q))))).limit(8);
    const vendorRows = await db.select().from(vendors).where(and(eq(vendors.companyId, companyId), or(ilike(vendors.name, like(q)), ilike(vendors.city, like(q))))).limit(8);
    return json({
      ok: true,
      results: [
        ...requestRows.map((row) => ({ type: "request", id: row.id, label: `${row.referenceCode} · ${row.title}`, href: `/actions/${row.id}` })),
        ...vendorRows.map((row) => ({ type: "vendor", id: row.id, label: row.name, href: `/vendors/${row.id}` })),
      ],
    });
  }
  if (a === "notifications" && !b && method === "GET") {
    const rows = await db.select().from(notifications).where(eq(notifications.userId, actor.user.id)).orderBy(desc(notifications.createdAt)).limit(30);
    return json({ ok: true, notifications: rows.map((row) => ({ id: row.id, title: row.title, body: row.body, type: row.type, href: row.href, isRead: row.isRead, createdAt: row.createdAt.toISOString() })) });
  }
  if (a === "notifications" && b === "read" && method === "POST") {
    const body = await readJson<{ ids?: string[]; all?: boolean }>(req);
    if (body.all) await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, actor.user.id));
    else if (body.ids?.length) await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.userId, actor.user.id), inArray(notifications.id, body.ids)));
    return json({ ok: true });
  }
  if (a === "history" && method === "GET") {
    const q = url.searchParams.get("q")?.trim();
    const entity = url.searchParams.get("entity");
    const rows = await db.select().from(activityLogs).where(eq(activityLogs.companyId, companyId)).orderBy(desc(activityLogs.createdAt)).limit(250);
    const emails = await db.select().from(emailLogs).where(eq(emailLogs.companyId, companyId)).orderBy(desc(emailLogs.createdAt)).limit(100);
    const filtered = rows.filter((row) => {
      if (entity && row.entityType !== entity && row.action !== entity) return false;
      if (!q) return true;
      const blob = `${row.action} ${row.actorName ?? ""} ${row.entityType} ${JSON.stringify(row.metadata ?? {})}`.toLowerCase();
      return blob.includes(q.toLowerCase());
    });
    return json({
      ok: true,
      activities: filtered.slice(0, 150).map((row) => ({ id: row.id, actorType: row.actorType, actorName: row.actorName, action: row.action, entityType: row.entityType, entityId: row.entityId, metadata: row.metadata, createdAt: row.createdAt.toISOString() })),
      emails: emails.map((row) => ({ id: row.id, to: row.toAddress, subject: row.subject, status: row.status, provider: row.provider, error: row.error, createdAt: row.createdAt.toISOString(), bodyText: row.bodyText })),
    });
  }
  if (a === "reports" && b === "export" && method === "GET") {
    assertCan(actor.user.role, "reports.read");
    const file = await exportReport(companyId, url.searchParams.get("format") || "csv", url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : null, url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : null);
    const payload = typeof file.body === "string" ? file.body : new Uint8Array(file.body);
    return new Response(payload, { headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"` } });
  }
  if (a === "reports" && method === "GET") {
    assertCan(actor.user.role, "reports.read");
    return json({ ok: true, ...(await buildReport(companyId, url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : null, url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : null)) });
  }
  if (a === "settings" && method === "GET") {
    const [ai] = await db.select().from(aiConfigs).where(eq(aiConfigs.companyId, companyId)).limit(1);
    const team = await db.select().from(users).where(eq(users.companyId, companyId)).orderBy(users.name);
    const activity = await db.select().from(aiActivities).where(eq(aiActivities.companyId, companyId)).orderBy(desc(aiActivities.createdAt)).limit(20);
    return json({
      ...userPayload(actor),
      team: team.map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, roleLabel: ROLE_LABEL[user.role] ?? user.role, title: user.title, active: user.active })),
      ai: ai ? { enabled: ai.enabled, vendorCount: ai.vendorCount, strategy: ai.strategy, speedSeconds: ai.speedSeconds, minPricePaise: ai.minPricePaise, maxDiscountPercent: Number(ai.maxDiscountPercent) } : null,
      aiActivity: activity.map((row) => ({ id: row.id, action: row.action, detail: row.detail, createdAt: row.createdAt.toISOString() })),
    });
  }
  if (a === "settings" && method === "PATCH") {
    assertCan(actor.user.role, "settings.write");
    const body = await readJson<Record<string, unknown>>(req);
    await db.update(companies).set({
      name: typeof body.name === "string" ? body.name : actor.company.name,
      legalName: clean(body.legalName) ?? actor.company.legalName,
      industry: clean(body.industry) ?? actor.company.industry,
      city: clean(body.city) ?? actor.company.city,
      gstNumber: clean(body.gstNumber) ?? actor.company.gstNumber,
      currency: typeof body.currency === "string" ? body.currency : actor.company.currency,
      timezone: typeof body.timezone === "string" ? body.timezone : actor.company.timezone,
      emailFromName: clean(body.emailFromName) ?? actor.company.emailFromName,
      directoryWebhookUrl: body.directoryWebhookUrl === "" ? null : clean(body.directoryWebhookUrl) ?? actor.company.directoryWebhookUrl,
      directoryWebhookToken: typeof body.directoryWebhookToken === "string" && body.directoryWebhookToken ? body.directoryWebhookToken : actor.company.directoryWebhookToken,
      defaultVisibility: typeof body.defaultVisibility === "string" ? body.defaultVisibility : actor.company.defaultVisibility,
      minBidIncrementPaise: typeof body.minIncrementRupees === "number" ? rupeesToPaise(body.minIncrementRupees) : actor.company.minBidIncrementPaise,
      updatedAt: new Date(),
    }).where(eq(companies.id, companyId));
    if (body.ai && typeof body.ai === "object") {
      assertCan(actor.user.role, "ai.configure");
      const ai = parseBody(aiConfigSchema, body.ai);
      await db.update(aiConfigs).set({
        enabled: ai.enabled,
        vendorCount: ai.vendorCount,
        strategy: ai.strategy,
        speedSeconds: ai.speedSeconds,
        minPricePaise: ai.minPriceRupees ? rupeesToPaise(ai.minPriceRupees) : null,
        maxDiscountPercent: String(ai.maxDiscountPercent),
        updatedAt: new Date(),
      }).where(eq(aiConfigs.companyId, companyId));
      if (ai.enabled) await ensureAiVendors(companyId, ai.vendorCount);
      await audit({ companyId, actorType: "user", actorId: actor.user.id, actorName: actor.user.name, action: ai.enabled ? "ai.enabled" : "ai.disabled", entityType: "ai_config", entityId: companyId, metadata: { strategy: ai.strategy } });
    }
    return json({ ok: true });
  }
  if (a === "users" && !b && method === "POST") {
    assertCan(actor.user.role, "users.write");
    const body = parseBody(userSchema, await readJson(req));
    const email = body.email.toLowerCase();
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new HttpError("That email is already in use.", 409);
    await db.insert(users).values({ id: newId("usr"), companyId, email, passwordHash: await hashPassword(body.password), name: body.name, role: body.role, title: body.title ?? null });
    return json({ ok: true });
  }
  if (a === "users" && b && method === "PATCH") {
    assertCan(actor.user.role, "users.write");
    const body = await readJson<{ role?: string; active?: boolean }>(req);
    if (b === actor.user.id && body.active === false) throw new HttpError("You cannot deactivate your own account.", 400);
    await db.update(users).set({ ...(body.role ? { role: body.role } : {}), ...(body.active == null ? {} : { active: body.active }) }).where(and(eq(users.id, b), eq(users.companyId, companyId)));
    return json({ ok: true });
  }
  if (a === "vendors" && !b && method === "GET") {
    const q = url.searchParams.get("q")?.trim();
    const includeAi = url.searchParams.get("includeAi") === "1";
    let rows = await db.select().from(vendors).where(eq(vendors.companyId, companyId)).orderBy(vendors.name);
    if (!includeAi) rows = rows.filter((row) => row.simulationKind !== "ai_demo");
    if (q) rows = rows.filter((row) => `${row.name} ${row.city ?? ""} ${row.email} ${(row.categories ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
    return json({ ok: true, vendors: rows.map(vendorDto) });
  }
  if (a === "vendors" && !b && method === "POST") {
    assertCan(actor.user.role, "vendors.write");
    const body = parseBody(vendorSchema, await readJson(req));
    const id = await insertVendor(companyId, body, actor.user.name);
    return json({ ok: true, id });
  }
  if (a === "vendors" && b === "import" && method === "POST") {
    assertCan(actor.user.role, "vendors.write");
    const rows = await readImportRows(req);
    let created = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const name = row["company name"] || row["name"] || row["vendor"] || row["vendor name"];
      const email = row["email"] || row["email address"];
      if (!name || !email) {
        errors.push(`Skipped a row missing name or email.`);
        continue;
      }
      try {
        await insertVendor(companyId, { name, email, contactPerson: row["contact"] || row["contact person"] || null, phone: row["phone"] || null, city: row["city"] || null, state: row["state"] || null, country: row["country"] || "India", categories: (row["categories"] || row["category"] || "").split(/[;,]/).map((part) => part.trim()).filter(Boolean), paymentTerms: row["payment terms"] || null, gstNumber: row["gst"] || row["gst number"] || null }, actor.user.name);
        created += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Row failed.");
      }
    }
    return json({ ok: true, created, errors });
  }
  if (a === "vendors" && b && method === "GET" && !c) {
    const [vendor] = await db.select().from(vendors).where(and(eq(vendors.id, b), eq(vendors.companyId, companyId))).limit(1);
    if (!vendor) throw new HttpError("Supplier not found.", 404);
    const catalog = await db.select().from(vendorCatalog).where(eq(vendorCatalog.vendorId, vendor.id));
    const history = await db.select().from(priceHistory).where(eq(priceHistory.vendorId, vendor.id)).orderBy(desc(priceHistory.recordedAt)).limit(30);
    const quotes = await db.select().from(bids).where(and(eq(bids.vendorId, vendor.id), eq(bids.isSimulated, false))).orderBy(desc(bids.createdAt)).limit(20);
    const inviteRows = await db.select().from(invitations).where(eq(invitations.vendorId, vendor.id));
    const docs = await db.select().from(documents).where(eq(documents.vendorId, vendor.id));
    return json({
      ok: true,
      vendor: vendorDto(vendor),
      catalog: catalog.map((item) => ({ id: item.id, productName: item.productName, category: item.category, grade: item.grade, specifications: item.specifications, availableQty: num(item.availableQty), unit: item.unit, pricePaise: item.pricePaise, currency: item.currency, moq: num(item.moq), deliveryDays: item.deliveryDays, rating: item.ratingTenths == null ? null : item.ratingTenths / 10, source: item.source, lastVerifiedAt: item.lastVerifiedAt?.toISOString() ?? null })),
      priceHistory: history.map((row) => ({ id: row.id, productName: row.productName, pricePaise: row.pricePaise, unit: row.unit, source: row.source, recordedAt: row.recordedAt.toISOString() })),
      quotations: quotes.map((row) => ({ id: row.id, requestId: row.requestId, amountPaise: row.amountPaise, createdAt: row.createdAt.toISOString(), isFinal: row.isFinal })),
      invitations: inviteRows.length,
      documents: docs.map((doc) => ({ id: doc.id, fileName: doc.fileName, createdAt: doc.createdAt.toISOString(), scanStatus: doc.scanStatus })),
    });
  }
  if (a === "vendors" && b && method === "PATCH" && !c) {
    assertCan(actor.user.role, "vendors.write");
    const body = parseBody(vendorSchema.partial(), await readJson(req));
    const city = body.city ? resolveCity(body.city) : null;
    await db.update(vendors).set({
      ...(body.name ? { name: body.name } : {}),
      ...(body.email ? { email: body.email.toLowerCase() } : {}),
      contactPerson: body.contactPerson || undefined,
      phone: body.phone || undefined,
      city: body.city || undefined,
      state: city?.state || body.state || undefined,
      country: body.country || undefined,
      categories: body.categories,
      grades: body.grades,
      gstNumber: body.gstNumber || undefined,
      paymentTerms: body.paymentTerms || undefined,
      deliveryCapabilities: body.deliveryCapabilities || undefined,
      notes: body.notes || undefined,
      verificationStatus: body.verificationStatus,
      performanceScore: body.performanceScore,
      onTimeDeliveryRate: body.onTimeDeliveryRate,
      active: body.active,
      lat: city ? String(city.lat) : undefined,
      lng: city ? String(city.lng) : undefined,
      updatedAt: new Date(),
    }).where(and(eq(vendors.id, b), eq(vendors.companyId, companyId)));
    return json({ ok: true });
  }
  if (a === "vendors" && b && c === "portal" && method === "POST") {
    assertCan(actor.user.role, "vendors.write");
    const body = await readJson<{ password?: string }>(req);
    const password = body.password && body.password.length >= 8 ? body.password : newToken(9);
    await db.update(vendors).set({ portalEnabled: true, portalPasswordHash: await hashPassword(password), updatedAt: new Date() }).where(and(eq(vendors.id, b), eq(vendors.companyId, companyId)));
    return json({ ok: true, password, shownOnce: true });
  }
  if (a === "vendors" && b && method === "DELETE") {
    assertCan(actor.user.role, "vendors.write");
    const quote = await db.select().from(bids).where(eq(bids.vendorId, b)).limit(1);
    if (quote.length) {
      await db.update(vendors).set({ active: false, updatedAt: new Date() }).where(and(eq(vendors.id, b), eq(vendors.companyId, companyId)));
      return json({ ok: true, deactivated: true });
    }
    await db.delete(vendorCatalog).where(eq(vendorCatalog.vendorId, b));
    await db.delete(vendors).where(and(eq(vendors.id, b), eq(vendors.companyId, companyId)));
    return json({ ok: true, deleted: true });
  }
  if (a === "catalog" && !b && method === "POST") {
    assertCan(actor.user.role, "vendors.write");
    const body = parseBody(catalogSchema, await readJson(req));
    const id = newId("cat");
    await db.insert(vendorCatalog).values({
      id,
      companyId,
      vendorId: body.vendorId,
      productName: body.productName,
      category: body.category ?? null,
      grade: body.grade ?? null,
      specifications: body.specifications ?? null,
      availableQty: body.availableQty == null ? null : String(body.availableQty),
      unit: body.unit ?? null,
      pricePaise: rupeesToPaise(body.priceRupees),
      moq: body.moq == null ? null : String(body.moq),
      deliveryDays: body.deliveryDays ?? null,
      ratingTenths: body.rating == null ? null : Math.round(body.rating * 10),
      source: body.source || `Added by ${actor.user.name} on ${new Date().toISOString().slice(0, 10)}. Not independently verified.`,
      lastVerifiedAt: null,
      isSimulated: false,
    });
    await db.insert(priceHistory).values({ id: newId("ph"), companyId, vendorId: body.vendorId, productName: body.productName, pricePaise: rupeesToPaise(body.priceRupees), unit: body.unit ?? null, source: "Workspace catalog update" });
    return json({ ok: true, id });
  }
  if (a === "catalog" && b && method === "DELETE") {
    assertCan(actor.user.role, "vendors.write");
    await db.delete(vendorCatalog).where(and(eq(vendorCatalog.id, b), eq(vendorCatalog.companyId, companyId)));
    return json({ ok: true });
  }
  if (a === "templates" && b === "requirements") {
    return new Response("Product,Grade,Quantity,Unit,Specifications,Target Price,Category\nIron Rod,Grade 2,5000,KG,TMT bar,92,Steel\n", { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=requirements-template.csv" } });
  }
  if (a === "templates" && b === "vendors") {
    return new Response("Company Name,Contact,Email,Phone,City,State,Country,Categories,GST,Payment Terms\n", { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=vendors-template.csv" } });
  }
  if (a === "documents" && !b && method === "POST") {
    assertCan(actor.user.role, "requests.write");
    const form = await req.formData();
    const file = form.get("file");
    const pasted = form.get("csv");
    let fileName = "requirements.csv";
    let bytes = Buffer.from("");
    let mime: string | null = "text/csv";
    if (file instanceof File) {
      fileName = file.name;
      bytes = Buffer.from(await file.arrayBuffer());
      mime = file.type || null;
      assertAllowedFile(fileName, bytes.length);
    } else if (typeof pasted === "string") {
      bytes = Buffer.from(pasted, "utf8");
      fileName = "pasted-requirements.csv";
    } else throw new HttpError("Choose a file or paste a table.", 400);
    const scanStatus = await scanStatusFor(fileName, bytes);
    if (scanStatus === "blocked") throw new HttpError("The file was rejected by the configured scanner.", 400);
    const extracted = await extractBuffer(fileName, bytes, mime);
    const saved = await saveUpload(companyId, fileName, bytes);
    await db.insert(documents).values({
      id: saved.id,
      companyId,
      uploadedBy: actor.user.id,
      fileName,
      mimeType: mime,
      sizeBytes: bytes.length,
      storagePath: saved.relative,
      extractedText: extracted.text,
      extractionJson: extracted.items,
      extractionStatus: extracted.items.length ? "review" : "empty",
      scanStatus,
      requestId: clean(form.get("requestId")),
      vendorId: clean(form.get("vendorId")),
    });
    await audit({ companyId, actorType: "user", actorId: actor.user.id, actorName: actor.user.name, action: "document.uploaded", entityType: "document", entityId: saved.id, metadata: { engine: extracted.engine, fileName } });
    return json({ ok: true, documentId: saved.id, items: extracted.items, warnings: extracted.warnings, engine: extracted.engine, scanStatus });
  }
  if (a === "documents" && b === "parse" && method === "POST") {
    const body = await readJson<{ text?: string; rows?: Record<string, string>[] }>(req);
    const extracted = body.rows?.length ? rowsToItems(body.rows, "paste") : textToItems(body.text || "");
    const bytes = Buffer.from(body.text || JSON.stringify(body.rows ?? []), "utf8");
    const saved = await saveUpload(companyId, "pasted-requirements.txt", bytes);
    await db.insert(documents).values({ id: saved.id, companyId, uploadedBy: actor.user.id, fileName: "pasted-requirements.txt", mimeType: "text/plain", sizeBytes: bytes.length, storagePath: saved.relative, extractedText: body.text ?? null, extractionJson: extracted.items, extractionStatus: "review", scanStatus: "not_configured" });
    return json({ ok: true, documentId: saved.id, items: extracted.items, warnings: extracted.warnings, engine: "paste" });
  }
  if (a === "documents" && b && method === "GET") {
    const [doc] = await db.select().from(documents).where(and(eq(documents.id, b), eq(documents.companyId, companyId))).limit(1);
    if (!doc) throw new HttpError("Document not found.", 404);
    const bytes = await readUpload(doc.storagePath);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": doc.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${doc.fileName.replace(/"/g, "")}"` } });
  }
  if (a === "requests" && !b && method === "GET") {
    const rows = await db.select().from(procurementRequests).where(eq(procurementRequests.companyId, companyId)).orderBy(desc(procurementRequests.updatedAt));
    return json({ ok: true, requests: rows.map((row) => ({ id: row.id, referenceCode: row.referenceCode, title: row.title, status: row.status, category: row.category, workflow: row.workflow, updatedAt: row.updatedAt.toISOString(), savingsPaise: row.savingsPaise, currency: row.currency, awardMode: row.awardMode })) });
  }
  if (a === "requests" && !b && method === "POST") {
    assertCan(actor.user.role, "requests.write");
    const body = parseBody(requestSchema, await readJson(req));
    const id = newId("req");
    const referenceCode = await nextReference(companyId);
    const city = resolveCity(body.deliveryLocation || actor.company.city);
    const confirmed = body.items.every((item) => item.confirmed);
    const baseline = body.items.reduce((sum, item) => sum + (item.targetPriceRupees && item.quantity ? rupeesToPaise(item.targetPriceRupees) * item.quantity : 0), 0);
    await db.insert(procurementRequests).values({
      id,
      companyId,
      createdBy: actor.user.id,
      referenceCode,
      title: body.title,
      status: confirmed ? "open" : "review",
      workflow: body.workflow ?? "manual",
      description: body.description ?? null,
      category: body.category ?? body.items[0]?.category ?? null,
      deliveryLocation: body.deliveryLocation ?? null,
      deliveryCity: city?.name ?? null,
      expectedDeliveryDate: asDate(body.expectedDeliveryDate),
      maxBudgetPaise: body.maxBudgetRupees ? rupeesToPaise(body.maxBudgetRupees) : null,
      currency: body.currency || actor.company.currency,
      taxPercent: body.taxPercent == null ? actor.company.taxPercent : String(body.taxPercent),
      visibilityMode: body.visibilityMode || actor.company.defaultVisibility,
      terms: body.terms ?? "Quotations are sourcing offers. A recorded decision is not an e-signed contract.",
      baselinePaise: baseline || null,
      baselineLabel: baseline ? "Sum of confirmed target prices × quantities." : null,
      targetPricePaise: baseline || null,
    });
    await insertItems(companyId, id, body.items);
    await audit({ companyId, actorType: "user", actorId: actor.user.id, actorName: actor.user.name, action: "request.created", entityType: "procurement_request", entityId: id, metadata: { referenceCode } });
    return json({ ok: true, id, referenceCode });
  }
  if (a === "requests" && b && method === "GET" && !c) {
    if (b) await maybeTick(companyId, b);
    return json({ ok: true, ...(await loadDossier(companyId, b)) });
  }
  if (a === "requests" && b && c === "items" && method === "POST") {
    assertCan(actor.user.role, "requests.write");
    const body = parseBody(z.object({ items: z.array(itemSchema).min(1), confirm: z.boolean().optional() }), await readJson(req));
    await db.delete(requirementItems).where(and(eq(requirementItems.requestId, b), eq(requirementItems.companyId, companyId)));
    await insertItems(companyId, b, body.items.map((item) => ({ ...item, confirmed: body.confirm ? true : item.confirmed, needsReview: body.confirm ? false : item.needsReview })));
    if (body.confirm) await db.update(procurementRequests).set({ status: "open", updatedAt: new Date() }).where(and(eq(procurementRequests.id, b), eq(procurementRequests.companyId, companyId)));
    return json({ ok: true });
  }
  if (a === "requests" && b && c === "invite" && method === "POST") {
    assertCan(actor.user.role, "invite");
    const body = parseBody(inviteSchema, await readJson(req));
    const result = await inviteVendors({
      actor,
      requestId: b,
      vendorIds: body.vendorIds,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      visibilityMode: body.visibilityMode,
      minIncrementPaise: rupeesToPaise(body.minIncrementRupees),
      terms: body.terms,
      resend: body.resend,
      req,
    });
    return json({ ok: true, ...result });
  }
  if (a === "requests" && b && c === "award" && method === "POST") {
    assertCan(actor.user.role, "requests.award");
    const body = await readJson<{ vendorId: string; closeNow?: boolean; acknowledgeDemo?: boolean }>(req);
    return json({ ok: true, ...(await awardRequest(actor, b, body)) });
  }
  if (a === "requests" && b && c === "close" && method === "POST") {
    assertCan(actor.user.role, "requests.award");
    await closeSession(actor, b);
    return json({ ok: true });
  }
  if (a === "requests" && b && c === "reschedule" && method === "POST") {
    assertCan(actor.user.role, "requests.award");
    const body = await readJson<{ endsAt: string; startsAt?: string; note?: string }>(req);
    await rescheduleSession(actor, b, { endsAt: new Date(body.endsAt), startsAt: body.startsAt ? new Date(body.startsAt) : null, note: body.note }, req);
    return json({ ok: true });
  }
  if (a === "requests" && b && c === "visibility" && method === "POST") {
    assertCan(actor.user.role, "requests.write");
    const body = await readJson<{ visibilityMode: string }>(req);
    const allowed = ["open", "anonymous", "blind", "company_only"];
    if (!allowed.includes(body.visibilityMode)) throw new HttpError("Unknown visibility mode.", 400);
    await db.update(procurementRequests).set({ visibilityMode: body.visibilityMode, updatedAt: new Date() }).where(and(eq(procurementRequests.id, b), eq(procurementRequests.companyId, companyId)));
    const { biddingSessions } = await import("@/db/schema");
    await db.update(biddingSessions).set({ visibilityMode: body.visibilityMode, updatedAt: new Date() }).where(eq(biddingSessions.requestId, b));
    await audit({ companyId, actorType: "user", actorId: actor.user.id, actorName: actor.user.name, action: "bidding.visibility", entityType: "procurement_request", entityId: b, metadata: { visibilityMode: body.visibilityMode } });
    return json({ ok: true });
  }
  if (a === "requests" && b && c === "simulate" && method === "POST") {
    assertCan(actor.user.role, "ai.configure");
    return json({ ok: true, ...(await runSimulation(actor, b, req)) });
  }
  if (a === "requests" && b && c === "negotiate" && method === "POST") {
    assertCan(actor.user.role, "negotiate");
    const body = parseBody(negotiationStartSchema, await readJson(req));
    return json({ ok: true, ...(await createNegotiation(actor, b, { vendorId: body.vendorId, offerPaise: rupeesToPaise(body.offerRupees), message: body.message }, req)) });
  }
  if (a === "extensions" && b && c === "review" && method === "POST") {
    assertCan(actor.user.role, "requests.award");
    const body = parseBody(extensionReviewSchema, await readJson(req));
    await reviewExtension(actor, b, body, req);
    return json({ ok: true });
  }
  if (a === "negotiations" && b && c === "message" && method === "POST") {
    assertCan(actor.user.role, "negotiate");
    const body = parseBody(negotiationMessageSchema, await readJson(req));
    if (body.action === "accept" || body.action === "confirm") assertCan(actor.user.role, "negotiate.agree");
    await postNegotiationMessage({ negotiationId: b, actor, action: body.action, message: body.message, offerPaise: body.offerRupees ? rupeesToPaise(body.offerRupees) : null });
    return json({ ok: true });
  }
  if (a === "negotiations" && b && c === "convert" && method === "POST") {
    assertCan(actor.user.role, "invite");
    await convertNegotiation(actor, b, req);
    return json({ ok: true });
  }

  return fail("Not found.", 404);
}

async function maybeTick(companyId: string, requestId: string) {
  const { biddingSessions } = await import("@/db/schema");
  const [session] = await db.select().from(biddingSessions).where(and(eq(biddingSessions.requestId, requestId), eq(biddingSessions.companyId, companyId))).limit(1);
  if (session) await tickAi(session.id);
}

async function runSimulation(actor: Awaited<ReturnType<typeof requireUser>>, requestId: string, req: Request) {
  const [config] = await db.select().from(aiConfigs).where(eq(aiConfigs.companyId, actor.company.id)).limit(1);
  if (!config?.enabled) throw new HttpError("Turn AI vendors on before running a simulation.", 400);
  const dossier = await loadDossier(actor.company.id, requestId);
  const [request] = await db.select().from(procurementRequests).where(eq(procurementRequests.id, requestId)).limit(1);
  const items = await db.select().from(requirementItems).where(eq(requirementItems.requestId, requestId));
  if (!request) throw new HttpError("Request not found.", 404);
  const reference = priceReference(request, items);
  if (!reference) throw new HttpError("Add a target price, budget, or line targets first. Simulation will not invent a market price.", 400);
  const profiles = await ensureAiVendors(actor.company.id, config.vendorCount);
  const selected = profiles.slice(0, config.vendorCount);
  const startsAt = dossier.session ? new Date(dossier.session.startsAt) : new Date();
  const endsAt = dossier.session ? new Date(dossier.session.endsAt) : new Date(Date.now() + 2 * 3600000);
  const invited = await inviteVendors({
    actor,
    requestId,
    vendorIds: selected.map((vendor) => vendor.id),
    startsAt,
    endsAt,
    visibilityMode: dossier.request.visibilityMode,
    minIncrementPaise: dossier.session?.minIncrementPaise ?? actor.company.minBidIncrementPaise,
    simulationOnly: true,
    req,
  });
  for (const vendor of selected) {
    const profile = vendor.aiProfile ?? { strategy: "competitive" as const, anchorFactor: 1.03, floorFactor: 0.93, maxBids: 8 };
    const opened = openingAmount(reference.paise, profile, config.minPricePaise, Number(config.maxDiscountPercent));
    await db.update(invitations).set({ simulationOnly: true, simAnchorPaise: reference.paise }).where(and(eq(invitations.requestId, requestId), eq(invitations.vendorId, vendor.id)));
    const existing = await db.select().from(bids).where(and(eq(bids.sessionId, invited.sessionId), eq(bids.vendorId, vendor.id))).limit(1);
    if (!existing.length) {
      await db.insert(bids).values({
        id: newId("bid"),
        companyId: actor.company.id,
        sessionId: invited.sessionId,
        requestId,
        vendorId: vendor.id,
        amountPaise: opened.amount,
        note: `SIMULATED / AI DEMO opening. Anchor uses ${reference.label}.`,
        isSimulated: true,
      });
    }
  }
  await tickAi(invited.sessionId);
  await audit({ companyId: actor.company.id, actorType: "user", actorId: actor.user.id, actorName: actor.user.name, action: "simulation.started", entityType: "procurement_request", entityId: requestId, metadata: { anchor: reference.label } });
  return { sessionId: invited.sessionId, anchorLabel: reference.label };
}

async function insertItems(companyId: string, requestId: string, items: z.infer<typeof itemSchema>[]) {
  await db.insert(requirementItems).values(
    items.map((item, index) => ({
      id: newId("item"),
      requestId,
      companyId,
      productName: item.productName,
      category: item.category ?? null,
      grade: item.grade ?? null,
      specifications: item.specifications ?? null,
      quantity: item.quantity == null ? null : String(item.quantity),
      unit: item.unit ?? null,
      targetPricePaise: item.targetPriceRupees == null ? null : rupeesToPaise(item.targetPriceRupees),
      deliveryNotes: item.deliveryNotes ?? null,
      confidence: item.confidence == null ? null : String(item.confidence),
      needsReview: item.confirmed ? false : item.needsReview ?? true,
      confirmed: Boolean(item.confirmed),
      extractionNote: item.extractionNote ?? null,
      sortOrder: index,
    })),
  );
}

async function insertVendor(companyId: string, body: { name: string; email: string; contactPerson?: string | null; phone?: string | null; city?: string | null; state?: string | null; country?: string | null; address?: string | null; categories?: string[]; grades?: string[]; gstNumber?: string | null; paymentTerms?: string | null; deliveryCapabilities?: string | null; notes?: string | null }, actorName: string) {
  const email = body.email.toLowerCase();
  const [existing] = await db.select().from(vendors).where(eq(vendors.email, email)).limit(1);
  if (existing) throw new HttpError(`${email} is already on a supplier record.`, 409);
  const city = resolveCity(body.city);
  const id = newId("ven");
  await db.insert(vendors).values({
    id,
    companyId,
    name: body.name,
    email,
    contactPerson: body.contactPerson ?? null,
    phone: body.phone ?? null,
    address: body.address ?? null,
    city: body.city ?? null,
    state: city?.state ?? body.state ?? null,
    country: body.country || "India",
    lat: city ? String(city.lat) : null,
    lng: city ? String(city.lng) : null,
    categories: body.categories ?? [],
    grades: body.grades ?? [],
    gstNumber: body.gstNumber ?? null,
    paymentTerms: body.paymentTerms ?? null,
    deliveryCapabilities: body.deliveryCapabilities ?? null,
    notes: body.notes ?? null,
    verificationStatus: "unverified",
    source: `Added by ${actorName} on ${new Date().toISOString().slice(0, 10)}. Company-entered record, not independently verified.`,
    lastVerifiedAt: null,
    isSimulated: false,
    simulationKind: null,
  });
  return id;
}

async function readImportRows(req: Request) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await readJson<{ rows?: Record<string, string>[] }>(req);
    return (body.rows ?? []).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), String(value ?? "")])));
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError("Upload an Excel or CSV file.", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  assertAllowedFile(file.name, bytes.length);
  if (file.name.toLowerCase().endsWith(".csv")) return parseCsv(bytes.toString("utf8")).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value])));
  const XLSX = await import("xlsx");
  const book = XLSX.read(bytes, { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0] || ""];
  const rows = sheet ? (XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[]) : [];
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), String(value ?? "")])));
}

