import type { AppServerClient } from "../app-server/connection/client";
import type { AppServerObservedQueryResult } from "../app-server/query/cache";
import { isStaleAppServerSharedQueryContextError } from "../app-server/query/shared-queries";
import { setHookItemEnabled, trustHookItem } from "../app-server/catalog";
import { restoreArchivedThread as restoreArchivedThreadOnAppServer } from "../app-server/threads";
import type { HookItem, ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import { errorMessage } from "../utils";
import { archivedThreadDisplayTitle } from "./archived-thread-title";
import { loadHookData } from "./app-server-data";
import type { SettingsDynamicDataHost } from "./host";
import {
  createSettingsDynamicSectionLifecycle,
  transitionSettingsDataRefreshLifecycle,
  transitionSettingsDynamicSectionLifecycle,
  type SettingsDataRefreshLifecycleState,
  type SettingsDynamicSectionLifecycleState,
} from "./lifecycle";

function archivedThreadTitleForStatus(thread: Thread | undefined, threadId: string): string {
  return thread ? archivedThreadDisplayTitle(thread) : threadId;
}

interface SettingsDynamicDataControllerCallbacks {
  display(target: SettingsDynamicDataDisplayTarget): void;
  notify(message: string): void;
}

export type SettingsDynamicDataDisplayTarget = "all" | "helper" | "archived" | "hooks";

export interface SettingsDynamicDataSnapshot {
  archivedThreads: readonly Thread[];
  archivedThreadsLifecycle: SettingsDynamicSectionLifecycleState;
  archivedThreadsLoaded: boolean;
  hooks: readonly HookItem[];
  hookWarnings: readonly string[];
  hookErrors: readonly string[];
  hooksLifecycle: SettingsDynamicSectionLifecycleState;
  hooksLoaded: boolean;
  models: readonly ModelMetadata[];
  modelsLifecycle: SettingsDynamicSectionLifecycleState;
}

export class SettingsDynamicDataController {
  private settingsDataAutoLoadStarted = false;
  private settingsRefreshOperationToken = 0;
  private modelsOperationToken = 0;
  private hooksOperationToken = 0;
  private archivedThreadsOperationToken = 0;
  private settingsDataRefreshLifecycle: SettingsDataRefreshLifecycleState = { kind: "idle" };

  private archivedThreads: Thread[] = [];
  private archivedThreadsLoaded = false;
  private archivedThreadsLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();
  private hooks: HookItem[] = [];
  private hookWarnings: string[] = [];
  private hookErrors: string[] = [];
  private hooksLoaded = false;
  private hooksLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();
  private models: ModelMetadata[] = [];
  private modelsLifecycle: SettingsDynamicSectionLifecycleState = createSettingsDynamicSectionLifecycle();
  private unsubscribeModels: (() => void) | null = null;
  private unsubscribeArchivedThreads: (() => void) | null = null;

  constructor(
    private readonly host: SettingsDynamicDataHost,
    private readonly callbacks: SettingsDynamicDataControllerCallbacks,
  ) {}

  activate(): void {
    if (this.unsubscribeModels) return;
    this.models = [...(this.host.appServerData.modelsSnapshot() ?? [])];
    const archivedThreads = this.host.threadCatalog.archivedSnapshot();
    if (archivedThreads) {
      this.archivedThreads = [...archivedThreads];
      this.archivedThreadsLoaded = true;
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "loaded",
        status: archivedThreadsStatus(archivedThreads.length),
        operationToken: this.archivedThreadsOperationToken,
      });
    }
    this.unsubscribeModels = this.host.appServerData.observeModelsResult(
      (result) => {
        this.receiveObservedModelsResult(result);
      },
      { emitCurrent: false },
    );
    this.unsubscribeArchivedThreads = this.host.threadCatalog.observeArchived(
      (result) => {
        this.receiveObservedArchivedThreadsResult(result);
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
    this.settingsRefreshOperationToken += 1;
    this.modelsOperationToken += 1;
    this.hooksOperationToken += 1;
    this.archivedThreadsOperationToken += 1;
    this.settingsDataRefreshLifecycle = { kind: "idle" };
    this.models = [...(this.host.appServerData.modelsSnapshot() ?? [])];
    this.modelsLifecycle = createSettingsDynamicSectionLifecycle();
    this.hooks = [];
    this.hookWarnings = [];
    this.hookErrors = [];
    this.hooksLoaded = false;
    this.hooksLifecycle = createSettingsDynamicSectionLifecycle();
    this.archivedThreads = [];
    this.archivedThreadsLoaded = false;
    this.archivedThreadsLifecycle = createSettingsDynamicSectionLifecycle();
  }

  dispose(): void {
    this.unsubscribeModels?.();
    this.unsubscribeModels = null;
    this.unsubscribeArchivedThreads?.();
    this.unsubscribeArchivedThreads = null;
  }

  private receiveObservedModelsResult(result: AppServerObservedQueryResult<readonly ModelMetadata[]>): void {
    if (!result.data) return;
    this.models = [...result.data];
    this.callbacks.display("helper");
  }

  private receiveObservedArchivedThreadsResult(result: AppServerObservedQueryResult<readonly Thread[]>): void {
    if (!result.data) return;
    this.archivedThreads = [...result.data];
    this.archivedThreadsLoaded = true;
    if (this.archivedThreadsLifecycle.kind !== "loading") {
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "loaded",
        status: archivedThreadsStatus(result.data.length),
        operationToken: this.archivedThreadsOperationToken,
      });
    }
    this.callbacks.display("archived");
  }

  async refreshSettingsData(options: { forceModels?: boolean } = {}): Promise<void> {
    this.settingsDataAutoLoadStarted = true;
    const operationToken = this.nextSettingsRefreshOperationToken();
    const modelsOperationToken = this.nextModelsOperationToken();
    const hooksOperationToken = this.nextHooksOperationToken();
    const archivedThreadsOperationToken = this.nextArchivedThreadsOperationToken();
    this.settingsDataRefreshLifecycle = transitionSettingsDataRefreshLifecycle(this.settingsDataRefreshLifecycle, {
      type: "started",
      operationToken,
    });
    this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
      type: "started",
      status: "Loading models...",
      operationToken: modelsOperationToken,
    });
    this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
      type: "started",
      status: "Loading archived threads...",
      operationToken: archivedThreadsOperationToken,
    });
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationToken: hooksOperationToken,
    });
    this.callbacks.display("all");

    let failedCount = 0;
    try {
      const [modelsResult, hooksResult, archivedThreadsResult] = await Promise.allSettled([
        options.forceModels === false ? this.host.appServerData.fetchModels() : this.host.appServerData.refreshModels(),
        this.withSettingsConnection((client) => loadHookData(client, this.host.vaultPath)),
        this.host.threadCatalog.refreshArchived(),
      ] as const);
      if (this.isStaleSettingsRefreshOperation(operationToken)) return;

      if (this.isStaleModelsOperation(modelsOperationToken)) {
        // A newer models operation owns this section.
      } else if (modelsResult.status === "fulfilled") {
        this.models = [...modelsResult.value];
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "loaded",
          status: `Loaded ${String(modelsResult.value.length)} model${modelsResult.value.length === 1 ? "" : "s"}.`,
          operationToken: modelsOperationToken,
        });
      } else if (isStaleAppServerSharedQueryContextError(modelsResult.reason)) {
        return;
      } else {
        failedCount += 1;
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "failed",
          status: `Could not load models: ${errorMessage(modelsResult.reason)}`,
          operationToken: modelsOperationToken,
        });
      }

      if (this.isStaleHooksOperation(hooksOperationToken)) {
        // A newer hooks operation owns this section.
      } else if (hooksResult.status === "fulfilled") {
        this.hooks = hooksResult.value.hooks;
        this.hookWarnings = hooksResult.value.warnings;
        this.hookErrors = hooksResult.value.errors;
        this.hooksLoaded = true;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "loaded",
          status: hooksResult.value.status,
          operationToken: hooksOperationToken,
        });
      } else {
        failedCount += 1;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "failed",
          status: `Could not load hooks: ${errorMessage(hooksResult.reason)}`,
          operationToken: hooksOperationToken,
        });
      }

      if (this.isStaleArchivedThreadsOperation(archivedThreadsOperationToken)) {
        // A newer archived threads operation owns this section.
      } else if (archivedThreadsResult.status === "fulfilled") {
        this.archivedThreads = [...archivedThreadsResult.value];
        this.archivedThreadsLoaded = true;
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "loaded",
          status: archivedThreadsStatus(archivedThreadsResult.value.length),
          operationToken: archivedThreadsOperationToken,
        });
      } else if (isStaleAppServerSharedQueryContextError(archivedThreadsResult.reason)) {
        return;
      } else {
        failedCount += 1;
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "failed",
          status: `Could not load archived threads: ${errorMessage(archivedThreadsResult.reason)}`,
          operationToken: archivedThreadsOperationToken,
        });
      }
    } catch (error) {
      if (this.isStaleSettingsRefreshOperation(operationToken)) return;
      failedCount = 3;
      const message = errorMessage(error);
      if (!this.isStaleModelsOperation(modelsOperationToken)) {
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "failed",
          status: `Could not load models: ${message}`,
          operationToken: modelsOperationToken,
        });
      }
      if (!this.isStaleHooksOperation(hooksOperationToken)) {
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "failed",
          status: `Could not load hooks: ${message}`,
          operationToken: hooksOperationToken,
        });
      }
      if (!this.isStaleArchivedThreadsOperation(archivedThreadsOperationToken)) {
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "failed",
          status: `Could not load archived threads: ${message}`,
          operationToken: archivedThreadsOperationToken,
        });
      }
    } finally {
      const staleRefresh = this.isStaleSettingsRefreshOperation(operationToken);
      this.settingsDataRefreshLifecycle = transitionSettingsDataRefreshLifecycle(this.settingsDataRefreshLifecycle, {
        type: "completed",
        failedCount,
        operationToken,
      });
      if (!staleRefresh) {
        if (failedCount > 0) {
          this.callbacks.notify("Could not refresh all Codex data.");
        }
        this.callbacks.display("all");
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
      archivedThreadsLoaded: this.archivedThreadsLoaded,
      hooks: [...this.hooks],
      hookWarnings: [...this.hookWarnings],
      hookErrors: [...this.hookErrors],
      hooksLifecycle: { ...this.hooksLifecycle },
      hooksLoaded: this.hooksLoaded,
      models: [...this.models],
      modelsLifecycle: { ...this.modelsLifecycle },
    };
  }

  async trustHook(hook: HookItem): Promise<void> {
    await this.runDynamicSectionOperation({
      section: "hooks",
      loadingStatus: "Loading hooks...",
      failureStatus: (error) => `Could not trust hook: ${errorMessage(error)}`,
      failureNotice: "Could not trust Codex hook.",
      operation: async (operationToken) => {
        await this.withSettingsConnection((client) => trustHookItem(client, hook));
        if (this.isStaleHooksOperation(operationToken)) return;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "loaded",
          status: "Trusted hook definition.",
          operationToken,
        });
        await this.loadHooks();
      },
    });
  }

  async setHookEnabled(hook: HookItem, enabled: boolean): Promise<void> {
    await this.runDynamicSectionOperation({
      section: "hooks",
      loadingStatus: "Loading hooks...",
      failureStatus: (error) => `Could not update hook: ${errorMessage(error)}`,
      failureNotice: "Could not update Codex hook.",
      operation: async (operationToken) => {
        await this.withSettingsConnection((client) => setHookItemEnabled(client, hook, enabled));
        if (this.isStaleHooksOperation(operationToken)) return;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "loaded",
          status: enabled ? "Enabled hook." : "Disabled hook.",
          operationToken,
        });
        await this.loadHooks();
      },
    });
  }

  async restoreArchivedThread(threadId: string): Promise<void> {
    await this.runDynamicSectionOperation({
      section: "archivedThreads",
      loadingStatus: "Loading archived threads...",
      failureStatus: (error) => `Could not restore archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not restore archived Codex thread.",
      operation: async (operationToken) => {
        const restoredThread = await this.withSettingsConnection((client) => restoreArchivedThreadOnAppServer(client, threadId));
        if (this.isStaleArchivedThreadsOperation(operationToken)) return;
        this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
        this.host.threadCatalog.recordThreadRestored(restoredThread);
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "loaded",
          status: `Restored "${archivedThreadDisplayTitle(restoredThread)}".`,
          operationToken,
        });
      },
    });
  }

  async deleteArchivedThread(threadId: string): Promise<void> {
    const title = archivedThreadTitleForStatus(
      this.archivedThreads.find((thread) => thread.id === threadId),
      threadId,
    );
    await this.runDynamicSectionOperation({
      section: "archivedThreads",
      loadingStatus: "Loading archived threads...",
      failureStatus: (error) => `Could not delete archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not delete archived Codex thread.",
      operation: async (operationToken) => {
        await this.withSettingsConnection((client) => client.deleteThread(threadId));
        if (this.isStaleArchivedThreadsOperation(operationToken)) return;
        this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
        this.host.threadCatalog.recordThreadDeleted(threadId);
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "loaded",
          status: `Deleted "${title}".`,
          operationToken,
        });
      },
    });
  }

  modelMetadata(): ModelMetadata[] {
    return sortedModelMetadata(this.models);
  }

  effortOptions(modelIdOrName: string | null): ReasoningEffort[] {
    const model = findModelMetadataByIdOrName(this.models, modelIdOrName);
    return model ? supportedEffortsForModelMetadata(model) : [];
  }

  namingEffortSupported(effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(this.host.settings.threadNamingModel).includes(effort);
  }

  rewriteSelectionEffortSupported(effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(this.host.settings.rewriteSelectionModel).includes(effort);
  }

  private async loadHooks(): Promise<void> {
    await this.runDynamicSectionOperation({
      section: "hooks",
      loadingStatus: "Loading hooks...",
      failureStatus: (error) => `Could not load hooks: ${errorMessage(error)}`,
      failureNotice: "Could not load Codex hooks.",
      operation: async (operationToken) => {
        const hooks = await this.withSettingsConnection((client) => loadHookData(client, this.host.vaultPath));
        if (this.isStaleHooksOperation(operationToken)) return;
        this.hooks = hooks.hooks;
        this.hookWarnings = hooks.warnings;
        this.hookErrors = hooks.errors;
        this.hooksLoaded = true;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "loaded",
          status: hooks.status,
          operationToken,
        });
      },
    });
  }

  private async runDynamicSectionOperation(options: {
    section: "hooks" | "archivedThreads";
    loadingStatus: string;
    failureStatus: (error: unknown) => string;
    failureNotice: string;
    operation: (operationToken: number) => Promise<void>;
  }): Promise<void> {
    const operationToken = options.section === "hooks" ? this.nextHooksOperationToken() : this.nextArchivedThreadsOperationToken();
    const stale = (): boolean =>
      options.section === "hooks" ? this.isStaleHooksOperation(operationToken) : this.isStaleArchivedThreadsOperation(operationToken);
    const lifecycle = (): SettingsDynamicSectionLifecycleState =>
      options.section === "hooks" ? this.hooksLifecycle : this.archivedThreadsLifecycle;
    const setLifecycle = (state: SettingsDynamicSectionLifecycleState): void => {
      if (options.section === "hooks") {
        this.hooksLifecycle = state;
      } else {
        this.archivedThreadsLifecycle = state;
      }
    };

    setLifecycle(
      transitionSettingsDynamicSectionLifecycle(lifecycle(), {
        type: "started",
        status: options.loadingStatus,
        operationToken,
      }),
    );
    this.callbacks.display(displayTargetForDynamicOperationSection(options.section));
    try {
      await options.operation(operationToken);
    } catch (error) {
      if (stale()) return;
      setLifecycle(
        transitionSettingsDynamicSectionLifecycle(lifecycle(), {
          type: "failed",
          status: options.failureStatus(error),
          operationToken,
        }),
      );
      this.callbacks.notify(options.failureNotice);
    } finally {
      if (!stale()) this.callbacks.display(displayTargetForDynamicOperationSection(options.section));
    }
  }

  private async withSettingsConnection<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    return this.host.clientAccess.withClient(operation, {
      unhandledServerRequestMessage: "Codex Panel settings does not handle server requests.",
    });
  }

  private nextSettingsRefreshOperationToken(): number {
    this.settingsRefreshOperationToken += 1;
    return this.settingsRefreshOperationToken;
  }

  private nextModelsOperationToken(): number {
    this.modelsOperationToken += 1;
    return this.modelsOperationToken;
  }

  private nextHooksOperationToken(): number {
    this.hooksOperationToken += 1;
    return this.hooksOperationToken;
  }

  private nextArchivedThreadsOperationToken(): number {
    this.archivedThreadsOperationToken += 1;
    return this.archivedThreadsOperationToken;
  }

  private isStaleSettingsRefreshOperation(operationToken: number): boolean {
    return operationToken !== this.settingsRefreshOperationToken;
  }

  private isStaleModelsOperation(operationToken: number): boolean {
    return operationToken !== this.modelsOperationToken;
  }

  private isStaleHooksOperation(operationToken: number): boolean {
    return operationToken !== this.hooksOperationToken;
  }

  private isStaleArchivedThreadsOperation(operationToken: number): boolean {
    return operationToken !== this.archivedThreadsOperationToken;
  }
}

function displayTargetForDynamicOperationSection(section: "hooks" | "archivedThreads"): SettingsDynamicDataDisplayTarget {
  return section === "hooks" ? "hooks" : "archived";
}

function archivedThreadsStatus(count: number): string {
  return `Loaded ${String(count)} archived thread${count === 1 ? "" : "s"}.`;
}
