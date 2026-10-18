import { shortThreadId, type Thread } from "../../../../domain/threads/model";
import { threadMeaningfulTitle } from "../../../../domain/threads/title";
import { type ChatState, isSideChatLifetime, newConversationEphemeral } from "../../application/state/model";

export function conversationIdentity(state: ChatState, threads: readonly Thread[]): { title: string; ephemeral: boolean | null } {
  const panel = state.panelThread;
  if (panel.kind === "empty") return { title: "New chat", ephemeral: newConversationEphemeral(state) };
  if (panel.kind === "fork-draft") {
    return {
      title: panel.draft.kind === "side-chat" ? sideChatTitle(panel.draft.sourceThreadTitle) : "Fork draft",
      ephemeral: panel.draft.kind === "side-chat",
    };
  }
  if (panel.kind === "active" && isSideChatLifetime(panel.thread.lifetime)) {
    return { title: sideChatTitle(panel.thread.lifetime.sourceThreadTitle ?? null), ephemeral: true };
  }
  const id = panel.kind === "active" ? panel.thread.id : panel.threadId;
  const listed = threads.find((thread) => thread.id === id);
  const title = listed
    ? threadMeaningfulTitle(listed)
    : panel.kind === "awaiting-resume"
      ? panel.fallbackTitle
      : threadMeaningfulTitle(panel.thread);
  return {
    title: title || `Untitled thread · ${shortThreadId(id)}`,
    ephemeral: panel.kind === "active" ? panel.thread.lifetime?.kind === "ephemeral" : null,
  };
}

function sideChatTitle(source: string | null): string {
  return source ? `Side chat — ${source}` : "Side chat";
}
