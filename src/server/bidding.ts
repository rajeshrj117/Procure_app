import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs,
  bids,
  biddingSessions,
  documents,
  extensionRequests,
  invitations,
  negotiationMessages,
  negotiations,
  procurementRequests,
  requirementItems,
  vendors,
  companies,
  type AiProfile,
} from "@/db/schema";
import { num, plainMoney, vendorBadge } from "@/lib/format";
import type { RankRow } from "@/lib/types";
import {
  HttpError,
  appBaseUrl,
  audit,
  newId,
  newToken,
  notifyCompany,
  notifyVendor,
  sendEmail,
  type UserActor,
} from "./core";

type SessionRow = typeof biddingSessions.$inferSelect;
type BidRow = typeof bids.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function esc(value: string) {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] || ch);
}

export function aliasFor(vendorId: string) {
  let hash = 0;
  for (const char of vendorId) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return `Bidder ${(hash % 900) + 100}`;
}

export async function syncSessionPhase(session: SessionRow) {
  const now = new Date();
  if (session.status === "cancelled") return { ...session, phase: "cancelled" };
  if (session.closedAt || session.status === "closed") return { ...session, phase: "closed" };
  if (now < session.startsAt) {
    if (session.status !== "scheduled") {
      await db.update(biddingSessions).set({ status: "scheduled", updatedAt: now }).where(eq(biddingSessions.id, session.id));
    }
    return { ...session, status: "scheduled", phase: "scheduled" };
  }
  if (now > session.endsAt) {
    await db.update(biddingSessions).set({ status: "closed", closedAt: now, updatedAt: now }).where(eq(biddingSessions.id, session.id));
    return { ...session, status: "closed", closedAt: now, phase: "closed" };
  }
  if (session.status !== "live") {
    await db.update(biddingSessions).set({ status: "live", updatedAt: now }).where(eq(biddingSessions.id, session.id));
  }
  return { ...session, status: "live", phase: "live" };
}

function latestByVendor(rows: BidRow[]) {
  const map = new Map<string, BidRow>();
  for (const bid of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) map.set(bid.vendorId, bid);
  return [...map.values()];
}

export function rankBids(rows: BidRow[], vendorMap: Map<string, VendorRow>): RankRow[] {
  const latest = latestByVendor(rows);
  const sorted = latest.sort((a, b) => a.amountPaise - b.amountPaise || a.createdAt.getTime() - b.createdAt.getTime());
  const best = sorted[0]?.amountPaise;
  const tied = sorted.filter((bid) => bid.amountPaise === best).length > 1;
  return sorted.map((bid, index) => {
    const vendor = vendorMap.get(bid.vendorId);
    return {
      rank: index + 1,
      vendorId: bid.vendorId,
      vendorName: vendor?.name ?? "Supplier",
      badge: vendorBadge(vendor?.simulationKind),
      amountPaise: bid.amountPaise,
      bidId: bid.id,
      submittedAt: bid.createdAt.toISOString(),
      isFinal: bid.isFinal,
      status: index === 0 ? (tied ? "Tied" : "Winning") : "Outbid",
      simulationKind: vendor?.simulationKind ?? null,
    };
  });
}

