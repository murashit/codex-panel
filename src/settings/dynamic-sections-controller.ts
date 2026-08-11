import type { HookItem, ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import { threadCommandDisplayTitle } from "../domain/threads/title";
import type { ObservedResult } from "../shared/async/observed-result";
import { OwnerLifetime } from "../shared/async/owner-lifetime";
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

type SettingsDynamicSectionLifecycleKey = "modelsLifecycle" | "hooksLifecycle" | "archivedThreadsLifecycle";

interface SettingsDynamicSectionRefreshSpec<T> {
  lifecycle: SettingsDynamicSectionLifecycleKey;
  loadingStatus: string;
  load: (dynamicData: SettingsDynamicDataAccess) => Promise<T>;
  commit: (value: T) => string;
  failureStatus: (error: unknown) => string;
}

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
    this.unsubscribeModels = dynamicData.observeModels(
      (models) => {
        if (!this.dynamicDataIsCurrent(dynamicData)) return;
        this.models = [...models];
        this.callbacks.display();
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
    if (this.dynamicSectionsAutoLoadStarted) return;
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
    this.unsubscribe();
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
    if (!this.lifetime.isCurrent(lifetime)) return;
    this.dynamicSectionsAutoLoadStarted = true;
    let failureNotified = false;
    const notifyFailure = (): void => {
      if (failureNotified || !this.lifetime.isCurrent(lifetime)) return;
      failureNotified = true;
      this.callbacks.notify("Could not refresh all Codex details.");
    };
    await Promise.all([
      this.refreshSection(
        {
          lifecycle: "modelsLifecycle",
          loadingStatus: "Loading models...",
          load: (dynamicData) => (options.forceModels === false ? dynamicData.fetchModels() : dynamicData.refreshModels()),
          commit: (models) => {
            this.models = [...models];
            return `Loaded ${String(models.length)} model${models.length === 1 ? "" : "s"}.`;
          },
          failureStatus: (error) => `Could not load models: ${errorMessage(error)}`,
        },
        notifyFailure,
      ),
      this.refreshSection(
        {
          lifecycle: "hooksLifecycle",
          loadingStatus: "Loading hooks...",
          load: (dynamicData) => dynamicData.refreshHooks(),
          commit: (catalog) => {
            this.receiveHookCatalog(catalog);
            return catalog.status;
          },
          failureStatus: (error) => `Could not load hooks: ${errorMessage(error)}`,
        },
        notifyFailure,
      ),
      this.refreshSection(
        {
          lifecycle: "archivedThreadsLifecycle",
          loadingStatus: "Loading archived threads...",
          load: (dynamicData) => dynamicData.refreshArchivedThreads(),
          commit: (archivedThreads) => {
            this.archivedThreads = [...archivedThreads];
            this.archivedThreadsLoaded = true;
            return archivedThreadsStatus(archivedThreads.length);
          },
          failureStatus: (error) => `Could not load archived threads: ${errorMessage(error)}`,
        },
        notifyFailure,
      ),
    ]);
  }

  canRefreshDynamicSections(): boolean {
    return (
      this.modelsLifecycle.kind !== "loading" || this.hooksLifecycle.kind !== "loading" || this.archivedThreadsLifecycle.kind !== "loading"
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
      operation: async (dynamicData) => {
        const restoredThread = await dynamicData.restoreArchivedThread(threadId);
        return `Restored "${threadCommandDisplayTitle(restoredThread)}".`;
      },
    });
  }

  async deleteArchivedThread(threadId: string): Promise<void> {
    const thread = this.archivedThreads.find((item) => item.id === threadId);
    const title = thread ? threadCommandDisplayTitle(thread) : threadId;
    await this.runArchivedThreadOperation({
      loadingStatus: "Loading archived threads...",
      failureStatus: (error) => `Could not delete archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not delete archived Codex thread.",
      operation: async (dynamicData) => {
        await dynamicData.deleteArchivedThread(threadId);
        return `Deleted "${title}".`;
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
    if (this.hooksLifecycle.kind === "loading") return;
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
    operation: (dynamicData: SettingsDynamicDataAccess) => Promise<string>;
  }): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || this.archivedThreadsLifecycle.kind === "loading") return;
    const dynamicData = this.dynamicData;
    const isCurrent = (): boolean => this.lifetime.isCurrent(lifetime) && this.dynamicDataIsCurrent(dynamicData);

    this.archivedThreadsLifecycle = settingsDynamicSectionLoading(options.loadingStatus);
    this.callbacks.display();
    try {
      const successStatus = await options.operation(dynamicData);
      if (!isCurrent()) return;
      this.archivedThreadsLifecycle = settingsDynamicSectionLoaded(successStatus);
    } catch (error) {
      if (!isCurrent()) return;
      this.archivedThreadsLifecycle = settingsDynamicSectionFailed(options.failureStatus(error));
      this.callbacks.notify(options.failureNotice);
    } finally {
      if (isCurrent()) this.callbacks.display();
    }
  }

  private async refreshSection<T>(spec: SettingsDynamicSectionRefreshSpec<T>, notifyFailure: () => void): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || this[spec.lifecycle].kind === "loading") return;
    const dynamicData = this.dynamicData;
    const isCurrent = (): boolean => this.lifetime.isCurrent(lifetime) && this.dynamicDataIsCurrent(dynamicData);

    this[spec.lifecycle] = settingsDynamicSectionLoading(spec.loadingStatus);
    this.callbacks.display();
    try {
      const value = await spec.load(dynamicData);
      if (!isCurrent()) return;
      this[spec.lifecycle] = settingsDynamicSectionLoaded(spec.commit(value));
      this.callbacks.display();
    } catch (error) {
      if (!isCurrent()) return;
      this[spec.lifecycle] = settingsDynamicSectionFailed(spec.failureStatus(error));
      this.callbacks.display();
      notifyFailure();
    }
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
