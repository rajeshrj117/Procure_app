export function formatMoney(paise: number | null | undefined, currency = "INR") {
  if (paise == null || Number.isNaN(paise)) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

export function plainMoney(paise: number | null | undefined, currency = "INR") {
  if (paise == null || Number.isNaN(paise)) return "n/a";
  const amount = (paise / 100).toLocaleString(currency === "INR" ? "en-IN" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

export function formatWhen(value: string | Date | null | undefined, timeZone = "Asia/Kolkata") {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(value: string | Date | null | undefined, timeZone = "Asia/Kolkata") {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function rupeesToPaise(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function num(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function vendorBadge(kind: string | null | undefined) {
  if (kind === "ai_demo") return "SIMULATED / AI DEMO";
  if (kind === "directory_demo") return "DEMO DIRECTORY";
  return null;
}

export function titleCaseStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function remainingMs(endIso: string, serverNowIso: string, clientNow = Date.now()) {
  const end = new Date(endIso).getTime();
  const serverNow = new Date(serverNowIso).getTime();
  const offset = serverNow - clientNow;
  return end - (Date.now() + offset);
}

export function formatDuration(ms: number) {
  if (ms <= 0) return "Closed";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
