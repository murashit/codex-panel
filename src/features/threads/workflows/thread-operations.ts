import type { ArchiveExportSettings } from "../../../domain/threads/archive-markdown";
import { normalizeExplicitThreadName } from "../../../domain/threads/model";
import type { ThreadCatalogEventSink } from "../catalog/thread-catalog";
import { type ArchiveExportDestination, exportArchivedThreadMarkdown } from "./archive-export";
import type { ThreadOperationsTransport } from "./ports";
import type { ThreadNameMutationCoordinator } from "./thread-name-mutation-coordinator";

export interface ThreadOperationsHost {
  transport: ThreadOperationsTransport;
  nameMutations: ThreadNameMutationCoordinator;
  archiveExport: {
    settings(): ArchiveExportSettings;
    enabled(): boolean;
    vaultPath: string;
    vaultConfigDir: string;
  };
  archiveDestination(): ArchiveExportDestination;
  catalog: ThreadCatalogEventSink;
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
      host.catalog.apply({ type: "thread-renamed", threadId, name });
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
          const result = await exportArchivedThreadMarkdown(
            thread,
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
  host.catalog.apply({ type: "thread-archived", threadId });
  return { exportedPath };
}
