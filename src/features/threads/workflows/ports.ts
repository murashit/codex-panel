import type { ArchiveThreadInput } from "../../../domain/threads/archive-markdown";
import type { ThreadTitleContext } from "../../../domain/threads/title-generation-model";

export interface ThreadMutationPort {
  renameThread(threadId: string, name: string): Promise<void>;
  setThreadPinned(threadId: string, isPinned: boolean): Promise<void>;
  archiveThread(threadId: string, prepare?: (thread: ArchiveThreadInput) => Promise<string | null>): Promise<string | null>;
}

export interface ThreadTitlePort {
  persistedContext(threadId: string): Promise<ThreadTitleContext | null>;
  generateTitle(context: ThreadTitleContext, signal: AbortSignal): Promise<string | null>;
}
