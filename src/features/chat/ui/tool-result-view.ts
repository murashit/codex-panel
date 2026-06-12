import { pathRelativeToRoot } from "../display/details/path-labels";
import { definedProp } from "../../../utils";
import type {
  ApprovalResultDisplayItem,
  CommandDisplayItem,
  DisplayDetailSection,
  DisplayFileChange,
  DisplayItem,
  ExecutionState,
  FileChangeDisplayItem,
  GoalDisplayItem,
  HookDisplayItem,
  ReviewResultDisplayItem,
  ToolCallDisplayItem,
} from "../display/types";

export type ToolResultDisplayItem =
  | CommandDisplayItem
  | FileChangeDisplayItem
  | GoalDisplayItem
  | ToolCallDisplayItem
  | HookDisplayItem
  | ApprovalResultDisplayItem
  | ReviewResultDisplayItem;

export type ToolResultDetailSection =
  | { kind: "meta"; title?: string; rows: { key: string; value: string }[] }
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
  if (item.kind === "goal") return goalToolView(item);
  if (item.kind === "approvalResult") return approvalToolView(item);
  if (item.kind === "reviewResult") return reviewToolView(item);
  return genericToolView(item, workspaceRoot);
}

function commandToolView(item: CommandDisplayItem): ToolResultView {
  const rows = [
    { key: "command", value: item.command },
    { key: "cwd", value: item.cwd },
    { key: "status", value: item.status },
    ...(item.exitCode !== undefined ? [{ key: "exit", value: String(item.exitCode) }] : []),
    ...(item.durationMs !== undefined ? [{ key: "duration", value: `${String(item.durationMs)}ms` }] : []),
  ];
  const details: ToolResultDetailSection[] = [
    {
      kind: "meta",
      rows,
    },
    ...outputSection("Output", item.output),
  ];
  return toolView(item, "codex-panel__tool-item", item.actionLabel ?? "command", `${item.id}:command-details`, details);
}

function fileChangeToolView(item: FileChangeDisplayItem, workspaceRoot?: string | null): ToolResultView {
  const displayChanges = item.changes.map((change) => ({
    ...change,
    displayPath: change.path && change.path !== "(unknown)" ? pathRelativeToRoot(change.path, workspaceRoot) : change.path,
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
      title: `${change.kind} ${change.displayPath}`,
      diff: change.diff,
    })),
    ...outputSection("Patch output", item.output),
  ];
  return toolView(
    item,
    "codex-panel__file-change",
    "file change",
    `${item.id}:file-change-details`,
    details,
    fileChangeSummary(item, displayChanges),
  );
}

function goalToolView(item: GoalDisplayItem): ToolResultView {
  return toolView(
    item,
    "codex-panel__tool-item codex-panel__tool-item--goal",
    "goal",
    `${item.id}:goal-details`,
    (item.details ?? []).flatMap(detailSection),
  );
}

function genericToolView(item: ToolCallDisplayItem | HookDisplayItem, workspaceRoot?: string | null): ToolResultView {
  return toolView(
    item,
    `codex-panel__tool-item codex-panel__tool-item--${item.kind}`,
    item.toolLabel ?? item.kind,
    `${item.id}:details`,
    [...(item.details ?? []).flatMap(detailSection), ...outputSection(item.kind === "hook" ? "Hook output" : "Output", item.output)],
    item.summaryPath ? pathRelativeToRoot(item.text, workspaceRoot) : item.text,
  );
}

function reviewToolView(item: ReviewResultDisplayItem): ToolResultView {
  return resultToolView(
    item,
    "auto-review",
    `${item.id}:review-details`,
    "codex-panel__message--review-result codex-panel__tool-item--review",
  );
}

function approvalToolView(item: ApprovalResultDisplayItem): ToolResultView {
  return resultToolView(
    item,
    "approval",
    `${item.id}:approval-details`,
    "codex-panel__message--approval-result codex-panel__tool-item--approval",
  );
}

function resultToolView(
  item: ApprovalResultDisplayItem | ReviewResultDisplayItem,
  label: string,
  detailsKey: string,
  className: string,
): ToolResultView {
  return toolView(item, `codex-panel__tool-item ${className}`, label, detailsKey, (item.details ?? []).flatMap(resultDetailSection));
}

function toolView(
  item: ToolResultDisplayItem,
  className: string,
  label: string,
  detailsKey: string,
  details: ToolResultDetailSection[],
  summary = item.text,
): ToolResultView {
  return {
    className: `codex-panel__message codex-panel__message--tool ${className}`,
    label,
    summary,
    detailsKey,
    details,
    state: item.executionState ?? null,
  };
}

function resultDetailSection(section: DisplayDetailSection): ToolResultDetailSection[] {
  if (section.rows && section.rows.length > 0) return [{ kind: "meta", rows: section.rows }];
  return detailSection(section);
}

function detailSection(section: DisplayDetailSection): ToolResultDetailSection[] {
  if (section.rows && section.rows.length > 0) return [{ kind: "meta", ...definedProp("title", section.title), rows: section.rows }];
  if (section.body) return [{ kind: "output", title: section.title ?? "Output", body: section.body }];
  return [];
}

function outputSection(title: string, body: string | null | undefined): ToolResultDetailSection[] {
  return body ? [{ kind: "output", title, body }] : [];
}

function fileChangeSummary(item: DisplayItem, changes: (DisplayFileChange & { displayPath: string })[]): string {
  if (item.kind !== "fileChange") return item.text;
  if (changes.length === 0) return item.text;
  if (changes.length > 1) return item.text;
  const relativePath = changes[0]?.displayPath;
  if (!relativePath || relativePath === "(unknown)") return item.text;
  const suffixMatch = /\s\(([^)]+)\)$/.exec(item.text);
  const suffix = suffixMatch?.[1];
  return suffix ? `${relativePath} (${suffix})` : relativePath;
}
