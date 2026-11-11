import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiActivities, aiConfigs, bids, biddingSessions, invitations, vendors } from "@/db/schema";
import type { AiProfile } from "@/db/schema";
import { newId, newToken } from "./core";
import { resolveCity } from "./geo";

const PROFILES: Array<{ name: string; city: string; strategy: AiProfile["strategy"]; anchorFactor: number; floorFactor: number; maxBids: number }> = [
  { name: "Helios Demo Metals", city: "Pune", strategy: "aggressive", anchorFactor: 1.01, floorFactor: 0.9, maxBids: 10 },
  { name: "Keen Quote Demo Supply", city: "Mumbai", strategy: "competitive", anchorFactor: 1.03, floorFactor: 0.93, maxBids: 8 },
  { name: "Quiet Bid Demo Co", city: "Nashik", strategy: "conservative", anchorFactor: 1.05, floorFactor: 0.96, maxBids: 4 },
  { name: "Margin Lock Demo Industries", city: "Ahmedabad", strategy: "fixed_margin", anchorFactor: 1.04, floorFactor: 0.94, maxBids: 6 },
  { name: "Sandbox Random Demo Traders", city: "Surat", strategy: "randomized", anchorFactor: 1.04, floorFactor: 0.91, maxBids: 8 },
];

export async function ensureAiVendors(companyId: string, count = 4) {
  const existing = await db.select().from(vendors).where(and(eq(vendors.companyId, companyId), eq(vendors.simulationKind, "ai_demo")));
  const needed = PROFILES.slice(0, count).filter((profile) => !existing.some((vendor) => vendor.name === profile.name));
  if (!needed.length) return existing;
  const now = new Date();
  await db.insert(vendors).values(
    needed.map((profile) => {
      const city = resolveCity(profile.city);
      return {
        id: newId("ven"),
        companyId,
        name: profile.name,
        contactPerson: "Simulation desk",
        email: `${profile.name.toLowerCase().replace(/[^a-z]+/g, ".")}@ai.demo`,
        city: profile.city,
        state: city?.state ?? null,
        country: "India",
        lat: city ? String(city.lat) : null,
        lng: city ? String(city.lng) : null,
        categories: ["Simulation"],
        grades: [],
        verificationStatus: "simulated",
        performanceScore: 0,
        onTimeDeliveryRate: 0,
        active: true,
        isSimulated: true,
        simulationKind: "ai_demo",
        portalEnabled: false,
        source: "AI vendor simulation profile. Not a supplier.",
        lastVerifiedAt: now,
        aiProfile: { strategy: profile.strategy, anchorFactor: profile.anchorFactor, floorFactor: profile.floorFactor, maxBids: profile.maxBids },
        notes: "SIMULATED / AI DEMO. Cannot be awarded and cannot create a contractual acceptance.",
      };
    }),
  );
  return db.select().from(vendors).where(and(eq(vendors.companyId, companyId), eq(vendors.simulationKind, "ai_demo")));
}

function nextPrice(strategy: string, current: number, leader: number, floor: number, random: number) {
  const cut =
    strategy === "aggressive" ? Math.max(current, leader) * 0.975 :
    strategy === "competitive" ? Math.max(current, leader) * 0.99 :
    strategy === "conservative" ? current * 0.996 :
    strategy === "fixed_margin" ? current - Math.max(1, (current - floor) / 4) :
    current * (1 - (0.004 + random * 0.018));
  return Math.max(floor, Math.round(cut));
}

export async function tickAi(sessionId: string) {
  const [session] = await db.select().from(biddingSessions).where(eq(biddingSessions.id, sessionId)).limit(1);
  if (!session || session.closedAt || session.status === "closed" || session.status === "cancelled") return { placed: 0 };
  const now = new Date();
  if (now < session.startsAt || now > session.endsAt) return { placed: 0 };
  const [config] = await db.select().from(aiConfigs).where(eq(aiConfigs.companyId, session.companyId)).limit(1);
  if (!config?.enabled) return { placed: 0 };
  const invited = await db.select().from(invitations).where(and(eq(invitations.sessionId, sessionId), eq(invitations.simulationOnly, true)));
  if (!invited.length) return { placed: 0 };
  const vendorRows = await db.select().from(vendors).where(eq(vendors.companyId, session.companyId));
  const vendorMap = new Map(vendorRows.map((vendor) => [vendor.id, vendor]));
  let placed = 0;
  const maxDiscount = Number(config.maxDiscountPercent) || 12;
  for (const invitation of invited) {
    const vendor = vendorMap.get(invitation.vendorId);
    if (!vendor || vendor.simulationKind !== "ai_demo") continue;
    const profile = vendor.aiProfile;
    const history = await db.select().from(bids).where(and(eq(bids.sessionId, sessionId), eq(bids.vendorId, vendor.id))).orderBy(desc(bids.createdAt));
    const latest = history[0];
    if (latest && now.getTime() - latest.createdAt.getTime() < config.speedSeconds * 1000) continue;
    if (history.length >= (profile?.maxBids ?? 8)) continue;
    const anchor = invitation.simAnchorPaise ?? latest?.amountPaise;
    if (!anchor) continue;
    const floor = Math.max(config.minPricePaise ?? 0, Math.round(anchor * (1 - maxDiscount / 100)), Math.round(anchor * (profile?.floorFactor ?? 0.9)));
    const leaderRow = await db.select().from(bids).where(and(eq(bids.sessionId, sessionId), eq(bids.isSimulated, true))).orderBy(bids.amountPaise);
    const leader = leaderRow[0]?.amountPaise ?? anchor;
    const current = latest?.amountPaise ?? anchor;
    const amount = nextPrice(config.strategy || profile?.strategy || "competitive", current, leader, floor, Math.random());
    if (latest && amount >= latest.amountPaise) continue;
    if (amount < floor) continue;
    await db.insert(bids).values({
      id: newId("bid"),
      companyId: session.companyId,
      sessionId,
      requestId: session.requestId,
      vendorId: vendor.id,
      amountPaise: amount,
      note: "SIMULATED / AI DEMO. Not a supplier quotation.",
      isSimulated: true,
      isFinal: false,
    });
    await db.insert(aiActivities).values({
      id: newId("aia"),
      companyId: session.companyId,
      vendorId: vendor.id,
      sessionId,
      action: "simulated_bid",
      detail: `${vendor.name} (${profile?.strategy ?? config.strategy}) submitted a demo bid. Floor is derived from your anchor and discount cap, not a market price.`,
    });
    placed += 1;
  }
  return { placed };
}

export function openingAmount(anchor: number, profile: AiProfile, minPrice: number | null, maxDiscount: number) {
  const floor = Math.max(minPrice ?? 0, Math.round(anchor * (1 - maxDiscount / 100)), Math.round(anchor * profile.floorFactor));
  const opened = Math.round(anchor * profile.anchorFactor);
  return { amount: Math.max(opened, floor), floor };
}

export function newSimToken() {
  return newToken();
}
