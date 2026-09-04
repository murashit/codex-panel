import type { HookItem, ModelMetadata, ReasoningEffort } from "../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";
import type { ObservedResult } from "../../shared/async/observed-result";
import { OwnerLifetime } from "../../shared/async/owner-lifetime";
import type { SettingsHookCatalog, SettingsResources } from "./resources";

interface SettingsResourcesControllerCallbacks {
  display(): void;
  notify(message: string): void;
}

type SettingsResourceLifecycleState = { kind: "idle" } | { kind: "loading" } | { kind: "failed"; error: string };

type SettingsResourceLifecycleKey = "modelsLifecycle" | "hooksLifecycle" | "archivedThreadsLifecycle";

interface SettingsResourceRefreshSpec<T> {
  lifecycle: SettingsResourceLifecycleKey;
  load: (resources: SettingsResources) => Promise<T>;
  commit: (value: T) => void;
  failureError: (error: unknown) => string;
}

interface SettingsResourcesSnapshot {
  archivedThreads: readonly Thread[] | null;
  archivedThreadsLifecycle: SettingsResourceLifecycleState;
  hookCatalog: SettingsHookCatalog | null;
  hooksLifecycle: SettingsResourceLifecycleState;
  models: readonly ModelMetadata[];
  modelsLifecycle: SettingsResourceLifecycleState;
}

export class SettingsResourcesController {
  private readonly lifetime = new OwnerLifetime();
  private autoLoadStarted = false;
  private hookMutationOperation: object | null = null;

