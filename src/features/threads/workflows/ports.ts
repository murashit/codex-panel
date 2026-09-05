import type { Thread } from "../../../domain/threads/model";
import type { ThreadTitleContext } from "../../../domain/threads/title-context";
import type { ThreadTranscript } from "../../../domain/threads/transcript";

export interface ThreadMutationPort {
  renameThread(threadId: string, name: string): Promise<void>;
  setThreadPinned(threadId: string, isPinned: boolean): Promise<void>;
  archiveThread(threadId: string, prepare?: (thread: ThreadTranscript) => Promise<string | null>): Promise<string | null>;
  restoreThread(threadId: string): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
}

export interface ThreadTitlePort {
  persistedContext(threadId: string): Promise<ThreadTitleContext | null>;
  generateTitle(context: ThreadTitleContext, signal: AbortSignal): Promise<string | null>;
}
