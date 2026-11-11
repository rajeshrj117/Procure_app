import { and, desc, eq, gte, lte } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import {
  activityLogs,
  aiActivities,
  bids,
  biddingSessions,
  companies,
  extensionRequests,
  invitations,
  negotiations,
  priceHistory,
  procurementRequests,
  requirementItems,
  vendors,
} from "@/db/schema";
import { plainMoney } from "@/lib/format";
import { buildPdf } from "./pdf";

function monthKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(date);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(Number(year), Number(month) - 1, 1));
}

export async function buildDashboard(companyId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  const timeZone = company?.timezone || "Asia/Kolkata";
  const requestRows = await db.select().from(procurementRequests).where(eq(procurementRequests.companyId, companyId));
  const vendorRows = await db.select().from(vendors).where(eq(vendors.companyId, companyId));
  const invitationRows = await db.select().from(invitations).where(eq(invitations.companyId, companyId));
  const bidRows = await db.select().from(bids).where(eq(bids.companyId, companyId));
  const sessions = await db.select().from(biddingSessions).where(eq(biddingSessions.companyId, companyId));
  const activities = await db.select().from(activityLogs).where(eq(activityLogs.companyId, companyId)).orderBy(desc(activityLogs.createdAt)).limit(12);
  const history = await db.select().from(priceHistory).where(eq(priceHistory.companyId, companyId)).orderBy(desc(priceHistory.recordedAt)).limit(80);
  const now = new Date();
  const liveSessions = sessions.filter((session) => !session.closedAt && session.status !== "cancelled" && now >= session.startsAt && now <= session.endsAt);
  const awarded = requestRows.filter((row) => row.awardedPaise != null);
  const positive = awarded.filter((row) => (row.savingsPaise ?? 0) > 0);
  const withBaseline = awarded.filter((row) => row.baselinePaise && row.savingsPaise != null);
  const avgSavingsPercent = withBaseline.length
    ? (withBaseline.reduce((sum, row) => sum + (row.savingsPaise ?? 0), 0) / withBaseline.reduce((sum, row) => sum + (row.baselinePaise ?? 0), 0)) * 100
    : null;
  const responded = new Set(bidRows.filter((bid) => !bid.isSimulated).map((bid) => `${bid.requestId}:${bid.vendorId}`));
  const pendingResponses = invitationRows.filter((row) => !row.simulationOnly && !responded.has(`${row.requestId}:${row.vendorId}`) && row.status !== "declined").length;
  const monthlyMap = new Map<string, { spend: number; estimated: number }>();
  for (const row of awarded) {
    if (!row.awardedAt) continue;
    const key = monthKey(row.awardedAt, timeZone);
    const current = monthlyMap.get(key) ?? { spend: 0, estimated: 0 };
    current.spend += (row.awardedPaise ?? 0) / 100;
    current.estimated += (row.baselinePaise ?? row.awardedPaise ?? 0) / 100;
    monthlyMap.set(key, current);
  }
  const monthly = [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ month: monthLabel(key), ...value }));
  const savingsByCategoryMap = new Map<string, number>();
  for (const row of awarded) {
    const key = row.category || "Uncategorised";
    savingsByCategoryMap.set(key, (savingsByCategoryMap.get(key) ?? 0) + Math.max(row.savingsPaise ?? 0, 0) / 100);
  }
  const vendorMap = new Map(vendorRows.map((vendor) => [vendor.id, vendor]));
  const participation = requestRows.slice(0, 8).map((row) => {
    const invited = invitationRows.filter((invitation) => invitation.requestId === row.id && !invitation.simulationOnly).length;
    const replies = new Set(bidRows.filter((bid) => bid.requestId === row.id && !bid.isSimulated).map((bid) => bid.vendorId)).size;
    return { name: row.referenceCode, invited, responded: replies };
  });
  const priceTrend = history
    .filter((row) => row.productName.toLowerCase().includes("iron rod"))
    .map((row) => ({
      month: monthLabel(monthKey(row.recordedAt, timeZone)),
      price: row.pricePaise / 100,
      vendor: vendorMap.get(row.vendorId)?.name ?? "Supplier",
    }))
    .reverse();
  const upcoming = sessions
    .filter((session) => !session.closedAt && session.endsAt > now && session.status !== "cancelled")
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime())
    .slice(0, 5)
    .map((session) => {
      const request = requestRows.find((row) => row.id === session.requestId);
      return { id: session.id, requestId: session.requestId, referenceCode: request?.referenceCode ?? "Session", title: request?.title ?? "Bidding", endsAt: session.endsAt.toISOString(), startsAt: session.startsAt.toISOString(), phase: now < session.startsAt ? "scheduled" : "live" };
    });
  const bestVendors = vendorRows
    .filter((vendor) => vendor.simulationKind !== "ai_demo" && vendor.active)
    .sort((a, b) => b.performanceScore - a.performanceScore)
    .slice(0, 5)
    .map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      badge: vendor.simulationKind === "directory_demo" ? "DEMO DIRECTORY" : null,
      score: vendor.performanceScore,
      onTime: vendor.onTimeDeliveryRate,
      city: vendor.city,
    }));
  return {
    currency: company?.currency ?? "INR",
    isDemo: Boolean(company?.isDemo),
    kpis: {
      requests: requestRows.length,
      liveSessions: liveSessions.length,
      vendors: vendorRows.filter((vendor) => vendor.simulationKind !== "ai_demo").length,
      invited: invitationRows.filter((row) => !row.simulationOnly).length,
      bids: bidRows.filter((bid) => !bid.isSimulated).length,
      pendingResponses,
      completedDeals: awarded.length,
      savingsPaise: positive.reduce((sum, row) => sum + (row.savingsPaise ?? 0), 0),
      avgSavingsPercent,
    },
    charts: {
      monthly,
      estimatedVsActual: monthly,
      savingsByCategory: [...savingsByCategoryMap.entries()].map(([category, savings]) => ({ category, savings })),
      vendorPerformance: bestVendors.map((vendor) => ({ name: vendor.name, score: vendor.score, onTime: vendor.onTime })),
      participation,
      priceTrend,
    },
    upcoming,
    recent: activities.map((row) => ({ id: row.id, action: row.action, actorName: row.actorName, entityType: row.entityType, entityId: row.entityId, createdAt: row.createdAt.toISOString(), metadata: row.metadata })),
    bestVendors,
    notes: company?.isDemo ? ["Northwind is a demo workspace. Historical deals, directory prices, and scores are simulated seed — not live market data."] : [],
  };
}

