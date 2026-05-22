import { jsonPreview } from "../utils";

export interface DetailRow {
  key: string;
  value: string;
}

export function permissionRows(value: unknown): DetailRow[] {
  const permissions = value as { network?: { enabled?: unknown } | null; fileSystem?: unknown } | null;
  if (!permissions || typeof permissions !== "object") return [];

  const rows: DetailRow[] = [];
  const networkEnabled = permissions.network?.enabled;
  if (typeof networkEnabled === "boolean") {
    rows.push({ key: "network", value: networkEnabled ? "enabled" : "disabled" });
  }

  const fileSystem = permissions.fileSystem as {
    read?: unknown;
    write?: unknown;
    entries?: { path?: unknown; access?: unknown }[];
    globScanMaxDepth?: unknown;
  } | null;
  if (!fileSystem || typeof fileSystem !== "object") return rows;

  if (Array.isArray(fileSystem.entries) && fileSystem.entries.length > 0) {
    rows.push({
      key: "filesystem",
      value: fileSystem.entries.map((entry) => `${fileSystemPathLabel(entry.path)} (${stringValue(entry.access, "unknown")})`).join("\n"),
    });
  }
  addOptional(rows, "read", fileSystem.read);
  addOptional(rows, "write", fileSystem.write);
  addOptional(rows, "glob depth", fileSystem.globScanMaxDepth);
  return rows;
}

export function addOptional(rows: DetailRow[], key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;
  rows.push({ key, value: stringValue(value) });
}

export function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
    return value.join("\n");
  }
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value);
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function fileSystemPathLabel(path: unknown): string {
  const value = path as
    | { type?: "path"; path?: unknown }
    | { type?: "glob_pattern"; pattern?: unknown }
    | { type?: "special"; value?: { kind?: unknown; path?: unknown; subpath?: unknown } }
    | null;
  if (!value || typeof value !== "object") return "(unknown)";
  if (value.type === "path") return stringValue(value.path, "(unknown)");
  if (value.type === "glob_pattern") return stringValue(value.pattern, "(unknown)");
  if (value.type !== "special") return "(unknown)";

  const special = value.value;
  if (!special || typeof special !== "object") return "(unknown)";
  const kind = stringValue(special.kind, "special");
  const subpath = nonEmptyString(special.subpath);
  if (kind === "project_roots") return subpath ? `project_roots/${subpath}` : "project_roots";
  if (kind === "unknown") {
    const base = stringValue(special.path, "unknown");
    return subpath ? `${base}/${subpath}` : base;
  }
  return kind;
}
