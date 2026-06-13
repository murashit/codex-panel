import { signal, type Signal } from "@preact/signals";

import type { ChatThreadActions } from "../threads/action-context";
import type { ChatAction, ChatState, ChatStateStore } from "../state/reducer";

export interface ToolbarPanelActionsHost {
  stateStore: ChatStateStore;
  threadActions: ChatThreadActions;
  archiveConfirm: ToolbarArchiveConfirmState;
  scheduleRender: () => void;
}

export interface ToolbarArchiveConfirmState {
  id: Signal<string | null>;
  get: () => string | null;
  set: (threadId: string | null) => void;
}

export interface ToolbarPanelActions {
  archiveConfirm: Signal<string | null>;
  archiveConfirmId(): string | null;
  toggleHistory(): void;
  toggleChatActions(): void;
  closeToolbarPanels(): void;
  toggleStatus(): void;
  closeForThreadSelection(): void;
  startArchive(threadId: string): void;
  archiveThread(threadId: string, saveMarkdown: boolean): Promise<void>;
  closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void;
}

interface ToolbarOutsidePointerContext {
  target: EventTarget | null;
  viewWindow: ToolbarDomWindow | null;
  contains: (element: Element) => boolean;
  renameEditing: boolean;
}

type ToolbarDomWindow = Window & { Element: typeof Element };

export function createToolbarPanelActions(host: ToolbarPanelActionsHost): ToolbarPanelActions {
  const state = (): ChatState => host.stateStore.getState();
  const dispatch = (action: ChatAction): void => {
    host.stateStore.dispatch(action);
  };
  const hasOpenPanel = (): boolean => state().ui.toolbarPanel !== null;
  const close = (): void => {
    if (!hasOpenPanel()) return;

    dispatch({ type: "ui/panel-set", panel: null });
    host.archiveConfirm.set(null);
    host.scheduleRender();
  };

  return {
    archiveConfirm: host.archiveConfirm.id,

    archiveConfirmId(): string | null {
      return host.archiveConfirm.get();
    },

    toggleHistory(): void {
      dispatch({ type: "ui/panel-set", panel: "history", toggle: true });
      host.scheduleRender();
    },

    toggleChatActions(): void {
      dispatch({ type: "ui/panel-set", panel: "chat-actions", toggle: true });
      host.scheduleRender();
    },

    closeToolbarPanels(): void {
      close();
    },

    toggleStatus(): void {
      dispatch({ type: "ui/panel-set", panel: "status-panel", toggle: true });
      host.scheduleRender();
    },

    closeForThreadSelection(): void {
      host.archiveConfirm.set(null);
    },

    startArchive(threadId: string): void {
      host.archiveConfirm.set(threadId);
    },

    async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
      if (host.archiveConfirm.get() === threadId) host.archiveConfirm.set(null);
      await host.threadActions.archiveThread(threadId, saveMarkdown);
      host.scheduleRender();
    },

    closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void {
      if (!hasOpenPanel()) return;

      const target = context.target;
      if (isToolbarElement(target, context.viewWindow)) {
        const insideToolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
        if (insideToolbarPanel && context.contains(insideToolbarPanel)) {
          if (host.archiveConfirm.get() && !target.closest(".codex-panel__archive-confirm")) {
            host.archiveConfirm.set(null);
          }
          return;
        }
      }

      if (host.archiveConfirm.get()) {
        host.archiveConfirm.set(null);
      }

      if (context.renameEditing) return;

      close();
    },
  };
}

function isToolbarElement(target: EventTarget | null, viewWindow: ToolbarDomWindow | null): target is Element {
  return Boolean(viewWindow && target instanceof viewWindow.Element);
}

export function createToolbarArchiveConfirmState(): ToolbarArchiveConfirmState {
  const id = signal<string | null>(null);
  return {
    id,
    get: () => id.value,
    set: (nextThreadId) => {
      if (id.value === nextThreadId) return;
      id.value = nextThreadId;
    },
  };
}
