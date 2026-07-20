import type { App } from "obsidian";

import type { AppServerClient } from "./app-server/connection/client";
import type { AppServerClientAccess, AppServerClientAccessOptions } from "./app-server/connection/client-access";
import { withShortLivedAppServerClient } from "./app-server/connection/short-lived-client";
import type { AppServerQueryContext } from "./app-server/query/keys";
import { AppServerResourceStore, StaleAppServerResourceContextError } from "./app-server/query/resource-store";
import {
  type EphemeralStructuredTurnClient,
  type EphemeralStructuredTurnRunner,
  runEphemeralStructuredTurn,
} from "./app-server/services/ephemeral-structured-turn";
import { createThreadGoalOperationCoordinator } from "./features/chat/application/threads/goal-actions";
import type { ChatPanelSettingsAccess, ChatRuntimeView, CodexChatHost, WorkspacePanels } from "./features/chat/host/contracts";
import { createAppServerSelectionRewriteTransport } from "./features/selection-rewrite/app-server-transport";
import type { SelectionRewriteTransport } from "./features/selection-rewrite/transport";
import { openThreadPicker, type ThreadPickerController } from "./features/thread-picker/modal.obsidian";
import { createThreadOperationsTransport, createThreadTitleTransport } from "./features/threads/app-server/workflow-transports";
import { createThreadCatalog, type ThreadCatalog, type ThreadCatalogEvent } from "./features/threads/catalog/thread-catalog";
import { createThreadNameMutationCoordinator } from "./features/threads/workflows/thread-name-mutation-coordinator";
import type { ThreadsViewHost, ThreadsViewSettingsAccess } from "./features/threads-view/session";
import type { ThreadsViewPanelActivity } from "./features/threads-view/state";
import type { ThreadsRuntimeView } from "./features/threads-view/view.obsidian";
import { createSettingsAppServerDynamicData } from "./settings/app-server-dynamic-data";
import type { SettingsDynamicDataAccess } from "./settings/dynamic-data";
import type { CodexPanelSettings } from "./settings/model";
import { createKeyedOperationQueue } from "./shared/runtime/keyed-operation-queue";

