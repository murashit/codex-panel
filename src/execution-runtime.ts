import type { App } from "obsidian";

import type { AppServerClient } from "./app-server/connection/client";
import type { AppServerClientAccess, AppServerClientAccessOptions } from "./app-server/connection/client-access";
import type { AppServerExecutionContext } from "./app-server/connection/execution-context";
import { withShortLivedAppServerClient } from "./app-server/connection/short-lived-client";
import { AppServerQueryCache } from "./app-server/query/cache";
import {
  type EphemeralStructuredTurnClient,
  type EphemeralStructuredTurnRunner,
  runEphemeralStructuredTurn,
} from "./app-server/services/ephemeral-structured-turn";
import { createThreadGoalCoordinator } from "./features/chat/application/threads/thread-goal-coordinator";
import type { ChatPanelSettingsAccess, ChatRuntimeView, CodexChatHost, WorkspacePanels } from "./features/chat/host/contracts";
import { createAppServerSelectionRewriteAdapter } from "./features/selection-rewrite/app-server-adapter";
import type { SelectionRewritePort } from "./features/selection-rewrite/port";
import { openThreadPicker, type ThreadPickerController } from "./features/thread-picker/modal.obsidian";
import { createThreadMutationAdapter, createThreadTitleAdapter } from "./features/threads/app-server/workflow-adapters";
import type { ThreadCatalog } from "./features/threads/catalog/thread-catalog";
import { createThreadFactCoordinator, type ThreadFactCoordinator } from "./features/threads/workflows/thread-fact-coordinator";
import type { ThreadFact } from "./features/threads/workflows/thread-facts";
import { projectThreadFacts } from "./features/threads/workflows/thread-projection";
import type { ThreadsViewHost, ThreadsViewSettingsAccess } from "./features/threads-view/session";
import type { ThreadsViewPanelActivity } from "./features/threads-view/state";
import type { ThreadsRuntimeView } from "./features/threads-view/view.obsidian";
import { createSettingsAppServerDynamicData } from "./settings/app-server-dynamic-data";
import type { SettingsDynamicDataAccess } from "./settings/dynamic-data";
import type { CodexPanelSettings } from "./settings/model";
import { StaleExecutionRuntimeError } from "./shared/runtime/execution-runtime-lifetime";
import { createKeyedOperationQueue } from "./shared/runtime/keyed-operation-queue";

export interface CodexExecutionRuntimeOptions {
  app: App;
  context: AppServerExecutionContext;
  settings: () => CodexPanelSettings;
  workspace: WorkspacePanels;
  onThreadFacts(facts: readonly ThreadFact[]): void;
  openNewPanel(): Promise<unknown>;
  openThreadInCurrentView(threadId: string): Promise<void>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  openPanelActivities(): readonly ThreadsViewPanelActivity[];
}

export interface ExecutionRuntimeViews {
  readonly chat: readonly ChatRuntimeView[];
  readonly threads: readonly ThreadsRuntimeView[];
}

export class CodexExecutionRuntime implements AppServerClientAccess {
  private readonly context: Readonly<AppServerExecutionContext>;
  private readonly appServerQueries: AppServerQueryCache;
  private readonly threadCatalog: ThreadCatalog;
  private readonly threadFactCoordinator: ThreadFactCoordinator;
  readonly settingsDynamicData: SettingsDynamicDataAccess;
  private readonly threadNameMutations = createKeyedOperationQueue<string>();
  private readonly threadGoalCoordinator = createThreadGoalCoordinator();
  private readonly runtimeSettingsCommitQueue = createKeyedOperationQueue<string>();
  private readonly shortLivedClients = new Set<AppServerClient>();
  private readonly structuredTurnClients = new Set<EphemeralStructuredTurnClient>();
  private readonly structuredTurnOperations = new Set<AbortController>();
  private activeThreadPicker: ThreadPickerController | null = null;
  private readonly chatViews = new Set<ChatRuntimeView>();
  private readonly threadsViews = new Set<ThreadsRuntimeView>();
  private disposed = false;

