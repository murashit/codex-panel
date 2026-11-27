import { normalizeExplicitThreadName } from "../../../domain/threads/model";
import type { ThreadTranscript } from "../../../domain/threads/transcript";
import { createKeyedOperationCoordinator } from "../../../shared/async/keyed-operation-coordinator";
import { type ArchiveExportDestination, type ArchiveExportSettings, exportArchivedThreadMarkdown } from "./archive-export";
import type { ArchiveThreadResult, ThreadMutationPort } from "./ports";

export interface ThreadMutationCommandsHost {
  port: ThreadMutationPort;
  archiveExport: {
    settings(): ArchiveExportSettings;
    enabled(): boolean;
    vaultPath: string;
    vaultConfigDir: string;
  };
  archiveDestination(): ArchiveExportDestination;
  threadIsBusy(threadId: string): boolean;
  archiveActivityChanged: () => void;
}

interface ArchiveThreadOptions {
  saveMarkdown?: boolean;
  afterArchive?: () => void;
}

interface RenameThreadOptions {
  shouldStart?: () => boolean;
}

export interface ThreadMutationCommands extends Pick<ThreadMutationPort, "setThreadPinned" | "restoreThread" | "deleteThread"> {
  renameThread: (threadId: string, value: string, options?: RenameThreadOptions) => Promise<boolean>;
  archiveThread(threadId: string, options?: ArchiveThreadOptions): Promise<ArchiveThreadResult>;
}

export function createThreadMutationCommands(
  host: ThreadMutationCommandsHost,
): ThreadMutationCommands & { readonly archivingThreadIds: ReadonlySet<string> } {
  const nameMutations = createKeyedOperationCoordinator<string>();
  const archivingThreadIds = new Set<string>();
  return {
    ...host.port,
    archivingThreadIds,
    async renameThread(threadId, value, options = {}) {
      const name = normalizeExplicitThreadName(value);
      if (!name) return false;
      return nameMutations.run(threadId, async () => {
        if (options.shouldStart && !options.shouldStart()) return false;
        await host.port.renameThread(threadId, name);
        return true;
      });
    },
    async archiveThread(threadId, options = {}) {
      if (archivingThreadIds.has(threadId)) throw new Error("An operation is already in progress.");
      const canArchive = () => !host.threadIsBusy(threadId);
      if (!canArchive()) return { kind: "blocked", reason: "thread-busy", exportedPath: null };
      archivingThreadIds.add(threadId);
      queueMicrotask(host.archiveActivityChanged);
      try {
        const saveMarkdown = options.saveMarkdown ?? host.archiveExport.enabled();
        const result = await host.port.archiveThread(threadId, {
          canArchive,
          prepare: saveMarkdown ? (thread) => saveArchiveMarkdown(host, thread) : undefined,
        });
        if (result.kind === "archived") options.afterArchive?.();
        return result;
      } finally {
        archivingThreadIds.delete(threadId);
        queueMicrotask(host.archiveActivityChanged);
      }
    },
  };
}

async function saveArchiveMarkdown(host: ThreadMutationCommandsHost, thread: ThreadTranscript): Promise<string> {
  const { path } = await exportArchivedThreadMarkdown(
    thread,
    { ...host.archiveExport.settings(), vaultPath: host.archiveExport.vaultPath, vaultConfigDir: host.archiveExport.vaultConfigDir },
    host.archiveDestination(),
  );
  return path;
}