export interface CodexExecutionRuntimeOptions {
  app: App;
  context: AppServerQueryContext;
  settings: () => CodexPanelSettings;
  workspace: WorkspacePanels;
  onThreadCatalogEvent(event: ThreadCatalogEvent): void;
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
  readonly context: Readonly<AppServerQueryContext>;
  readonly resourceStore: AppServerResourceStore;
  readonly threadCatalog: ThreadCatalog;
  readonly settingsDynamicData: SettingsDynamicDataAccess;
  private readonly threadNameMutations = createThreadNameMutationCoordinator();
  private readonly threadGoalOperations = createThreadGoalOperationCoordinator();
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
    this.resourceStore = new AppServerResourceStore({
      context: this.context,
      clientRunner: {
        runWithClient: (operation, clientOptions) => this.runWithAppServerClient(operation, clientOptions),
      },
    });
    this.threadCatalog = createThreadCatalog({
      store: this.resourceStore,
      onEventApplied: (event) => {
        options.onThreadCatalogEvent(event);
      },
    });
    this.settingsDynamicData = createSettingsAppServerDynamicData({
      vaultPath: this.context.vaultPath,
      clientAccess: this,
      appServerQueries: this.resourceStore,
      threadCatalog: this.threadCatalog,
    });
  }

  chatHost(): CodexChatHost {
    this.assertActive();
    return {
      appServerClientAccess: this,
      appServerContext: this.context,
      settingsRef: {
        settings: this.chatSettings(),
        vaultPath: this.context.vaultPath,
      },
      workspace: this.options.workspace,
      appServerQueries: this.resourceStore,
      threadCatalog: this.threadCatalog,
      threadNameMutations: this.threadNameMutations,
      threadTitleTransport: this.threadTitleTransport(),
      threadGoalOperations: this.threadGoalOperations,
      runtimeSettingsCommitQueue: this.runtimeSettingsCommitQueue,
    };
  }

  threadsHost(): ThreadsViewHost {
    this.assertActive();
    return {
      settings: this.threadsSettings(),
      vaultPath: this.context.vaultPath,
      threadCatalog: this.threadCatalog,
      threadNameMutations: this.threadNameMutations,
      threadOperationsTransport: createThreadOperationsTransport(this),
      threadTitleTransport: this.threadTitleTransport(),
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
      if (
        this.tryCleanup(() => {
          view.attachRuntime(this.chatHost());
        })
      )
        this.chatViews.add(view);
      else
        this.tryCleanup(() => {
          view.detachRuntime();
        });
    }
    for (const view of views.threads) {
      if (
        this.tryCleanup(() => {
          view.attachRuntime(this.threadsHost());
        })
      )
        this.threadsViews.add(view);
      else
        this.tryCleanup(() => {
          view.detachRuntime();
        });
    }
    for (const view of [...this.chatViews]) {
      if (
        this.tryCleanup(() => {
          view.activateRuntime();
        })
      )
        continue;
      this.chatViews.delete(view);
      this.tryCleanup(() => {
        view.detachRuntime();
      });
    }
    for (const view of [...this.threadsViews]) {
      if (
        this.tryCleanup(() => {
          view.activateRuntime();
        })
      )
        continue;
      this.threadsViews.delete(view);
      this.tryCleanup(() => {
        view.detachRuntime();
      });
    }
  }

  selectionRewriteTransport(): SelectionRewriteTransport {
    return createAppServerSelectionRewriteTransport({
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
      if (
        this.tryCleanup(() => {
          view.detachRuntime();
        })
      )
        views.chat.push(view);
    }
    for (const view of this.threadsViews) {
      if (
        this.tryCleanup(() => {
          view.detachRuntime();
        })
      )
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
      this.resourceStore.dispose();
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
    const result = await withShortLivedAppServerClient(this.context.codexPath, this.context.vaultPath, guardedOperation, options, {
      created: (client) => {
        if (this.disposed) {
          client.disconnect();
          throw new StaleAppServerResourceContextError();
        }
        this.shortLivedClients.add(client);
      },
      disposed: (client) => {
        this.shortLivedClients.delete(client);
      },
    });
    this.assertActive();
    return result;
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
                  throw new StaleAppServerResourceContextError();
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

  private threadTitleTransport() {
    return createThreadTitleTransport({
      clientAccess: this,
      codexPath: this.context.codexPath,
      vaultPath: this.context.vaultPath,
      threadNamingModel: () => this.options.settings().threadNamingModel,
      threadNamingEffort: () => this.options.settings().threadNamingEffort,
      runner: this.structuredTurnRunner(),
    });
  }

  private assertActive(): void {
    if (this.disposed) throw new StaleAppServerResourceContextError();
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
      codexPath: () => this.context.codexPath,
      scrollThreadFromComposerEdges: () => this.options.settings().scrollThreadFromComposerEdges,
      sendShortcut: () => this.options.settings().sendShortcut,
      showToolbar: () => this.options.settings().showToolbar,
      threadNamingEffort: () => this.options.settings().threadNamingEffort,
      threadNamingModel: () => this.options.settings().threadNamingModel,
    };
  }

  private threadsSettings(): ThreadsViewSettingsAccess {
    return {
      archiveExportEnabled: () => this.options.settings().archiveExportEnabled,
      codexPath: () => this.context.codexPath,
      threadNamingModel: () => this.options.settings().threadNamingModel,
      threadNamingEffort: () => this.options.settings().threadNamingEffort,
      archiveExportSettings: () => ({
        archiveExportFolderTemplate: this.options.settings().archiveExportFolderTemplate,
        archiveExportFilenameTemplate: this.options.settings().archiveExportFilenameTemplate,
        archiveExportTags: this.options.settings().archiveExportTags,
      }),
    };
  }
}