  constructor(private readonly options: CodexExecutionRuntimeOptions) {
    this.context = Object.freeze({ ...options.context });
    this.appServerQueries = new AppServerQueryCache(this.context, this);
    this.threadCatalog = this.appServerQueries;
    this.threadFactCoordinator = createThreadFactCoordinator((facts) => {
      this.threadCatalog.applyThreadCatalogChanges(projectThreadFacts(this.threadCatalog, facts));
      options.onThreadFacts(facts);
    });
    this.settingsDynamicData = createSettingsAppServerDynamicData({
      vaultPath: this.context.vaultPath,
      clientAccess: this,
      appServerQueries: this.appServerQueries,
      threadCatalog: this.threadCatalog,
      threadFacts: this.threadFactCoordinator,
    });
  }

  private chatHost(): CodexChatHost {
    this.assertActive();
    return {
      appServerClientAccess: this,
      appServerContext: this.context,
      settings: this.chatSettings(),
      workspace: this.options.workspace,
      appServerQueries: this.appServerQueries,
      threadCatalog: this.threadCatalog,
      threadFactCoordinator: this.threadFactCoordinator,
      threadNameMutations: this.threadNameMutations,
      threadTitlePort: this.threadTitlePort(),
      threadGoalCoordinator: this.threadGoalCoordinator,
      runtimeSettingsCommitQueue: this.runtimeSettingsCommitQueue,
    };
  }

  private threadsHost(): ThreadsViewHost {
    this.assertActive();
    return {
      settings: this.threadsSettings(),
      vaultPath: this.context.vaultPath,
      threadCatalog: this.threadCatalog,
      threadFacts: this.threadFactCoordinator,
      threadNameMutations: this.threadNameMutations,
      threadMutationPort: createThreadMutationAdapter(this),
      threadTitlePort: this.threadTitlePort(),
      openNewPanel: () => this.options.openNewPanel(),
      openThreadInAvailableView: (threadId) => this.options.openThreadInAvailableView(threadId),
      openPanelActivities: () => this.options.openPanelActivities(),
    };
  }

  withClient<T>(operation: (client: AppServerClient) => Promise<T>, options: AppServerClientAccessOptions = {}): Promise<T> {
    return this.runWithAppServerClient(operation, options);
  }

  attachChatView(view: ChatRuntimeView): void {
    this.assertActive();
    if (this.chatViews.has(view)) return;
    this.chatViews.add(view);
    view.attachRuntime(this.chatHost());
    view.activateRuntime();
  }

  detachChatView(view: ChatRuntimeView): void {
    if (!this.chatViews.delete(view)) return;
    view.detachRuntime();
  }

  attachThreadsView(view: ThreadsRuntimeView): void {
    this.assertActive();
    if (this.threadsViews.has(view)) return;
    this.threadsViews.add(view);
    view.attachRuntime(this.threadsHost());
    view.activateRuntime();
  }

  detachThreadsView(view: ThreadsRuntimeView): void {
    if (!this.threadsViews.delete(view)) return;
    view.detachRuntime();
  }

  adoptViews(views: ExecutionRuntimeViews): void {
    this.assertActive();
    for (const view of views.chat) {
      view.attachRuntime(this.chatHost());
      view.activateRuntime();
      this.chatViews.add(view);
    }
    for (const view of views.threads) {
      view.attachRuntime(this.threadsHost());
      view.activateRuntime();
      this.threadsViews.add(view);
    }
  }

  selectionRewritePort(): SelectionRewritePort {
    return createAppServerSelectionRewriteAdapter({
      codexPath: this.context.codexPath,
      cwd: this.context.vaultPath,
      runner: this.structuredTurnRunner(),
    });
  }

  openThreadPicker(): void {
    this.activeThreadPicker?.close();
    const picker = openThreadPicker(
      {
        app: this.options.app,
        threadCatalog: this.threadCatalog,
        openThreadInCurrentView: (threadId) => this.options.openThreadInCurrentView(threadId),
        openThreadInAvailableView: (threadId) => this.options.openThreadInAvailableView(threadId),
      },
      () => {
        if (this.activeThreadPicker === picker) this.activeThreadPicker = null;
      },
    );
    this.activeThreadPicker = picker;
  }