export async function buildReport(companyId: string, from?: Date | null, to?: Date | null) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  const filters = [eq(procurementRequests.companyId, companyId)];
  if (from) filters.push(gte(procurementRequests.createdAt, from));
  if (to) filters.push(lte(procurementRequests.createdAt, to));
  const requests = await db.select().from(procurementRequests).where(and(...filters)).orderBy(desc(procurementRequests.createdAt));
  const requestIds = requests.map((row) => row.id);
  const allBids = await db.select().from(bids).where(eq(bids.companyId, companyId));
  const allInvites = await db.select().from(invitations).where(eq(invitations.companyId, companyId));
  const allNegotiations = await db.select().from(negotiations).where(eq(negotiations.companyId, companyId));
  const allSessions = await db.select().from(biddingSessions).where(eq(biddingSessions.companyId, companyId));
  const extensions = await db.select().from(extensionRequests).where(eq(extensionRequests.companyId, companyId));
  const ai = await db.select().from(aiActivities).where(eq(aiActivities.companyId, companyId)).orderBy(desc(aiActivities.createdAt)).limit(50);
  const vendorRows = await db.select().from(vendors).where(eq(vendors.companyId, companyId));
  const items = await db.select().from(requirementItems).where(eq(requirementItems.companyId, companyId));
  const vendorName = (id: string | null) => vendorRows.find((vendor) => vendor.id === id)?.name ?? "—";
  const inRange = (id: string) => requestIds.includes(id);
  const scopedBids = allBids.filter((bid) => inRange(bid.requestId));
  const awarded = requests.filter((row) => row.awardedPaise != null);
  const spend = awarded.reduce((sum, row) => sum + (row.awardedPaise ?? 0), 0);
  const savings = awarded.reduce((sum, row) => sum + (row.savingsPaise ?? 0), 0);
  const baseline = awarded.reduce((sum, row) => sum + (row.baselinePaise ?? 0), 0);
  const reductions: number[] = [];
  for (const session of allSessions.filter((session) => inRange(session.requestId))) {
    const rows = scopedBids.filter((bid) => bid.sessionId === session.id && !bid.isSimulated);
    const byVendor = new Map<string, number[]>();
    for (const bid of rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      byVendor.set(bid.vendorId, [...(byVendor.get(bid.vendorId) ?? []), bid.amountPaise]);
    }
    for (const amounts of byVendor.values()) {
      if (amounts.length >= 2 && amounts[0]) reductions.push((amounts[0] - amounts[amounts.length - 1]!) / amounts[0]);
    }
  }
  return {
    currency: company?.currency ?? "INR",
    isDemo: Boolean(company?.isDemo),
    summary: {
      expenditurePaise: spend,
      savingsPaise: savings,
      savingsPercent: baseline ? (savings / baseline) * 100 : null,
      requests: requests.length,
      awarded: awarded.length,
      negotiations: allNegotiations.filter((row) => inRange(row.requestId)).length,
      agreed: allNegotiations.filter((row) => inRange(row.requestId) && (row.status === "agreed" || row.status === "demo_agreed")).length,
      averageReductionPercent: reductions.length ? (reductions.reduce((sum, value) => sum + value, 0) / reductions.length) * 100 : null,
    },
    purchases: awarded.map((row) => ({
      reference: row.referenceCode,
      title: row.title,
      category: row.category,
      vendor: vendorName(row.awardedVendorId),
      awardedPaise: row.awardedPaise,
      baselinePaise: row.baselinePaise,
      savingsPaise: row.savingsPaise,
      savingsPercent: row.savingsPercent ? Number(row.savingsPercent) : null,
      awardMode: row.awardMode,
      awardedAt: row.awardedAt?.toISOString() ?? null,
    })),
    products: items.filter((item) => inRange(item.requestId)).map((item) => ({
      request: requests.find((row) => row.id === item.requestId)?.referenceCode,
      product: item.productName,
      grade: item.grade,
      quantity: item.quantity ? Number(item.quantity) : null,
      unit: item.unit,
      targetPaise: item.targetPricePaise,
    })),
    bidding: allSessions.filter((session) => inRange(session.requestId)).map((session) => {
      const rows = scopedBids.filter((bid) => bid.sessionId === session.id && !bid.isSimulated);
      const amounts = rows.map((bid) => bid.amountPaise);
      return {
        request: requests.find((row) => row.id === session.requestId)?.referenceCode,
        phase: session.status,
        bids: rows.length,
        lowestPaise: amounts.length ? Math.min(...amounts) : null,
        highestPaise: amounts.length ? Math.max(...amounts) : null,
        extensions: extensions.filter((row) => row.sessionId === session.id).length,
      };
    }),
    participation: vendorRows.filter((vendor) => vendor.simulationKind !== "ai_demo").map((vendor) => ({
      vendor: vendor.name,
      badge: vendor.simulationKind === "directory_demo" ? "DEMO DIRECTORY" : null,
      invited: allInvites.filter((row) => row.vendorId === vendor.id && !row.simulationOnly && inRange(row.requestId)).length,
      responded: new Set(scopedBids.filter((bid) => bid.vendorId === vendor.id && !bid.isSimulated).map((bid) => bid.requestId)).size,
      wins: awarded.filter((row) => row.awardedVendorId === vendor.id).length,
      onTime: vendor.onTimeDeliveryRate,
    })),
    negotiations: allNegotiations.filter((row) => inRange(row.requestId)).map((row) => ({
      request: requests.find((request) => request.id === row.requestId)?.referenceCode,
      vendor: vendorName(row.vendorId),
      status: row.status,
      agreedPaise: row.agreedPaise,
    })),
    ai: ai.map((row) => ({ action: row.action, detail: row.detail, createdAt: row.createdAt.toISOString() })),
    disclaimer: company?.isDemo ? "Demo workspace export. Figures come from simulated seed records, not a live market." : "Figures are calculated from workspace records only.",
  };
}

