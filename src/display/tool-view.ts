import { executionState, pathRelativeToWorkspace } from "./model";
import type {
  CommandDisplayItem,
  DisplayDetailSection,
  DisplayFileChange,
  DisplayItem,
  ExecutionState,
  FileChangeDisplayItem,
  ReviewResultDisplayItem,
  ToolDisplayItem,
} from "./types";

export type ToolResultDisplayItem = CommandDisplayItem | FileChangeDisplayItem | ToolDisplayItem | ReviewResultDisplayItem;

export type ToolResultDetailSection =
  | { kind: "meta"; title?: string; rows: Array<{ key: string; value: string }> }
  | { kind: "output"; title: string; body: string }
  | { kind: "diff"; title: string; diff: string };

export interface ToolResultView {
  className: string;
  label: string;
  summary: string;
  detailsKey: string;
  details: ToolResultDetailSection[];
  state: ExecutionState;
}

export function toolResultView(item: ToolResultDisplayItem, workspaceRoot?: string | null): ToolResultView {
  if (item.kind === "command") return commandToolView(item);
  if (item.kind === "fileChange") return fileChangeToolView(item, workspaceRoot);
  if (item.kind === "reviewResult") return reviewToolView(item);
  return genericToolView(item);
}

function commandToolView(item: CommandDisplayItem): ToolResultView {
  const details: ToolResultDetailSection[] = [
    {
      kind: "meta",
      rows: [
        { key: "command", value: item.command },
        { key: "cwd", value: item.cwd },
        { key: "status", value: item.status },
        ...(item.exitCode !== null && item.exitCode !== undefined ? [{ key: "exit", value: String(item.exitCode) }] : []),
        ...(item.durationMs !== null && item.durationMs !== undefined ? [{ key: "duration", value: `${item.durationMs}ms` }] : []),
      ],
    },
    ...outputSection("Output", item.output),
  ];
  return {
    className: "codex-panel__message codex-panel__message--tool codex-panel__tool-item",
    label: item.actionLabel ?? "command",
    summary: item.text,
    detailsKey: `${item.id}:command-details`,
    details,
    state: executionState(item),
  };
}

function fileChangeToolView(item: FileChangeDisplayItem, workspaceRoot?: string | null): ToolResultView {
  const displayChanges = item.changes.map((change) => ({
    ...change,
    displayPath: change.path && change.path !== "(unknown)" ? pathRelativeToWorkspace(change.path, workspaceRoot) : change.path,
  }));
  const details: ToolResultDetailSection[] = [
    {
      kind: "meta",
      rows: [
        { key: "status", value: item.status },
        { key: "files", value: String(item.changes.length) },
      ],
    },
    ...displayChanges.map((change) => ({
      kind: "diff" as const,
      title: `${change.kind ?? "changed"} ${change.displayPath ?? "(unknown)"}`,
      diff: change.diff ?? "",
    })),
    ...outputSection("Patch output", item.output),
  ];
  return {
    className: "codex-panel__message codex-panel__message--tool codex-panel__file-change",
    label: "file change",
    summary: fileChangeSummary(item, displayChanges),
    detailsKey: `${item.id}:file-change-details`,
    details,
    state: executionState(item),
  };
}

function genericToolView(item: ToolDisplayItem): ToolResultView {
  return {
    className: `codex-panel__message codex-panel__message--tool codex-panel__tool-item codex-panel__tool-item--${item.kind}`,
    label: item.toolLabel ?? item.kind,
    summary: item.text,
    detailsKey: `${item.id}:details`,
    details: [
      ...(item.details ?? []).flatMap(detailSection),
      ...outputSection(item.kind === "hook" ? "Hook output" : "Output", item.output),
    ],
    state: executionState(item),
  };
}

function reviewToolView(item: ReviewResultDisplayItem): ToolResultView {
  return {
    className:
      "codex-panel__message codex-panel__message--tool codex-panel__message--review-result codex-panel__tool-item codex-panel__tool-item--review",
    label: "auto-review",
    summary: item.text,
    detailsKey: `${item.id}:review-details`,
    details: (item.details ?? []).flatMap(reviewDetailSection),
    state: executionState(item),
  };
}

function reviewDetailSection(section: DisplayDetailSection): ToolResultDetailSection[] {
  if (section.rows && section.rows.length > 0) return [{ kind: "meta", rows: section.rows }];
  return detailSection(section);
}

function detailSection(section: DisplayDetailSection): ToolResultDetailSection[] {
  if (section.rows && section.rows.length > 0) return [{ kind: "meta", title: section.title, rows: section.rows }];
  if (section.body) return [{ kind: "output", title: section.title ?? "Output", body: section.body }];
  return [];
}

function outputSection(title: string, body: string | null | undefined): ToolResultDetailSection[] {
  return body ? [{ kind: "output", title, body }] : [];
}

function fileChangeSummary(item: DisplayItem, changes: Array<DisplayFileChange & { displayPath: string }>): string {
  if (item.kind !== "fileChange") return item.text;
  if (changes.length === 0) return item.text;
  if (changes.length > 1) return item.text;
  const relativePath = changes[0]?.displayPath;
  if (!relativePath || relativePath === "(unknown)") return item.text;
  const suffixMatch = /\s\(([^)]+)\)$/.exec(item.text);
  return suffixMatch ? `${relativePath} (${suffixMatch[1]})` : relativePath;
}
