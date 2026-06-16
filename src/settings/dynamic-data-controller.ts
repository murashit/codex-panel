import type { AppServerClient } from "../app-server/connection/client";
import type { AppServerObservedQueryResult } from "../app-server/query/cache";
import { isStaleAppServerSharedQueryContextError } from "../app-server/query/shared-queries";
import { withShortLivedAppServerClient } from "../app-server/connection/short-lived-client";
import { setHookItemEnabled, trustHookItem } from "../app-server/catalog/data";
import {
  deleteArchivedThread as deleteArchivedThreadOnAppServer,
  restoreArchivedThread as restoreArchivedThreadOnAppServer,
} from "../app-server/threads/data";
import type { AppServerSharedQueries } from "../app-server/query/shared-queries";
import type { HookItem, ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import { errorMessage } from "../utils";
import type { SharedThreadCatalog } from "../workspace/shared-thread-catalog";
import { archivedThreadDisplayTitle } from "./archived-thread-title";
import { loadHookData, loadSettingsCompanionData } from "./app-server-data";
import {
  createSettingsDynamicSectionLifecycle,
  transitionSettingsDataRefreshLifecycle,
  transitionSettingsDynamicSectionLifecycle,
  type SettingsDataRefreshLifecycleState,
  type SettingsDynamicSectionLifecycleState,
} from "./lifecycle";
import type { CodexPanelSettings } from "./model";

export interface SettingsDynamicDataHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  appServerData: SettingsAppServerData;
  threadCatalog: SettingsThreadCatalog;
}

type SettingsAppServerData = Pick<
  AppServerSharedQueries,
  "modelsSnapshot" | "observeModelsResult" | "fetchModels" | "refreshModels" | "notifyContextChanged"
>;

type SettingsThreadCatalog = Pick<SharedThreadCatalog, "refreshActiveThreads">;

function archivedThreadTitleForStatus(thread: Thread | undefined, threadId: string): string {
  return thread ? archivedThreadDisplayTitle(thread) : threadId;
}

interface SettingsDynamicDataControllerCallbacks {
  display(): void;
  notify(message: string): void;
}

export interface SettingsDynamicDataSnapshot {
  archivedThreads: readonly Thread[];
  archivedThreadsLifecycle: SettingsDynamicSectionLifecycleState;
  hooks: readonly HookItem[];
  hookWarnings: readonly string[];
  hookErrors: readonly string[];
  hooksLifecycle: SettingsDynamicSectionLifecycleState;
  models: readonly ModelMetadata[];
  modelsLifecycle: SettingsDynamicSectionLifecycleState;
}

export class SettingsDynamicDataController {
  private settingsDataAutoLoadStarted = false;
  private settingsRefreshOperationId = 0;
  private modelsOperationId = 0;
  private hooksOperationId = 0;
  private archivedThreadsOperationId = 0;
  private settingsDataRefreshLifecycle: SettingsDataRefreshLifecycleState = { kind: "idle" };

  private archivedThreads: Thread[] = [];
  private archivedThreadsLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();
  private hooks: HookItem[] = [];
  private hookWarnings: string[] = [];
  private hookErrors: string[] = [];
  private hooksLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();
  private models: ModelMetadata[] = [];
  private modelsLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();
  private unsubscribeModels: (() => void) | null = null;

  constructor(
    private readonly host: SettingsDynamicDataHost,
    private readonly callbacks: SettingsDynamicDataControllerCallbacks,
  ) {
    this.activate();
  }

  activate(): void {
    if (this.unsubscribeModels) return;
    this.models = [...(this.host.appServerData.modelsSnapshot() ?? [])];
    this.unsubscribeModels = this.host.appServerData.observeModelsResult(
      (result) => {
        this.receiveObservedModelsResult(result);
      },
      { emitCurrent: false },
    );
  }

  maybeAutoLoadSettingsData(): void {
    if (this.settingsDataAutoLoadStarted || this.settingsDataLoading()) return;
    this.settingsDataAutoLoadStarted = true;
    void this.refreshSettingsData({ forceModels: false });
  }

