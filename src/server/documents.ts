import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { grokComplete, grokConfigured, parseJsonBlock } from "./grok";
import { newId } from "./core";

export type ExtractedItem = {
  productName: string;
  category: string | null;
  grade: string | null;
  specifications: string | null;
  quantity: number | null;
  unit: string | null;
  targetPriceRupees: number | null;
  deliveryNotes: string | null;
  confidence: number;
  needsReview: true;
  extractionNote: string | null;
};

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["pdf", "xlsx", "xls", "csv", "docx", "png", "jpg", "jpeg", "webp", "txt"]);

export function extensionOf(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "";
  return ext;
}

export function assertAllowedFile(name: string, size: number) {
  const ext = extensionOf(name);
  if (!ALLOWED.has(ext)) {
    throw new Error("Upload a PDF, Excel, CSV, Word (.docx), text, or image file.");
  }
  if (size > MAX_BYTES) throw new Error("Files must be 8 MB or smaller.");
  return ext;
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0]!.map((header) => header.trim());
  return rows
    .slice(1)
    .filter((cells) => cells.some((value) => value.trim()))
    .map((cells) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = (cells[index] ?? "").trim();
      });
      return record;
    });
}

function keyOf(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function pick(row: Record<string, string>, names: string[]) {
  const entries = Object.entries(row).map(([key, value]) => [keyOf(key), value] as const);
  for (const name of names) {
    const found = entries.find(([key]) => key === name || key.includes(name));
    if (found && found[1].trim()) return found[1].trim();
  }
  return "";
}

function parseQty(value: string) {
  if (!value) return null;
  const n = Number(value.replace(/,/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parsePrice(value: string) {
  if (!value) return null;
  const n = Number(value.replace(/,/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function unitOf(value: string) {
  const raw = value.toLowerCase();
  if (/kg|kilogram/.test(raw)) return "KG";
  if (/mt|tonne|ton/.test(raw)) return "MT";
  if (/bag/.test(raw)) return "BAG";
  if (/pcs|piece|nos|unit/.test(raw)) return "PCS";
  if (/mtr|meter|metre|^m$/.test(raw)) return "M";
  if (/ltr|litre|liter/.test(raw)) return "LTR";
  return value ? value.toUpperCase() : null;
}

export function rowsToItems(rows: Record<string, string>[], engine: string): { items: ExtractedItem[]; warnings: string[] } {
  const items: ExtractedItem[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    const productName = pick(row, ["product name", "product", "item", "material", "description"]);
    if (!productName) {
      skipped += 1;
      return;
    }
    const quantity = parseQty(pick(row, ["quantity", "qty", "required quantity"]));
    const grade = pick(row, ["grade", "quality"]) || null;
    const missing: string[] = [];
    if (!quantity) missing.push("quantity");
    if (!grade) missing.push("grade");
    items.push({
      productName,
      category: pick(row, ["category"]) || null,
      grade,
      specifications: pick(row, ["specifications", "specification", "specs"]) || null,
      quantity,
      unit: unitOf(pick(row, ["unit", "uom"])),
      targetPriceRupees: parsePrice(pick(row, ["target price", "target", "rate", "price"])),
      deliveryNotes: pick(row, ["delivery", "delivery notes", "location"]) || null,
      confidence: missing.length ? 0.62 : 0.9,
      needsReview: true,
      extractionNote: missing.length
        ? `Row ${index + 2}: ${missing.join(" and ")} not detected. Confirm before use. Engine: ${engine}.`
        : `Structured row ${index + 2}. Still requires confirmation. Engine: ${engine}.`,
    });
  });
  const warnings = ["Extracted values are unconfirmed until you review and save them."];
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped because no product name was detected.`);
  if (!items.length) warnings.push("No requirement lines were detected. Add them manually or check the column headers.");
  return { items, warnings };
}

export function textToItems(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: ExtractedItem[] = [];
  const pattern =
    /^(.{3,80}?)(?:,|\s{2,}|\t+)\s*(grade\s*[a-z0-9.+/-]+|opc\s*\d+|fe\s*\d+[a-z]*)?(?:,|\s{2,}|\t+)?\s*(\d[\d,]*(?:\.\d+)?)?\s*(kg|mt|pcs|m|bag|bags|ltr)?/i;
  for (const line of lines) {
    if (/^product\b/i.test(line)) continue;
    const match = line.match(pattern);
    if (!match) continue;
    const productName = match[1]?.replace(/[,|]+$/g, "").trim();
    if (!productName || productName.length < 3) continue;
    items.push({
      productName,
      category: null,
      grade: match[2] || null,
      specifications: null,
      quantity: match[3] ? Number(match[3].replace(/,/g, "")) : null,
      unit: match[4] ? unitOf(match[4]) : null,
      targetPriceRupees: null,
      deliveryNotes: null,
      confidence: 0.46,
      needsReview: true,
      extractionNote: "Parsed from unstructured text. Confirm every cell before saving.",
    });
  }
  return {
    items: items.slice(0, 40),
    warnings: items.length
      ? ["Text extraction is uncertain. Review every row before it is used."]
      : ["No table-like lines were detected in the document text."],
  };
}

async function grokItems(text: string) {
  if (!grokConfigured() || text.trim().length < 12) return null;
  const result = await grokComplete(
    [
      {
        role: "system",
        content:
          "Extract procurement lines as JSON {\"items\":[{\"productName\",\"grade\",\"quantity\",\"unit\",\"category\",\"specifications\",\"targetPriceRupees\",\"deliveryNotes\"}]}. Use null for unknown values. Never invent rows that are not supported by the text.",
      },
      { role: "user", content: text.slice(0, 12000) },
    ],
    { temperature: 0, maxTokens: 1400 },
  );
  if (!result.text) return null;
  const parsed = parseJsonBlock(result.text) as { items?: Array<Record<string, unknown>> } | null;
  if (!parsed?.items || !Array.isArray(parsed.items)) return null;
  const items: ExtractedItem[] = [];
  for (const item of parsed.items) {
    const productName = typeof item.productName === "string" ? item.productName.trim() : "";
    if (productName.length < 2) continue;
    items.push({
      productName,
      category: typeof item.category === "string" ? item.category : null,
      grade: typeof item.grade === "string" ? item.grade : null,
      specifications: typeof item.specifications === "string" ? item.specifications : null,
      quantity: typeof item.quantity === "number" ? item.quantity : null,
      unit: typeof item.unit === "string" ? unitOf(item.unit) : null,
      targetPriceRupees: typeof item.targetPriceRupees === "number" ? item.targetPriceRupees : null,
      deliveryNotes: typeof item.deliveryNotes === "string" ? item.deliveryNotes : null,
      confidence: 0.7,
      needsReview: true,
      extractionNote: "Suggested by Grok from the document text. Confirm before use. Not silently accepted.",
    });
  }
  return items.slice(0, 40);
}

export async function extractBuffer(fileName: string, bytes: Buffer, mime: string | null) {
  const ext = extensionOf(fileName);
  const warnings: string[] = [];
  let text = "";
  let engine = "none";
  let items: ExtractedItem[] = [];

  if (ext === "csv" || ext === "txt") {
    text = bytes.toString("utf8");
    const structured = rowsToItems(parseCsv(text), "csv");
    items = structured.items;
    warnings.push(...structured.warnings);
    engine = items.length ? "csv" : "text";
    if (!items.length) {
      const loose = textToItems(text);
      items = loose.items;
      warnings.push(...loose.warnings);
    }
  } else if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    const book = XLSX.read(bytes, { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0] || ""];
    const rows = sheet ? (XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[]) : [];
    const normalized = rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")])),
    );
    text = normalized.map((row) => Object.values(row).join(" | ")).join("\n");
    const structured = rowsToItems(normalized, "excel");
    items = structured.items;
    warnings.push(...structured.warnings);
    engine = "excel";
  } else if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    text = result.value || "";
    const loose = textToItems(text);
    items = loose.items;
    warnings.push(...loose.warnings);
    engine = "docx";
  } else if (ext === "pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const extracted = await extractText(pdf, { mergePages: true });
      text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text || "";
      const loose = textToItems(text);
      items = loose.items;
      warnings.push(...loose.warnings);
      engine = "pdf";
      if (text.trim().length < 20) {
        warnings.push("This PDF has little selectable text. If it is a scan, configure Grok for OCR or upload Excel/CSV.");
      }
    } catch {
      warnings.push("PDF text could not be read. Upload Excel or CSV, or paste the table.");
      engine = "pdf-failed";
    }
  } else if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    engine = "image";
    if (!grokConfigured()) {
      warnings.push("Image OCR needs a configured Grok API key. No rows were invented from this image.");
    } else {
      const vision = await grokComplete(
        [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract procurement table rows as JSON {\"items\":[{\"productName\",\"grade\",\"quantity\",\"unit\",\"targetPriceRupees\",\"specifications\"}]}. If unreadable, return {\"items\":[]}. Do not invent values.",
              },
              { type: "image_url", image_url: { url: `data:${mime || "image/png"};base64,${bytes.toString("base64")}` } },
            ],
          },
        ],
        { temperature: 0, maxTokens: 1200 },
      );
      text = vision.text || "";
      const parsed = text ? (parseJsonBlock(text) as { items?: Array<Record<string, unknown>> } | null) : null;
      if (parsed?.items?.length) {
        items = [];
        for (const item of parsed.items) {
          const productName = typeof item.productName === "string" ? item.productName.trim() : "";
          if (!productName) continue;
          items.push({
            productName,
            category: null,
            grade: typeof item.grade === "string" ? item.grade : null,
            specifications: typeof item.specifications === "string" ? item.specifications : null,
            quantity: typeof item.quantity === "number" ? item.quantity : null,
            unit: typeof item.unit === "string" ? unitOf(item.unit) : null,
            targetPriceRupees: typeof item.targetPriceRupees === "number" ? item.targetPriceRupees : null,
            deliveryNotes: null,
            confidence: 0.55,
            needsReview: true,
            extractionNote: "OCR suggestion from Grok. Confirm every value. Uncertain cells are not approved.",
          });
        }
      } else {
        warnings.push(vision.error || "No readable requirement rows were found in the image.");
      }
    }
  }

  if (!items.length && text.trim().length > 20) {
    const ai = await grokItems(text);
    if (ai?.length) {
      items = ai;
      engine = `${engine}+grok`;
      warnings.push("Grok suggested these lines from the document. They remain unconfirmed.");
    }
  }

  return { items, text: text.slice(0, 200000), warnings, engine };
}

export async function saveUpload(companyId: string, fileName: string, bytes: Buffer) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
  const id = newId("doc");
  const relative = path.join("storage", "uploads", companyId, `${id}-${safe}`);
  const absolute = path.join(storageRoot(), companyId, `${id}-${safe}`);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  return { id, relative };
}

function storageRoot() {
  return path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "uploads");
}

export async function readUpload(relativePath: string) {
  const root = storageRoot();
  const absolute = path.resolve(root, path.relative(path.join("storage", "uploads"), relativePath));
  if (!absolute.startsWith(root)) throw new Error("Invalid document path.");
  return readFile(absolute);
}

export async function scanStatusFor(fileName: string, bytes: Buffer) {
  const hook = process.env.MALWARE_SCAN_WEBHOOK;
  if (!hook) return "not_configured";
  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, size: bytes.length, sha256: (await import("crypto")).createHash("sha256").update(bytes).digest("hex") }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "scan_failed";
    const data = (await res.json()) as { clean?: boolean };
    return data.clean === false ? "blocked" : "scanned";
  } catch {
    return "scan_failed";
  }
}
