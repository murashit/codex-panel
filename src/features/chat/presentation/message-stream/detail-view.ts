import type { MessageStreamItem, MessageStreamPrimaryTarget } from "../../domain/message-stream/items";
import { codexDetailView } from "./codex-detail-view";
import {
  compactSummary,
  detailViewBase,
  metaRow,
  outputField,
  outputSection,
  primaryTargetSummary,
  stringField,
  textField,
  type DetailSection,
  type DetailView,
} from "./detail-types";

export { type DetailSection, type DetailView } from "./detail-types";

export function detailView(item: MessageStreamItem, workspaceRoot?: string | null): DetailView {
  return codexDetailView(item, workspaceRoot) ?? genericDetailView(item, workspaceRoot);
}

function genericDetailView(item: MessageStreamItem, workspaceRoot?: string | null): DetailView {
  return detailViewBase(
    item,
    `codex-panel__detail-item codex-panel__detail-item--${item.kind}`,
    detailLabel(item),
    `${item.id}:details`,
    genericDetailSections(item, workspaceRoot),
    genericDetailSummary(item, workspaceRoot),
  );
}

function genericDetailSections(item: MessageStreamItem, workspaceRoot?: string | null): DetailSection[] {
  const rows = [
    ...metaRow("kind", item.kind),
    ...metaRow("status", stringField(item, "status")),
    ...metaRow("operation", stringField(item, "operation")),
    ...metaRow("target", primaryTargetSummary(primaryTargetField(item), workspaceRoot)),
    ...metaRow("failure", stringField(item, "failureReason")),
  ];
  return [...(rows.length > 0 ? [{ kind: "kv" as const, rows }] : []), ...outputSection("Output", outputField(item))];
}

function genericDetailSummary(item: MessageStreamItem, workspaceRoot?: string | null): string {
  const target = primaryTargetSummary(primaryTargetField(item), workspaceRoot);
  return compactSummary(null, target ?? textField(item) ?? outputField(item) ?? stringField(item, "status") ?? item.kind);
}

function detailLabel(item: MessageStreamItem): string {
  return stringField(item, "toolName") ?? item.kind;
}

function primaryTargetField(item: MessageStreamItem): MessageStreamPrimaryTarget | undefined {
  if (!("primaryTarget" in item)) return undefined;
  return item.primaryTarget;
}
