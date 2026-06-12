import { archiveThread } from "./thread-archive-actions";
import { compactThread } from "./thread-compact-actions";
import type { ChatThreadActionsHost } from "./thread-action-context";
import { forkThread, forkThreadFromTurn } from "./thread-fork-actions";
import { renameThread } from "./thread-rename-actions";
import { rollbackThread } from "./thread-rollback-actions";

export type { ChatThreadActionsHost } from "./thread-action-context";

export interface ChatThreadActions {
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string) => Promise<void>;
}

export function createChatThreadActions(host: ChatThreadActionsHost): ChatThreadActions {
  return {
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown) => archiveThread(host, threadId, saveMarkdown),
    forkThread: (threadId) => forkThread(host, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(host, threadId, name),
    rollbackThread: (threadId) => rollbackThread(host, threadId),
  };
}