function requestDto(row: typeof procurementRequests.$inferSelect) {
  return {
    id: row.id,
    referenceCode: row.referenceCode,
    title: row.title,
    status: row.status,
    workflow: row.workflow,
    description: row.description,
    category: row.category,
    deliveryLocation: row.deliveryLocation,
    deliveryCity: row.deliveryCity,
    expectedDeliveryDate: iso(row.expectedDeliveryDate),
    targetPricePaise: row.targetPricePaise,
    maxBudgetPaise: row.maxBudgetPaise,
    currency: row.currency,
    taxPercent: num(row.taxPercent),
    visibilityMode: row.visibilityMode,
    terms: row.terms,
    baselinePaise: row.baselinePaise,
    baselineLabel: row.baselineLabel,
    awardedVendorId: row.awardedVendorId,
    awardedPaise: row.awardedPaise,
    awardedAt: iso(row.awardedAt),
    savingsPaise: row.savingsPaise,
    savingsPercent: num(row.savingsPercent),
    awardMode: row.awardMode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function itemDto(row: typeof requirementItems.$inferSelect) {
  return {
    id: row.id,
    productName: row.productName,
    category: row.category,
    grade: row.grade,
    specifications: row.specifications,
    quantity: num(row.quantity),
    unit: row.unit,
    targetPricePaise: row.targetPricePaise,
    deliveryNotes: row.deliveryNotes,
    confidence: num(row.confidence),
    needsReview: row.needsReview,
    confirmed: row.confirmed,
    extractionNote: row.extractionNote,
    sortOrder: row.sortOrder,
  };
}

export async function loadDossier(companyId: string, requestId: string) {
  const [request] = await db
    .select()
    .from(procurementRequests)
    .where(and(eq(procurementRequests.id, requestId), eq(procurementRequests.companyId, companyId)))
    .limit(1);
  if (!request) throw new HttpError("Procurement request not found.", 404);
  const items = await db.select().from(requirementItems).where(eq(requirementItems.requestId, requestId)).orderBy(asc(requirementItems.sortOrder));
  const [sessionRow] = await db
    .select()
    .from(biddingSessions)
    .where(eq(biddingSessions.requestId, requestId))
    .orderBy(desc(biddingSessions.createdAt))
    .limit(1);
  const session = sessionRow ? await syncSessionPhase(sessionRow) : null;
  const invitationRows = await db.select().from(invitations).where(eq(invitations.requestId, requestId));
  const bidRows = session ? await db.select().from(bids).where(eq(bids.sessionId, session.id)).orderBy(asc(bids.createdAt)) : [];
  const extensionRows = session ? await db.select().from(extensionRequests).where(eq(extensionRequests.sessionId, session.id)).orderBy(desc(extensionRequests.createdAt)) : [];
  const negotiationRows = await db.select().from(negotiations).where(eq(negotiations.requestId, requestId));
  const docs = await db.select().from(documents).where(eq(documents.requestId, requestId)).orderBy(desc(documents.createdAt));
  const activities = await db
    .select()
    .from(activityLogs)
    .where(and(eq(activityLogs.companyId, companyId), eq(activityLogs.entityId, requestId)))
    .orderBy(desc(activityLogs.createdAt))
    .limit(40);
  const vendorIds = Array.from(
    new Set(
      [...invitationRows.map((row) => row.vendorId), ...bidRows.map((row) => row.vendorId), ...negotiationRows.map((row) => row.vendorId), request.awardedVendorId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  const vendorRows = vendorIds.length ? await db.select().from(vendors).where(inArray(vendors.id, vendorIds)) : [];
  const vendorMap = new Map(vendorRows.map((vendor) => [vendor.id, vendor]));
  const decisionBids = bidRows.filter((bid) => !bid.isSimulated && vendorMap.get(bid.vendorId)?.simulationKind !== "ai_demo");
  const aiBids = bidRows.filter((bid) => bid.isSimulated || vendorMap.get(bid.vendorId)?.simulationKind === "ai_demo");
  const messages = negotiationRows.length
    ? await db
        .select()
        .from(negotiationMessages)
        .where(inArray(negotiationMessages.negotiationId, negotiationRows.map((row) => row.id)))
        .orderBy(asc(negotiationMessages.createdAt))
    : [];

  return {
    request: requestDto(request),
    items: items.map(itemDto),
    session: session
      ? {
          id: session.id,
          status: session.status,
          phase: session.phase,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
          originalEndsAt: iso(session.originalEndsAt),
          visibilityMode: session.visibilityMode,
          minIncrementPaise: session.minIncrementPaise,
          currency: session.currency,
          extensionCount: session.extensionCount,
          closedAt: iso(session.closedAt),
        }
      : null,
    invitations: invitationRows.map((row) => {
      const vendor = vendorMap.get(row.vendorId);
      return {
        id: row.id,
        vendorId: row.vendorId,
        vendorName: vendor?.name ?? "Supplier",
        badge: vendorBadge(vendor?.simulationKind),
        email: vendor?.email ?? "",
        token: row.token,
        status: row.status,
        emailStatus: row.emailStatus,
        simulationOnly: row.simulationOnly,
        sentAt: iso(row.sentAt),
        openedAt: iso(row.openedAt),
        expiresAt: iso(row.expiresAt),
      };
    }),
    bids: decisionBids.map((bid) => bidDto(bid, vendorMap)),
    aiBids: aiBids.map((bid) => bidDto(bid, vendorMap)),
    ranking: rankBids(decisionBids, vendorMap),
    operationalRanking: rankBids(
      decisionBids.filter((bid) => !vendorMap.get(bid.vendorId)?.simulationKind),
      vendorMap,
    ),
    aiRanking: rankBids(aiBids, vendorMap),
    extensions: extensionRows.map((row) => ({
      id: row.id,
      vendorId: row.vendorId,
      vendorName: vendorMap.get(row.vendorId)?.name ?? "Supplier",
      reason: row.reason,
      requestedMinutes: row.requestedMinutes,
      message: row.message,
      status: row.status,
      companyNote: row.companyNote,
      approvedMinutes: row.approvedMinutes,
      previousEndsAt: iso(row.previousEndsAt),
      newEndsAt: iso(row.newEndsAt),
      createdAt: row.createdAt.toISOString(),
      reviewedAt: iso(row.reviewedAt),
    })),
    negotiations: negotiationRows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      vendorId: row.vendorId,
      vendorName: vendorMap.get(row.vendorId)?.name ?? "Supplier",
      badge: vendorBadge(vendorMap.get(row.vendorId)?.simulationKind),
      status: row.status,
      vendorToken: row.vendorToken,
      agreedPaise: row.agreedPaise,
      agreedAt: iso(row.agreedAt),
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
      disclaimer: vendorMap.get(row.vendorId)?.simulationKind
        ? "Simulated counterparty. An agreement here is a demo note, not a purchase commitment or contractual acceptance."
        : "Recording an agreement stores a sourcing decision. It is not an e-signed contract.",
      messages: messages
        .filter((message) => message.negotiationId === row.id)
        .map((message) => ({
          id: message.id,
          senderRole: message.senderRole,
          senderName: message.senderName,
          body: message.body,
          offerPaise: message.offerPaise,
          action: message.action,
          createdAt: message.createdAt.toISOString(),
        })),
    })),
    documents: docs.map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      extractionStatus: doc.extractionStatus,
      scanStatus: doc.scanStatus,
      createdAt: doc.createdAt.toISOString(),
      requestId: doc.requestId,
      vendorId: doc.vendorId,
    })),
    activities: activities.map((row) => ({
      id: row.id,
      actorType: row.actorType,
      actorName: row.actorName,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    })),
    serverNow: new Date().toISOString(),
  };
}

function bidDto(bid: BidRow, vendorMap: Map<string, VendorRow>) {
  const vendor = vendorMap.get(bid.vendorId);
  return {
    id: bid.id,
    vendorId: bid.vendorId,
    vendorName: vendor?.name ?? "Supplier",
    badge: vendorBadge(vendor?.simulationKind),
    amountPaise: bid.amountPaise,
    note: bid.note,
    isSimulated: bid.isSimulated,
    isFinal: bid.isFinal,
    createdAt: bid.createdAt.toISOString(),
  };
}

async function loadInviteContext(token: string) {
  const [invitation] = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
  if (!invitation) throw new HttpError("This bidding link is not valid.", 404);
  if (invitation.expiresAt && invitation.expiresAt.getTime() < Date.now()) {
    throw new HttpError("This bidding link has expired. Ask the buyer for a new invitation.", 410);
  }
  const [request] = await db.select().from(procurementRequests).where(eq(procurementRequests.id, invitation.requestId)).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, invitation.vendorId)).limit(1);
  const [company] = await db.select().from(companies).where(eq(companies.id, invitation.companyId)).limit(1);
  if (!request || !vendor || !company || !invitation.sessionId) throw new HttpError("Invitation is incomplete.", 404);
  const [sessionRow] = await db.select().from(biddingSessions).where(eq(biddingSessions.id, invitation.sessionId)).limit(1);
  if (!sessionRow) throw new HttpError("Bidding session not found.", 404);
  const session = await syncSessionPhase(sessionRow);
  return { invitation, request, vendor, company, session };
}

