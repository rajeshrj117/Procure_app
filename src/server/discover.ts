import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, vendorCatalog, vendors } from "@/db/schema";
import type { DiscoverRow, Interpretation } from "@/lib/types";
import { vendorBadge } from "@/lib/format";
import { haversineKm, resolveCity } from "./geo";
import { grokComplete, grokConfigured, parseJsonBlock } from "./grok";

const GROUPS = [
  ["iron rod", "tmt bar", "tmt rod", "rebar", "reinforcement bar"],
  ["steel plate", "ms plate"],
  ["copper wire", "copper cable", "copper conductor"],
  ["cement", "opc"],
  ["hdpe", "hdpe pipe", "polyethylene pipe"],
  ["binding wire", "binding wire 16 gauge"],
];

export function interpretQuery(query: string): Interpretation {
  const text = query.replace(/\s+/g, " ").trim();
  const distance = text.match(/within\s+(\d+(?:\.\d+)?)\s*km/i);
  const location = text.match(/\b(?:in|near|around|at)\s+([a-z][a-z\s]{1,32})/i);
  const grade =
    text.match(/\b(grade\s*[a-z0-9][a-z0-9.+/-]*)\b/i) ||
    text.match(/\b(opc\s*\d+|fe\s*\d+[a-z]*)\b/i);
  const qty = text.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(kg|kgs|mt|tons|tonnes|pcs|pieces|nos|m|meter|meters|metre|metres|ltr|litres|bags|bag|coils?)?/i);
  let product = text;
  if (grade) product = product.replace(grade[0], " ");
  if (distance) product = product.replace(distance[0], " ");
  if (location) product = product.replace(location[0], " ");
  if (qty && /[a-z]/i.test(qty[2] || "")) product = product.replace(qty[0], " ");
  product = product.replace(/\b(vendors?|suppliers?|quotation|price|prices|cheapest|lowest|find|show)\b/gi, " ");
  product = product.replace(/\s+/g, " ").trim();
  const unitRaw = qty?.[2]?.toLowerCase() || null;
  const unit = unitRaw
    ? /kg/.test(unitRaw)
      ? "KG"
      : /mt|ton/.test(unitRaw)
        ? "MT"
        : /bag/.test(unitRaw)
          ? "BAG"
          : /pc|nos|piece/.test(unitRaw)
            ? "PCS"
            : /m/.test(unitRaw)
              ? "M"
              : /l/.test(unitRaw)
                ? "LTR"
                : unitRaw.toUpperCase()
    : null;
  return {
    product: product || null,
    grade: grade ? grade[1].replace(/\s+/g, " ").replace(/^grade/i, "Grade") : null,
    quantity: qty && unit ? Number(qty[1].replace(/,/g, "")) : null,
    unit,
    location: location ? location[1].trim() : null,
    maxDistanceKm: distance ? Number(distance[1]) : null,
    category: null,
    specifications: null,
  };
}

function grounded(product: string | null, query: string) {
  if (!product) return true;
  const words = product.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const hay = query.toLowerCase();
  return words.length === 0 || words.some((word) => hay.includes(word));
}

export async function interpretWithGrok(query: string) {
  const parsed = interpretQuery(query);
  if (!grokConfigured() || query.trim().length < 3) {
    return { interpretation: parsed, source: "parser" as const, note: null as string | null };
  }
  const result = await grokComplete(
    [
      {
        role: "system",
        content:
          "Convert a procurement search into JSON with keys product, grade, quantity, unit, location, maxDistanceKm, category, specifications. Use null if unknown. Do not add suppliers or prices.",
      },
      { role: "user", content: query },
    ],
    { temperature: 0, maxTokens: 300 },
  );
  if (!result.text) return { interpretation: parsed, source: "parser" as const, note: result.error };
  const json = parseJsonBlock(result.text) as Partial<Interpretation> | null;
  if (!json || typeof json !== "object" || !grounded(typeof json.product === "string" ? json.product : null, query)) {
    return { interpretation: parsed, source: "parser" as const, note: "Grok interpretation was discarded because it was not grounded in the search text." };
  }
  return {
    interpretation: {
      product: typeof json.product === "string" ? json.product : parsed.product,
      grade: typeof json.grade === "string" ? json.grade : parsed.grade,
      quantity: typeof json.quantity === "number" ? json.quantity : parsed.quantity,
      unit: typeof json.unit === "string" ? json.unit.toUpperCase() : parsed.unit,
      location: typeof json.location === "string" ? json.location : parsed.location,
      maxDistanceKm: typeof json.maxDistanceKm === "number" ? json.maxDistanceKm : parsed.maxDistanceKm,
      category: typeof json.category === "string" ? json.category : null,
      specifications: typeof json.specifications === "string" ? json.specifications : null,
    },
    source: "grok" as const,
    note: null,
  };
}

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function gradeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function productsMatch(query: string, candidate: string) {
  const a = norm(query);
  const b = norm(candidate);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  return GROUPS.some((group) => group.some((item) => a.includes(item)) && group.some((item) => b.includes(item)));
}

