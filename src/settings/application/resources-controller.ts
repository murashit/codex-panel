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
type SettingsOperationState = Exclude<SettingsResourceLifecycleState, { kind: "idle" }>;

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

  private archivedThreadsResult = emptyObservedResult<readonly Thread[]>();
  private archivedThreadsOperation: SettingsOperationState | null = null;
  private hooksResult = emptyObservedResult<SettingsHookCatalog>();
  private hooksOperation: SettingsOperationState | null = null;
  private modelsResult = emptyObservedResult<readonly ModelMetadata[]>();
  private unsubscribeModels: (() => void) | null = null;
  private unsubscribeHooks: (() => void) | null = null;
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
    this.subscribe();
  }

  replaceResources(next: SettingsResources): void {
    if (next === this.resources) return;
    this.unsubscribe();
    this.resources = next;
    this.autoLoadStarted = false;
    this.modelsResult = emptyObservedResult();
    this.hooksResult = emptyObservedResult();
    this.hooksOperation = null;
    this.archivedThreadsResult = emptyObservedResult();
    this.archivedThreadsOperation = null;
    if (this.lifetime.isActive()) this.subscribe();
  }

  private subscribe(): void {
    const resources = this.resources;
    this.unsubscribeModels = resources.queries.observeModelsResult((result) => {
      if (!this.resourcesAreCurrent(resources)) return;
      this.modelsResult = result;
      this.callbacks.display();
    });
    this.unsubscribeHooks = resources.queries.observeHooksResult((result) => {
      if (!this.resourcesAreCurrent(resources)) return;
      if (result.isFetching && this.hooksOperation?.kind === "failed") this.hooksOperation = null;
      this.hooksResult = result;
      this.callbacks.display();
    });
    this.unsubscribeArchivedThreads = resources.threadCatalog.observeArchivedThreadsResult((result) => {
      if (!this.resourcesAreCurrent(resources)) return;
      if (result.isFetching && this.archivedThreadsOperation?.kind === "failed") this.archivedThreadsOperation = null;
      this.archivedThreadsResult = result;
      this.callbacks.display();
    });
  }

  maybeAutoLoad(): void {
    if (this.autoLoadStarted) return;
    this.autoLoadStarted = true;
    void this.refresh({ forceModels: false });
  }

  dispose(): void {
    this.lifetime.dispose();
    this.autoLoadStarted = false;
    if (this.archivedThreadsOperation?.kind === "loading") this.archivedThreadsOperation = null;
    this.unsubscribe();
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
      this.refreshObservedResource(
        (resources) => (options.forceModels === false ? resources.queries.fetchModels() : resources.queries.refreshModels()),
        false,
        notifyFailure,
      ),
      this.refreshObservedResource((resources) => resources.queries.refreshHooks(), this.hooksOperation?.kind === "loading", notifyFailure),
      this.refreshObservedResource(
        (resources) => resources.threadCatalog.refreshArchivedThreads(),
        this.archivedThreadsOperation?.kind === "loading",
        notifyFailure,
      ),
    ]);
  }

  canRefresh(): boolean {
    return (
      this.modelsLifecycle().kind !== "loading" ||
      this.hooksLifecycle().kind !== "loading" ||
      this.archivedThreadsLifecycle().kind !== "loading"
    );
  }

  snapshot(): SettingsResourcesSnapshot {
    return {
      archivedThreads: this.archivedThreadsResult.value,
      archivedThreadsLifecycle: { ...this.archivedThreadsLifecycle() },
      hookCatalog: this.hooksResult.value,
      hooksLifecycle: { ...this.hooksLifecycle() },
      models: this.modelsResult.value ?? [],
      modelsLifecycle: { ...this.modelsLifecycle() },
    };
  }

  async trustHook(hook: HookItem): Promise<void> {
    await this.runHookOperation({
      failureError: (error) => `Could not trust hook: ${errorMessage(error)}`,
      failureNotice: "Could not trust Codex hook.",
      operation: (resources) => resources.queries.trustHook(hook),
    });
  }

  async setHookEnabled(hook: HookItem, enabled: boolean): Promise<void> {
    await this.runHookOperation({
      failureError: (error) => `Could not update hook: ${errorMessage(error)}`,
      failureNotice: "Could not update Codex hook.",
      operation: (resources) => resources.queries.setHookEnabled(hook, enabled),
    });
  }

  async restoreArchivedThread(threadId: string): Promise<void> {
    await this.runArchivedThreadOperation({
      failureError: (error) => `Could not restore archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not restore archived Codex thread.",
      operation: async (resources) => {
        await resources.threadMutations.restoreThread(threadId);
      },
    });
  }

  async deleteArchivedThread(threadId: string): Promise<void> {
    await this.runArchivedThreadOperation({
      failureError: (error) => `Could not delete archived thread: ${errorMessage(error)}`,
      failureNotice: "Could not delete archived Codex thread.",
      operation: (resources) => resources.threadMutations.deleteThread(threadId),
    });
  }

  modelMetadata(): ModelMetadata[] {
    return sortedModelMetadata(this.modelsResult.value ?? []);
  }

  effortOptions(modelIdOrName: string | null): ReasoningEffort[] {
    const model = findModelMetadataByIdOrName(this.modelsResult.value ?? [], modelIdOrName);
    return supportedEffortsForModelMetadata(model);
  }

  effortSupported(modelIdOrName: string | null, effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(modelIdOrName).includes(effort);
  }

  private async runHookOperation(options: {
    failureError: (error: unknown) => string;
    failureNotice: string;
    operation: (resources: SettingsResources) => Promise<void>;
  }): Promise<void> {
    if (this.hooksLifecycle().kind === "loading") return;
    const resources = this.resources;
    const isCurrent = (): boolean => this.resourcesAreCurrent(resources);
    this.hooksOperation = { kind: "loading" };
    this.callbacks.display();
    try {
      await options.operation(resources);
      if (!isCurrent()) return;
      this.hooksOperation = null;
    } catch (error) {
      if (!isCurrent()) return;
      this.hooksOperation = { kind: "failed", error: options.failureError(error) };
      if (this.lifetime.isActive()) this.callbacks.notify(options.failureNotice);
    } finally {
      if (isCurrent() && this.lifetime.isActive()) this.callbacks.display();
    }
  }

  private async runArchivedThreadOperation(options: {
    failureError: (error: unknown) => string;
    failureNotice: string;
    operation: (resources: SettingsResources) => Promise<void>;
  }): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || this.archivedThreadsLifecycle().kind === "loading") return;
    const resources = this.resources;
    const isCurrent = (): boolean => this.lifetime.isCurrent(lifetime) && this.resourcesAreCurrent(resources);

    this.archivedThreadsOperation = { kind: "loading" };
    this.callbacks.display();
    try {
      await options.operation(resources);
      if (!isCurrent()) return;
      this.archivedThreadsOperation = null;
    } catch (error) {
      if (!isCurrent()) return;
      this.archivedThreadsOperation = { kind: "failed", error: options.failureError(error) };
      this.callbacks.notify(options.failureNotice);
    } finally {
      if (isCurrent()) this.callbacks.display();
    }
  }

  private async refreshObservedResource(
    load: (resources: SettingsResources) => Promise<unknown>,
    blockedByOperation: boolean,
    notifyFailure: () => void,
  ): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || blockedByOperation) return;
    const resources = this.resources;
    try {
      await load(resources);
    } catch {
      if (this.lifetime.isCurrent(lifetime) && this.resourcesAreCurrent(resources)) notifyFailure();
    }
  }

  private archivedThreadsLifecycle(): SettingsResourceLifecycleState {
    return this.archivedThreadsOperation ?? lifecycleFromObservedResult(this.archivedThreadsResult, "Could not load archived threads");
  }

  private hooksLifecycle(): SettingsResourceLifecycleState {
    return this.hooksOperation ?? lifecycleFromObservedResult(this.hooksResult, "Could not load hooks");
  }

  private modelsLifecycle(): SettingsResourceLifecycleState {
    return lifecycleFromObservedResult(this.modelsResult, "Could not load models");
  }

  private resourcesAreCurrent(resources: SettingsResources): boolean {
    return this.resources === resources;
  }

  private unsubscribe(): void {
    this.unsubscribeModels?.();
    this.unsubscribeModels = null;
    this.unsubscribeHooks?.();
    this.unsubscribeHooks = null;
    this.unsubscribeArchivedThreads?.();
    this.unsubscribeArchivedThreads = null;
  }
}

function emptyObservedResult<T>(): ObservedResult<T> {
  return { value: null, error: null, isFetching: false };
}

function lifecycleFromObservedResult<T>(result: ObservedResult<T>, label: string): SettingsResourceLifecycleState {
  if (result.isFetching) return { kind: "loading" };
  if (result.error) return { kind: "failed", error: `${label}: ${result.error.message}` };
  return { kind: "idle" };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
