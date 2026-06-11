import { definedProp } from "../../../utils";
import type { DisplayDetailMetaRow, DisplayDetailSection, DisplayItem, HookDisplayItem } from "./types";

interface DisplayHookRun {
  id: string;
  eventName: string | null;
  statusMessage: string | null;
  startedAt: { toString(): string };
  durationMs: { toString(): string } | number | bigint | null;
  entries: readonly { kind: string; text: string }[];
}

export function hookRunDisplayItem(run: DisplayHookRun, turnId: string | null, status: string): HookDisplayItem | null {
  if (run.id.length === 0) return null;
  const entries = run.entries.map((entry) => `${entry.kind}: ${entry.text}`).join("\n");
  const metaRows: DisplayDetailMetaRow[] = [
    { key: "status", value: status },
    { key: "event", value: hookEventName(run.eventName) },
    ...(run.statusMessage ? [{ key: "message", value: run.statusMessage }] : []),
    ...(run.durationMs !== null ? [{ key: "duration", value: `${String(run.durationMs)}ms` }] : []),
  ];
  const details: DisplayDetailSection[] = [{ rows: metaRows }, ...(entries ? [{ title: "Hook output", body: entries }] : [])];
  const displayId = hookRunDisplayId(run);
  return {
    id: displayId,
    kind: "hook",
    role: "tool",
    text: hookSummary(run.eventName, run.statusMessage),
    toolLabel: "hook",
    ...definedProp("turnId", turnId),
    itemId: displayId,
    status,
    details,
    output: "",
  };
}

function hookRunDisplayId(run: DisplayHookRun): string {
  return `hook-${run.id}-${run.startedAt.toString()}`;
}

function hookEventName(eventName: string | null | undefined): string {
  const trimmed = eventName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Hook";
}

export function attachHookRunsToTurn(
  items: readonly DisplayItem[],
  turnId: string,
  hookItemIds: readonly string[],
  afterItemId?: string | null,
): DisplayItem[] {
  const hookIdSet = new Set(hookItemIds);
  const attachedHooks = items.filter((item) => hookIdSet.has(item.id)).map((item) => ({ ...item, turnId }));
  if (attachedHooks.length === 0) return [...items];

  const withoutAttachedHooks = items.filter((item) => !hookIdSet.has(item.id));
  const anchorItemId = afterItemId ?? lastUserMessageAnchorId(withoutAttachedHooks, turnId);
  if (!anchorItemId) return [...withoutAttachedHooks, ...attachedHooks];
  const insertAfterIndex = withoutAttachedHooks.findIndex((item) => item.id === anchorItemId);
  if (insertAfterIndex === -1) return [...withoutAttachedHooks, ...attachedHooks];
  return [...withoutAttachedHooks.slice(0, insertAfterIndex + 1), ...attachedHooks, ...withoutAttachedHooks.slice(insertAfterIndex + 1)];
}

function lastUserMessageAnchorId(items: readonly DisplayItem[], turnId: string): string | null {
  const anchor = [...items]
    .reverse()
    .find((item) => item.kind === "message" && item.role === "user" && (!item.turnId || item.turnId === turnId));
  return anchor?.id ?? null;
}

function hookSummary(eventName: string | null | undefined, statusMessage: string | null | undefined): string {
  const message = statusMessage?.trim();
  const event = hookEventName(eventName);
  return message ? `${event}: ${message}` : event;
}
