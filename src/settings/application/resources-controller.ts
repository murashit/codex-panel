import type { HookItem, ModelMetadata, ReasoningEffort } from "../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";
import { threadCommandDisplayTitle } from "../../domain/threads/title";
import type { ObservedResult } from "../../shared/async/observed-result";
import { OwnerLifetime } from "../../shared/async/owner-lifetime";
import type { SettingsHookCatalog, SettingsResources } from "./resources";

interface SettingsResourcesControllerCallbacks {
  display(): void;
  notify(message: string): void;
}

type SettingsResourceLifecycleState =
  | { kind: "idle"; status: "" }
  | { kind: "loading"; status: string }
  | { kind: "loaded"; status: string }
  | { kind: "failed"; status: string };

type SettingsResourceLifecycleKey = "modelsLifecycle" | "hooksLifecycle" | "archivedThreadsLifecycle";

interface SettingsResourceRefreshSpec<T> {
  lifecycle: SettingsResourceLifecycleKey;
  loadingStatus: string;
  load: (resources: SettingsResources) => Promise<T>;
  commit: (value: T) => string;
  failureStatus: (error: unknown) => string;
}

interface SettingsResourcesSnapshot {
  archivedThreads: readonly Thread[];
  archivedThreadsLifecycle: SettingsResourceLifecycleState;
  archivedThreadsLoaded: boolean;
  hooks: readonly HookItem[];
  hookWarnings: readonly string[];
  hookErrors: readonly string[];
  hooksLifecycle: SettingsResourceLifecycleState;
  hooksLoaded: boolean;
  models: readonly ModelMetadata[];
  modelsLifecycle: SettingsResourceLifecycleState;
}

export class SettingsResourcesController {
  private readonly lifetime = new OwnerLifetime();
  private autoLoadStarted = false;
  private hookMutationOperation: object | null = null;

  private archivedThreads: Thread[] = [];
  private archivedThreadsLoaded = false;
  private archivedThreadsLifecycle: SettingsResourceLifecycleState = createSettingsResourceLifecycle();
  private hooks: HookItem[] = [];
  private hookWarnings: string[] = [];
  private hookErrors: string[] = [];
  private hooksLoaded = false;
  private hooksLifecycle: SettingsResourceLifecycleState = createSettingsResourceLifecycle();
  private models: ModelMetadata[] = [];
  private modelsLifecycle: SettingsResourceLifecycleState = createSettingsResourceLifecycle();
  private unsubscribeModels: (() => void) | null = null;
  private unsubscribeArchivedThreads: (() => void) | null = null;
  private resources: SettingsResources;

  constructor(
    resources: SettingsResources,
    private readonly callbacks: SettingsResourcesControllerCallbacks,
  ) {
    this.resources = resources;
  }

  activate(): void {
    if (this.unsubscribeModels) return;
    this.lifetime.activate();
    this.loadSnapshots();
    this.subscribe();
  }

  replaceResources(next: SettingsResources): void {
    if (next === this.resources) return;
    this.unsubscribe();
    this.hookMutationOperation = null;
    this.resources = next;
    this.autoLoadStarted = false;
    this.modelsLifecycle = createSettingsResourceLifecycle();
    this.hooks = [];
    this.hookWarnings = [];
    this.hookErrors = [];
    this.hooksLoaded = false;
    this.hooksLifecycle = createSettingsResourceLifecycle();
    this.archivedThreads = [];
    this.archivedThreadsLoaded = false;
    this.archivedThreadsLifecycle = createSettingsResourceLifecycle();
    this.loadSnapshots();
    if (this.lifetime.isActive()) this.subscribe();
  }

  private loadSnapshots(): void {
    this.models = [...(this.resources.modelsSnapshot() ?? [])];
    const archivedThreads = this.resources.archivedThreadsSnapshot();
    if (archivedThreads) {
      this.archivedThreads = [...archivedThreads];
      this.archivedThreadsLoaded = true;
      this.archivedThreadsLifecycle = settingsResourceLoaded(archivedThreadsStatus(archivedThreads.length));
    }
  }

