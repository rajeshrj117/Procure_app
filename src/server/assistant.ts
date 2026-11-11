import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bids, procurementRequests, requirementItems, vendorCatalog, vendors } from "@/db/schema";
import { formatMoney, plainMoney, vendorBadge } from "@/lib/format";
import { productsMatch } from "./discover";
import { interpretQuery } from "./discover";
import { audit } from "./core";
import { grokComplete, grokConfigured } from "./grok";

type Citation = { label: string; href?: string };

export async function answerQuestion(companyId: string, question: string, actorName: string) {
  const vendorRows = await db.select().from(vendors).where(eq(vendors.companyId, companyId));
  const catalog = await db.select().from(vendorCatalog).where(eq(vendorCatalog.companyId, companyId));
  const requests = await db.select().from(procurementRequests).where(eq(procurementRequests.companyId, companyId)).orderBy(desc(procurementRequests.createdAt));
  const items = requests.length
    ? await db.select().from(requirementItems)
    : [];
  const companyItems = items.filter((item) => item.companyId === companyId);
  const bidRows = await db.select().from(bids).where(eq(bids.companyId, companyId)).orderBy(desc(bids.createdAt));
  const realVendors = vendorRows.filter((vendor) => vendor.simulationKind !== "ai_demo");
  const interpreted = interpretQuery(question);
  const product = interpreted.product;
  const catalogView = catalog
    .map((item) => {
      const vendor = vendorRows.find((row) => row.id === item.vendorId);
      if (!vendor || vendor.simulationKind === "ai_demo") return null;
      return {
        vendor: vendor.name,
        badge: vendorBadge(vendor.simulationKind),
        product: item.productName,
        grade: item.grade,
        priceRupees: item.pricePaise / 100,
        unit: item.unit,
        city: vendor.city,
        source: item.source,
        lastVerifiedAt: item.lastVerifiedAt?.toISOString() ?? null,
        onTime: vendor.onTimeDeliveryRate,
        score: vendor.performanceScore,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const awards = requests
    .filter((row) => row.awardedPaise != null)
    .map((row) => ({
      reference: row.referenceCode,
      title: row.title,
      awardedRupees: (row.awardedPaise ?? 0) / 100,
      baselineRupees: row.baselinePaise ? row.baselinePaise / 100 : null,
      savingsRupees: row.savingsPaise != null ? row.savingsPaise / 100 : null,
      awardedAt: row.awardedAt?.toISOString() ?? null,
      vendor: vendorRows.find((vendor) => vendor.id === row.awardedVendorId)?.name ?? null,
      awardMode: row.awardMode,
      href: `/actions/${row.id}`,
    }));
  const local = localAnswer(question, product, catalogView, awards, realVendors, bidRows, requests, companyItems);
  const packet = {
    question,
    catalog: catalogView.slice(0, 40),
    awards: awards.slice(0, 20),
    vendorCount: realVendors.length,
    notes: local.warnings,
  };
  let answer = local.answer;
  let source: "grok" | "workspace" = "workspace";
  let grokError: string | null = null;
  if (grokConfigured()) {
    const grok = await grokComplete(
      [
        {
          role: "system",
          content:
            "You are the Strata procurement assistant. Answer only from the JSON workspace packet. If data is missing, say so. Never invent suppliers, prices, savings, or a market index. If records are demo seed, say that. Keep the answer under 180 words.",
        },
        { role: "user", content: JSON.stringify(packet) },
      ],
      { temperature: 0.1, maxTokens: 700 },
    );
    if (grok.text && !suspicious(grok.text, packet)) {
      answer = grok.text;
      source = "grok";
    } else {
      grokError = grok.error || "Grok's draft was discarded because it introduced figures that are not in the workspace.";
    }
  }
  await audit({
    companyId,
    actorType: "user",
    actorName,
    action: "ai.assistant",
    entityType: "assistant",
    metadata: { question, source },
  });
  return {
    ok: true,
    answer,
    source,
    citations: local.citations,
    warnings: local.warnings,
    grokConfigured: grokConfigured(),
    grokError,
  };
}

function suspicious(text: string, packet: unknown) {
  const allowed = new Set<number>();
  const walk = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) allowed.add(Math.round(value * 100) / 100);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(packet);
  const nums = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return nums.some((raw) => {
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 100 || (n >= 2020 && n <= 2035)) return false;
    return ![...allowed].some((candidate) => Math.abs(candidate - n) < 1.5);
  });
}

function localAnswer(
  question: string,
  product: string | null,
  catalog: Array<{ vendor: string; badge: string | null; product: string; grade: string | null; priceRupees: number; unit: string | null; city: string | null; source: string | null; onTime: number; score: number }>,
  awards: Array<{ reference: string; title: string; awardedRupees: number; baselineRupees: number | null; savingsRupees: number | null; awardedAt: string | null; vendor: string | null; awardMode: string | null; href: string }>,
  vendors: Array<{ id: string; name: string; onTimeDeliveryRate: number; performanceScore: number; simulationKind: string | null }>,
  bids: Array<{ vendorId: string; amountPaise: number; createdAt: Date; isSimulated: boolean }>,
  requests: Array<{ id: string; referenceCode: string; title: string; currency: string }>,
  items: Array<{ requestId: string; productName: string }>,
) {
  const warnings = ["Answers use workspace records only. Missing quotations are not filled with estimated market prices."];
  if (catalog.some((row) => row.badge) || awards.some((row) => row.awardMode === "demo")) {
    warnings.push("Some records are demo seed. They are not a live market index.");
  }
  const q = question.toLowerCase();
  const matched = catalog.filter((row) => !product || productsMatch(product, row.product) || q.includes(row.product.toLowerCase()));
  const citations: Citation[] = [];

  if (/deliver/.test(q)) {
    const ranked = [...vendors].filter((vendor) => vendor.simulationKind !== "ai_demo").sort((a, b) => b.onTimeDeliveryRate - a.onTimeDeliveryRate).slice(0, 5);
    if (!ranked.length) return { answer: "No supplier performance records are on file yet.", citations, warnings };
    return {
      answer: `Best recorded on-time rates in this workspace:\n${ranked.map((vendor) => `${vendor.name}${vendor.simulationKind ? " (demo directory)" : ""}: ${vendor.onTimeDeliveryRate}% on time, score ${vendor.performanceScore}.`).join("\n")}\nThese are stored performance fields, not an external audit.`,
      citations,
      warnings,
    };
  }

  if (/above the (market )?average|above average/.test(q)) {
    if (matched.length < 2) return { answer: "At least two recorded quotations are needed before an average can be calculated. This is not an external market average.", citations, warnings };
    const avg = matched.reduce((sum, row) => sum + row.priceRupees, 0) / matched.length;
    const above = matched.filter((row) => row.priceRupees > avg);
    return {
      answer: `Average of recorded ${product || "matching"} quotations in your directory: INR ${avg.toFixed(2)} per ${matched[0]?.unit || "unit"}. This is not an external market index.\nAbove that workspace average:\n${above.map((row) => `${row.vendor}: INR ${row.priceRupees.toFixed(2)} ${row.badge ? `(${row.badge})` : ""}`).join("\n") || "None."}`,
      citations,
      warnings,
    };
  }

  if (/save|saving/.test(q)) {
    const named = vendors.find((vendor) => q.includes(vendor.name.toLowerCase()));
    const quote = named ? matched.find((row) => row.vendor === named.name) : matched[0];
    const award = awards.find((row) => product && row.title.toLowerCase().includes(product.toLowerCase())) ?? awards[0];
    if (!quote) return { answer: "No recorded quotation was found for that supplier, so savings cannot be calculated.", citations, warnings };
    if (!award?.baselineRupees) return { answer: `${quote.vendor} is on file at INR ${quote.priceRupees.toFixed(2)} per ${quote.unit || "unit"}. A savings figure needs a target, budget, or competing quotation. None of those baselines is available for a reliable comparison.`, citations, warnings };
    return {
      answer: `Using ${award.reference} as the comparison baseline (INR ${award.baselineRupees.toLocaleString("en-IN")}), the awarded result was INR ${award.awardedRupees.toLocaleString("en-IN")}${award.savingsRupees != null ? `, a difference of INR ${award.savingsRupees.toLocaleString("en-IN")}` : ""}. ${quote.vendor}'s current directory rate is INR ${quote.priceRupees.toFixed(2)} per ${quote.unit || "unit"}. I will not convert that unit rate into a deal saving without a confirmed quantity and competing total quotations.`,
      citations: [{ label: award.reference, href: award.href }],
      warnings,
    };
  }

  if (/last month|previous purchase|compare/.test(q)) {
    const last = awards[0];
    if (!last) return { answer: "No previous awarded purchase is on file, so there is nothing to compare.", citations, warnings };
    const current = matched.sort((a, b) => a.priceRupees - b.priceRupees)[0];
    return {
      answer: `Most recent recorded decision is ${last.reference} (${last.title}) at INR ${last.awardedRupees.toLocaleString("en-IN")}${last.vendor ? ` from ${last.vendor}` : ""}${last.awardMode === "demo" ? " — demo decision" : ""}. ${current ? `Lowest current directory rate for the matched product is INR ${current.priceRupees.toFixed(2)} per ${current.unit || "unit"} from ${current.vendor}${current.badge ? ` (${current.badge})` : ""}.` : "No current directory rate matches the question."}`,
      citations: [{ label: last.reference, href: last.href }],
      warnings,
    };
  }

  if (/cheap|lowest|price|vendor|supplier|find/.test(q)) {
    const rows = matched.sort((a, b) => a.priceRupees - b.priceRupees).slice(0, 6);
    if (!rows.length) return { answer: "No matching supplier quotations are stored. Add suppliers or import an approved directory. I will not invent vendors.", citations, warnings };
    return {
      answer: `Lowest recorded ${product || "matching"} rates in your workspace:\n${rows.map((row, index) => `${index + 1}. ${row.vendor}${row.badge ? ` [${row.badge}]` : ""} — INR ${row.priceRupees.toFixed(2)}/${row.unit || "unit"}${row.city ? `, ${row.city}` : ""}. Source: ${row.source || "workspace"}`).join("\n")}`,
      citations,
      warnings,
    };
  }

  const bidCount = bids.filter((bid) => !bid.isSimulated).length;
  return {
    answer: `Workspace snapshot: ${vendors.length} supplier records, ${catalog.length} catalog rates, ${requests.length} procurement requests, ${bidCount} non-simulated bids, ${awards.length} recorded decisions. Ask about a product, a supplier, delivery performance, or a savings comparison against a stored baseline.`,
    citations: requests.slice(0, 3).map((row) => ({ label: row.referenceCode, href: `/actions/${row.id}` })),
    warnings,
  };
}

export function moneyLine(paise: number, currency: string) {
  return `${formatMoney(paise, currency)} (${plainMoney(paise, currency)})`;
}