function gradesMatch(queryGrade: string | null, candidate: string | null) {
  if (!queryGrade) return true;
  if (!candidate) return false;
  return gradeKey(queryGrade) === gradeKey(candidate);
}

export async function discoverVendors(input: {
  companyId: string;
  query: string;
  product?: string | null;
  grade?: string | null;
  location?: string | null;
  maxDistanceKm?: number | null;
  minRating?: number | null;
  sort?: string | null;
}) {
  const interpreted = input.query ? await interpretWithGrok(input.query) : { interpretation: interpretQuery(""), source: "parser" as const, note: null };
  const interpretation: Interpretation = {
    ...interpreted.interpretation,
    product: input.product || interpreted.interpretation.product,
    grade: input.grade || interpreted.interpretation.grade,
    location: input.location || interpreted.interpretation.location,
    maxDistanceKm: input.maxDistanceKm ?? interpreted.interpretation.maxDistanceKm,
  };
  const [company] = await db.select().from(companies).where(eq(companies.id, input.companyId)).limit(1);
  const destination = resolveCity(interpretation.location || company?.city);
  const catalog = await db
    .select({ catalog: vendorCatalog, vendor: vendors })
    .from(vendorCatalog)
    .innerJoin(vendors, eq(vendorCatalog.vendorId, vendors.id))
    .where(and(eq(vendorCatalog.companyId, input.companyId), eq(vendors.active, true)));

  const warnings: string[] = [];
  if (company?.isDemo) {
    warnings.push("Northwind directory matches are simulated seed data, not live market quotations.");
  }
  warnings.push("Strata searches your supplier workspace and configured integrations. It does not bypass website access controls or invent quotes.");

  let rows: DiscoverRow[] = catalog
    .filter(({ vendor, catalog: item }) => vendor.simulationKind !== "ai_demo")
    .filter(({ catalog: item }) => (interpretation.product ? productsMatch(interpretation.product, item.productName) : true))
    .filter(({ catalog: item }) => gradesMatch(interpretation.grade, item.grade))
    .map(({ vendor, catalog: item }) => {
      const origin = vendor.lat && vendor.lng ? { lat: Number(vendor.lat), lng: Number(vendor.lng) } : null;
      const distance = origin && destination ? haversineKm(origin, destination) : null;
      return {
        catalogId: item.id,
        vendorId: vendor.id,
        externalId: null,
        vendorName: vendor.name,
        city: vendor.city,
        state: vendor.state,
        country: vendor.country,
        productName: item.productName,
        grade: item.grade,
        specifications: item.specifications,
        availableQty: item.availableQty == null ? null : Number(item.availableQty),
        unit: item.unit,
        pricePaise: item.pricePaise,
        distanceKm: distance,
        deliveryDays: item.deliveryDays,
        rating: item.ratingTenths == null ? null : item.ratingTenths / 10,
        contactPerson: vendor.contactPerson,
        email: vendor.email,
        phone: vendor.phone,
        priceUpdatedAt: item.updatedAt.toISOString(),
        source: item.source,
        lastVerifiedAt: item.lastVerifiedAt?.toISOString() ?? null,
        badge: vendorBadge(vendor.simulationKind),
        simulationKind: vendor.simulationKind,
        performanceScore: vendor.performanceScore,
        moq: item.moq == null ? null : Number(item.moq),
        origin: "workspace" as const,
      };
    });

  if (interpretation.location) {
    const city = interpretation.location.toLowerCase();
    rows = rows.filter((row) => row.distanceKm != null || (row.city || "").toLowerCase().includes(city));
  }
  if (interpretation.maxDistanceKm != null) {
    rows = rows.filter((row) => row.distanceKm == null || row.distanceKm <= interpretation.maxDistanceKm!);
    warnings.push("Rows without coordinates stay visible and are marked with an unknown distance. They are not assigned an estimated distance.");
  }
  if (input.minRating) rows = rows.filter((row) => (row.rating ?? 0) >= input.minRating!);

  const sort = input.sort || "price";
  rows.sort((a, b) => {
    if (sort === "distance") return (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999);
    if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
    if (sort === "delivery") return (a.deliveryDays ?? 999) - (b.deliveryDays ?? 999);
    return a.pricePaise - b.pricePaise;
  });

  const external = await fetchDirectory(company?.directoryWebhookUrl, company?.directoryWebhookToken, interpretation);
  if (external.warning) warnings.push(external.warning);
  rows = rows.concat(external.rows);
  if (!rows.length) warnings.push("No matching supplier records are on file. Add suppliers, import a directory, or connect an approved integration.");
  if (rows.length && rows.every((row) => row.badge)) warnings.push("Every match is labeled demo or simulated data. Do not treat these prices as a market index.");

  return { interpretation, interpretationSource: interpreted.source, note: interpreted.note, results: rows, warnings, serverNow: new Date().toISOString() };
}

