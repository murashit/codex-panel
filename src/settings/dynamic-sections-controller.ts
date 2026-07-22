import type { HookItem, ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import { threadArchiveDisplayTitle } from "../domain/threads/title";
import type { ObservedResult } from "../shared/runtime/observed-result";
import { OwnerLifetime } from "../shared/runtime/owner-lifetime";
import type { SettingsDynamicDataAccess, SettingsHookCatalog } from "./dynamic-data";
import type { SettingsDynamicSectionsHost } from "./host";

interface SettingsDynamicSectionsControllerCallbacks {
  display(): void;
  notify(message: string): void;
}

type SettingsDynamicSectionLifecycleState =
  | { kind: "idle"; status: "" }
  | { kind: "loading"; status: string }
  | { kind: "loaded"; status: string }
  | { kind: "failed"; status: string };

interface SettingsDynamicSectionsSnapshot {
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
  private readonly lifetime = new OwnerLifetime();
  private dynamicSectionsAutoLoadStarted = false;
  private archivedThreadsOperationToken = 0;
  private hookMutationOperation: object | null = null;

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
  private dynamicData: SettingsDynamicDataAccess;

  constructor(
    private readonly host: SettingsDynamicSectionsHost,
    private readonly callbacks: SettingsDynamicSectionsControllerCallbacks,
  ) {
    this.dynamicData = host.dynamicData;
  }

  activate(): void {
    if (this.unsubscribeModels) return;
    this.lifetime.activate();
    this.loadSnapshots();
    this.subscribe();
  }

  replaceDynamicData(next: SettingsDynamicDataAccess): void {
    if (next === this.dynamicData) return;
    this.unsubscribe();
    this.archivedThreadsOperationToken += 1;
    this.hookMutationOperation = null;
    this.dynamicData = next;
    this.dynamicSectionsAutoLoadStarted = false;
    this.modelsLifecycle = createSettingsDynamicSectionLifecycle();
    this.hooks = [];
    this.hookWarnings = [];
    this.hookErrors = [];
    this.hooksLoaded = false;
    this.hooksLifecycle = createSettingsDynamicSectionLifecycle();
    this.archivedThreads = [];
    this.archivedThreadsLoaded = false;
    this.archivedThreadsLifecycle = createSettingsDynamicSectionLifecycle();
    this.loadSnapshots();
    if (this.lifetime.isActive()) this.subscribe();
  }

  private loadSnapshots(): void {
    this.models = [...(this.dynamicData.modelsSnapshot() ?? [])];
    const archivedThreads = this.dynamicData.archivedThreadsSnapshot();
    if (archivedThreads) {
      this.archivedThreads = [...archivedThreads];
      this.archivedThreadsLoaded = true;
      this.archivedThreadsLifecycle = settingsDynamicSectionLoaded(archivedThreadsStatus(archivedThreads.length));
    }
  }

  private subscribe(): void {
    const dynamicData = this.dynamicData;
    this.unsubscribeModels = dynamicData.observeModelsResult(
      (result) => {
        if (!this.dynamicDataIsCurrent(dynamicData)) return;
        this.receiveObservedModelsResult(result);
      },
      { emitCurrent: false },
    );
    this.unsubscribeArchivedThreads = dynamicData.observeArchivedThreadsResult(
      (result) => {
        if (!this.dynamicDataIsCurrent(dynamicData)) return;
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

  dispose(): void {
    this.lifetime.dispose();
    this.dynamicSectionsAutoLoadStarted = false;
    if (this.modelsLifecycle.kind === "loading") this.modelsLifecycle = createSettingsDynamicSectionLifecycle();
    if (!this.hookMutationOperation && this.hooksLifecycle.kind === "loading") {
      this.hooksLifecycle = createSettingsDynamicSectionLifecycle();
    }
    if (this.archivedThreadsLifecycle.kind === "loading") {
      this.archivedThreadsLifecycle = createSettingsDynamicSectionLifecycle();
    }
    this.archivedThreadsOperationToken += 1;
    this.unsubscribe();
  }

  private receiveObservedModelsResult(result: ObservedResult<readonly ModelMetadata[]>): void {
    const observedModels = result.value;
    if (!observedModels) return;
    this.models = [...observedModels];
    this.callbacks.display();
  }

  private receiveObservedArchivedThreadsResult(result: ObservedResult<readonly Thread[]>): void {
    const observedThreads = result.value;
    if (!observedThreads) return;
    this.archivedThreads = [...observedThreads];
    this.archivedThreadsLoaded = true;
    if (this.archivedThreadsLifecycle.kind !== "loading") {
      this.archivedThreadsLifecycle = settingsDynamicSectionLoaded(archivedThreadsStatus(observedThreads.length));
    }
    this.callbacks.display();
  }

  private receiveHookCatalog(snapshot: SettingsHookCatalog): void {
    this.hooks = [...snapshot.hooks];
    this.hookWarnings = [...snapshot.warnings];
    this.hookErrors = [...snapshot.errors];
    this.hooksLoaded = true;
    if (this.hooksLifecycle.kind !== "loading") {
      this.hooksLifecycle = settingsDynamicSectionLoaded(snapshot.status);
    }
  }

  async refreshDynamicSections(options: { forceModels?: boolean } = {}): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || this.isLoading()) return;
    const dynamicData = this.dynamicData;
    this.dynamicSectionsAutoLoadStarted = true;
    const archivedThreadsOperationToken = this.nextArchivedThreadsOperationToken();
    this.modelsLifecycle = settingsDynamicSectionLoading("Loading models...");
    this.archivedThreadsLifecycle = settingsDynamicSectionLoading("Loading archived threads...");
    this.hooksLifecycle = settingsDynamicSectionLoading("Loading hooks...");
    this.callbacks.display();

    let failedCount = 0;
    try {
      const [modelsResult, hooksResult, archivedThreadsResult] = await Promise.allSettled([
        options.forceModels === false ? dynamicData.fetchModels() : dynamicData.refreshModels(),
        dynamicData.refreshHooks(),
        dynamicData.refreshArchivedThreads(),
      ] as const);
      if (!this.lifetime.isCurrent(lifetime) || !this.dynamicDataIsCurrent(dynamicData)) return;

      if (modelsResult.status === "fulfilled") {
        this.models = [...modelsResult.value];
        this.modelsLifecycle = settingsDynamicSectionLoaded(
          `Loaded ${String(modelsResult.value.length)} model${modelsResult.value.length === 1 ? "" : "s"}.`,
        );
      } else {
        failedCount += 1;
        this.modelsLifecycle = settingsDynamicSectionFailed(`Could not load models: ${errorMessage(modelsResult.reason)}`);
      }

      if (hooksResult.status === "fulfilled") {
        this.receiveHookCatalog(hooksResult.value);
        this.hooksLifecycle = settingsDynamicSectionLoaded(hooksResult.value.status);
      } else {
        failedCount += 1;
        this.hooksLifecycle = settingsDynamicSectionFailed(`Could not load hooks: ${errorMessage(hooksResult.reason)}`);
      }

      if (this.isStaleArchivedThreadsOperation(archivedThreadsOperationToken)) {
        // A newer archived threads operation owns this section.
      } else if (archivedThreadsResult.status === "fulfilled") {
        this.archivedThreads = [...archivedThreadsResult.value];
        this.archivedThreadsLoaded = true;
        this.archivedThreadsLifecycle = settingsDynamicSectionLoaded(archivedThreadsStatus(archivedThreadsResult.value.length));
      } else {
        failedCount += 1;
        this.archivedThreadsLifecycle = settingsDynamicSectionFailed(
          `Could not load archived threads: ${errorMessage(archivedThreadsResult.reason)}`,
        );
      }
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime) || !this.dynamicDataIsCurrent(dynamicData)) return;
      failedCount = 3;
      const message = errorMessage(error);
      this.modelsLifecycle = settingsDynamicSectionFailed(`Could not load models: ${message}`);
      this.hooksLifecycle = settingsDynamicSectionFailed(`Could not load hooks: ${message}`);
      if (!this.isStaleArchivedThreadsOperation(archivedThreadsOperationToken)) {
        this.archivedThreadsLifecycle = settingsDynamicSectionFailed(`Could not load archived threads: ${message}`);
      }
    } finally {
      if (this.lifetime.isCurrent(lifetime) && this.dynamicDataIsCurrent(dynamicData)) {
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
    await this.runHookOperation({
      loadingStatus: "Loading hooks...",
      failureStatus: (error) => `Could not trust hook: ${errorMessage(error)}`,
      failureNotice: "Could not trust Codex hook.",
      successStatus: "Trusted hook definition.",
      operation: (dynamicData) => dynamicData.trustHook(hook),
    });
  }

  async setHookEnabled(hook: HookItem, enabled: boolean): Promise<void> {
    await this.runHookOperation({
      loadingStatus: "Loading hooks...",
      failureStatus: (error) => `Could not update hook: ${errorMessage(error)}`,
      failureNotice: "Could not update Codex hook.",
      successStatus: enabled ? "Enabled hook." : "Disabled hook.",
      operation: (dynamicData) => dynamicData.setHookEnabled(hook, enabled),
    });
  }

  async restoreArchivedThread(threadId: string): Promise<void> {
    await this.runArchivedThreadOperation({
      loadingStatus: "Loading archived threads...",
      failureStatus: (error) => `Could not restore archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not restore archived Codex thread.",
      operation: async (dynamicData, operationToken) => {
        const restoredThread = await dynamicData.restoreArchivedThread(threadId);
        if (this.isStaleArchivedThreadsOperation(operationToken)) return;
        this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
        this.archivedThreadsLifecycle = settingsDynamicSectionLoaded(`Restored "${threadArchiveDisplayTitle(restoredThread)}".`);
      },
    });
  }

  async deleteArchivedThread(threadId: string): Promise<void> {
    const thread = this.archivedThreads.find((item) => item.id === threadId);
    const title = thread ? threadArchiveDisplayTitle(thread) : threadId;
    await this.runArchivedThreadOperation({
      loadingStatus: "Loading archived threads...",
      failureStatus: (error) => `Could not delete archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not delete archived Codex thread.",
      operation: async (dynamicData, operationToken) => {
        await dynamicData.deleteArchivedThread(threadId);
        if (this.isStaleArchivedThreadsOperation(operationToken)) return;
        this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
        this.archivedThreadsLifecycle = settingsDynamicSectionLoaded(`Deleted "${title}".`);
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

  private async runHookOperation(options: {
    loadingStatus: string;
    failureStatus: (error: unknown) => string;
    failureNotice: string;
    successStatus: string;
    operation: (dynamicData: SettingsDynamicDataAccess) => Promise<SettingsHookCatalog>;
  }): Promise<void> {
    const dynamicData = this.dynamicData;
    const operation = {};
    this.hookMutationOperation = operation;
    const isCurrent = (): boolean => this.hookMutationOperation === operation && this.dynamicDataIsCurrent(dynamicData);
    this.hooksLifecycle = settingsDynamicSectionLoading(options.loadingStatus);
    this.callbacks.display();
    try {
      const catalog = await options.operation(dynamicData);
      if (!isCurrent()) return;
      this.receiveHookCatalog(catalog);
      this.hooksLifecycle = settingsDynamicSectionLoaded(options.successStatus);
    } catch (error) {
      if (!isCurrent()) return;
      this.hooksLifecycle = settingsDynamicSectionFailed(options.failureStatus(error));
      if (this.lifetime.isActive()) this.callbacks.notify(options.failureNotice);
    } finally {
      if (isCurrent()) {
        this.hookMutationOperation = null;
        if (this.lifetime.isActive()) this.callbacks.display();
      }
    }
  }

  private async runArchivedThreadOperation(options: {
    loadingStatus: string;
    failureStatus: (error: unknown) => string;
    failureNotice: string;
    operation: (dynamicData: SettingsDynamicDataAccess, operationToken: number) => Promise<void>;
  }): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    const dynamicData = this.dynamicData;
    const operationToken = this.nextArchivedThreadsOperationToken();
    const stale = (): boolean =>
      !this.lifetime.isCurrent(lifetime) || !this.dynamicDataIsCurrent(dynamicData) || this.isStaleArchivedThreadsOperation(operationToken);

    this.archivedThreadsLifecycle = settingsDynamicSectionLoading(options.loadingStatus);
    this.callbacks.display();
    try {
      await options.operation(dynamicData, operationToken);
    } catch (error) {
      if (stale()) return;
      this.archivedThreadsLifecycle = settingsDynamicSectionFailed(options.failureStatus(error));
      this.callbacks.notify(options.failureNotice);
    } finally {
      if (!stale()) this.callbacks.display();
    }
  }

  private nextArchivedThreadsOperationToken(): number {
    this.archivedThreadsOperationToken += 1;
    return this.archivedThreadsOperationToken;
  }

  private isStaleArchivedThreadsOperation(operationToken: number): boolean {
    return operationToken !== this.archivedThreadsOperationToken;
  }

  private dynamicDataIsCurrent(dynamicData: SettingsDynamicDataAccess): boolean {
    return this.dynamicData === dynamicData;
  }

  private unsubscribe(): void {
    this.unsubscribeModels?.();
    this.unsubscribeModels = null;
    this.unsubscribeArchivedThreads?.();
    this.unsubscribeArchivedThreads = null;
  }
}

function archivedThreadsStatus(count: number): string {
  return `Loaded ${String(count)} archived thread${count === 1 ? "" : "s"}.`;
}

function createSettingsDynamicSectionLifecycle(): SettingsDynamicSectionLifecycleState {
  return { kind: "idle", status: "" };
}

function settingsDynamicSectionLoading(status: string): SettingsDynamicSectionLifecycleState {
  return { kind: "loading", status };
}

function settingsDynamicSectionLoaded(status: string): SettingsDynamicSectionLifecycleState {
  return { kind: "loaded", status };
}

function settingsDynamicSectionFailed(status: string): SettingsDynamicSectionLifecycleState {
  return { kind: "failed", status };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
