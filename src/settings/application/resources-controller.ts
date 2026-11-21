import type { HookCatalog, HookItem, ModelMetadata, ReasoningEffort } from "../../domain/runtime/catalog";
import { findModelMetadataByIdOrName, sortedModelMetadata, supportedEffortsForModelMetadata } from "../../domain/runtime/catalog";
import { errorMessage } from "../../domain/text/error-message";
import type { Thread } from "../../domain/threads/model";
import type { ObservedResult } from "../../shared/async/observed-result";
import { OwnerLifetime } from "../../shared/async/owner-lifetime";
import type { SettingsResources } from "./resources";

interface SettingsResourcesControllerCallbacks {
  display(): void;
  notify(message: string): void;
}

type SettingsResourceLifecycleState = { kind: "idle" } | { kind: "loading" } | { kind: "failed"; error: string };

interface SettingsResourcesSnapshot {
  archivedThreads: readonly Thread[] | null;
  archivedThreadsLifecycle: SettingsResourceLifecycleState;
  hookCatalog: HookCatalog | null;
  hooksLifecycle: SettingsResourceLifecycleState;
  modelsLifecycle: SettingsResourceLifecycleState;
}

export class SettingsResourcesController {
  private readonly lifetime = new OwnerLifetime();
  private autoLoadStarted = false;

  private observations: ReturnType<typeof watchSettingsResources> | null = null;
  private archivedThreadsOperation = false;
  private hooksOperation = false;
  private resources: SettingsResources;

  constructor(
    resources: SettingsResources,
    private readonly callbacks: SettingsResourcesControllerCallbacks,
  ) {
    this.resources = resources;
  }

  activate(): void {
    if (this.observations && this.lifetime.isActive()) return;
    this.lifetime.activate();
    const resources = this.resources;
    this.observations = null;
    this.observations = watchSettingsResources(resources, () => {
      if (this.observations && this.resourcesAreCurrent(resources) && this.lifetime.isActive()) this.callbacks.display();
    });
    this.callbacks.display();
  }

  replaceResources(next: SettingsResources): void {
    if (next === this.resources) return;
    this.unsubscribe();
    this.resources = next;
    this.autoLoadStarted = false;
    this.observations = null;
    this.hooksOperation = false;
    this.archivedThreadsOperation = false;
    if (this.lifetime.isActive()) this.activate();
  }

  maybeAutoLoad(): void {
    if (this.autoLoadStarted) return;
    void this.refresh({ forceModels: false });
  }

  dispose(): void {
    this.lifetime.dispose();
    this.autoLoadStarted = false;
    this.unsubscribe();
  }

