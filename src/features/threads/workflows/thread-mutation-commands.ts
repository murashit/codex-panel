import { normalizeExplicitThreadName, type Thread } from "../../../domain/threads/model";
import { threadDisplayTitle } from "../../../domain/threads/title";
import { createKeyedOperationCoordinator, type KeyedOperationCoordinator } from "../../../shared/async/keyed-operation-coordinator";
import { type ArchiveExportDestination, type ArchiveExportSettings, exportArchivedThreadMarkdown } from "./archive-export";
import type { ThreadMutationPort } from "./ports";
import type { ThreadFactSink } from "./thread-facts";

export interface ThreadMutationCommandsHost {
  port: ThreadMutationPort;
  archiveExport: {
    settings(): ArchiveExportSettings;
    enabled(): boolean;
    vaultPath: string;
    vaultConfigDir: string;
  };
  archiveDestination(): ArchiveExportDestination;
  facts: ThreadFactSink;
  referenceThreads(): readonly Thread[];
  threadIsBusy(threadId: string): boolean;
}

interface ArchiveThreadOptions {
  saveMarkdown?: boolean;
  afterArchive?: () => void;
}

export type ArchiveThreadResult =
  | { readonly kind: "archived"; readonly exportedPath: string | null }
  | { readonly kind: "blocked"; readonly reason: "thread-busy" };

interface RenameThreadOptions {
  shouldStart?: () => boolean;
}

export interface ThreadMutationCommands {
  renameThread(threadId: string, value: string, options?: RenameThreadOptions): Promise<boolean>;
  setThreadPinned(threadId: string, isPinned: boolean): Promise<void>;
  archiveThread(threadId: string, options?: ArchiveThreadOptions): Promise<ArchiveThreadResult>;
  restoreThread(threadId: string): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
}

export function createThreadMutationCommands(host: ThreadMutationCommandsHost): ThreadMutationCommands {
  const nameMutations = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
  const lifecycleMutations = createKeyedOperationCoordinator<string>({ whenBusy: "reject" });
  return {
    renameThread: (threadId, value, options) => renameThread(host, nameMutations, threadId, value, options),
    setThreadPinned: (threadId, isPinned) => setThreadPinned(host, threadId, isPinned),
    archiveThread: (threadId, options) => archiveThread(host, lifecycleMutations, threadId, options),
    restoreThread: (threadId) => restoreThread(host, lifecycleMutations, threadId),
    deleteThread: (threadId) => deleteThread(host, lifecycleMutations, threadId),
  };
}

async function renameThread(
  host: ThreadMutationCommandsHost,
  nameMutations: KeyedOperationCoordinator<string>,
  threadId: string,
  value: string,
  options: RenameThreadOptions = {},
): Promise<boolean> {
  const name = normalizeExplicitThreadName(value);
  if (!name) return false;
  return nameMutations.run(threadId, async () => {
    if (!(options.shouldStart?.() ?? true)) return false;
    await host.port.renameThread(threadId, name);
    return true;
  });
}

async function setThreadPinned(host: ThreadMutationCommandsHost, threadId: string, isPinned: boolean): Promise<void> {
  await host.port.setThreadPinned(threadId, isPinned);
  host.facts.apply({ type: "thread-pinned", threadId, isPinned });
}

async function archiveThread(
  host: ThreadMutationCommandsHost,
  lifecycleMutations: KeyedOperationCoordinator<string>,
  threadId: string,
  options: ArchiveThreadOptions = {},
): Promise<ArchiveThreadResult> {
  return lifecycleMutations.run(threadId, async () => {
    if (host.threadIsBusy(threadId)) return { kind: "blocked", reason: "thread-busy" };
    const shouldExport = options.saveMarkdown ?? host.archiveExport.enabled();
    const exportedPath = await host.port.archiveThread(
      threadId,
      shouldExport
        ? async (thread) => {
            const archiveSettings = host.archiveExport.settings();
            const threads = host.referenceThreads();
            const titleById = new Map(threads.map((item) => [item.id, threadDisplayTitle(item)] as const));
            const result = await exportArchivedThreadMarkdown(
              {
                ...thread,
                transcriptEntries: thread.transcriptEntries.map((entry) => {
                  if (!entry.referencedThread) return entry;
                  const title = titleById.get(entry.referencedThread.threadId);
                  return title ? { ...entry, referencedThread: { ...entry.referencedThread, title } } : entry;
                }),
              },
              {
                ...archiveSettings,
                vaultPath: host.archiveExport.vaultPath,
                vaultConfigDir: host.archiveExport.vaultConfigDir,
              },
              host.archiveDestination(),
            );
            return result.path;
          }
        : undefined,
    );
    options.afterArchive?.();
    return { kind: "archived", exportedPath };
  });
}

async function restoreThread(
  host: ThreadMutationCommandsHost,
  lifecycleMutations: KeyedOperationCoordinator<string>,
  threadId: string,
): Promise<Thread> {
  return lifecycleMutations.run(threadId, async () => {
    const thread = await host.port.restoreThread(threadId);
    return thread;
  });
}

async function deleteThread(
  host: ThreadMutationCommandsHost,
  lifecycleMutations: KeyedOperationCoordinator<string>,
  threadId: string,
): Promise<void> {
  await lifecycleMutations.run(threadId, async () => {
    await host.port.deleteThread(threadId);
  });
}
