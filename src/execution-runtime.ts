import type { App } from "obsidian";

import type { AppServerClient } from "./app-server/connection/client";
import type { AppServerClientAccess } from "./app-server/connection/client-access";
import { codexPanelAppServerInitializeParams } from "./app-server/connection/client-profile";
import { AppServerContextConnection } from "./app-server/connection/context-connection";
import type { AppServerExecutionContext } from "./app-server/connection/execution-context";
import { AppServerMetadataQueries } from "./app-server/query/metadata-queries";
import { AppServerQueryScope } from "./app-server/query/query-scope";
import { AppServerThreadCatalog } from "./app-server/query/thread-catalog-queries";
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
import { threadFactFromLifecycleNotification } from "./features/threads/app-server/thread-lifecycle-notifications";
import { createThreadMutationAdapter, createThreadTitleAdapter } from "./features/threads/app-server/workflow-adapters";
import type { ThreadCatalog } from "./features/threads/catalog/thread-catalog";
import { createThreadAutoTitleWork, type ThreadAutoTitleWork } from "./features/threads/workflows/thread-auto-title-work";
import type { ThreadFact, ThreadFactSink } from "./features/threads/workflows/thread-facts";
import { createThreadMutationCommands, type ThreadMutationCommands } from "./features/threads/workflows/thread-mutation-commands";
import { projectThreadFacts } from "./features/threads/workflows/thread-projection";
import {
  createThreadReplacementPublication,
  type ThreadReplacementPublicationOwner,
} from "./features/threads/workflows/thread-replacement-publication";
import type { ThreadsViewHost, ThreadsViewSettingsAccess } from "./features/threads-view/session";
import type { ThreadsViewPanelActivity } from "./features/threads-view/state";
import type { ThreadsRuntimeView } from "./features/threads-view/view.obsidian";
import { createSettingsAppServerDynamicData } from "./settings/app-server-dynamic-data";
import type { SettingsDynamicDataAccess } from "./settings/dynamic-data";
import type { CodexPanelSettings } from "./settings/model";
import { createObsidianVaultMarkdownDestination } from "./shared/obsidian/vault-write-destination.obsidian";
import { createKeyedOperationCoordinator } from "./shared/runtime/keyed-operation-coordinator";

export interface CodexExecutionRuntimeOptions {
  app: App;
  context: AppServerExecutionContext;
  settings: () => CodexPanelSettings;
  workspace: ExecutionWorkspaceOperations;
  onThreadFacts(facts: readonly ThreadFact[]): void;
}

interface ExecutionWorkspaceOperations extends WorkspacePanels {
  openNewPanel(): Promise<unknown>;
  openThreadInCurrentView(threadId: string): Promise<void>;
  openPanelActivities(): readonly ThreadsViewPanelActivity[];
}

export class CodexExecutionRuntime implements AppServerClientAccess {
  private readonly context: Readonly<AppServerExecutionContext>;
  readonly appServerConnection: AppServerContextConnection;
  private readonly queryScope: AppServerQueryScope;
  private readonly appServerQueries: AppServerMetadataQueries;
  private readonly threadCatalog: ThreadCatalog;
  private readonly threadFacts: ThreadFactSink;
  private readonly threadReplacementPublication: ThreadReplacementPublicationOwner;
  private readonly threadMutations: ThreadMutationCommands;
  private threadAutoTitleWork: ThreadAutoTitleWork | null = null;
  readonly settingsDynamicData: SettingsDynamicDataAccess;
  private readonly threadGoalCoordinator = createThreadGoalCoordinator();
  private readonly runtimeSettingsCommitQueue = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
  private readonly structuredTurnClients = new Set<EphemeralStructuredTurnClient>();
  private readonly structuredTurnOperations = new Set<AbortController>();
  private activeThreadPicker: ThreadPickerController | null = null;
  private disposed = false;

