import type { ThreadStreamAuditFact } from "../../../domain/thread-stream/items";
import { addOptional, stringValue } from "../../display-values";
import { asRecordOrNull, nonEmptyString, nullableString } from "../../value-readers";

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

export function permissionRows(permissions: unknown): ThreadStreamAuditFact[] {
  const profile = asRecordOrNull(permissions);
  if (!profile) return [];
  const rows: ThreadStreamAuditFact[] = [];
  const networkEnabled = asRecordOrNull(profile["network"])?.["enabled"];
  if (typeof networkEnabled === "boolean") {
    rows.push({ key: "network", value: networkEnabled ? "enabled" : "disabled" });
  }

  const fileSystem = asRecordOrNull(profile["fileSystem"]);
  if (!fileSystem) return rows;

  const entries = fileSystem["entries"];
  if (Array.isArray(entries) && entries.length > 0) {
    rows.push({
      key: "filesystem",
      value: entries
        .map((entry) => {
          const record = asRecordOrNull(entry);
          return record ? `${fileSystemPathLabel(record["path"])} (${stringValue(record["access"], "unknown")})` : stringValue(entry);
        })
        .join("\n"),
    });
  }
  addOptional(rows, "read", fileSystem["read"]);
  addOptional(rows, "write", fileSystem["write"]);
  addOptional(rows, "glob depth", fileSystem["globScanMaxDepth"]);
  return rows;
}

function fileSystemPathLabel(path: unknown): string {
  const record = asRecordOrNull(path);
  if (!record) return stringValue(path, "unknown");
  if (record["type"] === "path") return stringValue(record["path"], "unknown");
  if (record["type"] === "glob_pattern") return stringValue(record["pattern"], "unknown");

  const special = asRecordOrNull(record["value"]);
  if (!special) return stringValue(path, "unknown");
  if (special["kind"] === "project_roots") {
    const subpath = nullableString(special["subpath"]);
    return subpath ? `project_roots/${subpath}` : "project_roots";
  }
  if (special["kind"] === "unknown") {
    const specialPath = nullableString(special["path"]) ?? "unknown";
    const subpath = nullableString(special["subpath"]);
    return subpath ? `${specialPath}/${subpath}` : specialPath;
  }
  return nonEmptyString(special["kind"]) ?? "unknown";
}