  resetSettingsDataContext(): void {
    this.settingsDataAutoLoadStarted = false;
    this.settingsRefreshOperationId += 1;
    this.modelsOperationId += 1;
    this.hooksOperationId += 1;
    this.archivedThreadsOperationId += 1;
    this.settingsDataRefreshLifecycle = { kind: "idle" };
    this.models = [...(this.host.appServerData.modelsSnapshot() ?? [])];
    this.modelsLifecycle = createSettingsDynamicSectionLifecycle();
    this.hooks = [];
    this.hookWarnings = [];
    this.hookErrors = [];
    this.hooksLifecycle = createSettingsDynamicSectionLifecycle();
    this.archivedThreads = [];
    this.archivedThreadsLifecycle = createSettingsDynamicSectionLifecycle();
  }

  dispose(): void {
    this.unsubscribeModels?.();
    this.unsubscribeModels = null;
  }

  private receiveObservedModelsResult(result: AppServerObservedQueryResult<readonly ModelMetadata[]>): void {
    if (!result.data) return;
    this.models = [...result.data];
    this.callbacks.display();
  }

  async refreshSettingsData(options: { forceModels?: boolean } = {}): Promise<void> {
    this.settingsDataAutoLoadStarted = true;
    const operationId = this.nextSettingsRefreshOperationId();
    const modelsOperationId = this.nextModelsOperationId();
    const hooksOperationId = this.nextHooksOperationId();
    const archivedThreadsOperationId = this.nextArchivedThreadsOperationId();
    this.settingsDataRefreshLifecycle = transitionSettingsDataRefreshLifecycle(this.settingsDataRefreshLifecycle, {
      type: "started",
      operationId,
    });
    this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
      type: "started",
      status: "Loading models...",
      operationId: modelsOperationId,
    });
    this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
      type: "started",
      status: "Loading archived threads...",
      operationId: archivedThreadsOperationId,
    });
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId: hooksOperationId,
    });
    this.callbacks.display();

    let failedCount = 0;
    try {
      const [modelsResult, companionResult] = await Promise.allSettled([
        options.forceModels === false ? this.host.appServerData.fetchModels() : this.host.appServerData.refreshModels(),
        this.withSettingsConnection((client) => loadSettingsCompanionData(client, this.host.vaultPath)),
      ] as const);
      if (this.isStaleSettingsRefreshOperation(operationId)) return;

      if (this.isStaleModelsOperation(modelsOperationId)) {
        // A newer models operation owns this section.
      } else if (modelsResult.status === "fulfilled") {
        this.models = [...modelsResult.value];
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "loaded",
          status: `Loaded ${String(modelsResult.value.length)} model${modelsResult.value.length === 1 ? "" : "s"}.`,
          operationId: modelsOperationId,
        });
      } else if (isStaleAppServerSharedQueryContextError(modelsResult.reason)) {
        return;
      } else {
        failedCount += 1;
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "failed",
          status: `Could not load models: ${errorMessage(modelsResult.reason)}`,
          operationId: modelsOperationId,
        });
      }

      const companion =
        companionResult.status === "fulfilled"
          ? companionResult.value
          : {
              hooks: { ok: false as const, status: `Could not load hooks: ${errorMessage(companionResult.reason)}` },
              archivedThreads: { ok: false as const, status: `Could not load archived threads: ${errorMessage(companionResult.reason)}` },
            };

      if (this.isStaleHooksOperation(hooksOperationId)) {
        // A newer hooks operation owns this section.
      } else if (companion.hooks.ok) {
        this.hooks = companion.hooks.data.hooks;
        this.hookWarnings = companion.hooks.data.warnings;
        this.hookErrors = companion.hooks.data.errors;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "loaded",
          status: companion.hooks.status,
          operationId: hooksOperationId,
        });
      } else {
        failedCount += 1;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "failed",
          status: companion.hooks.status,
          operationId: hooksOperationId,
        });
      }

      if (this.isStaleArchivedThreadsOperation(archivedThreadsOperationId)) {
        // A newer archived threads operation owns this section.
      } else if (companion.archivedThreads.ok) {
        this.archivedThreads = companion.archivedThreads.data;
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "loaded",
          status: companion.archivedThreads.status,
          operationId: archivedThreadsOperationId,
        });
      } else {
        failedCount += 1;
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "failed",
          status: companion.archivedThreads.status,
          operationId: archivedThreadsOperationId,
        });
      }
    } catch (error) {
      if (this.isStaleSettingsRefreshOperation(operationId)) return;
      failedCount = 3;
      const message = errorMessage(error);
      if (!this.isStaleModelsOperation(modelsOperationId)) {
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "failed",
          status: `Could not load models: ${message}`,
          operationId: modelsOperationId,
        });
      }
      if (!this.isStaleHooksOperation(hooksOperationId)) {
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "failed",
          status: `Could not load hooks: ${message}`,
          operationId: hooksOperationId,
        });
      }
      if (!this.isStaleArchivedThreadsOperation(archivedThreadsOperationId)) {
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "failed",
          status: `Could not load archived threads: ${message}`,
          operationId: archivedThreadsOperationId,
        });
      }
    } finally {
      const staleOperation = this.isStaleSettingsRefreshOperation(operationId);
      this.settingsDataRefreshLifecycle = transitionSettingsDataRefreshLifecycle(this.settingsDataRefreshLifecycle, {
        type: "completed",
        failedCount,
        operationId,
      });
      if (!staleOperation) {
        if (failedCount > 0) {
          this.callbacks.notify("Could not refresh all Codex data.");
        }
        this.callbacks.display();
      }
    }
  }

  settingsDataLoading(): boolean {
    return this.settingsDataRefreshLifecycle.kind === "loading";
  }

  snapshot(): SettingsDynamicDataSnapshot {
    return {
      archivedThreads: [...this.archivedThreads],
      archivedThreadsLifecycle: { ...this.archivedThreadsLifecycle },
      hooks: [...this.hooks],
      hookWarnings: [...this.hookWarnings],
      hookErrors: [...this.hookErrors],
      hooksLifecycle: { ...this.hooksLifecycle },
      models: [...this.models],
      modelsLifecycle: { ...this.modelsLifecycle },
    };
  }

  async trustHook(hook: HookItem): Promise<void> {
    const operationId = this.nextHooksOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.callbacks.display();
    try {
      await this.withSettingsConnection((client) => trustHookItem(client, hook));
      if (this.isStaleHooksOperation(operationId)) return;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: "Trusted hook definition.",
        operationId,
      });
      await this.loadHooks();
    } catch (error) {
      if (this.isStaleHooksOperation(operationId)) return;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not trust hook: ${errorMessage(error)}`,
        operationId,
      });
      this.callbacks.notify("Could not trust Codex hook.");
      this.callbacks.display();
    }
  }

  async setHookEnabled(hook: HookItem, enabled: boolean): Promise<void> {
    const operationId = this.nextHooksOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.callbacks.display();
    try {
      await this.withSettingsConnection((client) => setHookItemEnabled(client, hook, enabled));
      if (this.isStaleHooksOperation(operationId)) return;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: enabled ? "Enabled hook." : "Disabled hook.",
        operationId,
      });
      await this.loadHooks();
    } catch (error) {
      if (this.isStaleHooksOperation(operationId)) return;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not update hook: ${errorMessage(error)}`,
        operationId,
      });
      this.callbacks.notify("Could not update Codex hook.");
      this.callbacks.display();
    }
  }

  async restoreArchivedThread(threadId: string): Promise<void> {
    const operationId = this.nextArchivedThreadsOperationId();
    this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
      type: "started",
      status: "Loading archived threads...",
      operationId,
    });
    this.callbacks.display();
    try {
      const restoredThread = await this.withSettingsConnection((client) => restoreArchivedThreadOnAppServer(client, threadId));
      if (this.isStaleArchivedThreadsOperation(operationId)) return;
      this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "loaded",
        status: `Restored "${archivedThreadDisplayTitle(restoredThread)}".`,
        operationId,
      });
      this.callbacks.display();
      try {
        await this.host.threadCatalog.refreshActiveThreads();
      } catch (error) {
        if (!this.isStaleArchivedThreadsOperation(operationId) && !isStaleAppServerSharedQueryContextError(error)) {
          this.callbacks.notify("Could not refresh active Codex threads.");
        }
      }
    } catch (error) {
      if (this.isStaleArchivedThreadsOperation(operationId)) return;
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "failed",
        status: `Could not restore archived thread: ${errorMessage(error)}`,
        operationId,
      });
      this.callbacks.notify("Could not restore archived Codex thread.");
    } finally {
      if (!this.isStaleArchivedThreadsOperation(operationId)) this.callbacks.display();
    }
  }

  async deleteArchivedThread(threadId: string): Promise<void> {
    const operationId = this.nextArchivedThreadsOperationId();
    const title = archivedThreadTitleForStatus(
      this.archivedThreads.find((thread) => thread.id === threadId),
      threadId,
    );
    this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
      type: "started",
      status: "Loading archived threads...",
      operationId,
    });
    this.callbacks.display();
    try {
      await this.withSettingsConnection((client) => deleteArchivedThreadOnAppServer(client, threadId));
      if (this.isStaleArchivedThreadsOperation(operationId)) return;
      this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "loaded",
        status: `Deleted "${title}".`,
        operationId,
      });
    } catch (error) {
      if (this.isStaleArchivedThreadsOperation(operationId)) return;
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "failed",
        status: `Could not delete archived thread: ${errorMessage(error)}`,
        operationId,
      });
      this.callbacks.notify("Could not delete archived Codex thread.");
    } finally {
      if (!this.isStaleArchivedThreadsOperation(operationId)) this.callbacks.display();
    }
  }

  modelMetadata(): ModelMetadata[] {
    return sortedModelMetadata(this.models);
  }

  effortOptions(modelIdOrName: string | null): ReasoningEffort[] {
    const model = this.selectedModel(modelIdOrName);
    return model ? supportedEffortsForModelMetadata(model) : [];
  }

  namingEffortSupported(effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(this.host.settings.threadNamingModel).includes(effort);
  }

  rewriteSelectionEffortSupported(effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(this.host.settings.rewriteSelectionModel).includes(effort);
  }

  private async loadHooks(): Promise<void> {
    const operationId = this.nextHooksOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.callbacks.display();
    try {
      const hooks = await this.withSettingsConnection((client) => loadHookData(client, this.host.vaultPath));
      if (this.isStaleHooksOperation(operationId)) return;
      this.hooks = hooks.hooks;
      this.hookWarnings = hooks.warnings;
      this.hookErrors = hooks.errors;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: hooks.status,
        operationId,
      });
    } catch (error) {
      if (this.isStaleHooksOperation(operationId)) return;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not load hooks: ${errorMessage(error)}`,
        operationId,
      });
      this.callbacks.notify("Could not load Codex hooks.");
    } finally {
      if (!this.isStaleHooksOperation(operationId)) this.callbacks.display();
    }
  }

  private async withSettingsConnection<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    return withShortLivedAppServerClient(this.host.settings.codexPath, this.host.vaultPath, operation, {
      unhandledServerRequestMessage: "Codex Panel settings does not handle server requests.",
    });
  }

  private nextSettingsRefreshOperationId(): number {
    this.settingsRefreshOperationId += 1;
    return this.settingsRefreshOperationId;
  }

  private nextModelsOperationId(): number {
    this.modelsOperationId += 1;
    return this.modelsOperationId;
  }

  private nextHooksOperationId(): number {
    this.hooksOperationId += 1;
    return this.hooksOperationId;
  }

  private nextArchivedThreadsOperationId(): number {
    this.archivedThreadsOperationId += 1;
    return this.archivedThreadsOperationId;
  }

  private isStaleSettingsRefreshOperation(operationId: number): boolean {
    return operationId !== this.settingsRefreshOperationId;
  }

  private isStaleModelsOperation(operationId: number): boolean {
    return operationId !== this.modelsOperationId;
  }

  private isStaleHooksOperation(operationId: number): boolean {
    return operationId !== this.hooksOperationId;
  }

  private isStaleArchivedThreadsOperation(operationId: number): boolean {
    return operationId !== this.archivedThreadsOperationId;
  }

  private selectedModel(modelIdOrName: string | null): ModelMetadata | null {
    return findModelMetadataByIdOrName(this.models, modelIdOrName);
  }
}