  private subscribe(): void {
    const resources = this.resources;
    this.unsubscribeModels = resources.observeModels(
      (models) => {
        if (!this.resourcesAreCurrent(resources)) return;
        this.models = [...models];
        this.callbacks.display();
      },
      { emitCurrent: false },
    );
    this.unsubscribeArchivedThreads = resources.observeArchivedThreadsResult(
      (result) => {
        if (!this.resourcesAreCurrent(resources)) return;
        this.receiveObservedArchivedThreadsResult(result);
      },
      { emitCurrent: false },
    );
  }

  maybeAutoLoad(): void {
    if (this.autoLoadStarted) return;
    this.autoLoadStarted = true;
    void this.refresh({ forceModels: false });
  }

  dispose(): void {
    this.lifetime.dispose();
    this.autoLoadStarted = false;
    if (this.modelsLifecycle.kind === "loading") this.modelsLifecycle = createSettingsResourceLifecycle();
    if (!this.hookMutationOperation && this.hooksLifecycle.kind === "loading") {
      this.hooksLifecycle = createSettingsResourceLifecycle();
    }
    if (this.archivedThreadsLifecycle.kind === "loading") {
      this.archivedThreadsLifecycle = createSettingsResourceLifecycle();
    }
    this.unsubscribe();
  }

  private receiveObservedArchivedThreadsResult(result: ObservedResult<readonly Thread[]>): void {
    const observedThreads = result.value;
    if (!observedThreads) return;
    this.archivedThreads = [...observedThreads];
    this.archivedThreadsLoaded = true;
    if (this.archivedThreadsLifecycle.kind !== "loading") {
      this.archivedThreadsLifecycle = settingsResourceLoaded(archivedThreadsStatus(observedThreads.length));
    }
    this.callbacks.display();
  }

  private receiveHookCatalog(snapshot: SettingsHookCatalog): void {
    this.hooks = [...snapshot.hooks];
    this.hookWarnings = [...snapshot.warnings];
    this.hookErrors = [...snapshot.errors];
    this.hooksLoaded = true;
    if (this.hooksLifecycle.kind !== "loading") {
      this.hooksLifecycle = settingsResourceLoaded(snapshot.status);
    }
  }

