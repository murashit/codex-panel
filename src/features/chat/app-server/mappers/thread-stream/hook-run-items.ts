import type { HookThreadStreamItem } from "../../../domain/thread-stream/items";
import { type ExecutionStateByStatus, executionStateFromStatus, RUNNING_EXECUTION_STATE } from "./execution-state";

interface ThreadStreamHookRun {
  id: string;
  eventName: string | null;
  statusMessage: string | null;
  startedAt: { toString(): string };
  durationMs: { toString(): string } | number | bigint | null;
  entries: readonly { kind: string; text: string }[];
}

const HOOK_RUN_STATES: ExecutionStateByStatus = {
  running: RUNNING_EXECUTION_STATE,
  completed: "completed",
  failed: "failed",
  blocked: "failed",
  stopped: "failed",
};

export function hookRunThreadStreamItem(run: ThreadStreamHookRun, turnId: string | null, status: string): HookThreadStreamItem | null {
  if (run.id.length === 0) return null;
  const trimmedEventName = run.eventName?.trim();
  const eventName = trimmedEventName && trimmedEventName.length > 0 ? trimmedEventName : "Hook";
  const displayId = `hook-${run.id}-${run.startedAt.toString()}`;
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
    executionState: executionStateFromStatus(status, HOOK_RUN_STATES),
    hookRun: {
      eventName,
      ...definedProp("statusMessage", run.statusMessage ?? undefined),
      ...(run.durationMs !== null ? { durationMs: `${String(run.durationMs)}ms` } : {}),
      entries: run.entries,
    },
    output: "",
  };
}

function definedProp<Key extends string, Value>(key: Key, value: Value | null | undefined): Record<Key, Value> | Record<string, never> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
