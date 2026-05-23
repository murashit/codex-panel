import type { RateLimitSummary } from "../../runtime/view";

export function statusValue(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value, fallback);
}

export function usageLimitStatusLines(limit: RateLimitSummary): string[] {
  return ["Usage limits", ...limit.rows.map((row) => `${row.label}: ${row.value}${row.resetLabel ? ` (${row.resetLabel})` : ""}`)];
}

function jsonPreview(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}