  async refresh(options: { forceModels?: boolean } = {}): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    this.autoLoadStarted = true;
    let failureNotified = false;
    const notifyFailure = (): void => {
      if (failureNotified || !this.lifetime.isCurrent(lifetime)) return;
      failureNotified = true;
      this.callbacks.notify("Could not refresh all Codex details.");
    };
    await Promise.all([
      this.refreshResource(
        {
          lifecycle: "modelsLifecycle",
          loadingStatus: "Loading models...",
          load: (resources) => (options.forceModels === false ? resources.fetchModels() : resources.refreshModels()),
          commit: (models) => {
            this.models = [...models];
            return `Loaded ${String(models.length)} model${models.length === 1 ? "" : "s"}.`;
          },
          failureStatus: (error) => `Could not load models: ${errorMessage(error)}`,
        },
        notifyFailure,
      ),
      this.refreshResource(
        {
          lifecycle: "hooksLifecycle",
          loadingStatus: "Loading hooks...",
          load: (resources) => resources.refreshHooks(),
          commit: (catalog) => {
            this.receiveHookCatalog(catalog);
            return catalog.status;
          },
          failureStatus: (error) => `Could not load hooks: ${errorMessage(error)}`,
        },
        notifyFailure,
      ),
      this.refreshResource(
        {
          lifecycle: "archivedThreadsLifecycle",
          loadingStatus: "Loading archived threads...",
          load: (resources) => resources.refreshArchivedThreads(),
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

  canRefresh(): boolean {
    return (
      this.modelsLifecycle.kind !== "loading" || this.hooksLifecycle.kind !== "loading" || this.archivedThreadsLifecycle.kind !== "loading"
    );
  }

  snapshot(): SettingsResourcesSnapshot {
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
      operation: (resources) => resources.trustHook(hook),
    });
  }

  async setHookEnabled(hook: HookItem, enabled: boolean): Promise<void> {
    await this.runHookOperation({
      loadingStatus: "Loading hooks...",
      failureStatus: (error) => `Could not update hook: ${errorMessage(error)}`,
      failureNotice: "Could not update Codex hook.",
      successStatus: enabled ? "Enabled hook." : "Disabled hook.",
      operation: (resources) => resources.setHookEnabled(hook, enabled),
    });
  }

  async restoreArchivedThread(threadId: string): Promise<void> {
    await this.runArchivedThreadOperation({
      loadingStatus: "Loading archived threads...",
      failureStatus: (error) => `Could not restore archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not restore archived Codex thread.",
      operation: async (resources) => {
        const restoredThread = await resources.restoreArchivedThread(threadId);
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
      operation: async (resources) => {
        await resources.deleteArchivedThread(threadId);
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

  effortSupported(modelIdOrName: string | null, effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(modelIdOrName).includes(effort);
  }

  private async runHookOperation(options: {
    loadingStatus: string;
    failureStatus: (error: unknown) => string;
    failureNotice: string;
    successStatus: string;
    operation: (resources: SettingsResources) => Promise<SettingsHookCatalog>;
  }): Promise<void> {
    if (this.hooksLifecycle.kind === "loading") return;
    const resources = this.resources;
    const operation = {};
    this.hookMutationOperation = operation;
    const isCurrent = (): boolean => this.hookMutationOperation === operation && this.resourcesAreCurrent(resources);
    this.hooksLifecycle = settingsResourceLoading(options.loadingStatus);
    this.callbacks.display();
    try {
      const catalog = await options.operation(resources);
      if (!isCurrent()) return;
      this.receiveHookCatalog(catalog);
      this.hooksLifecycle = settingsResourceLoaded(options.successStatus);
    } catch (error) {
      if (!isCurrent()) return;
      this.hooksLifecycle = settingsResourceFailed(options.failureStatus(error));
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
    operation: (resources: SettingsResources) => Promise<string>;
  }): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || this.archivedThreadsLifecycle.kind === "loading") return;
    const resources = this.resources;
    const isCurrent = (): boolean => this.lifetime.isCurrent(lifetime) && this.resourcesAreCurrent(resources);

    this.archivedThreadsLifecycle = settingsResourceLoading(options.loadingStatus);
    this.callbacks.display();
    try {
      const successStatus = await options.operation(resources);
      if (!isCurrent()) return;
      this.archivedThreadsLifecycle = settingsResourceLoaded(successStatus);
    } catch (error) {
      if (!isCurrent()) return;
      this.archivedThreadsLifecycle = settingsResourceFailed(options.failureStatus(error));
      this.callbacks.notify(options.failureNotice);
    } finally {
      if (isCurrent()) this.callbacks.display();
    }
  }

  private async refreshResource<T>(spec: SettingsResourceRefreshSpec<T>, notifyFailure: () => void): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || this[spec.lifecycle].kind === "loading") return;
    const resources = this.resources;
    const isCurrent = (): boolean => this.lifetime.isCurrent(lifetime) && this.resourcesAreCurrent(resources);

    this[spec.lifecycle] = settingsResourceLoading(spec.loadingStatus);
    this.callbacks.display();
    try {
      const value = await spec.load(resources);
      if (!isCurrent()) return;
      this[spec.lifecycle] = settingsResourceLoaded(spec.commit(value));
      this.callbacks.display();
    } catch (error) {
      if (!isCurrent()) return;
      this[spec.lifecycle] = settingsResourceFailed(spec.failureStatus(error));
      this.callbacks.display();
      notifyFailure();
    }
  }

  private resourcesAreCurrent(resources: SettingsResources): boolean {
    return this.resources === resources;
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

function createSettingsResourceLifecycle(): SettingsResourceLifecycleState {
  return { kind: "idle", status: "" };
}

function settingsResourceLoading(status: string): SettingsResourceLifecycleState {
  return { kind: "loading", status };
}

function settingsResourceLoaded(status: string): SettingsResourceLifecycleState {
  return { kind: "loaded", status };
}

function settingsResourceFailed(status: string): SettingsResourceLifecycleState {
  return { kind: "failed", status };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
