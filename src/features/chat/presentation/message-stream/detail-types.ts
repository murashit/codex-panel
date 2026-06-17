import { jsonPreview, truncate } from "../../../../utils";
import { pathRelativeToRoot } from "../../domain/message-stream/format/path-labels";
import type { ExecutionState, MessageStreamItem, MessageStreamPrimaryTarget } from "../../domain/message-stream/items";

export type DetailSection =
  | { kind: "kv"; title?: string; rows: readonly { readonly key: string; readonly value: string }[] }
  | { kind: "output"; title: string; body: string }
  | { kind: "diff"; title: string; diff: string };

export interface DetailView {
  className: string;
  label: string;
  summary: string;
  detailsKey: string;
  sections: DetailSection[];
  state: ExecutionState;
}

export function detailViewBase(
  item: MessageStreamItem,
  className: string,
  label: string,
  detailsKey: string,
  sections: DetailSection[],
  summary = fallbackSummary(item),
): DetailView {
  return {
    className: `codex-panel__message codex-panel__message--tool ${className}`,
    label,
    summary,
    detailsKey,
    sections,
    state: item.executionState ?? null,
  };
}

export function outputSection(title: string, body: string | null | undefined): DetailSection[] {
  return body ? [{ kind: "output", title, body }] : [];
}

export function jsonOutputSection(title: string, value: unknown): DetailSection[] {
  return value === null || value === undefined ? [] : outputSection(title, jsonPreview(value));
}

export function metaRow(key: string, value: string | null | undefined): { key: string; value: string }[] {
  return value ? [{ key, value }] : [];
}

export function primaryTargetSummary(target: MessageStreamPrimaryTarget | undefined, workspaceRoot?: string | null): string | null {
  if (!target) return null;
  if (target.kind === "path") return pathRelativeToRoot(target.path, workspaceRoot);
  return target.value;
}

export function textField(item: MessageStreamItem): string | null {
  return "text" in item && typeof item.text === "string" && item.text.trim().length > 0 ? item.text : null;
}

export function outputField(item: MessageStreamItem): string | null {
  return "output" in item && typeof item.output === "string" && item.output.trim().length > 0 ? item.output : null;
}

export function stringField(item: MessageStreamItem, key: "failureReason" | "operation" | "status" | "toolName"): string | null {
  if (!(key in item)) return null;
  const value = (item as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function compactSummary(label: string | null, target?: string | null, qualifier?: string | null): string {
  const targetText = target?.trim();
  const base = label ? (targetText ? `${label}: ${targetText}` : label) : (targetText ?? "details");
  return truncate(qualifier ? `${base} (${qualifier})` : base, 140);
}

export function statusQualifier(status: unknown, failure?: string | null): string | null {
  if (status === "declined") return "declined";
  if (status === "failed") return failure && failure.length > 0 ? failure : "failed";
  return null;
}

export function failedStatusLabel(status: unknown): string | null {
  if (status === "failed") return "failed";
  if (status === "declined") return "declined";
  return null;
}

function fallbackSummary(item: MessageStreamItem): string {
  return textField(item) ?? "details";
}
