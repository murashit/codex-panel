import { normalizeExplicitThreadName, type Thread } from "../../../domain/threads/model";
import { threadDisplayTitle } from "../../../domain/threads/title";
import type { KeyedOperationQueue } from "../../../shared/runtime/keyed-operation-queue";
import { type ArchiveExportDestination, type ArchiveExportSettings, exportArchivedThreadMarkdown } from "./archive-export";
import type { ThreadOperationsTransport } from "./ports";
import type { ThreadOperationEventSink } from "./thread-operation-event";

export interface ThreadOperationsHost {
  transport: ThreadOperationsTransport;
  nameMutations: KeyedOperationQueue<string>;
  archiveExport: {
    settings(): ArchiveExportSettings;
    enabled(): boolean;
    vaultPath: string;
    vaultConfigDir: string;
  };
  archiveDestination(): ArchiveExportDestination;
  operationEvents: ThreadOperationEventSink;
  referenceThreads(): readonly Thread[];
  notice(message: string): void;
}

interface ArchiveThreadOptions {
  saveMarkdown?: boolean;
}

export interface ArchiveThreadResult {
  exportedPath: string | null;
}

interface RenameThreadOptions {
  shouldStart?: () => boolean;
  shouldPublish?: () => boolean;
}

export interface ThreadOperations {
  renameThread(threadId: string, value: string, options?: RenameThreadOptions): Promise<boolean>;
  archiveThread(threadId: string, options?: ArchiveThreadOptions): Promise<ArchiveThreadResult>;
}

export function createThreadOperations(host: ThreadOperationsHost): ThreadOperations {
  return {
    renameThread: (threadId, value, options) => renameThread(host, threadId, value, options),
    archiveThread: (threadId, options) => archiveThread(host, threadId, options),
  };
}

async function renameThread(
  host: ThreadOperationsHost,
  threadId: string,
  value: string,
  options: RenameThreadOptions = {},
): Promise<boolean> {
  const name = normalizeExplicitThreadName(value);
  if (!name) return false;
  return host.nameMutations.run(threadId, async () => {
    if (!(options.shouldStart?.() ?? true)) return false;
    await host.transport.renameThread(threadId, name);
    if (options.shouldPublish?.() ?? true) {
      host.operationEvents.apply({ type: "thread-renamed", threadId, name });
    }
    return true;
  });
}

async function archiveThread(
  host: ThreadOperationsHost,
  threadId: string,
  options: ArchiveThreadOptions = {},
): Promise<ArchiveThreadResult> {
  const shouldExport = options.saveMarkdown ?? host.archiveExport.enabled();
  const exportedPath = await host.transport.archiveThread(
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
  if (exportedPath) {
    host.notice(`Saved archived thread to ${exportedPath}.`);
  }
  host.operationEvents.apply({ type: "thread-archived", threadId });
  return { exportedPath };
}