async function fetchDirectory(url: string | null | undefined, token: string | null | undefined, query: Interpretation) {
  const endpoint = url || process.env.SUPPLIER_DIRECTORY_URL;
  const secret = token || process.env.SUPPLIER_DIRECTORY_TOKEN;
  if (!endpoint) return { rows: [] as DiscoverRow[], warning: null as string | null };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { rows: [], warning: `Approved directory returned ${res.status}. No external rows were added.` };
    const data = (await res.json()) as { vendors?: Array<Record<string, unknown>> };
    const incoming = Array.isArray(data.vendors) ? data.vendors : [];
    const rows: DiscoverRow[] = [];
    let dropped = 0;
    for (const row of incoming.slice(0, 40)) {
      const name = typeof row.name === "string" ? row.name : "";
      const source = typeof row.source === "string" ? row.source : "";
      const price = typeof row.price === "number" ? row.price : null;
      const externalId = typeof row.externalId === "string" ? row.externalId : "";
      if (!name || !source || price == null || !externalId) {
        dropped += 1;
        continue;
      }
      rows.push({
        catalogId: null,
        vendorId: null,
        externalId,
        vendorName: name,
        city: typeof row.city === "string" ? row.city : null,
        state: typeof row.state === "string" ? row.state : null,
        country: typeof row.country === "string" ? row.country : null,
        productName: typeof row.product === "string" ? row.product : query.product || name,
        grade: typeof row.grade === "string" ? row.grade : null,
        specifications: typeof row.specifications === "string" ? row.specifications : null,
        availableQty: typeof row.availableQty === "number" ? row.availableQty : null,
        unit: typeof row.unit === "string" ? row.unit : null,
        pricePaise: Math.round(price * 100),
        distanceKm: typeof row.distanceKm === "number" ? row.distanceKm : null,
        deliveryDays: typeof row.deliveryDays === "number" ? row.deliveryDays : null,
        rating: typeof row.rating === "number" ? row.rating : null,
        contactPerson: typeof row.contact === "string" ? row.contact : null,
        email: typeof row.email === "string" ? row.email : null,
        phone: typeof row.phone === "string" ? row.phone : null,
        priceUpdatedAt: null,
        source,
        lastVerifiedAt: typeof row.lastVerifiedAt === "string" ? row.lastVerifiedAt : null,
        badge: null,
        simulationKind: null,
        performanceScore: null,
        moq: typeof row.moq === "number" ? row.moq : null,
        origin: "integration",
      });
    }
    return {
      rows,
      warning: dropped ? `${dropped} integration rows were ignored because source, price, or id was missing.` : null,
    };
  } catch {
    return { rows: [], warning: "The approved directory integration could not be reached. Workspace records only." };
  }
}
