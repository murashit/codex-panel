export type ParsedChatPanelViewState = { kind: "empty" } | { kind: "thread"; threadId: string; fallbackTitle: string | null };

export function parseChatPanelViewState(state: unknown): ParsedChatPanelViewState {
  if (!state || typeof state !== "object") return { kind: "empty" };
  const record = state as Record<string, unknown>;
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
  if (!source || typeof source !== "object") return false;
  const threadId = (source as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0;
}
