import { codexPanelDisplayTitle, explicitThreadName, getThreadTitle } from "../../../../domain/threads/model";
import type { ChatState } from "../../chat-state";
import type { RestoredThreadTitleSnapshot } from "./types";

export function chatViewDisplayTitle(state: ChatState, restoredThreadTitle: string | null): string {
  return codexPanelDisplayTitle(state.activeThread.id, state.threadList.listedThreads, restoredThreadTitle);
}

export function activeThreadTitle(state: ChatState): string | null {
  const threadId = state.activeThread.id;
  if (!threadId) return null;
  const thread = state.threadList.listedThreads.find((item) => item.id === threadId);
  return thread ? getThreadTitle(thread) : null;
}

export function activeComposerThreadName(state: ChatState, restoredThread: RestoredThreadTitleSnapshot | null): string | null {
  const threadId = state.activeThread.id;
  if (!threadId) return null;
  const thread = state.threadList.listedThreads.find((item) => item.id === threadId);
  const listedName = thread ? explicitThreadName(thread) : null;
  if (listedName) return listedName;
  return restoredThread?.threadId === threadId ? restoredThread.explicitName : null;
}