export async function publicBidPayload(token: string) {
  const ctx = await loadInviteContext(token);
  if (!ctx.invitation.openedAt) {
    await db.update(invitations).set({ openedAt: new Date(), status: ctx.invitation.status === "responded" ? "responded" : "opened" }).where(eq(invitations.id, ctx.invitation.id));
    await notifyCompany(ctx.company.id, {
      title: "Invitation opened",
      body: `${ctx.vendor.name} opened the bidding link for ${ctx.request.referenceCode}.`,
      type: "invitation",
      href: `/actions/${ctx.request.id}`,
    });
  }
  const items = await db.select().from(requirementItems).where(eq(requirementItems.requestId, ctx.request.id)).orderBy(asc(requirementItems.sortOrder));
  const docs = await db.select().from(documents).where(eq(documents.requestId, ctx.request.id));
  const allBids = await db.select().from(bids).where(eq(bids.sessionId, ctx.session.id)).orderBy(asc(bids.createdAt));
  const invited = await db.select().from(invitations).where(eq(invitations.sessionId, ctx.session.id));
  const vendorRows = invited.length ? await db.select().from(vendors).where(inArray(vendors.id, invited.map((row) => row.vendorId))) : [];
  const vendorMap = new Map(vendorRows.map((vendor) => [vendor.id, vendor]));
  const visible = allBids.filter((bid) => {
    if (bid.isSimulated || vendorMap.get(bid.vendorId)?.simulationKind === "ai_demo") return false;
    if (!ctx.vendor.simulationKind && vendorMap.get(bid.vendorId)?.simulationKind) return false;
    return true;
  });
  const own = allBids.filter((bid) => bid.vendorId === ctx.vendor.id && !bid.isSimulated);
  const ranked = rankBids(visible, vendorMap);
  const ownRank = ranked.find((row) => row.vendorId === ctx.vendor.id) ?? null;
  const latestOwn = own.at(-1) ?? null;
  const mode = ctx.session.visibilityMode;
  const hidePrices = mode === "blind" || mode === "company_only";
  const ranking = hidePrices
    ? null
    : ranked.map((row) =>
        mode === "anonymous"
          ? {
              ...row,
              vendorName: row.vendorId === ctx.vendor.id ? "Your quotation" : aliasFor(row.vendorId),
              vendorId: row.vendorId === ctx.vendor.id ? ctx.vendor.id : "hidden",
              badge: row.vendorId === ctx.vendor.id ? row.badge : null,
              isYou: row.vendorId === ctx.vendor.id,
            }
          : { ...row, isYou: row.vendorId === ctx.vendor.id },
      );
  const winning = hidePrices ? null : ranked[0]?.amountPaise ?? null;
  const minimumNextPaise = latestOwn ? latestOwn.amountPaise - Math.max(ctx.session.minIncrementPaise, 1) : null;
  const extensions = await db
    .select()
    .from(extensionRequests)
    .where(and(eq(extensionRequests.sessionId, ctx.session.id), eq(extensionRequests.vendorId, ctx.vendor.id)))
    .orderBy(desc(extensionRequests.createdAt));
  return {
    ok: true,
    serverNow: new Date().toISOString(),
    companyName: ctx.company.name,
    timezone: ctx.company.timezone,
    currency: ctx.request.currency,
    vendor: { id: ctx.vendor.id, name: ctx.vendor.name, badge: vendorBadge(ctx.vendor.simulationKind), portalEnabled: ctx.vendor.portalEnabled },
    request: requestDto(ctx.request),
    items: items.map(itemDto),
    session: {
      id: ctx.session.id,
      phase: ctx.session.phase,
      status: ctx.session.status,
      startsAt: ctx.session.startsAt.toISOString(),
      endsAt: ctx.session.endsAt.toISOString(),
      originalEndsAt: iso(ctx.session.originalEndsAt),
      visibilityMode: ctx.session.visibilityMode,
      minIncrementPaise: ctx.session.minIncrementPaise,
      extensionCount: ctx.session.extensionCount,
    },
    documents: docs.map((doc) => ({ id: doc.id, fileName: doc.fileName, sizeBytes: doc.sizeBytes })),
    ownBids: own.map((bid) => ({ id: bid.id, amountPaise: bid.amountPaise, note: bid.note, isFinal: bid.isFinal, createdAt: bid.createdAt.toISOString() })),
    ranking,
    ownRank: hidePrices ? null : ownRank?.rank ?? null,
    winningPricePaise: winning,
    gapPaise: ownRank && winning != null ? ownRank.amountPaise - winning : null,
    minimumNextPaise,
    lockedFinal: Boolean(latestOwn?.isFinal),
    termsAccepted: Boolean(ctx.invitation.termsAcceptedAt),
    extensions: extensions.map((row) => ({ id: row.id, status: row.status, reason: row.reason, requestedMinutes: row.requestedMinutes, companyNote: row.companyNote, createdAt: row.createdAt.toISOString() })),
    disclaimer: ctx.vendor.simulationKind
      ? "You are viewing a demo supplier workspace. Quotations here are simulated and cannot create a real purchase commitment."
      : "Submit only a price you are prepared to stand behind. The buyer records a sourcing decision; this screen is not an e-signed contract.",
  };
}

