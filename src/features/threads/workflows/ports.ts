import type { Thread } from "../../../domain/threads/model";
import type { ThreadTitleContext } from "../../../domain/threads/title-context";
import type { ThreadTranscript } from "../../../domain/threads/transcript";

export type ArchiveThreadResult =
  | { readonly kind: "archived"; readonly exportedPath: string | null }
  | { readonly kind: "blocked"; readonly reason: "thread-busy" };

export interface ThreadMutationPort {
  renameThread(threadId: string, name: string): Promise<void>;
  setThreadPinned(threadId: string, isPinned: boolean): Promise<void>;
  archiveThread(
    threadId: string,
    options: { canArchive: () => boolean; prepare?: ((thread: ThreadTranscript) => Promise<string | null>) | undefined },
  ): Promise<ArchiveThreadResult>;
  restoreThread(threadId: string): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
}

export interface ThreadTitlePort {
  persistedContext(threadId: string): Promise<ThreadTitleContext | null>;
  generateTitle(context: ThreadTitleContext, signal: AbortSignal): Promise<string | null>;
}
