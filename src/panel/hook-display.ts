import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { DisplayItem } from "../display/types";

export function hookRunDisplayItem(
  run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
  turnId: string | null,
  status: string,
): DisplayItem | null {
  if (!run?.id) return null;
  const entries = (run.entries ?? []).map((entry) => `${entry.kind}: ${entry.text}`).join("\n");
  const metaRows = [
    { key: "status", value: status },
    { key: "event", value: run.eventName },
    ...(run.statusMessage ? [{ key: "message", value: run.statusMessage }] : []),
    ...(run.durationMs !== null && run.durationMs !== undefined ? [{ key: "duration", value: `${run.durationMs}ms` }] : []),
  ];
  const details = [{ rows: metaRows }, ...(entries ? [{ title: "Hook output", body: entries }] : [])];
  return {
    id: `hook-${run.id}`,
    kind: "hook",
    role: "tool",
    text: hookSummary(run.eventName, run.statusMessage),
    toolLabel: "hook",
    turnId: turnId ?? undefined,
    itemId: `hook-${run.id}`,
    status,
    details,
    output: "",
  };
}

function hookSummary(eventName: string | null | undefined, statusMessage: string | null | undefined): string {
  const event = eventName?.trim() || "Hook";
  const message = statusMessage?.trim();
  return message ? `${event}: ${message}` : event;
}
