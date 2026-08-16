import type { ThreadRenameActiveState } from "../../../domain/threads/rename-lifecycle";
import type { ThreadTitleContext } from "../../../domain/threads/title-generation-model";

interface ThreadRenameEditorState {
  get(threadId: string): ThreadRenameActiveState | undefined;
  replace(threadId: string, state: ThreadRenameActiveState | undefined): void;
  clear(): void;
}

export interface ThreadRenameEditorHost {
  state: ThreadRenameEditorState;
  initialDraft(threadId: string): string | null;
  prepare?(): Promise<void>;
  renameThread(threadId: string, value: string, shouldStart: () => boolean): Promise<unknown>;
  resolveTitleContext(threadId: string): Promise<ThreadTitleContext | null>;
  generateTitle(context: ThreadTitleContext, signal: AbortSignal): Promise<string | null>;
  reportError(error: unknown): void;
  exclusive?: boolean;
}

export interface ThreadRenameEditor {
  invalidate(): void;
  start(threadId: string): void;
  updateDraft(threadId: string, value: string): void;
  cancel(threadId: string): void;
  cancelAutoName(threadId: string): void;
  save(threadId: string, value: string): Promise<void>;
  autoNameDraft(threadId: string): Promise<void>;
}

export function createThreadRenameEditor(host: ThreadRenameEditorHost): ThreadRenameEditor {
  const preparations = new Map<string, object>();
  const generations = new Map<string, { controller: AbortController }>();
  const saves = new Map<string, object>();

  const editor: ThreadRenameEditor = {
    invalidate() {
      for (const operation of generations.values()) operation.controller.abort();
      preparations.clear();
      generations.clear();
      saves.clear();
      host.state.clear();
    },

    start(threadId) {
      if (host.exclusive ? saves.size > 0 : saves.has(threadId)) return;
      const draft = host.initialDraft(threadId);
      if (draft === null) return;
      if (host.exclusive) abortAllTitleWork();
      host.state.replace(threadId, { kind: "editing", draft, autoName: { kind: "checking" } });
      void prepareAutoName(threadId);
    },

    updateDraft(threadId, value) {
      const state = host.state.get(threadId);
      if (state?.kind === "editing") host.state.replace(threadId, { ...state, draft: value });
    },

    cancel(threadId) {
      const state = host.state.get(threadId);
      if (!state || state.kind === "saving") return;
      abortTitleWork(threadId);
      host.state.replace(threadId, undefined);
    },

    cancelAutoName(threadId) {
      const state = host.state.get(threadId);
      if (state?.kind !== "generating") return;
      abortGeneration(threadId);
      host.state.replace(threadId, editingState(state));
    },

    async save(threadId, value) {
      const editing = host.state.get(threadId);
      if (editing?.kind !== "editing") return;
      const state: ThreadRenameActiveState = { ...editing, kind: "saving" };
      host.state.replace(threadId, state);
      const operation = {};
      saves.set(threadId, operation);
      const isCurrent = () => saves.get(threadId) === operation && host.state.get(threadId)?.kind === "saving";
      try {
        await host.prepare?.();
        if (!isCurrent()) return;
        await host.renameThread(threadId, value, isCurrent);
        if (!isCurrent()) return;
        saves.delete(threadId);
        preparations.delete(threadId);
        host.state.replace(threadId, undefined);
      } catch (error) {
        if (!isCurrent()) return;
        saves.delete(threadId);
        host.reportError(error);
        const current = host.state.get(threadId);
        if (current?.kind === "saving") host.state.replace(threadId, editingState(current));
      }
    },

    async autoNameDraft(threadId) {
      const editing = host.state.get(threadId);
      if (editing?.kind !== "editing" || editing.autoName.kind !== "ready") return;
      const state: ThreadRenameActiveState = { ...editing, kind: "generating", autoName: editing.autoName };
      host.state.replace(threadId, state);
      const operation = { controller: new AbortController() };
      generations.set(threadId, operation);
      try {
        const title = await host.generateTitle(state.autoName.context, operation.controller.signal);
        if (!title) throw new Error("Codex did not return a usable thread title.");
        if (generations.get(threadId) !== operation || host.state.get(threadId)?.kind !== "generating") return;
        host.state.replace(threadId, { ...state, draft: title });
      } catch (error) {
        if (generations.get(threadId) === operation && host.state.get(threadId)?.kind === "generating") host.reportError(error);
      } finally {
        if (generations.get(threadId) === operation) {
          generations.delete(threadId);
          const current = host.state.get(threadId);
          if (current?.kind === "generating") host.state.replace(threadId, editingState(current));
        }
      }
    },
  };

  return editor;

  async function prepareAutoName(threadId: string): Promise<void> {
    const operation = {};
    preparations.set(threadId, operation);
    let context: ThreadTitleContext | null = null;
    try {
      await host.prepare?.();
      if (preparations.get(threadId) !== operation) return;
      context = await host.resolveTitleContext(threadId);
    } catch {
      // Availability is represented by the disabled auto-name action.
    }
    if (preparations.get(threadId) !== operation) return;
    preparations.delete(threadId);
    const state = host.state.get(threadId);
    if (state?.kind !== "editing" && state?.kind !== "saving") return;
    host.state.replace(threadId, {
      ...state,
      autoName: context ? { kind: "ready", context } : { kind: "unavailable" },
    });
  }

  function abortTitleWork(threadId: string): void {
    preparations.delete(threadId);
    abortGeneration(threadId);
  }

  function abortGeneration(threadId: string): void {
    generations.get(threadId)?.controller.abort();
    generations.delete(threadId);
  }

  function abortAllTitleWork(): void {
    preparations.clear();
    for (const operation of generations.values()) operation.controller.abort();
    generations.clear();
  }
}

function editingState(state: ThreadRenameActiveState): Extract<ThreadRenameActiveState, { kind: "editing" }> {
  return { kind: "editing", draft: state.draft, autoName: state.autoName };
}