export async function exportReport(companyId: string, format: string, from?: Date | null, to?: Date | null) {
  const report = await buildReport(companyId, from, to);
  const currency = report.currency;
  if (format === "csv") {
    const lines = ["reference,title,category,vendor,awarded,baseline,savings,mode", ...report.purchases.map((row) => [row.reference, row.title, row.category, row.vendor, row.awardedPaise ?? "", row.baselinePaise ?? "", row.savingsPaise ?? "", row.awardMode].join(","))];
    return { body: lines.join("\n"), contentType: "text/csv", filename: "strata-procurement.csv" };
  }
  if (format === "pdf") {
    const lines = [
      report.disclaimer,
      `Expenditure ${plainMoney(report.summary.expenditurePaise, currency)}`,
      `Net savings ${plainMoney(report.summary.savingsPaise, currency)}`,
      `Savings percent ${report.summary.savingsPercent == null ? "n/a" : report.summary.savingsPercent.toFixed(2)}`,
      `Average bidding reduction ${report.summary.averageReductionPercent == null ? "n/a" : report.summary.averageReductionPercent.toFixed(2) + "%"}`,
      "",
      "Purchases",
      ...report.purchases.map((row) => `${row.reference} ${row.title} ${row.vendor} ${plainMoney(row.awardedPaise, currency)} savings ${plainMoney(row.savingsPaise, currency)} ${row.awardMode || ""}`),
      "",
      "Bidding",
      ...report.bidding.map((row) => `${row.request} bids ${row.bids} low ${plainMoney(row.lowestPaise, currency)} high ${plainMoney(row.highestPaise, currency)}`),
    ];
    return { body: buildPdf("Strata procurement report", lines), contentType: "application/pdf", filename: "strata-procurement.pdf" };
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([report.summary, { disclaimer: report.disclaimer }]), "Summary");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.purchases), "Purchases");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.products), "Products");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.bidding), "Bidding");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.participation), "Participation");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.negotiations), "Negotiations");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.ai), "AI simulation");
  const body = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { body, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: "strata-procurement.xlsx" };
}
