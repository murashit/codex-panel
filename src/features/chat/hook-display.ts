import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { DisplayItem } from "./display/types";
import { definedProp } from "../../utils";

export function hookRunDisplayItem(
  run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
  turnId: string | null,
  status: string,
): DisplayItem | null {
  if (run.id.length === 0) return null;
  const entries = run.entries.map((entry) => `${entry.kind}: ${entry.text}`).join("\n");
  const metaRows = [
    { key: "status", value: status },
    { key: "event", value: run.eventName },
    ...(run.statusMessage ? [{ key: "message", value: run.statusMessage }] : []),
    ...(run.durationMs !== null ? [{ key: "duration", value: `${String(run.durationMs)}ms` }] : []),
  ];
  const details = [{ rows: metaRows }, ...(entries ? [{ title: "Hook output", body: entries }] : [])];
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

function hookRunDisplayId(run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"]): string {
  return `hook-${run.id}-${run.startedAt.toString()}`;
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
  const trimmedEvent = eventName?.trim();
  const event = trimmedEvent && trimmedEvent.length > 0 ? trimmedEvent : "Hook";
  const message = statusMessage?.trim();
  return message ? `${event}: ${message}` : event;
}
