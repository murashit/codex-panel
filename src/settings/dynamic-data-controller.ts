import type { AppServerClient } from "../app-server/connection/client";
import { withShortLivedAppServerClient } from "../app-server/connection/short-lived-client";
import { setHookItemEnabled, trustHookItem } from "../app-server/services/catalog";
import { restoreArchivedThread as restoreArchivedThreadOnAppServer } from "../app-server/services/threads";
import type { HookItem, ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import { errorMessage } from "../utils";
import type { SharedThreadCatalog } from "../workspace/shared-thread-catalog";
import { archivedThreadDisplayTitle } from "./archived-thread-title";
import { loadHookData, loadSettingsData } from "./app-server-data";
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
  threadCatalog: SettingsThreadCatalog;
}

export type SettingsThreadCatalog = Pick<SharedThreadCatalog, "refreshFromOpenSurface" | "cachedModels" | "publishModels">;

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
  private settingsDynamicOperationId = 0;
  private settingsDataRefreshLifecycle: SettingsDataRefreshLifecycleState = { kind: "idle" };

  private archivedThreads: Thread[] = [];
  private archivedThreadsLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();
  private hooks: HookItem[] = [];
  private hookWarnings: string[] = [];
  private hookErrors: string[] = [];
  private hooksLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();
  private models: ModelMetadata[] = [];
  private modelsLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();

  constructor(
    private readonly host: SettingsDynamicDataHost,
    private readonly callbacks: SettingsDynamicDataControllerCallbacks,
  ) {
    this.models = [...(host.threadCatalog.cachedModels() ?? [])];
  }

  maybeAutoLoadSettingsData(): void {
    if (this.settingsDataAutoLoadStarted || this.settingsDataLoading()) return;
    this.settingsDataAutoLoadStarted = true;
    void this.refreshSettingsData();
  }

  resetSettingsDataContext(): void {
    this.settingsDataAutoLoadStarted = false;
    this.settingsDynamicOperationId += 1;
    this.settingsDataRefreshLifecycle = { kind: "idle" };
    this.models = [...(this.host.threadCatalog.cachedModels() ?? [])];
    this.modelsLifecycle = createSettingsDynamicSectionLifecycle();
    this.hooks = [];
    this.hookWarnings = [];
    this.hookErrors = [];
    this.hooksLifecycle = createSettingsDynamicSectionLifecycle();
    this.archivedThreads = [];
    this.archivedThreadsLifecycle = createSettingsDynamicSectionLifecycle();
  }

  async refreshSettingsData(): Promise<void> {
    this.settingsDataAutoLoadStarted = true;
    const operationId = this.nextSettingsDynamicOperationId();
    this.settingsDataRefreshLifecycle = transitionSettingsDataRefreshLifecycle(this.settingsDataRefreshLifecycle, {
      type: "started",
      operationId,
    });
    this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
      type: "started",
      status: "Loading models...",
      operationId,
    });
    this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
      type: "started",
      status: "Loading archived threads...",
      operationId,
    });
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.callbacks.display();

    let failedCount = 0;
    try {
      const result = await this.withSettingsConnection((client) => loadSettingsData(client, this.host.vaultPath));
      if (this.isStaleSettingsDynamicOperation(operationId)) return;

      if (result.models.ok) {
        this.models = result.models.data;
        this.host.threadCatalog.publishModels(result.models.data);
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "loaded",
          status: result.models.status,
          operationId,
        });
      } else {
        failedCount += 1;
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "failed",
          status: result.models.status,
          operationId,
        });
      }

      if (result.hooks.ok) {
        this.hooks = result.hooks.data.hooks;
        this.hookWarnings = result.hooks.data.warnings;
        this.hookErrors = result.hooks.data.errors;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "loaded",
          status: result.hooks.status,
          operationId,
        });
      } else {
        failedCount += 1;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "failed",
          status: result.hooks.status,
          operationId,
        });
      }

      if (result.archivedThreads.ok) {
        this.archivedThreads = result.archivedThreads.data;
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "loaded",
          status: result.archivedThreads.status,
          operationId,
        });
      } else {
        failedCount += 1;
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "failed",
          status: result.archivedThreads.status,
          operationId,
        });
      }
    } catch (error) {
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
      failedCount = 3;
      const message = errorMessage(error);
      this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
        type: "failed",
        status: `Could not load models: ${message}`,
        operationId,
      });
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not load hooks: ${message}`,
        operationId,
      });
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "failed",
        status: `Could not load archived threads: ${message}`,
        operationId,
      });
    } finally {
      const staleOperation = this.isStaleSettingsDynamicOperation(operationId);
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
    const operationId = this.nextSettingsDynamicOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.callbacks.display();
    try {
      await this.withSettingsConnection((client) => trustHookItem(client, hook));
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: "Trusted hook definition.",
        operationId,
      });
      await this.loadHooks();
    } catch (error) {
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
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
    const operationId = this.nextSettingsDynamicOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.callbacks.display();
    try {
      await this.withSettingsConnection((client) => setHookItemEnabled(client, hook, enabled));
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: enabled ? "Enabled hook." : "Disabled hook.",
        operationId,
      });
      await this.loadHooks();
    } catch (error) {
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
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
    const operationId = this.nextSettingsDynamicOperationId();
    this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
      type: "started",
      status: "Loading archived threads...",
      operationId,
    });
    this.callbacks.display();
    try {
      const restoredThread = await this.withSettingsConnection((client) => restoreArchivedThreadOnAppServer(client, threadId));
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
      this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "loaded",
        status: `Restored "${archivedThreadDisplayTitle(restoredThread)}".`,
        operationId,
      });
      this.host.threadCatalog.refreshFromOpenSurface();
    } catch (error) {
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "failed",
        status: `Could not restore archived thread: ${errorMessage(error)}`,
        operationId,
      });
      this.callbacks.notify("Could not restore archived Codex thread.");
    } finally {
      if (!this.isStaleSettingsDynamicOperation(operationId)) this.callbacks.display();
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
    const operationId = this.nextSettingsDynamicOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.callbacks.display();
    try {
      const hooks = await this.withSettingsConnection((client) => loadHookData(client, this.host.vaultPath));
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
      this.hooks = hooks.hooks;
      this.hookWarnings = hooks.warnings;
      this.hookErrors = hooks.errors;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: hooks.status,
        operationId,
      });
    } catch (error) {
      if (this.isStaleSettingsDynamicOperation(operationId)) return;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not load hooks: ${errorMessage(error)}`,
        operationId,
      });
      this.callbacks.notify("Could not load Codex hooks.");
    } finally {
      if (!this.isStaleSettingsDynamicOperation(operationId)) this.callbacks.display();
    }
  }

  private async withSettingsConnection<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    return withShortLivedAppServerClient(this.host.settings.codexPath, this.host.vaultPath, operation, {
      unhandledServerRequestMessage: "Codex Panel settings does not handle server requests.",
    });
  }

  private nextSettingsDynamicOperationId(): number {
    this.settingsDynamicOperationId += 1;
    return this.settingsDynamicOperationId;
  }

  private isStaleSettingsDynamicOperation(operationId: number): boolean {
    return operationId !== this.settingsDynamicOperationId;
  }

  private selectedModel(modelIdOrName: string | null): ModelMetadata | null {
    return findModelMetadataByIdOrName(this.models, modelIdOrName);
  }
}
