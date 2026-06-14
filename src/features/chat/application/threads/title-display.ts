import { getThreadTitle, type Thread } from "../../../../domain/threads/model";
import { shortThreadId } from "../../../../utils";

export function codexPanelDisplayTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const title = thread ? getThreadTitle(thread).replace(/\s+/g, " ").trim() : (fallbackTitle ?? shortThreadId(activeThreadId));
  return title ? `Codex: ${title}` : "Codex";
}
