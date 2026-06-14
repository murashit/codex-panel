import { definedProp } from "../../../../../utils";
import type { HookMessageStreamItem } from "../../../domain/message-stream/items";

interface MessageStreamHookRun {
  id: string;
  eventName: string | null;
  statusMessage: string | null;
  startedAt: { toString(): string };
  durationMs: { toString(): string } | number | bigint | null;
  entries: readonly { kind: string; text: string }[];
}

export function hookRunMessageStreamItem(run: MessageStreamHookRun, turnId: string | null, status: string): HookMessageStreamItem | null {
  if (run.id.length === 0) return null;
  const eventName = hookEventName(run.eventName);
  const displayId = hookRunDisplayId(run);
  return {
    id: displayId,
    kind: "hook",
    role: "tool",
    toolName: "hook",
    operation: eventName,
    ...(run.statusMessage ? { primaryTarget: { kind: "value" as const, value: run.statusMessage } } : {}),
    ...definedProp("turnId", turnId),
    sourceItemId: displayId,
    provenance: { source: "appServer", channel: "notification", event: "hookRun", sourceItemId: displayId },
    status,
    hookRun: {
      eventName,
      ...definedProp("statusMessage", run.statusMessage ?? undefined),
      ...(run.durationMs !== null ? { durationMs: `${String(run.durationMs)}ms` } : {}),
      entries: run.entries,
    },
    output: "",
  };
}

function hookRunDisplayId(run: MessageStreamHookRun): string {
  return `hook-${run.id}-${run.startedAt.toString()}`;
}

function hookEventName(eventName: string | null | undefined): string {
  const trimmed = eventName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Hook";
}
