import type { ChatAction, ChatState, ChatStateStore } from "../chat-state";
import type { ChatThreadActions } from "../threads/thread-actions";
import type { ToolbarArchiveConfirmState } from "./toolbar-archive-confirm-state";

export interface ToolbarPanelControllerHost {
  stateStore: ChatStateStore;
  threadActions: ChatThreadActions;
  archiveConfirm: ToolbarArchiveConfirmState;
  scheduleRender: () => void;
}

export interface ToolbarOutsidePointerContext {
  target: EventTarget | null;
  viewWindow: ToolbarDomWindow | null;
  contains: (element: Element) => boolean;
  renameEditing: boolean;
}

type ToolbarDomWindow = Window & { Element: typeof Element };

export class ToolbarPanelController {
  constructor(private readonly host: ToolbarPanelControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  archiveConfirmId(): string | null {
    return this.host.archiveConfirm.get();
  }

  onArchiveConfirmChange(listener: () => void): () => void {
    return this.host.archiveConfirm.subscribe(listener);
  }

  toggleHistory(): void {
    this.dispatch({ type: "ui/panel-set", panel: "history", toggle: true });
    this.host.scheduleRender();
  }

  toggleChatActions(): void {
    this.dispatch({ type: "ui/panel-set", panel: "chat-actions", toggle: true });
    this.host.scheduleRender();
  }

  closeToolbarPanels(): void {
    this.close();
  }

  toggleStatus(): void {
    this.dispatch({ type: "ui/panel-set", panel: "status-panel", toggle: true });
    this.host.scheduleRender();
  }

  closeForThreadSelection(): void {
    this.host.archiveConfirm.set(null);
  }

  startArchive(threadId: string): void {
    this.host.archiveConfirm.set(threadId);
  }

  async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
    if (this.host.archiveConfirm.get() === threadId) this.host.archiveConfirm.set(null);
    await this.host.threadActions.archiveThread(threadId, saveMarkdown);
    this.host.scheduleRender();
  }

  closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void {
    if (!this.hasOpenPanel()) return;

    const target = context.target;
    if (isToolbarElement(target, context.viewWindow)) {
      const insideToolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
      if (insideToolbarPanel && context.contains(insideToolbarPanel)) {
        if (this.host.archiveConfirm.get() && !target.closest(".codex-panel__archive-confirm")) {
          this.host.archiveConfirm.set(null);
        }
        return;
      }
    }

    if (this.host.archiveConfirm.get()) {
      this.host.archiveConfirm.set(null);
    }

    if (context.renameEditing) return;

    this.close();
  }

  private hasOpenPanel(): boolean {
    return this.state.ui.toolbarPanel !== null;
  }

  private close(): void {
    if (!this.hasOpenPanel()) return;

    this.dispatch({ type: "ui/panel-set", panel: null });
    this.host.archiveConfirm.set(null);
    this.host.scheduleRender();
  }
}

function isToolbarElement(target: EventTarget | null, viewWindow: ToolbarDomWindow | null): target is Element {
  return Boolean(viewWindow && target instanceof viewWindow.Element);
}
