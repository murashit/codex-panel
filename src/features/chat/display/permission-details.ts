import type { FileSystemPath } from "../../../generated/app-server/v2/FileSystemPath";
import type { RequestPermissionProfile } from "../../../generated/app-server/v2/RequestPermissionProfile";
import { jsonPreview } from "../../../utils";

export interface DetailRow {
  key: string;
  value: string;
}

export function permissionRows(permissions: RequestPermissionProfile): DetailRow[] {
  const rows: DetailRow[] = [];
  const networkEnabled = permissions.network?.enabled;
  if (typeof networkEnabled === "boolean") {
    rows.push({ key: "network", value: networkEnabled ? "enabled" : "disabled" });
  }

  const fileSystem = permissions.fileSystem;
  if (!fileSystem) return rows;

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

function fileSystemPathLabel(path: FileSystemPath): string {
  if (path.type === "path") return path.path;
  if (path.type === "glob_pattern") return path.pattern;

  const special = path.value;
  if (special.kind === "project_roots") {
    return special.subpath ? `project_roots/${special.subpath}` : "project_roots";
  }
  if (special.kind === "unknown") {
    return special.subpath ? `${special.path}/${special.subpath}` : special.path;
  }
  return special.kind;
}
