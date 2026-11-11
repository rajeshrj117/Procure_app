import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs,
  aiConfigs,
  appMeta,
  bids,
  biddingSessions,
  companies,
  emailLogs,
  extensionRequests,
  invitations,
  negotiationMessages,
  negotiations,
  notifications,
  priceHistory,
  procurementRequests,
  requirementItems,
  users,
  vendorCatalog,
  vendors,
} from "@/db/schema";
import { hashPassword, newToken } from "./core";
import { resolveCity } from "./geo";

const DEMO_SOURCE =
  "Demo supplier directory shipped with the Northwind workspace. Simulated seed — not a live quotation, scrape, or verified supplier.";

let pending: Promise<void> | null = null;

export function ensureSeeded() {
  if (!pending) {
    pending = runSeed().catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

function monthsAgo(months: number, day = 14, hour = 11) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  date.setDate(day);
  date.setHours(hour, 20, 0, 0);
  return date;
}

export async function runSeed() {
  const [adminHash, managerHash, staffHash, superHash, vendorHash] = await Promise.all([
    hashPassword("Northwind#2026"),
    hashPassword("Manage#2026"),
    hashPassword("Staff#2026"),
    hashPassword("Super#2026"),
    hashPassword("Vendor#2026"),
  ]);

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(481516)`);
    const [existing] = await tx.select().from(appMeta).where(eq(appMeta.key, "seed_version")).limit(1);
    if (existing) return;

    const now = new Date();
    const pune = resolveCity("pune")!;
    await tx.insert(companies).values({
      id: "cmp_northwind",
      name: "Northwind Fabrication",
      legalName: "Northwind Fabrication Pvt Ltd",
      industry: "Industrial fabrication",
      address: "Plot 18, MIDC Bhosari",
      city: "Pune",
      state: pune.state,
      country: "India",
      currency: "INR",
      timezone: "Asia/Kolkata",
      taxPercent: "18",
      isDemo: true,
      nextRequestNumber: 1100,
      emailFromName: "Northwind Procurement",
      minBidIncrementPaise: 50000,
      defaultVisibility: "anonymous",
      createdAt: monthsAgo(8),
      updatedAt: now,
    });

    await tx.insert(users).values([
      { id: "usr_amira", companyId: "cmp_northwind", email: "amira.shah@northwind.demo", passwordHash: adminHash, name: "Amira Shah", role: "company_admin", title: "Head of Procurement", phone: null, active: true },
      { id: "usr_rohan", companyId: "cmp_northwind", email: "rohan.mehta@northwind.demo", passwordHash: managerHash, name: "Rohan Mehta", role: "procurement_manager", title: "Procurement Manager", active: true },
      { id: "usr_leela", companyId: "cmp_northwind", email: "leela.nair@northwind.demo", passwordHash: staffHash, name: "Leela Nair", role: "procurement_staff", title: "Procurement Executive", active: true },
      { id: "usr_platform", companyId: "cmp_northwind", email: "platform@strata.demo", passwordHash: superHash, name: "Platform Admin", role: "super_admin", title: "Super Admin", active: true },
    ]);

    const cityOf = (name: string) => {
      const city = resolveCity(name)!;
      return { city: name, state: city.state, country: city.country, lat: String(city.lat), lng: String(city.lng) };
    };
    const vendorRows = [
      ["ven_apex", "Apex Steel Works", "Pune", "quotes@apexsteel.demo", 92, 96, ["Steel"], ["Grade 2", "Grade A"], true],
      ["ven_deccan", "Deccan Rods & Sections", "Nashik", "desk@deccanrods.demo", 88, 91, ["Steel"], ["Grade 2"], false],
      ["ven_western", "Western Metals Desk", "Mumbai", "sales@westernmetals.demo", 81, 84, ["Steel", "Electrical"], ["Grade 2"], false],
      ["ven_sabarmati", "Sabarmati Alloys", "Ahmedabad", "supply@sabarmatialloys.demo", 85, 89, ["Steel"], ["Grade 2", "Grade A"], false],
      ["ven_ncr", "NCR Ferrous Supply", "Gurugram", "desk@ncrferrous.demo", 74, 77, ["Steel"], ["Grade 2"], false],
      ["ven_kaveri", "Kaveri Cement Depot", "Bengaluru", "orders@kavericement.demo", 90, 93, ["Cement"], ["OPC 53"], false],
      ["ven_godavari", "Godavari Polymers", "Nagpur", "sales@godavaripolymers.demo", 83, 86, ["Polymers"], ["PE100"], false],
    ] as const;

    await tx.insert(vendors).values(
      vendorRows.map(([id, name, city, email, score, onTime, categories, grades, portal]) => {
        const geo = cityOf(city);
        return {
          id,
          companyId: "cmp_northwind",
          name,
          contactPerson: "Quotations desk",
          email,
          phone: null,
          address: null,
          city: geo.city,
          state: geo.state,
          country: geo.country,
          lat: geo.lat,
          lng: geo.lng,
          categories: [...categories],
          grades: [...grades],
          verificationStatus: "simulated",
          performanceScore: score,
          onTimeDeliveryRate: onTime,
          paymentTerms: "Demo terms — 30 days, not a live account",
          deliveryCapabilities: "Demo delivery profile only",
          active: true,
          isSimulated: true,
          simulationKind: "directory_demo",
          portalEnabled: portal,
          portalPasswordHash: portal ? vendorHash : null,
          source: DEMO_SOURCE,
          lastVerifiedAt: now,
          notes: "Simulated seed supplier. Not a verified vendor and not available for a real purchase commitment.",
        };
      }),
    );

    const aiProfiles = [
      ["ven_ai_helios", "Helios Demo Metals", "Pune", "aggressive", 1.01, 0.9],
      ["ven_ai_keen", "Keen Quote Demo Supply", "Mumbai", "competitive", 1.03, 0.93],
      ["ven_ai_quiet", "Quiet Bid Demo Co", "Nashik", "conservative", 1.05, 0.96],
      ["ven_ai_margin", "Margin Lock Demo Industries", "Ahmedabad", "fixed_margin", 1.04, 0.94],
      ["ven_ai_random", "Sandbox Random Demo Traders", "Surat", "randomized", 1.04, 0.91],
    ] as const;
    await tx.insert(vendors).values(
      aiProfiles.map(([id, name, city, strategy, anchorFactor, floorFactor]) => {
        const geo = cityOf(city);
        return {
          id,
          companyId: "cmp_northwind",
          name,
          contactPerson: "Simulation desk",
          email: `${id}@ai.demo`,
          city: geo.city,
          state: geo.state,
          country: geo.country,
          lat: geo.lat,
          lng: geo.lng,
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
          aiProfile: { strategy, anchorFactor, floorFactor, maxBids: strategy === "conservative" ? 4 : 10 },
          notes: "SIMULATED / AI DEMO. Cannot be awarded a purchase and cannot send a contractual acceptance.",
        };
      }),
    );

    await tx.insert(aiConfigs).values({
      companyId: "cmp_northwind",
      enabled: false,
      vendorCount: 4,
      strategy: "competitive",
      speedSeconds: 20,
      maxDiscountPercent: "12",
    });

    const catalog = [
      ["cat_apex_rod", "ven_apex", "Iron Rod", "Steel", "Grade 2", "TMT bar, demo specification", "20000", "KG", 8650, "2", 3, 46],
      ["cat_deccan_rod", "ven_deccan", "Iron Rod", "Steel", "Grade 2", "TMT bar, demo specification", "15000", "KG", 8420, "5", 4, 44],
      ["cat_western_rod", "ven_western", "Iron Rod", "Steel", "Grade 2", "TMT bar, demo specification", "8000", "KG", 9100, "1", 5, 40],
      ["cat_sab_rod", "ven_sabarmati", "Iron Rod", "Steel", "Grade 2", "TMT bar, demo specification", "12000", "KG", 8840, "3", 6, 43],
      ["cat_ncr_rod", "ven_ncr", "Iron Rod", "Steel", "Grade 2", "TMT bar, demo specification", "25000", "KG", 9675, "10", 9, 38],
      ["cat_apex_plate", "ven_apex", "Steel Plate", "Steel", "Grade A", "IS 2062 demo spec", "6000", "KG", 7425, "1", 5, 45],
      ["cat_sab_plate", "ven_sabarmati", "Steel Plate", "Steel", "Grade A", "IS 2062 demo spec", "4000", "KG", 7180, "2", 7, 43],
      ["cat_western_cu", "ven_western", "Copper Cable", "Electrical", "2.5mm", "Demo conductor spec", "5000", "M", 18600, "100", 6, 41],
      ["cat_kaveri", "ven_kaveri", "Cement", "Cement", "OPC 53", "Demo bagged cement", "2000", "BAG", 38500, "50", 7, 47],
      ["cat_godavari", "ven_godavari", "HDPE Pipe", "Polymers", "PE100", "110mm demo pipe", "3000", "M", 24500, "50", 8, 42],
    ] as const;
    await tx.insert(vendorCatalog).values(
      catalog.map(([id, vendorId, productName, category, grade, specifications, qty, unit, price, moq, days, rating]) => ({
        id,
        companyId: "cmp_northwind",
        vendorId,
        productName,
        category,
        grade,
        specifications,
        availableQty: qty,
        unit,
        pricePaise: price,
        currency: "INR",
        moq,
        deliveryDays: days,
        ratingTenths: rating,
        source: DEMO_SOURCE,
        lastVerifiedAt: now,
        isSimulated: true,
        updatedAt: now,
      })),
    );

    for (const vendorId of ["ven_apex", "ven_deccan", "ven_western"]) {
      const base = vendorId === "ven_apex" ? 9100 : vendorId === "ven_deccan" ? 8800 : 9600;
      for (let month = 6; month >= 1; month -= 1) {
        await tx.insert(priceHistory).values({
          id: `ph_${vendorId}_${month}`,
          companyId: "cmp_northwind",
          vendorId,
          productName: "Iron Rod",
          pricePaise: base - (6 - month) * 70,
          unit: "KG",
          source: "Demo price history — not a market index.",
          recordedAt: monthsAgo(month, 8),
        });
      }
    }

    const awards = [
      { id: "req_1040", ref: "PR-1040", title: "Steel plate restock", category: "Steel", months: 6, vendor: "ven_apex", qty: 1500, unit: "KG", product: "Steel Plate", grade: "Grade A", target: 7000, awarded: 6600 },
      { id: "req_1041", ref: "PR-1041", title: "Copper cable draw-off", category: "Electrical", months: 5, vendor: "ven_western", qty: 500, unit: "M", product: "Copper Cable", grade: "2.5mm", target: 20000, awarded: 18600 },
      { id: "req_1042", ref: "PR-1042", title: "Iron rod grade 2 — yard replenishment", category: "Steel", months: 4, vendor: "ven_deccan", qty: 5000, unit: "KG", product: "Iron Rod", grade: "Grade 2", target: 9200, awarded: 8420 },
      { id: "req_1043", ref: "PR-1043", title: "Steel plate grade A", category: "Steel", months: 3, vendor: "ven_sabarmati", qty: 2000, unit: "KG", product: "Steel Plate", grade: "Grade A", target: 7600, awarded: 7180 },
      { id: "req_1044", ref: "PR-1044", title: "OPC 53 cement", category: "Cement", months: 2, vendor: "ven_kaveri", qty: 800, unit: "BAG", product: "Cement", grade: "OPC 53", target: 41000, awarded: 38500 },
      { id: "req_1045", ref: "PR-1045", title: "HDPE pipe 110mm", category: "Polymers", months: 1, vendor: "ven_godavari", qty: 1000, unit: "M", product: "HDPE Pipe", grade: "PE100", target: 26000, awarded: 24500 },
    ];

    for (const award of awards) {
      const when = monthsAgo(award.months);
      const baseline = award.qty * award.target;
      const awardedPaise = award.qty * award.awarded;
      const savings = baseline - awardedPaise;
      await tx.insert(procurementRequests).values({
        id: award.id,
        companyId: "cmp_northwind",
        createdBy: "usr_rohan",
        referenceCode: award.ref,
        title: award.title,
        status: "demo_awarded",
        workflow: "bidding",
        description: "Historical demo sourcing decision. Not a live purchase commitment.",
        category: award.category,
        deliveryLocation: "Northwind Fabrication, Bhosari, Pune",
        deliveryCity: "Pune",
        currency: "INR",
        taxPercent: "18",
        visibilityMode: "anonymous",
        terms: "Demo terms. This record does not create a contract.",
        baselinePaise: baseline,
        baselineLabel: "Sum of stated target price × quantity. Demo baseline, not a market index.",
        targetPricePaise: baseline,
        awardedVendorId: award.vendor,
        awardedBidId: `bid_${award.id}_win`,
        awardedPaise,
        awardedAt: when,
        savingsPaise: savings,
        savingsPercent: ((savings / baseline) * 100).toFixed(3),
        awardMode: "demo",
        createdAt: new Date(when.getTime() - 5 * 86400000),
        updatedAt: when,
      });
      await tx.insert(requirementItems).values({
        id: `item_${award.id}`,
        requestId: award.id,
        companyId: "cmp_northwind",
        productName: award.product,
        category: award.category,
        grade: award.grade,
        quantity: String(award.qty),
        unit: award.unit,
        targetPricePaise: award.target,
        confirmed: true,
        needsReview: false,
        confidence: "1.000",
        sortOrder: 0,
      });
      const start = new Date(when.getTime() - 2 * 86400000);
      const end = new Date(when.getTime() - 2 * 3600000);
      await tx.insert(biddingSessions).values({
        id: `ses_${award.id}`,
        companyId: "cmp_northwind",
        requestId: award.id,
        status: "closed",
        startsAt: start,
        endsAt: end,
        originalEndsAt: end,
        visibilityMode: "anonymous",
        minIncrementPaise: 50000,
        currency: "INR",
        closedAt: end,
        extensionCount: 0,
      });
      await tx.insert(invitations).values({
        id: `inv_${award.id}`,
        companyId: "cmp_northwind",
        requestId: award.id,
        sessionId: `ses_${award.id}`,
        vendorId: award.vendor,
        token: newToken(),
        status: "responded",
        emailStatus: "suppressed_demo",
        sentAt: start,
        openedAt: start,
        expiresAt: new Date(when.getTime() + 14 * 86400000),
      });
      await tx.insert(bids).values({
        id: `bid_${award.id}_win`,
        companyId: "cmp_northwind",
        sessionId: `ses_${award.id}`,
        requestId: award.id,
        vendorId: award.vendor,
        amountPaise: awardedPaise,
        note: "Demo closing quotation.",
        isFinal: true,
        createdAt: new Date(end.getTime() - 30 * 60000),
      });
      await tx.insert(activityLogs).values({
        id: `act_${award.id}`,
        companyId: "cmp_northwind",
        actorType: "user",
        actorId: "usr_rohan",
        actorName: "Rohan Mehta",
        action: "request.awarded",
        entityType: "procurement_request",
        entityId: award.id,
        metadata: { demo: true, referenceCode: award.ref, savingsPaise: savings },
        createdAt: when,
      });
    }

    const liveStart = new Date(now.getTime() - 2 * 3600000);
    const liveEnd = new Date(now.getTime() + 36 * 3600000);
    await tx.insert(procurementRequests).values({
      id: "req_1046",
      companyId: "cmp_northwind",
      createdBy: "usr_amira",
      referenceCode: "PR-1046",
      title: "Copper cable 2.5mm — competitive round",
      status: "live",
      workflow: "bidding",
      description: "Live demo bidding session. Prices are simulated seed quotations.",
      category: "Electrical",
      deliveryLocation: "Northwind Fabrication, Bhosari, Pune",
      deliveryCity: "Pune",
      expectedDeliveryDate: new Date(now.getTime() + 18 * 86400000),
      targetPricePaise: 38000000,
      maxBudgetPaise: 42000000,
      currency: "INR",
      taxPercent: "18",
      visibilityMode: "anonymous",
      terms: "Submit a total landed quotation in INR. Demo session — not a purchase order.",
      baselinePaise: 38000000,
      baselineLabel: "Stated target for 2,000 M. Demo baseline, not a market index.",
      createdAt: new Date(now.getTime() - 26 * 3600000),
      updatedAt: now,
    });
    await tx.insert(requirementItems).values({
      id: "item_1046",
      requestId: "req_1046",
      companyId: "cmp_northwind",
      productName: "Copper Cable",
      category: "Electrical",
      grade: "2.5mm",
      specifications: "2,000 metres. Demo specification only.",
      quantity: "2000",
      unit: "M",
      targetPricePaise: 19000,
      confirmed: true,
      needsReview: false,
      confidence: "1.000",
    });
    await tx.insert(biddingSessions).values({
      id: "ses_1046",
      companyId: "cmp_northwind",
      requestId: "req_1046",
      status: "live",
      startsAt: liveStart,
      endsAt: liveEnd,
      originalEndsAt: liveEnd,
      visibilityMode: "anonymous",
      minIncrementPaise: 50000,
      currency: "INR",
      extensionCount: 0,
    });

    const liveVendors = ["ven_apex", "ven_deccan", "ven_western", "ven_sabarmati"] as const;
    for (const vendorId of liveVendors) {
      await tx.insert(invitations).values({
        id: `inv_1046_${vendorId}`,
        companyId: "cmp_northwind",
        requestId: "req_1046",
        sessionId: "ses_1046",
        vendorId,
        token: newToken(),
        status: vendorId === "ven_sabarmati" ? "opened" : "responded",
        emailStatus: "suppressed_demo",
        sentAt: liveStart,
        openedAt: new Date(liveStart.getTime() + 20 * 60000),
        expiresAt: new Date(liveEnd.getTime() + 14 * 86400000),
      });
      await tx.insert(emailLogs).values({
        id: `eml_1046_${vendorId}`,
        companyId: "cmp_northwind",
        toAddress: vendorId === "ven_apex" ? "quotes@apexsteel.demo" : `${vendorId}@demo.local`,
        subject: "Northwind Fabrication: quotation invited for Copper cable 2.5mm",
        bodyText: "Demo invitation. Email suppressed because the address is not a real inbox. Open the vendor portal for the secure link.",
        bodyHtml: "<p>Demo invitation recorded. Email suppressed.</p>",
        status: "suppressed_demo",
        provider: null,
        error: "Demo address.",
        relatedType: "invitation",
        relatedId: `inv_1046_${vendorId}`,
        createdAt: liveStart,
      });
    }
    await tx.insert(bids).values([
      { id: "bid_1046_apex_1", companyId: "cmp_northwind", sessionId: "ses_1046", requestId: "req_1046", vendorId: "ven_apex", amountPaise: 39400000, note: "Opening demo quotation", createdAt: new Date(now.getTime() - 80 * 60000) },
      { id: "bid_1046_apex_2", companyId: "cmp_northwind", sessionId: "ses_1046", requestId: "req_1046", vendorId: "ven_apex", amountPaise: 38600000, note: "Revised demo quotation", createdAt: new Date(now.getTime() - 35 * 60000) },
      { id: "bid_1046_deccan", companyId: "cmp_northwind", sessionId: "ses_1046", requestId: "req_1046", vendorId: "ven_deccan", amountPaise: 39100000, note: "Demo quotation", createdAt: new Date(now.getTime() - 50 * 60000) },
      { id: "bid_1046_western", companyId: "cmp_northwind", sessionId: "ses_1046", requestId: "req_1046", vendorId: "ven_western", amountPaise: 40200000, note: "Demo quotation", createdAt: new Date(now.getTime() - 40 * 60000) },
    ]);
    await tx.insert(extensionRequests).values({
      id: "ext_1046",
      companyId: "cmp_northwind",
      sessionId: "ses_1046",
      requestId: "req_1046",
      vendorId: "ven_sabarmati",
      reason: "Costing sheet is still with the mill desk.",
      requestedMinutes: 180,
      message: "Demo extension request. Approval would move the official deadline for every invited supplier.",
      status: "pending",
      createdAt: new Date(now.getTime() - 25 * 60000),
    });

    const schedStart = new Date(now.getTime() + 2 * 86400000);
    const schedEnd = new Date(now.getTime() + 4 * 86400000);
    await tx.insert(procurementRequests).values({
      id: "req_1048",
      companyId: "cmp_northwind",
      createdBy: "usr_leela",
      referenceCode: "PR-1048",
      title: "Angle cleats — scheduled round",
      status: "scheduled",
      workflow: "manual",
      category: "Steel",
      deliveryLocation: "Northwind Fabrication, Bhosari, Pune",
      deliveryCity: "Pune",
      currency: "INR",
      visibilityMode: "blind",
      terms: "Blind demo round. Competing prices stay hidden from suppliers.",
      baselinePaise: 6400000,
      baselineLabel: "Stated target.",
      targetPricePaise: 6400000,
      createdAt: new Date(now.getTime() - 5 * 3600000),
      updatedAt: now,
    });
    await tx.insert(requirementItems).values({
      id: "item_1048",
      requestId: "req_1048",
      companyId: "cmp_northwind",
      productName: "Angle cleat",
      category: "Steel",
      grade: "IS 2062",
      quantity: "400",
      unit: "PCS",
      targetPricePaise: 16000,
      confirmed: true,
      needsReview: false,
      confidence: "1.000",
    });
    await tx.insert(biddingSessions).values({
      id: "ses_1048",
      companyId: "cmp_northwind",
      requestId: "req_1048",
      status: "scheduled",
      startsAt: schedStart,
      endsAt: schedEnd,
      originalEndsAt: schedEnd,
      visibilityMode: "blind",
      minIncrementPaise: 10000,
      currency: "INR",
    });
    for (const vendorId of ["ven_apex", "ven_deccan"] as const) {
      await tx.insert(invitations).values({
        id: `inv_1048_${vendorId}`,
        companyId: "cmp_northwind",
        requestId: "req_1048",
        sessionId: "ses_1048",
        vendorId,
        token: newToken(),
        status: "sent",
        emailStatus: "suppressed_demo",
        sentAt: now,
        expiresAt: new Date(schedEnd.getTime() + 14 * 86400000),
      });
    }

    await tx.insert(procurementRequests).values({
      id: "req_1047",
      companyId: "cmp_northwind",
      createdBy: "usr_amira",
      referenceCode: "PR-1047",
      title: "Binding wire — direct negotiation",
      status: "negotiation",
      workflow: "negotiation",
      category: "Steel",
      deliveryLocation: "Northwind Fabrication, Bhosari, Pune",
      deliveryCity: "Pune",
      currency: "INR",
      visibilityMode: "company_only",
      terms: "Direct negotiation demo. Agreement here is a sourcing note, not an e-signed contract.",
      baselinePaise: 7840000,
      baselineLabel: "Target for 800 KG.",
      targetPricePaise: 7840000,
      createdAt: new Date(now.getTime() - 3 * 86400000),
      updatedAt: now,
    });
    await tx.insert(requirementItems).values({
      id: "item_1047",
      requestId: "req_1047",
      companyId: "cmp_northwind",
      productName: "Binding wire",
      category: "Steel",
      grade: "16 gauge",
      quantity: "800",
      unit: "KG",
      targetPricePaise: 9800,
      confirmed: true,
      needsReview: false,
      confidence: "1.000",
    });
    await tx.insert(negotiations).values({
      id: "neg_1047",
      companyId: "cmp_northwind",
      requestId: "req_1047",
      vendorId: "ven_apex",
      status: "open",
      currency: "INR",
      vendorToken: newToken(),
      createdBy: "usr_amira",
      createdAt: new Date(now.getTime() - 2 * 86400000),
      updatedAt: new Date(now.getTime() - 60 * 60000),
    });
    await tx.insert(negotiationMessages).values([
      { id: "nmsg_1", negotiationId: "neg_1047", companyId: "cmp_northwind", senderRole: "company", senderName: "Amira Shah", body: "Opening offer for 800 KG binding wire, delivered to Bhosari.", offerPaise: 7600000, action: "offer", createdAt: new Date(now.getTime() - 2 * 86400000) },
      { id: "nmsg_2", negotiationId: "neg_1047", companyId: "cmp_northwind", senderRole: "vendor", senderName: "Apex Steel Works", body: "Demo counteroffer. This supplier record is simulated seed data.", offerPaise: 7840000, action: "counter", createdAt: new Date(now.getTime() - 60 * 60000) },
    ]);

    await tx.insert(procurementRequests).values({
      id: "req_1049",
      companyId: "cmp_northwind",
      createdBy: "usr_leela",
      referenceCode: "PR-1049",
      title: "Fastener kit — draft",
      status: "draft",
      workflow: "manual",
      category: "Hardware",
      deliveryCity: "Pune",
      deliveryLocation: "Northwind Fabrication, Bhosari, Pune",
      currency: "INR",
      visibilityMode: "anonymous",
      createdAt: new Date(now.getTime() - 2 * 3600000),
      updatedAt: now,
    });
    await tx.insert(requirementItems).values({
      id: "item_1049",
      requestId: "req_1049",
      companyId: "cmp_northwind",
      productName: "Hex bolt",
      category: "Hardware",
      grade: "8.8",
      quantity: "1500",
      unit: "PCS",
      confirmed: true,
      needsReview: false,
      confidence: "1.000",
    });

    await tx.insert(notifications).values([
      { id: "ntf_ext", companyId: "cmp_northwind", userId: "usr_amira", title: "Extension requested", body: "Sabarmati Alloys asked for 180 more minutes on PR-1046. A decision applies to every invited supplier.", type: "extension", href: "/actions/req_1046", isRead: false, createdAt: new Date(now.getTime() - 25 * 60000) },
      { id: "ntf_bid", companyId: "cmp_northwind", userId: "usr_amira", title: "Bid revised", body: "Apex Steel Works revised its demo quotation on PR-1046.", type: "bid", href: "/actions/req_1046", isRead: false, createdAt: new Date(now.getTime() - 35 * 60000) },
      { id: "ntf_vendor", companyId: "cmp_northwind", vendorId: "ven_apex", title: "Bidding is open", body: "Copper cable 2.5mm is open for quotation. This is a demo workspace.", type: "invitation", href: "/portal", isRead: false, createdAt: liveStart },
    ]);
    await tx.insert(activityLogs).values({
      id: "act_live_open",
      companyId: "cmp_northwind",
      actorType: "user",
      actorId: "usr_amira",
      actorName: "Amira Shah",
      action: "bidding.opened",
      entityType: "bidding_session",
      entityId: "ses_1046",
      metadata: { demo: true, referenceCode: "PR-1046" },
      createdAt: liveStart,
    });
    await tx.insert(appMeta).values({ key: "seed_version", value: "1" });
  });
}