  constructor(private readonly options: CodexExecutionRuntimeOptions) {
    this.context = Object.freeze({ ...options.context });
    this.appServerConnection = new AppServerContextConnection(
      this.context.codexPath,
      this.context.vaultPath,
      codexPanelAppServerInitializeParams(),
      {
        onNotification: (notification) => {
          const fact = threadFactFromLifecycleNotification(notification);
          if (!fact) return false;
          this.threadFacts.apply(fact);
          return true;
        },
      },
    );
    this.queryScope = new AppServerQueryScope(this.context, this);
    this.appServerQueries = new AppServerMetadataQueries(this.queryScope);
    this.threadCatalog = new AppServerThreadCatalog(this.queryScope);
    const applyThreadFacts = (facts: readonly ThreadFact[]): void => {
      if (this.disposed) return;
      for (const fact of facts) this.threadAutoTitleWork?.applyThreadFact(fact);
      this.threadCatalog.applyThreadCatalogChanges(projectThreadFacts(this.threadCatalog, facts));
      options.onThreadFacts(facts);
    };
    this.threadReplacementPublication = createThreadReplacementPublication(applyThreadFacts);
    this.threadFacts = this.threadReplacementPublication.facts;
    this.threadMutations = createThreadMutationCommands({
      port: createThreadMutationAdapter(this),
      archiveExport: {
        settings: () => this.archiveExportSettings(),
        enabled: () => this.options.settings().archiveExportEnabled,
        vaultPath: this.context.vaultPath,
        vaultConfigDir: this.options.app.vault.configDir,
      },
      archiveDestination: () => createObsidianVaultMarkdownDestination(this.options.app.vault),
      facts: this.threadReplacementPublication.facts,
      referenceThreads: () => this.threadCatalog.activeThreadsSnapshot() ?? [],
      threadIsBusy: (threadId) =>
        this.options.workspace
          .openPanelActivities()
          .some((activity) => activity.threadId === threadId && (activity.pending || activity.running)),
    });
    this.threadAutoTitleWork = createThreadAutoTitleWork({
      titlePort: this.threadTitlePort(),
      mutations: this.threadMutations,
    });
    this.settingsDynamicData = createSettingsAppServerDynamicData({
      vaultPath: this.context.vaultPath,
      clientAccess: this,
      appServerQueries: this.appServerQueries,
      threadCatalog: this.threadCatalog,
      threadMutations: this.threadMutations,
    });
  }

  private chatHost(): CodexChatHost {
    this.assertActive();
    return {
      appServerConnection: this.appServerConnection,
      appServerContext: this.context,
      settings: this.chatSettings(),
      workspace: this.options.workspace,
      appServerQueries: this.appServerQueries,
      threadCatalog: this.threadCatalog,
      threadFacts: this.threadFacts,
      threadReplacementPublication: this.threadReplacementPublication,
      threadMutations: this.threadMutations,
      threadTitlePort: this.threadTitlePort(),
      threadAutoTitleWork: this.currentThreadAutoTitleWork(),
      threadGoalCoordinator: this.threadGoalCoordinator,
      runtimeSettingsCommitQueue: this.runtimeSettingsCommitQueue,
    };
  }

  private threadsHost(): ThreadsViewHost {
    this.assertActive();
    return {
      settings: this.threadsSettings(),
      threadCatalog: this.threadCatalog,
      threadMutations: this.threadMutations,
      threadTitlePort: this.threadTitlePort(),
      openNewPanel: () => this.options.workspace.openNewPanel(),
      openThreadInAvailableView: (threadId) => this.options.workspace.openThreadInAvailableView(threadId),
      openPanelActivities: () => this.options.workspace.openPanelActivities(),
    };
  }

  withClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    this.assertActive();
    return this.appServerConnection.withClient(async (client) => {
      this.assertActive();
      return operation(client);
    });
  }

  attachChatView(view: ChatRuntimeView): void {
    this.assertActive();
    view.attachRuntime(this.chatHost());
  }

  attachThreadsView(view: ThreadsRuntimeView): void {
    this.assertActive();
    view.attachRuntime(this.threadsHost());
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
        openThreadInCurrentView: (threadId) => this.options.workspace.openThreadInCurrentView(threadId),
        openThreadInAvailableView: (threadId) => this.options.workspace.openThreadInAvailableView(threadId),
      },
      () => {
        if (this.activeThreadPicker === picker) this.activeThreadPicker = null;
      },
    );
    this.activeThreadPicker = picker;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.threadAutoTitleWork?.dispose();
    this.threadAutoTitleWork = null;
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
    this.tryCleanup(() => {
      this.appServerConnection.dispose();
    });
    this.tryCleanup(() => {
      this.queryScope.dispose();
    });
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
                  throw new Error("Codex execution runtime is no longer active.");
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

  private currentThreadAutoTitleWork(): ThreadAutoTitleWork {
    this.assertActive();
    if (!this.threadAutoTitleWork) throw new Error("Codex execution runtime is no longer active.");
    return this.threadAutoTitleWork;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Codex execution runtime is no longer active.");
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
      scrollThreadFromComposerEdges: () => this.options.settings().scrollThreadFromComposerEdges,
      sendShortcut: () => this.options.settings().sendShortcut,
      showToolbar: () => this.options.settings().showToolbar,
    };
  }

  private threadsSettings(): ThreadsViewSettingsAccess {
    return {
      archiveExportEnabled: () => this.options.settings().archiveExportEnabled,
    };
  }

  private archiveExportSettings() {
    const settings = this.options.settings();
    return {
      archiveExportFolderTemplate: settings.archiveExportFolderTemplate,
      archiveExportFilenameTemplate: settings.archiveExportFilenameTemplate,
      archiveExportTags: settings.archiveExportTags,
    };
  }
}