  async refresh(options: { forceModels?: boolean } = {}): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    this.autoLoadStarted = true;
    let failureNotified = false;
    const notifyFailure = (): void => {
      if (failureNotified) return;
      failureNotified = true;
      this.callbacks.notify("Could not refresh all Codex details.");
    };
    await Promise.all([
      this.refreshObservedResource(
        (resources) => (options.forceModels === false ? resources.queries.fetchModels() : resources.queries.refreshModels()),
        false,
        notifyFailure,
      ),
      this.refreshObservedResource((resources) => resources.queries.refreshHooks(), this.hooksOperation, notifyFailure),
      this.refreshObservedResource(
        (resources) => resources.threadCatalog.refreshArchivedThreads(),
        this.archivedThreadsOperation,
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
      archivedThreads: this.observations?.archivedThreads.read().value ?? null,
      archivedThreadsLifecycle: this.archivedThreadsLifecycle(),
      hookCatalog: this.observations?.hooks.read().value ?? null,
      hooksLifecycle: this.hooksLifecycle(),
      modelsLifecycle: this.modelsLifecycle(),
    };
  }

  async trustHook(hook: HookItem): Promise<void> {
    if (this.hooksLifecycle().kind === "loading") return;
    await this.runOperation("hooksOperation", {
      failureError: (error) => `Could not trust hook: ${errorMessage(error)}`,
      operation: (resources) => resources.queries.trustHook(hook),
    });
  }

  async setHookEnabled(hook: HookItem, enabled: boolean): Promise<void> {
    if (this.hooksLifecycle().kind === "loading") return;
    await this.runOperation("hooksOperation", {
      failureError: (error) => `Could not update hook: ${errorMessage(error)}`,
      operation: (resources) => resources.queries.setHookEnabled(hook, enabled),
    });
  }

  async restoreArchivedThread(threadId: string): Promise<void> {
    if (!this.lifetime.isActive() || this.archivedThreadsLifecycle().kind === "loading") return;
    await this.runOperation("archivedThreadsOperation", {
      failureError: (error) => `Could not restore archived thread: ${errorMessage(error)}`,
      operation: async (resources) => {
        await resources.threadMutations.restoreThread(threadId);
      },
    });
  }

  async deleteArchivedThread(threadId: string): Promise<void> {
    if (!this.lifetime.isActive() || this.archivedThreadsLifecycle().kind === "loading") return;
    await this.runOperation("archivedThreadsOperation", {
      failureError: (error) => `Could not delete archived thread: ${errorMessage(error)}`,
      operation: (resources) => resources.threadMutations.deleteThread(threadId),
    });
  }

  modelMetadata(): ModelMetadata[] {
    return sortedModelMetadata(this.observations?.models.read().value ?? []);
  }

  effortOptions(modelIdOrName: string | null): ReasoningEffort[] {
    const model = findModelMetadataByIdOrName(this.observations?.models.read().value ?? [], modelIdOrName);
    return supportedEffortsForModelMetadata(model);
  }

  effortSupported(modelIdOrName: string | null, effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(modelIdOrName).includes(effort);
  }

  private async runOperation(
    stateKey: "hooksOperation" | "archivedThreadsOperation",
    options: {
      failureError: (error: unknown) => string;
      operation: (resources: SettingsResources) => Promise<void>;
    },
  ): Promise<void> {
    const resources = this.resources;
    this[stateKey] = true;
    this.callbacks.display();
    try {
      await options.operation(resources);
    } catch (error) {
      if (!this.resourcesAreCurrent(resources)) return;
      if (this.lifetime.isActive()) this.callbacks.notify(options.failureError(error));
    } finally {
      if (this.resourcesAreCurrent(resources)) {
        this[stateKey] = false;
        if (this.lifetime.isActive()) this.callbacks.display();
      }
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
    return this.archivedThreadsOperation
      ? { kind: "loading" }
      : lifecycleFromObservedResult(this.observations?.archivedThreads.read(), "Could not load archived threads");
  }

  private hooksLifecycle(): SettingsResourceLifecycleState {
    return this.hooksOperation ? { kind: "loading" } : lifecycleFromObservedResult(this.observations?.hooks.read(), "Could not load hooks");
  }

  private modelsLifecycle(): SettingsResourceLifecycleState {
    return lifecycleFromObservedResult(this.observations?.models.read(), "Could not load models");
  }

  private resourcesAreCurrent(resources: SettingsResources): boolean {
    return this.resources === resources;
  }

  private unsubscribe(): void {
    if (this.observations) {
      for (const observation of Object.values(this.observations)) observation.close();
    }
  }
}

function watchSettingsResources(resources: SettingsResources, changed: () => void) {
  return {
    models: resources.queries.watchModels(changed),
    hooks: resources.queries.watchHooks(changed),
    archivedThreads: resources.threadCatalog.watchArchivedThreads(changed),
  };
}

function lifecycleFromObservedResult<T>(result: ObservedResult<T> | undefined, label: string): SettingsResourceLifecycleState {
  if (result?.isFetching) return { kind: "loading" };
  if (result?.error) return { kind: "failed", error: `${label}: ${result.error.message}` };
  return { kind: "idle" };
}