  private archivedThreads: Thread[] | null = null;
  private archivedThreadsLifecycle: SettingsResourceLifecycleState = createSettingsResourceLifecycle();
  private hookCatalog: SettingsHookCatalog | null = null;
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
    this.hookCatalog = null;
    this.hooksLifecycle = createSettingsResourceLifecycle();
    this.archivedThreads = null;
    this.archivedThreadsLifecycle = createSettingsResourceLifecycle();
    this.loadSnapshots();
    if (this.lifetime.isActive()) this.subscribe();
  }

  private loadSnapshots(): void {
    this.models = [...(this.resources.modelsSnapshot() ?? [])];
    const archivedThreads = this.resources.archivedThreadsSnapshot();
    if (archivedThreads) this.archivedThreads = [...archivedThreads];
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
    if (this.archivedThreadsLifecycle.kind !== "loading") {
      this.archivedThreadsLifecycle = createSettingsResourceLifecycle();
    }
    this.callbacks.display();
  }

  private receiveHookCatalog(snapshot: SettingsHookCatalog): void {
    this.hookCatalog = cloneHookCatalog(snapshot);
    if (this.hooksLifecycle.kind !== "loading") {
      this.hooksLifecycle = createSettingsResourceLifecycle();
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
          load: (resources) => (options.forceModels === false ? resources.fetchModels() : resources.refreshModels()),
          commit: (models) => {
            this.models = [...models];
          },
          failureError: (error) => `Could not load models: ${errorMessage(error)}`,
        },
        notifyFailure,
      ),
      this.refreshResource(
        {
          lifecycle: "hooksLifecycle",
          load: (resources) => resources.refreshHooks(),
          commit: (catalog) => {
            this.receiveHookCatalog(catalog);
          },
          failureError: (error) => `Could not load hooks: ${errorMessage(error)}`,
        },
        notifyFailure,
      ),
      this.refreshResource(
        {
          lifecycle: "archivedThreadsLifecycle",
          load: (resources) => resources.refreshArchivedThreads(),
          commit: (archivedThreads) => {
            this.archivedThreads = [...archivedThreads];
          },
          failureError: (error) => `Could not load archived threads: ${errorMessage(error)}`,
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
      archivedThreads: this.archivedThreads ? [...this.archivedThreads] : null,
      archivedThreadsLifecycle: { ...this.archivedThreadsLifecycle },
      hookCatalog: this.hookCatalog ? cloneHookCatalog(this.hookCatalog) : null,
      hooksLifecycle: { ...this.hooksLifecycle },
      models: [...this.models],
      modelsLifecycle: { ...this.modelsLifecycle },
    };
  }

  async trustHook(hook: HookItem): Promise<void> {
    await this.runHookOperation({
      failureError: (error) => `Could not trust hook: ${errorMessage(error)}`,
      failureNotice: "Could not trust Codex hook.",
      operation: (resources) => resources.trustHook(hook),
    });
  }

  async setHookEnabled(hook: HookItem, enabled: boolean): Promise<void> {
    await this.runHookOperation({
      failureError: (error) => `Could not update hook: ${errorMessage(error)}`,
      failureNotice: "Could not update Codex hook.",
      operation: (resources) => resources.setHookEnabled(hook, enabled),
    });
  }

  async restoreArchivedThread(threadId: string): Promise<void> {
    await this.runArchivedThreadOperation({
      failureError: (error) => `Could not restore archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not restore archived Codex thread.",
      operation: async (resources) => {
        await resources.restoreArchivedThread(threadId);
      },
    });
  }

  async deleteArchivedThread(threadId: string): Promise<void> {
    await this.runArchivedThreadOperation({
      failureError: (error) => `Could not delete archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not delete archived Codex thread.",
      operation: (resources) => resources.deleteArchivedThread(threadId),
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
    failureError: (error: unknown) => string;
    failureNotice: string;
    operation: (resources: SettingsResources) => Promise<SettingsHookCatalog>;
  }): Promise<void> {
    if (this.hooksLifecycle.kind === "loading") return;
    const resources = this.resources;
    const operation = {};
    this.hookMutationOperation = operation;
    const isCurrent = (): boolean => this.hookMutationOperation === operation && this.resourcesAreCurrent(resources);
    this.hooksLifecycle = settingsResourceLoading();
    this.callbacks.display();
    try {
      const catalog = await options.operation(resources);
      if (!isCurrent()) return;
      this.receiveHookCatalog(catalog);
      this.hooksLifecycle = createSettingsResourceLifecycle();
    } catch (error) {
      if (!isCurrent()) return;
      this.hooksLifecycle = settingsResourceFailed(options.failureError(error));
      if (this.lifetime.isActive()) this.callbacks.notify(options.failureNotice);
    } finally {
      if (isCurrent()) {
        this.hookMutationOperation = null;
        if (this.lifetime.isActive()) this.callbacks.display();
      }
    }
  }

  private async runArchivedThreadOperation(options: {
    failureError: (error: unknown) => string;
    failureNotice: string;
    operation: (resources: SettingsResources) => Promise<void>;
  }): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || this.archivedThreadsLifecycle.kind === "loading") return;
    const resources = this.resources;
    const isCurrent = (): boolean => this.lifetime.isCurrent(lifetime) && this.resourcesAreCurrent(resources);

    this.archivedThreadsLifecycle = settingsResourceLoading();
    this.callbacks.display();
    try {
      await options.operation(resources);
      if (!isCurrent()) return;
      this.archivedThreadsLifecycle = createSettingsResourceLifecycle();
    } catch (error) {
      if (!isCurrent()) return;
      this.archivedThreadsLifecycle = settingsResourceFailed(options.failureError(error));
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

    this[spec.lifecycle] = settingsResourceLoading();
    this.callbacks.display();
    try {
      const value = await spec.load(resources);
      if (!isCurrent()) return;
      spec.commit(value);
      this[spec.lifecycle] = createSettingsResourceLifecycle();
      this.callbacks.display();
    } catch (error) {
      if (!isCurrent()) return;
      this[spec.lifecycle] = settingsResourceFailed(spec.failureError(error));
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

function cloneHookCatalog(catalog: SettingsHookCatalog): SettingsHookCatalog {
  return {
    hooks: [...catalog.hooks],
    warnings: [...catalog.warnings],
    errors: [...catalog.errors],
  };
}

function createSettingsResourceLifecycle(): SettingsResourceLifecycleState {
  return { kind: "idle" };
}

function settingsResourceLoading(): SettingsResourceLifecycleState {
  return { kind: "loading" };
}

function settingsResourceFailed(error: string): SettingsResourceLifecycleState {
  return { kind: "failed", error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