export async function submitBidByToken(token: string, input: { amountPaise: number; note?: string | null; isFinal?: boolean; acceptedTerms: boolean }) {
  if (!input.acceptedTerms) throw new HttpError("Accept the terms before submitting a bid.", 400);
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new HttpError("Enter a valid price greater than zero.", 400);
  const ctx = await loadInviteContext(token);
  if (ctx.invitation.simulationOnly || ctx.vendor.simulationKind === "ai_demo") {
    throw new HttpError("Simulated AI bidders cannot submit through a supplier link.", 403);
  }
  if (ctx.session.phase !== "live") throw new HttpError(`Bidding is ${ctx.session.phase}. The server clock controls the window.`, 400);
  if (ctx.request.awardedAt) throw new HttpError("This requirement has already been decided.", 400);
  if (ctx.request.maxBudgetPaise && input.amountPaise > ctx.request.maxBudgetPaise) {
    throw new HttpError("This quotation is above the buyer's maximum budget.", 400);
  }

  const bidId = newId("bid");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from bidding_sessions where id = ${ctx.session.id} for update`);
    const [fresh] = await tx.select().from(biddingSessions).where(eq(biddingSessions.id, ctx.session.id)).limit(1);
    if (!fresh || fresh.closedAt || fresh.status === "closed" || fresh.status === "cancelled") throw new HttpError("Bidding is closed.", 400);
    const now = new Date();
    if (now < fresh.startsAt || now > fresh.endsAt) throw new HttpError("Bidding is outside the official window.", 400);
    const previous = await tx.select().from(bids).where(and(eq(bids.sessionId, fresh.id), eq(bids.vendorId, ctx.vendor.id), eq(bids.isSimulated, false))).orderBy(desc(bids.createdAt));
    const latest = previous[0];
    if (latest?.isFinal) throw new HttpError("A final quotation is already on file and cannot be revised.", 400);
    if (latest) {
      const floor = latest.amountPaise - Math.max(fresh.minIncrementPaise, 1);
      if (input.amountPaise > floor) {
        throw new HttpError(`Improve your previous quotation by at least ${plainMoney(Math.max(fresh.minIncrementPaise, 1), ctx.request.currency)}.`, 400);
      }
      if (now.getTime() - latest.createdAt.getTime() < 2000 && latest.amountPaise === input.amountPaise) {
        throw new HttpError("Duplicate bid ignored.", 409);
      }
    }
    await tx.insert(bids).values({
      id: bidId,
      companyId: ctx.company.id,
      sessionId: fresh.id,
      requestId: ctx.request.id,
      vendorId: ctx.vendor.id,
      amountPaise: input.amountPaise,
      note: input.note ?? null,
      isSimulated: false,
      isFinal: Boolean(input.isFinal),
    });
    await tx.update(invitations).set({ status: "responded", termsAcceptedAt: ctx.invitation.termsAcceptedAt ?? now }).where(eq(invitations.id, ctx.invitation.id));
  });

  await notifyCompany(ctx.company.id, {
    title: input.isFinal ? "Final quotation received" : "Bid submitted",
    body: `${ctx.vendor.name} submitted ${plainMoney(input.amountPaise, ctx.request.currency)} on ${ctx.request.referenceCode}.`,
    type: "bid",
    href: `/actions/${ctx.request.id}`,
  });
  await audit({
    companyId: ctx.company.id,
    actorType: "vendor",
    actorId: ctx.vendor.id,
    actorName: ctx.vendor.name,
    action: input.isFinal ? "bid.final" : "bid.submitted",
    entityType: "procurement_request",
    entityId: ctx.request.id,
    metadata: { amountPaise: input.amountPaise, bidId, demo: Boolean(ctx.vendor.simulationKind) },
  });
  return publicBidPayload(token);
}

export async function createExtension(token: string, input: { reason: string; requestedMinutes: number; message?: string | null }) {
  const ctx = await loadInviteContext(token);
  if (ctx.session.phase === "cancelled") throw new HttpError("This session was cancelled.", 400);
  const pending = await db
    .select()
    .from(extensionRequests)
    .where(and(eq(extensionRequests.sessionId, ctx.session.id), eq(extensionRequests.vendorId, ctx.vendor.id), eq(extensionRequests.status, "pending")));
  if (pending.length) throw new HttpError("You already have a pending extension request.", 400);
  const id = newId("ext");
  await db.insert(extensionRequests).values({
    id,
    companyId: ctx.company.id,
    sessionId: ctx.session.id,
    requestId: ctx.request.id,
    vendorId: ctx.vendor.id,
    reason: input.reason,
    requestedMinutes: input.requestedMinutes,
    message: input.message ?? null,
    status: "pending",
  });
  await notifyCompany(ctx.company.id, {
    title: "Extension requested",
    body: `${ctx.vendor.name} requested ${input.requestedMinutes} minutes on ${ctx.request.referenceCode}. Approval changes the schedule for every invited supplier.`,
    type: "extension",
    href: `/actions/${ctx.request.id}`,
  });
  await audit({
    companyId: ctx.company.id,
    actorType: "vendor",
    actorId: ctx.vendor.id,
    actorName: ctx.vendor.name,
    action: "extension.requested",
    entityType: "procurement_request",
    entityId: ctx.request.id,
    metadata: { minutes: input.requestedMinutes },
  });
  return { id };
}

function lineSummary(items: Array<typeof requirementItems.$inferSelect>) {
  return items
    .map((item) => `${item.productName}${item.grade ? ` (${item.grade})` : ""} — ${item.quantity ?? "qty tbc"} ${item.unit ?? ""}`.trim())
    .join("\n");
}

export async function inviteVendors(opts: {
  actor: UserActor;
  requestId: string;
  vendorIds: string[];
  startsAt: Date;
  endsAt: Date;
  visibilityMode: string;
  minIncrementPaise: number;
  terms?: string | null;
  resend?: boolean;
  simulationOnly?: boolean;
  req: Request;
}) {
  if (opts.endsAt.getTime() - opts.startsAt.getTime() < 5 * 60 * 1000) throw new HttpError("Bidding must stay open for at least 5 minutes.", 400);
  if (opts.endsAt.getTime() - Date.now() > 90 * 86400000) throw new HttpError("The closing time must be within 90 days.", 400);
  const [request] = await db
    .select()
    .from(procurementRequests)
    .where(and(eq(procurementRequests.id, opts.requestId), eq(procurementRequests.companyId, opts.actor.company.id)))
    .limit(1);
  if (!request) throw new HttpError("Request not found.", 404);
  if (request.awardedAt) throw new HttpError("This requirement is already decided.", 400);
  const items = await db.select().from(requirementItems).where(eq(requirementItems.requestId, request.id));
  if (!items.length || items.some((item) => !item.confirmed)) throw new HttpError("Confirm every requirement line before inviting suppliers.", 400);
  const selected = await db.select().from(vendors).where(and(eq(vendors.companyId, opts.actor.company.id), inArray(vendors.id, opts.vendorIds)));
  if (selected.length !== new Set(opts.vendorIds).size) throw new HttpError("One or more suppliers are not in your workspace.", 400);
  if (selected.some((vendor) => !vendor.active)) throw new HttpError("Deactivated suppliers cannot be invited.", 400);
  if (opts.simulationOnly && selected.some((vendor) => vendor.simulationKind !== "ai_demo")) {
    throw new HttpError("The simulation board only accepts AI demo profiles.", 400);
  }
  if (!opts.simulationOnly && selected.some((vendor) => vendor.simulationKind === "ai_demo")) {
    throw new HttpError("AI demo profiles stay on the simulation board and are not invited as suppliers.", 400);
  }

  const [existing] = await db.select().from(biddingSessions).where(eq(biddingSessions.requestId, request.id)).orderBy(desc(biddingSessions.createdAt)).limit(1);
  let session = existing ?? null;
  if (session?.closedAt || session?.status === "closed") throw new HttpError("Reopen the closed session from the bidding board before inviting again.", 400);
  const priorBids = session
    ? await db.select().from(bids).where(and(eq(bids.sessionId, session.id), eq(bids.isSimulated, false))).limit(1)
    : [];
  if (session && priorBids.length && (session.startsAt.getTime() !== opts.startsAt.getTime() || session.endsAt.getTime() !== opts.endsAt.getTime())) {
    throw new HttpError("Quotations are already on file. Change the official schedule with a reschedule so every supplier is notified.", 400);
  }
  const now = new Date();
  if (!session) {
    const id = newId("ses");
    await db.insert(biddingSessions).values({
      id,
      companyId: opts.actor.company.id,
      requestId: request.id,
      status: now < opts.startsAt ? "scheduled" : now > opts.endsAt ? "closed" : "live",
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
      originalEndsAt: opts.endsAt,
      visibilityMode: opts.visibilityMode,
      minIncrementPaise: opts.minIncrementPaise,
      currency: request.currency,
    });
    const [created] = await db.select().from(biddingSessions).where(eq(biddingSessions.id, id)).limit(1);
    session = created!;
  } else if (!priorBids.length) {
    await db.update(biddingSessions).set({
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
      originalEndsAt: opts.endsAt,
      visibilityMode: opts.visibilityMode,
      minIncrementPaise: opts.minIncrementPaise,
      status: now < opts.startsAt ? "scheduled" : "live",
      updatedAt: now,
    }).where(eq(biddingSessions.id, session.id));
  }

  const links: Array<{ vendorId: string; name: string; url: string; emailStatus: string }> = [];
  const base = appBaseUrl(opts.req);
  for (const vendor of selected) {
    const [prior] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.requestId, request.id), eq(invitations.vendorId, vendor.id)))
      .limit(1);
    const token = prior?.token ?? newToken();
    const invitationId = prior?.id ?? newId("inv");
    if (!prior) {
      await db.insert(invitations).values({
        id: invitationId,
        companyId: opts.actor.company.id,
        requestId: request.id,
        sessionId: session.id,
        vendorId: vendor.id,
        token,
        status: opts.simulationOnly ? "simulated" : "sent",
        emailStatus: opts.simulationOnly ? "not_applicable" : "pending",
        simulationOnly: Boolean(opts.simulationOnly),
        sentAt: opts.simulationOnly ? null : now,
        expiresAt: new Date(opts.endsAt.getTime() + 14 * 86400000),
      });
    } else {
      await db.update(invitations).set({ sessionId: session.id, expiresAt: new Date(opts.endsAt.getTime() + 14 * 86400000) }).where(eq(invitations.id, prior.id));
    }
    const url = `${base}/bid/${token}`;
    let emailStatus = opts.simulationOnly ? "not_applicable" : prior && !opts.resend ? prior.emailStatus : "pending";
    if (!opts.simulationOnly && (!prior || opts.resend)) {
      const when = (date: Date) =>
        new Intl.DateTimeFormat("en-IN", { timeZone: opts.actor.company.timezone, dateStyle: "medium", timeStyle: "short" }).format(date);
      const text = [
        `${opts.actor.company.name} invited ${vendor.name} to quote on ${request.referenceCode}.`,
        request.title,
        lineSummary(items),
        `Delivery location: ${request.deliveryLocation || "See requirement"}`,
        `Bidding opens: ${when(opts.startsAt)}`,
        `Bidding closes: ${when(opts.endsAt)}`,
        `Secure bidding link: ${url}`,
        "Open the link, review the requirement, and submit your total quotation before the closing time.",
        "The countdown uses the server clock. Request More Time inside the room if needed. An approved extension changes the official schedule for every invited supplier.",
        vendor.simulationKind ? "This supplier record is simulated demo data." : "",
      ].filter(Boolean).join("\n\n");
      const html = `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><p><strong>${esc(opts.actor.company.name)}</strong> invited ${esc(vendor.name)} to quote.</p><p>${esc(request.referenceCode)} — ${esc(request.title)}</p><pre style="white-space:pre-wrap;font-family:inherit">${esc(lineSummary(items))}</pre><p>Delivery: ${esc(request.deliveryLocation || "See requirement")}<br>Opens: ${esc(when(opts.startsAt))}<br>Closes: ${esc(when(opts.endsAt))}</p><p><a href="${esc(url)}">Open secure bidding room</a></p><p>The link is confidential. An approved time extension applies to every invited supplier.</p></div>`;
      const mailed = await sendEmail({
        companyId: opts.actor.company.id,
        to: vendor.email,
        subject: `${opts.actor.company.name}: quotation invited for ${request.title}`,
        text,
        html,
        relatedType: "invitation",
        relatedId: invitationId,
        fromName: opts.actor.company.emailFromName || opts.actor.company.name,
      });
      emailStatus = mailed.status;
      await db.update(invitations).set({ emailStatus, sentAt: now, status: "sent" }).where(eq(invitations.id, invitationId));
      if (vendor.portalEnabled) {
        await notifyVendor(opts.actor.company.id, vendor.id, {
          title: "New quotation request",
          body: `${opts.actor.company.name} invited you to quote on ${request.referenceCode}.`,
          type: "invitation",
          href: `/bid/${token}`,
        });
      }
    }
    links.push({ vendorId: vendor.id, name: vendor.name, url, emailStatus });
  }

  const phase = now < opts.startsAt ? "scheduled" : "live";
  await db.update(procurementRequests).set({
    status: phase,
    workflow: "bidding",
    visibilityMode: opts.visibilityMode,
    terms: opts.terms ?? request.terms,
    updatedAt: now,
  }).where(eq(procurementRequests.id, request.id));
  await audit({
    companyId: opts.actor.company.id,
    actorType: "user",
    actorId: opts.actor.user.id,
    actorName: opts.actor.user.name,
    action: opts.simulationOnly ? "simulation.invited" : "vendors.invited",
    entityType: "procurement_request",
    entityId: request.id,
    metadata: { vendors: selected.map((vendor) => vendor.id), demo: selected.every((vendor) => vendor.simulationKind) },
  });
  return { sessionId: session.id, links, phase };
}

export async function rescheduleSession(actor: UserActor, requestId: string, input: { endsAt: Date; startsAt?: Date | null; note?: string | null }, req: Request) {
  const [request] = await db.select().from(procurementRequests).where(and(eq(procurementRequests.id, requestId), eq(procurementRequests.companyId, actor.company.id))).limit(1);
  if (!request) throw new HttpError("Request not found.", 404);
  const [session] = await db.select().from(biddingSessions).where(eq(biddingSessions.requestId, requestId)).orderBy(desc(biddingSessions.createdAt)).limit(1);
  if (!session) throw new HttpError("There is no bidding session to reschedule.", 400);
  const startsAt = input.startsAt ?? session.startsAt;
  if (input.endsAt <= startsAt) throw new HttpError("Closing time must be after the opening time.", 400);
  const now = new Date();
  await db.update(biddingSessions).set({
    startsAt,
    endsAt: input.endsAt,
    closedAt: null,
    status: now < startsAt ? "scheduled" : now > input.endsAt ? "closed" : "live",
    extensionCount: session.extensionCount + 1,
    updatedAt: now,
  }).where(eq(biddingSessions.id, session.id));
  await db.update(invitations).set({ expiresAt: new Date(input.endsAt.getTime() + 14 * 86400000) }).where(eq(invitations.sessionId, session.id));
  await announceSchedule(actor.company.id, actor.company.name, actor.company.timezone, request, session.id, startsAt, input.endsAt, input.note || "The buyer revised the official schedule for every invited supplier.", req);
  await audit({
    companyId: actor.company.id,
    actorType: "user",
    actorId: actor.user.id,
    actorName: actor.user.name,
    action: "bidding.rescheduled",
    entityType: "procurement_request",
    entityId: requestId,
    metadata: { startsAt: startsAt.toISOString(), endsAt: input.endsAt.toISOString() },
  });
}

export async function reviewExtension(actor: UserActor, extensionId: string, input: { decision: "approve" | "reject" | "clarification"; note?: string | null; approvedMinutes?: number; rescheduleStart?: string | null }, req: Request) {
  const [extension] = await db.select().from(extensionRequests).where(and(eq(extensionRequests.id, extensionId), eq(extensionRequests.companyId, actor.company.id))).limit(1);
  if (!extension) throw new HttpError("Extension request not found.", 404);
  if (extension.status !== "pending" && extension.status !== "clarification") throw new HttpError("This request was already reviewed.", 400);
  const [session] = await db.select().from(biddingSessions).where(eq(biddingSessions.id, extension.sessionId)).limit(1);
  const [request] = await db.select().from(procurementRequests).where(eq(procurementRequests.id, extension.requestId)).limit(1);
  if (!session || !request) throw new HttpError("Session not found.", 404);
  const now = new Date();
  if (input.decision === "approve") {
    const minutes = input.approvedMinutes ?? extension.requestedMinutes;
    const base = new Date(Math.max(session.endsAt.getTime(), now.getTime()));
    const newEnd = new Date(base.getTime() + minutes * 60000);
    const newStart = input.rescheduleStart ? new Date(input.rescheduleStart) : null;
    if (newStart && Number.isNaN(newStart.getTime())) throw new HttpError("Opening time is invalid.", 400);
    if (newStart && newStart >= newEnd) throw new HttpError("Opening time must be before the new closing time.", 400);
    await db.update(biddingSessions).set({
      startsAt: newStart ?? session.startsAt,
      endsAt: newEnd,
      closedAt: null,
      status: (newStart ?? session.startsAt) > now ? "scheduled" : "live",
      extensionCount: session.extensionCount + 1,
      updatedAt: now,
    }).where(eq(biddingSessions.id, session.id));
    await db.update(invitations).set({ expiresAt: new Date(newEnd.getTime() + 14 * 86400000) }).where(eq(invitations.sessionId, session.id));
    await db.update(extensionRequests).set({
      status: "approved",
      companyNote: input.note ?? null,
      approvedMinutes: minutes,
      previousEndsAt: session.endsAt,
      newEndsAt: newEnd,
      previousStartsAt: session.startsAt,
      newStartsAt: newStart,
      reviewedBy: actor.user.id,
      reviewedAt: now,
    }).where(eq(extensionRequests.id, extension.id));
    await announceSchedule(actor.company.id, actor.company.name, actor.company.timezone, request, session.id, newStart ?? session.startsAt, newEnd, input.note || "The buyer approved more time. The revised schedule applies to every invited supplier.", req);
  } else {
    await db.update(extensionRequests).set({
      status: input.decision === "reject" ? "rejected" : "clarification",
      companyNote: input.note ?? null,
      reviewedBy: actor.user.id,
      reviewedAt: now,
    }).where(eq(extensionRequests.id, extension.id));
    await notifyVendor(actor.company.id, extension.vendorId, {
      title: input.decision === "reject" ? "Extension declined" : "Clarification requested",
      body: input.note || "The buyer reviewed your time request. The official deadline is unchanged.",
      type: "extension",
      href: "/portal",
    });
  }
  await audit({
    companyId: actor.company.id,
    actorType: "user",
    actorId: actor.user.id,
    actorName: actor.user.name,
    action: `extension.${input.decision}`,
    entityType: "procurement_request",
    entityId: request.id,
    metadata: { extensionId, appliesToAll: input.decision === "approve" },
  });
}

async function announceSchedule(companyId: string, companyName: string, timezone: string, request: typeof procurementRequests.$inferSelect, sessionId: string, startsAt: Date, endsAt: Date, note: string, req: Request) {
  const invited = await db.select().from(invitations).where(eq(invitations.sessionId, sessionId));
  const vendorRows = invited.length ? await db.select().from(vendors).where(inArray(vendors.id, invited.map((row) => row.vendorId))) : [];
  const vendorMap = new Map(vendorRows.map((vendor) => [vendor.id, vendor]));
  const when = (date: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(date);
  const base = appBaseUrl(req);
  for (const invitation of invited) {
    if (invitation.simulationOnly) continue;
    const vendor = vendorMap.get(invitation.vendorId);
    if (!vendor) continue;
    const url = `${base}/bid/${invitation.token}`;
    await notifyVendor(companyId, vendor.id, {
      title: "Official schedule updated",
      body: `${request.referenceCode} now closes ${when(endsAt)}. This change applies to every invited supplier.`,
      type: "schedule",
      href: `/bid/${invitation.token}`,
    });
    await sendEmail({
      companyId,
      to: vendor.email,
      subject: `${companyName}: updated bidding schedule for ${request.title}`,
      text: `${note}\n\nOpens: ${when(startsAt)}\nCloses: ${when(endsAt)}\nSecure link: ${url}\nThe same official schedule is shown to every invited supplier.`,
      html: `<div style="font-family:Arial,sans-serif;color:#172033"><p>${esc(note)}</p><p>Opens: ${esc(when(startsAt))}<br>Closes: ${esc(when(endsAt))}</p><p><a href="${esc(url)}">Open bidding room</a></p></div>`,
      relatedType: "schedule",
      relatedId: request.id,
      fromName: companyName,
    });
  }
  await notifyCompany(companyId, {
    title: "Schedule updated",
    body: `${request.referenceCode} now closes ${when(endsAt)} for every invited supplier.`,
    type: "schedule",
    href: `/actions/${request.id}`,
  });
  await db.update(procurementRequests).set({ status: new Date() < startsAt ? "scheduled" : new Date() > endsAt ? "closed" : "live", updatedAt: new Date() }).where(eq(procurementRequests.id, request.id));
}

export async function closeSession(actor: UserActor, requestId: string) {
  const [session] = await db.select().from(biddingSessions).where(and(eq(biddingSessions.requestId, requestId), eq(biddingSessions.companyId, actor.company.id))).orderBy(desc(biddingSessions.createdAt)).limit(1);
  if (!session) throw new HttpError("No bidding session.", 404);
  const now = new Date();
  await db.update(biddingSessions).set({ status: "closed", closedAt: now, updatedAt: now }).where(eq(biddingSessions.id, session.id));
  const [request] = await db.select().from(procurementRequests).where(eq(procurementRequests.id, requestId)).limit(1);
  if (request && !request.awardedAt) {
    await db.update(procurementRequests).set({ status: "closed", updatedAt: now }).where(eq(procurementRequests.id, requestId));
  }
  await audit({ companyId: actor.company.id, actorType: "user", actorId: actor.user.id, actorName: actor.user.name, action: "bidding.closed", entityType: "procurement_request", entityId: requestId, metadata: {} });
}

export async function awardRequest(actor: UserActor, requestId: string, input: { vendorId: string; closeNow?: boolean; acknowledgeDemo?: boolean }) {
  const dossier = await loadDossier(actor.company.id, requestId);
  if (!dossier.session) throw new HttpError("There is no bidding session to award.", 400);
  if (dossier.session.phase === "live" && !input.closeNow) throw new HttpError("Close bidding before recording a decision, or confirm an early close.", 400);
  const vendor = (await db.select().from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.companyId, actor.company.id))).limit(1))[0];
  if (!vendor) throw new HttpError("Supplier not found.", 404);
  if (vendor.simulationKind === "ai_demo") throw new HttpError("AI demo bidders cannot be awarded. They are not suppliers.", 400);
  if (vendor.simulationKind && !input.acknowledgeDemo) {
    throw new HttpError("This supplier is simulated demo data. Confirm that the decision is a demo record, not a purchase commitment.", 400);
  }
  const winning = dossier.ranking.find((row) => row.vendorId === input.vendorId);
  if (!winning) throw new HttpError("That supplier has no quotation on the decision board.", 400);
  const [request] = await db.select().from(procurementRequests).where(eq(procurementRequests.id, requestId)).limit(1);
  if (!request) throw new HttpError("Request not found.", 404);
  const opening = await db.select().from(bids).where(and(eq(bids.sessionId, dossier.session.id), eq(bids.isSimulated, false))).orderBy(asc(bids.createdAt));
  const firstByVendor = new Map<string, number>();
  for (const bid of opening) if (!firstByVendor.has(bid.vendorId)) firstByVendor.set(bid.vendorId, bid.amountPaise);
  const openings = [...firstByVendor.values()];
  let baseline = request.baselinePaise;
  let baselineLabel = request.baselineLabel;
  if (!baseline && openings.length >= 2) {
    baseline = Math.round(openings.reduce((sum, value) => sum + value, 0) / openings.length);
    baselineLabel = "Average of opening quotations in this session.";
  }
  const savings = baseline ? baseline - winning.amountPaise : null;
  const savingsPercent = baseline && savings != null ? ((savings / baseline) * 100).toFixed(3) : null;
  const now = new Date();
  await db.update(biddingSessions).set({ status: "closed", closedAt: now, updatedAt: now }).where(eq(biddingSessions.id, dossier.session.id));
  await db.update(procurementRequests).set({
    status: vendor.simulationKind ? "demo_awarded" : "awarded",
    awardedVendorId: vendor.id,
    awardedBidId: winning.bidId,
    awardedPaise: winning.amountPaise,
    awardedAt: now,
    baselinePaise: baseline,
    baselineLabel: baseline ? baselineLabel : "Insufficient baseline — savings not calculated.",
    savingsPaise: savings,
    savingsPercent,
    awardMode: vendor.simulationKind ? "demo" : "operational",
    updatedAt: now,
  }).where(eq(procurementRequests.id, requestId));
  const invited = await db.select().from(invitations).where(eq(invitations.requestId, requestId));
  for (const invitation of invited) {
    if (invitation.simulationOnly) continue;
    const selected = invitation.vendorId === vendor.id;
    await notifyVendor(actor.company.id, invitation.vendorId, {
      title: selected ? "Quotation selected" : "Bidding closed",
      body: selected
        ? vendor.simulationKind
          ? "A demo decision was recorded at your submitted amount. This is not a purchase commitment."
          : "The buyer selected your quotation. A purchase commitment is not final until confirmed in your contracting process."
        : "The buyer closed this round and recorded a decision. You will be contacted if further information is required.",
      type: "award",
      href: `/bid/${invitation.token}`,
    });
  }
  await audit({
    companyId: actor.company.id,
    actorType: "user",
    actorId: actor.user.id,
    actorName: actor.user.name,
    action: "request.awarded",
    entityType: "procurement_request",
    entityId: requestId,
    metadata: { vendorId: vendor.id, amountPaise: winning.amountPaise, savingsPaise: savings, demo: Boolean(vendor.simulationKind) },
  });
  return { savingsPaise: savings, savingsPercent: savingsPercent ? Number(savingsPercent) : null, baselineLabel };
}

export async function createNegotiation(actor: UserActor, requestId: string, input: { vendorId: string; offerPaise: number; message: string }, req: Request) {
  const [request] = await db.select().from(procurementRequests).where(and(eq(procurementRequests.id, requestId), eq(procurementRequests.companyId, actor.company.id))).limit(1);
  if (!request) throw new HttpError("Request not found.", 404);
  const [vendor] = await db.select().from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.companyId, actor.company.id))).limit(1);
  if (!vendor) throw new HttpError("Supplier not found.", 404);
  if (vendor.simulationKind === "ai_demo") throw new HttpError("Negotiate with AI demo profiles from the simulation controls, not as a supplier.", 400);
  const id = newId("neg");
  const token = newToken();
  await db.insert(negotiations).values({
    id,
    companyId: actor.company.id,
    requestId,
    vendorId: vendor.id,
    status: "open",
    currency: request.currency,
    vendorToken: token,
    createdBy: actor.user.id,
  });
  await db.insert(negotiationMessages).values({
    id: newId("nmsg"),
    negotiationId: id,
    companyId: actor.company.id,
    senderRole: "company",
    senderName: actor.user.name,
    body: input.message,
    offerPaise: input.offerPaise,
    action: "offer",
  });
  if (!request.awardedAt && !["live", "scheduled"].includes(request.status)) {
    await db.update(procurementRequests).set({ status: "negotiation", workflow: "negotiation", updatedAt: new Date() }).where(eq(procurementRequests.id, requestId));
  }
  const url = `${appBaseUrl(req)}/negotiate/${token}`;
  await sendEmail({
    companyId: actor.company.id,
    to: vendor.email,
    subject: `${actor.company.name}: direct offer for ${request.title}`,
    text: `${input.message}\n\nOffer: ${plainMoney(input.offerPaise, request.currency)}\nRespond: ${url}\nThis is a sourcing discussion, not an e-signed contract.`,
    html: `<p>${esc(input.message)}</p><p>Offer: ${esc(plainMoney(input.offerPaise, request.currency))}</p><p><a href="${esc(url)}">Open negotiation</a></p>`,
    relatedType: "negotiation",
    relatedId: id,
    fromName: actor.company.name,
  });
  if (vendor.portalEnabled) {
    await notifyVendor(actor.company.id, vendor.id, { title: "Direct offer", body: `${actor.company.name} sent an offer on ${request.referenceCode}.`, type: "negotiation", href: `/negotiate/${token}` });
  }
  await audit({ companyId: actor.company.id, actorType: "user", actorId: actor.user.id, actorName: actor.user.name, action: "negotiation.opened", entityType: "negotiation", entityId: id, metadata: { requestId, offerPaise: input.offerPaise } });
  return { id, url };
}

export async function postNegotiationMessage(opts: {
  negotiationId?: string;
  token?: string;
  actor: UserActor | { kind: "vendor"; vendor: VendorRow; name: string } ;
  action: "offer" | "counter" | "accept" | "reject" | "message" | "confirm";
  message: string;
  offerPaise?: number | null;
}) {
  const [negotiation] = opts.token
    ? await db.select().from(negotiations).where(eq(negotiations.vendorToken, opts.token)).limit(1)
    : await db.select().from(negotiations).where(eq(negotiations.id, opts.negotiationId!)).limit(1);
  if (!negotiation) throw new HttpError("Negotiation not found.", 404);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, negotiation.vendorId)).limit(1);
  const [request] = await db.select().from(procurementRequests).where(eq(procurementRequests.id, negotiation.requestId)).limit(1);
  if (!vendor || !request) throw new HttpError("Negotiation is incomplete.", 404);
  let senderName = vendor.name;
  let senderRole: "company" | "vendor" = "vendor";
  let actorId = vendor.id;
  if ("kind" in opts.actor) {
    if (opts.actor.vendor.id !== negotiation.vendorId) throw new HttpError("Not found.", 404);
  } else {
    if (opts.actor.company.id !== negotiation.companyId) throw new HttpError("Not found.", 404);
    senderName = opts.actor.user.name;
    senderRole = "company";
    actorId = opts.actor.user.id;
  }
  const companySide = senderRole === "company";
  const terminal = ["agreed", "demo_agreed", "rejected", "converted"].includes(negotiation.status);
  if (terminal && opts.action !== "message") throw new HttpError("This negotiation is closed for price changes.", 400);
  if (["offer", "counter"].includes(opts.action) && !opts.offerPaise) throw new HttpError("Enter an amount.", 400);
  await db.insert(negotiationMessages).values({
    id: newId("nmsg"),
    negotiationId: negotiation.id,
    companyId: negotiation.companyId,
    senderRole,
    senderName,
    body: opts.message,
    offerPaise: opts.offerPaise ?? null,
    action: opts.action,
  });
  let status = negotiation.status;
  const demo = Boolean(vendor.simulationKind);
  if (opts.action === "reject") status = "rejected";
  if (opts.action === "accept" && !companySide) status = demo ? "demo_agreed" : "vendor_accepted";
  if ((opts.action === "accept" || opts.action === "confirm") && companySide) {
    if (!["offer", "counter", "accept", "confirm"].includes(opts.action)) throw new HttpError("Nothing to confirm.", 400);
    status = demo ? "demo_agreed" : "agreed";
  }
  if (opts.action === "confirm" && !companySide) throw new HttpError("Only the buyer can confirm a vendor acceptance.", 403);
  const agreedPaise = status === "agreed" || status === "demo_agreed" ? opts.offerPaise ?? negotiation.agreedPaise ?? (await latestOffer(negotiation.id)) : negotiation.agreedPaise;
  await db.update(negotiations).set({
    status,
    agreedPaise: status === "agreed" || status === "demo_agreed" ? agreedPaise : negotiation.agreedPaise,
    agreedAt: status === "agreed" || status === "demo_agreed" ? new Date() : negotiation.agreedAt,
    updatedAt: new Date(),
  }).where(eq(negotiations.id, negotiation.id));
  if (companySide) {
    await notifyVendor(negotiation.companyId, vendor.id, { title: "Negotiation update", body: opts.message, type: "negotiation", href: `/negotiate/${negotiation.vendorToken}` });
  } else {
    await notifyCompany(negotiation.companyId, { title: "Vendor reply", body: `${vendor.name}: ${opts.message}`, type: "negotiation", href: `/actions/${request.id}` });
  }
  await audit({
    companyId: negotiation.companyId,
    actorType: senderRole,
    actorId,
    actorName: senderName,
    action: `negotiation.${opts.action}`,
    entityType: "negotiation",
    entityId: negotiation.id,
    metadata: { offerPaise: opts.offerPaise ?? null, status, demo },
  });
  if (companySide && vendor.simulationKind === "directory_demo") {
    return { status, demoReply: false };
  }
  return { status, demoReply: false };
}

async function latestOffer(negotiationId: string) {
  const rows = await db.select().from(negotiationMessages).where(eq(negotiationMessages.negotiationId, negotiationId)).orderBy(desc(negotiationMessages.createdAt));
  return rows.find((row) => row.offerPaise)?.offerPaise ?? null;
}

export async function negotiationByToken(token: string) {
  const [negotiation] = await db.select().from(negotiations).where(eq(negotiations.vendorToken, token)).limit(1);
  if (!negotiation) throw new HttpError("Negotiation link not found.", 404);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, negotiation.vendorId)).limit(1);
  const [request] = await db.select().from(procurementRequests).where(eq(procurementRequests.id, negotiation.requestId)).limit(1);
  const [company] = await db.select().from(companies).where(eq(companies.id, negotiation.companyId)).limit(1);
  const items = await db.select().from(requirementItems).where(eq(requirementItems.requestId, negotiation.requestId));
  const messages = await db.select().from(negotiationMessages).where(eq(negotiationMessages.negotiationId, negotiation.id)).orderBy(asc(negotiationMessages.createdAt));
  return {
    ok: true,
    companyName: company?.name ?? "Buyer",
    currency: negotiation.currency,
    vendorName: vendor?.name ?? "Supplier",
    badge: vendorBadge(vendor?.simulationKind),
    disclaimer: vendor?.simulationKind ? "Demo supplier. Agreement is not a contractual acceptance." : "This discussion records a sourcing position. It is not an e-signed contract.",
    request: request ? requestDto(request) : null,
    items: items.map(itemDto),
    negotiation: {
      id: negotiation.id,
      status: negotiation.status,
      agreedPaise: negotiation.agreedPaise,
      messages: messages.map((message) => ({
        id: message.id,
        senderRole: message.senderRole,
        senderName: message.senderName,
        body: message.body,
        offerPaise: message.offerPaise,
        action: message.action,
        createdAt: message.createdAt.toISOString(),
      })),
    },
  };
}

export async function convertNegotiation(actor: UserActor, negotiationId: string, req: Request) {
  const [negotiation] = await db.select().from(negotiations).where(and(eq(negotiations.id, negotiationId), eq(negotiations.companyId, actor.company.id))).limit(1);
  if (!negotiation) throw new HttpError("Negotiation not found.", 404);
  const startsAt = new Date();
  const endsAt = new Date(Date.now() + 24 * 3600000);
  await inviteVendors({
    actor,
    requestId: negotiation.requestId,
    vendorIds: [negotiation.vendorId],
    startsAt,
    endsAt,
    visibilityMode: actor.company.defaultVisibility,
    minIncrementPaise: actor.company.minBidIncrementPaise,
    req,
  });
  await db.update(negotiations).set({ status: "converted", updatedAt: new Date() }).where(eq(negotiations.id, negotiation.id));
  await audit({ companyId: actor.company.id, actorType: "user", actorId: actor.user.id, actorName: actor.user.name, action: "negotiation.converted", entityType: "negotiation", entityId: negotiation.id, metadata: {} });
}

export function priceReference(request: typeof procurementRequests.$inferSelect, items: Array<typeof requirementItems.$inferSelect>) {
  if (request.targetPricePaise) return { paise: request.targetPricePaise, label: "your stated target" };
  if (request.baselinePaise) return { paise: request.baselinePaise, label: "your stated baseline" };
  if (request.maxBudgetPaise) return { paise: request.maxBudgetPaise, label: "your maximum budget, not a market price" };
  const summed = items.reduce((sum, item) => {
    if (!item.targetPricePaise || !item.quantity) return sum;
    return sum + Math.round(item.targetPricePaise * Number(item.quantity));
  }, 0);
  if (summed > 0) return { paise: summed, label: "sum of your target prices × quantities" };
  return null;
}

export type { AiProfile };
