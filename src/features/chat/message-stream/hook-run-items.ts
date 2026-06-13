import { definedProp } from "../../../utils";
import type { MessageStreamDetailMetaRow, MessageStreamDetailSection, HookMessageStreamItem } from "./items";

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
  const entries = run.entries.map((entry) => `${entry.kind}: ${entry.text}`).join("\n");
  const metaRows: MessageStreamDetailMetaRow[] = [
    { key: "status", value: status },
    { key: "event", value: hookEventName(run.eventName) },
    ...(run.statusMessage ? [{ key: "message", value: run.statusMessage }] : []),
    ...(run.durationMs !== null ? [{ key: "duration", value: `${String(run.durationMs)}ms` }] : []),
  ];
  const details: MessageStreamDetailSection[] = [{ rows: metaRows }, ...(entries ? [{ title: "Hook output", body: entries }] : [])];
  const displayId = hookRunDisplayId(run);
  return {
    id: displayId,
    kind: "hook",
    role: "tool",
    text: hookSummary(run.eventName, run.statusMessage),
    toolLabel: "hook",
    ...definedProp("turnId", turnId),
    sourceItemId: displayId,
    status,
    details,
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

function hookSummary(eventName: string | null | undefined, statusMessage: string | null | undefined): string {
  const message = statusMessage?.trim();
  const event = hookEventName(eventName);
  return message ? `${event}: ${message}` : event;
}
