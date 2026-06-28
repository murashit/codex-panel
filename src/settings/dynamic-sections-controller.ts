import type { HookItem, ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import { threadArchiveDisplayTitle } from "../domain/threads/title";
import type { ObservedResult } from "../shared/query/observed-result";
import { observedValue } from "../shared/query/observed-result";
import { isStaleSettingsDynamicDataContextError } from "./dynamic-data";
import type { SettingsDynamicSectionsHost } from "./host";
import {
  createSettingsDynamicSectionLifecycle,
  type SettingsDynamicSectionLifecycleState,
  transitionSettingsDynamicSectionLifecycle,
} from "./lifecycle";

interface SettingsDynamicSectionsControllerCallbacks {
  display(): void;
  notify(message: string): void;
}

export interface SettingsDynamicSectionsSnapshot {
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

export class SettingsDynamicSectionsController {
  private dynamicSectionsAutoLoadStarted = false;
  private dynamicSectionsRefreshOperationToken = 0;
  private modelsOperationToken = 0;
  private hooksOperationToken = 0;
  private archivedThreadsOperationToken = 0;

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
    private readonly host: SettingsDynamicSectionsHost,
    private readonly callbacks: SettingsDynamicSectionsControllerCallbacks,
  ) {}

  activate(): void {
    if (this.unsubscribeModels) return;
    this.models = [...(this.host.dynamicData.modelsSnapshot() ?? [])];
    const archivedThreads = this.host.dynamicData.archivedThreadsSnapshot();
    if (archivedThreads) {
      this.archivedThreads = [...archivedThreads];
      this.archivedThreadsLoaded = true;
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "loaded",
        status: archivedThreadsStatus(archivedThreads.length),
        operationToken: this.archivedThreadsOperationToken,
      });
    }
    this.unsubscribeModels = this.host.dynamicData.observeModelsResult(
      (result) => {
        this.receiveObservedModelsResult(result);
      },
      { emitCurrent: false },
    );
    this.unsubscribeArchivedThreads = this.host.dynamicData.observeArchivedThreadsResult(
      (result) => {
        this.receiveObservedArchivedThreadsResult(result);
      },
      { emitCurrent: false },
    );
  }

  maybeAutoLoadDynamicSections(): void {
    if (this.dynamicSectionsAutoLoadStarted || this.isLoading()) return;
    this.dynamicSectionsAutoLoadStarted = true;
    void this.refreshDynamicSections({ forceModels: false });
  }

  resetDynamicSectionContext(): void {
    this.dynamicSectionsAutoLoadStarted = false;
    this.dynamicSectionsRefreshOperationToken += 1;
    this.modelsOperationToken += 1;
    this.hooksOperationToken += 1;
    this.archivedThreadsOperationToken += 1;
    this.models = [...(this.host.dynamicData.modelsSnapshot() ?? [])];
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

  private receiveObservedModelsResult(result: ObservedResult<readonly ModelMetadata[]>): void {
    const observedModels = observedValue(result);
    if (!observedModels) return;
    this.models = [...observedModels];
    this.callbacks.display();
  }

  private receiveObservedArchivedThreadsResult(result: ObservedResult<readonly Thread[]>): void {
    const observedThreads = observedValue(result);
    if (!observedThreads) return;
    this.archivedThreads = [...observedThreads];
    this.archivedThreadsLoaded = true;
    if (this.archivedThreadsLifecycle.kind !== "loading") {
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "loaded",
        status: archivedThreadsStatus(observedThreads.length),
        operationToken: this.archivedThreadsOperationToken,
      });
    }
    this.callbacks.display();
  }

  async refreshDynamicSections(options: { forceModels?: boolean } = {}): Promise<void> {
    this.dynamicSectionsAutoLoadStarted = true;
    const operationToken = this.nextDynamicSectionsRefreshOperationToken();
    const modelsOperationToken = this.nextModelsOperationToken();
    const hooksOperationToken = this.nextHooksOperationToken();
    const archivedThreadsOperationToken = this.nextArchivedThreadsOperationToken();
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
    this.callbacks.display();

    let failedCount = 0;
    try {
      const [modelsResult, hooksResult, archivedThreadsResult] = await Promise.allSettled([
        options.forceModels === false ? this.host.dynamicData.fetchModels() : this.host.dynamicData.refreshModels(),
        this.host.dynamicData.loadHooks(),
        this.host.dynamicData.refreshArchivedThreads(),
      ] as const);
      if (this.isStaleDynamicSectionsRefreshOperation(operationToken)) return;

      if (this.isStaleModelsOperation(modelsOperationToken)) {
        // A newer models operation owns this section.
      } else if (modelsResult.status === "fulfilled") {
        this.models = [...modelsResult.value];
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "loaded",
          status: `Loaded ${String(modelsResult.value.length)} model${modelsResult.value.length === 1 ? "" : "s"}.`,
          operationToken: modelsOperationToken,
        });
      } else if (isStaleSettingsDynamicDataContextError(modelsResult.reason)) {
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
        this.hooks = [...hooksResult.value.hooks];
        this.hookWarnings = [...hooksResult.value.warnings];
        this.hookErrors = [...hooksResult.value.errors];
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
      } else if (isStaleSettingsDynamicDataContextError(archivedThreadsResult.reason)) {
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
      if (this.isStaleDynamicSectionsRefreshOperation(operationToken)) return;
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
      const staleRefresh = this.isStaleDynamicSectionsRefreshOperation(operationToken);
      if (!staleRefresh) {
        if (failedCount > 0) {
          this.callbacks.notify("Could not refresh all Codex details.");
        }
        this.callbacks.display();
      }
    }
  }

  isLoading(): boolean {
    return (
      this.modelsLifecycle.kind === "loading" || this.hooksLifecycle.kind === "loading" || this.archivedThreadsLifecycle.kind === "loading"
    );
  }

  snapshot(): SettingsDynamicSectionsSnapshot {
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
        await this.host.dynamicData.trustHook(hook);
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
        await this.host.dynamicData.setHookEnabled(hook, enabled);
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
        const restoredThread = await this.host.dynamicData.restoreArchivedThread(threadId, {
          shouldPublish: () => !this.isStaleArchivedThreadsOperation(operationToken),
        });
        if (this.isStaleArchivedThreadsOperation(operationToken)) return;
        this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "loaded",
          status: `Restored "${threadArchiveDisplayTitle(restoredThread)}".`,
          operationToken,
        });
      },
    });
  }

  async deleteArchivedThread(threadId: string): Promise<void> {
    const thread = this.archivedThreads.find((item) => item.id === threadId);
    const title = thread ? threadArchiveDisplayTitle(thread) : threadId;
    await this.runDynamicSectionOperation({
      section: "archivedThreads",
      loadingStatus: "Loading archived threads...",
      failureStatus: (error) => `Could not delete archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not delete archived Codex thread.",
      operation: async (operationToken) => {
        await this.host.dynamicData.deleteArchivedThread(threadId, {
          shouldPublish: () => !this.isStaleArchivedThreadsOperation(operationToken),
        });
        if (this.isStaleArchivedThreadsOperation(operationToken)) return;
        this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
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
        const hooks = await this.host.dynamicData.loadHooks();
        if (this.isStaleHooksOperation(operationToken)) return;
        this.hooks = [...hooks.hooks];
        this.hookWarnings = [...hooks.warnings];
        this.hookErrors = [...hooks.errors];
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
    this.callbacks.display();
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
      if (!stale()) this.callbacks.display();
    }
  }

  private nextDynamicSectionsRefreshOperationToken(): number {
    this.dynamicSectionsRefreshOperationToken += 1;
    return this.dynamicSectionsRefreshOperationToken;
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

  private isStaleDynamicSectionsRefreshOperation(operationToken: number): boolean {
    return operationToken !== this.dynamicSectionsRefreshOperationToken;
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

function archivedThreadsStatus(count: number): string {
  return `Loaded ${String(count)} archived thread${count === 1 ? "" : "s"}.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
