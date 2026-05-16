import type { DisplayDetailMetaRow, DisplayDetailSection } from "./types";
import { jsonPreview, truncate } from "../utils";

const TOOL_SUMMARY_LIMIT = 140;

export function compactToolSummary(label: string | null, target?: string | null, qualifier?: string | null): string {
  const targetText = target?.trim();
  const base = label ? (targetText ? `${label}: ${targetText}` : label) : (targetText ?? "details");
  return truncate(qualifier ? `${base} (${qualifier})` : base, TOOL_SUMMARY_LIMIT);
}

export function statusQualifier(status: unknown, failure?: string | null): string | null {
  if (status === "declined") return "declined";
  if (status === "failed") return failure || "failed";
  return null;
}

export function failedStatusLabel(status: unknown): string | null {
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return null;
}

export function metaDetail(title: string, rows: DisplayDetailMetaRow[]): DisplayDetailSection[] {
  return rows.length > 0 ? [{ title, rows }] : [];
}

export function bodyDetail(title: string, body: string | null | undefined): DisplayDetailSection[] {
  return body ? [{ title, body }] : [];
}

export function jsonDetail(title: string, value: unknown): DisplayDetailSection[] {
  return value === null || value === undefined ? [] : [{ title, body: jsonPreview(value) }];
}

export function jsonDetails(entries: Array<[title: string, value: unknown]>): DisplayDetailSection[] {
  return entries.flatMap(([title, value]) => jsonDetail(title, value));
}

export function jsonTargetLabel(value: unknown): string | null {
  const direct = jsonTargetPrimitive(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const priorityKeys = [
    "q",
    "query",
    "search_query",
    "url",
    "ref_id",
    "path",
    "file",
    "filename",
    "ticker",
    "location",
    "team",
    "league",
    "id",
    "target",
    "command",
  ];

  for (const key of priorityKeys) {
    const target = jsonTargetPrimitive(record[key]);
    if (target) return target;
  }

  const firstEntry = Object.entries(record).find(([, entryValue]) => jsonTargetPrimitive(entryValue));
  return firstEntry ? jsonTargetPrimitive(firstEntry[1]) : null;
}

function jsonTargetPrimitive(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const target = jsonTargetLabel(item);
    if (target) return target;
  }
  return null;
}