  dispose(): ExecutionRuntimeViews {
    if (this.disposed) return { chat: [], threads: [] };
    this.disposed = true;
    const views: { chat: ChatRuntimeView[]; threads: ThreadsRuntimeView[] } = { chat: [], threads: [] };
    for (const view of this.chatViews) {
      view.detachRuntime();
      views.chat.push(view);
    }
    for (const view of this.threadsViews) {
      view.detachRuntime();
      views.threads.push(view);
    }
    this.chatViews.clear();
    this.threadsViews.clear();
    this.tryCleanup(() => {
      this.activeThreadPicker?.close();
    });
    this.activeThreadPicker = null;
    for (const operation of this.structuredTurnOperations)
      this.tryCleanup(() => {
        operation.abort();
      });
    this.structuredTurnOperations.clear();
    for (const client of this.structuredTurnClients)
      this.tryCleanup(() => {
        client.disconnect();
      });
    this.structuredTurnClients.clear();
    for (const client of this.shortLivedClients)
      this.tryCleanup(() => {
        client.disconnect();
      });
    this.shortLivedClients.clear();
    this.tryCleanup(() => {
      this.appServerQueries.dispose();
    });
    return views;
  }

  private async runWithAppServerClient<T>(
    operation: (client: AppServerClient) => Promise<T>,
    options: AppServerClientAccessOptions = {},
  ): Promise<T> {
    this.assertActive();
    const guardedOperation = (client: AppServerClient): Promise<T> => {
      this.assertActive();
      return operation(client);
    };
    try {
      const result = await withShortLivedAppServerClient(this.context.codexPath, this.context.vaultPath, guardedOperation, options, {
        created: (client) => {
          if (this.disposed) {
            client.disconnect();
            throw new StaleExecutionRuntimeError();
          }
          this.shortLivedClients.add(client);
        },
        disposed: (client) => {
          this.shortLivedClients.delete(client);
        },
      });
      this.assertActive();
      return result;
    } catch (error) {
      if (this.disposed) throw new StaleExecutionRuntimeError();
      throw error;
    }
  }

  private structuredTurnRunner(): EphemeralStructuredTurnRunner {
    return async (options) => {
      this.assertActive();
      const operation = new AbortController();
      const abort = (): void => {
        operation.abort(options.signal?.reason);
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
      this.structuredTurnOperations.add(operation);
      try {
        return await runEphemeralStructuredTurn(
          { ...options, signal: operation.signal },
          {
            clientLifecycle: {
              created: (client) => {
                if (this.disposed) {
                  client.disconnect();
                  throw new StaleExecutionRuntimeError();
                }
                this.structuredTurnClients.add(client);
              },
              disposed: (client) => {
                this.structuredTurnClients.delete(client);
              },
            },
          },
        );
      } finally {
        options.signal?.removeEventListener("abort", abort);
        this.structuredTurnOperations.delete(operation);
      }
    };
  }

  private threadTitlePort() {
    return createThreadTitleAdapter({
      clientAccess: this,
      codexPath: this.context.codexPath,
      vaultPath: this.context.vaultPath,
      threadNamingModel: () => this.options.settings().threadNamingModel,
      threadNamingEffort: () => this.options.settings().threadNamingEffort,
      runner: this.structuredTurnRunner(),
    });
  }

  private assertActive(): void {
    if (this.disposed) throw new StaleExecutionRuntimeError();
  }

  private tryCleanup(operation: () => void): boolean {
    try {
      operation();
      return true;
    } catch {
      return false;
    }
  }

  private chatSettings(): ChatPanelSettingsAccess {
    return {
      referenceActiveNoteOnSend: () => this.options.settings().referenceActiveNoteOnSend,
      attachmentFolder: () => this.options.settings().attachmentFolder,
      archiveExportEnabled: () => this.options.settings().archiveExportEnabled,
      archiveExportSettings: () => ({
        archiveExportFolderTemplate: this.options.settings().archiveExportFolderTemplate,
        archiveExportFilenameTemplate: this.options.settings().archiveExportFilenameTemplate,
        archiveExportTags: this.options.settings().archiveExportTags,
      }),
      scrollThreadFromComposerEdges: () => this.options.settings().scrollThreadFromComposerEdges,
      sendShortcut: () => this.options.settings().sendShortcut,
      showToolbar: () => this.options.settings().showToolbar,
    };
  }

  private threadsSettings(): ThreadsViewSettingsAccess {
    return {
      archiveExportEnabled: () => this.options.settings().archiveExportEnabled,
      archiveExportSettings: () => ({
        archiveExportFolderTemplate: this.options.settings().archiveExportFolderTemplate,
        archiveExportFilenameTemplate: this.options.settings().archiveExportFilenameTemplate,
        archiveExportTags: this.options.settings().archiveExportTags,
      }),
    };
  }
}
