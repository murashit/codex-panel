import { jsonPreview } from "../../../../../domain/display/json-preview";
import type { ThreadStreamAuditFact } from "../../../domain/thread-stream/items";

export interface AutoReviewPermissionProfile {
  network?: { enabled?: boolean | null } | null;
  fileSystem?: {
    entries?: readonly { path: AutoReviewFileSystemPath; access?: unknown }[] | null;
    read?: unknown;
    write?: unknown;
    globScanMaxDepth?: unknown;
  } | null;
}

type AutoReviewFileSystemPath =
  | { type: "path"; path: string }
  | { type: "glob_pattern"; pattern: string }
  | {
      type: "special";
      value:
        | { kind: "project_roots"; subpath?: string | null }
        | { kind: "unknown"; path: string; subpath?: string | null }
        | { kind: string };
    };

export function autoReviewPermissionRows(permissions: AutoReviewPermissionProfile): ThreadStreamAuditFact[] {
  const rows: ThreadStreamAuditFact[] = [];
  const networkEnabled = permissions.network?.enabled;
  if (typeof networkEnabled === "boolean") {
    rows.push({ key: "network", value: networkEnabled ? "enabled" : "disabled" });
  }

  const fileSystem = permissions.fileSystem;
  if (!fileSystem) return rows;

  const entries = fileSystem.entries;
  if (entries && entries.length > 0) {
    rows.push({
      key: "filesystem",
      value: entries.map((entry) => `${fileSystemPathLabel(entry.path)} (${stringValue(entry.access, "unknown")})`).join("\n"),
    });
  }
  addOptional(rows, "read", fileSystem.read);
  addOptional(rows, "write", fileSystem.write);
  addOptional(rows, "glob depth", fileSystem.globScanMaxDepth);
  return rows;
}

function addOptional(rows: ThreadStreamAuditFact[], key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;
  rows.push({ key, value: stringValue(value) });
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
    return value.join("\n");
  }
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value);
}

function fileSystemPathLabel(path: AutoReviewFileSystemPath): string {
  if (path.type === "path") return path.path;
  if (path.type === "glob_pattern") return path.pattern;

  const special = path.value;
  if (special.kind === "project_roots") {
    const subpath = "subpath" in special ? special.subpath : null;
    return subpath ? `project_roots/${subpath}` : "project_roots";
  }
  if (special.kind === "unknown") {
    const specialPath = "path" in special ? special.path : "unknown";
    const subpath = "subpath" in special ? special.subpath : null;
    return subpath ? `${specialPath}/${subpath}` : specialPath;
  }
  return special.kind;
}
