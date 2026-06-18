import { definedProp } from "../../../../../utils";
import type { ExecutionState, HookMessageStreamItem } from "../../../domain/message-stream/items";

interface MessageStreamHookRun {
  id: string;
  eventName: string | null;
  statusMessage: string | null;
  startedAt: { toString(): string };
  durationMs: { toString(): string } | number | bigint | null;
  entries: readonly { kind: string; text: string }[];
}

type MessageStreamExecutionState = Exclude<ExecutionState, null>;
type ExecutionStateByStatus = Readonly<Record<string, MessageStreamExecutionState>>;

const HOOK_RUN_STATES: ExecutionStateByStatus = {
  running: "running",
  completed: "completed",
  failed: "failed",
  blocked: "failed",
  stopped: "failed",
};

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
    executionState: hookRunExecutionState(status),
    hookRun: {
      eventName,
      ...definedProp("statusMessage", run.statusMessage ?? undefined),
      ...(run.durationMs !== null ? { durationMs: `${String(run.durationMs)}ms` } : {}),
      entries: run.entries,
    },
    output: "",
  };
}

function hookRunExecutionState(status: string): ExecutionState {
  return HOOK_RUN_STATES[status] ?? null;
}

function hookRunDisplayId(run: MessageStreamHookRun): string {
  return `hook-${run.id}-${run.startedAt.toString()}`;
}

function hookEventName(eventName: string | null | undefined): string {
  const trimmed = eventName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Hook";
}
