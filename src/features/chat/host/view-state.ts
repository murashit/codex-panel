import { isObjectValue } from "../../../domain/objects/object-value";

export type ParsedChatPanelViewState = { kind: "empty" } | { kind: "thread"; threadId: string; fallbackTitle: string | null };

export function parseChatPanelViewState(state: unknown): ParsedChatPanelViewState {
  if (!isObjectValue(state)) return { kind: "empty" };
  const record = state;
  if (isEphemeralSourceState(record["ephemeralSource"])) return { kind: "empty" };

  const threadId = record["threadId"];
  if (typeof threadId !== "string" || threadId.trim().length === 0) return { kind: "empty" };
  const title = record["threadTitle"];
  return {
    kind: "thread",
    threadId,
    fallbackTitle: typeof title === "string" && title.trim().length > 0 ? title : null,
  };
}

function isEphemeralSourceState(source: unknown): boolean {
  if (!isObjectValue(source)) return false;
  const threadId = source["threadId"];
  return typeof threadId === "string" && threadId.length > 0;
}
