import { normalizeExplicitThreadName, type Thread } from "../../../domain/threads/model";
import { threadDisplayTitle } from "../../../domain/threads/title";
import type { KeyedOperationQueue } from "../../../shared/runtime/keyed-operation-queue";
import { type ArchiveExportDestination, type ArchiveExportSettings, exportArchivedThreadMarkdown } from "./archive-export";
import type { ThreadMutationPort } from "./ports";
import type { ThreadFact, ThreadFactSink } from "./thread-facts";

export interface ThreadMutationCommandsHost {
  port: ThreadMutationPort;
  nameMutations: KeyedOperationQueue<string>;
  archiveExport: {
    settings(): ArchiveExportSettings;
    enabled(): boolean;
    vaultPath: string;
    vaultConfigDir: string;
  };
  archiveDestination(): ArchiveExportDestination;
  facts: ThreadFactSink;
  referenceThreads(): readonly Thread[];
  notice(message: string): void;
}

interface ArchiveThreadOptions {
  saveMarkdown?: boolean;
  beforePublish?: () => void;
  additionalFacts?: readonly ThreadFact[];
}

export interface ArchiveThreadResult {
  exportedPath: string | null;
}

interface RenameThreadOptions {
  shouldStart?: () => boolean;
  shouldPublish?: () => boolean;
}

export interface ThreadMutationCommands {
  renameThread(threadId: string, value: string, options?: RenameThreadOptions): Promise<boolean>;
  archiveThread(threadId: string, options?: ArchiveThreadOptions): Promise<ArchiveThreadResult>;
}

export function createThreadMutationCommands(host: ThreadMutationCommandsHost): ThreadMutationCommands {
  return {
    renameThread: (threadId, value, options) => renameThread(host, threadId, value, options),
    archiveThread: (threadId, options) => archiveThread(host, threadId, options),
  };
}

async function renameThread(
  host: ThreadMutationCommandsHost,
  threadId: string,
  value: string,
  options: RenameThreadOptions = {},
): Promise<boolean> {
  const name = normalizeExplicitThreadName(value);
  if (!name) return false;
  return host.nameMutations.run(threadId, async () => {
    if (!(options.shouldStart?.() ?? true)) return false;
    await host.port.renameThread(threadId, name);
    if (options.shouldPublish?.() ?? true) {
      host.facts.apply({ type: "thread-renamed", threadId, name });
    }
    return true;
  });
}

async function archiveThread(
  host: ThreadMutationCommandsHost,
  threadId: string,
  options: ArchiveThreadOptions = {},
): Promise<ArchiveThreadResult> {
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
  if (exportedPath) {
    host.notice(`Saved archived thread to ${exportedPath}.`);
  }
  options.beforePublish?.();
  host.facts.applyBatch([...(options.additionalFacts ?? []), { type: "thread-archived", threadId }]);
  return { exportedPath };
}
