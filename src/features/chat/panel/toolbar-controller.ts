import type { ChatAction, ChatState, ChatStateStore } from "../chat-state";
import type { ChatThreadActions } from "../threads/thread-actions";
import type { ChatViewRenderScheduleOptions } from "./lifecycle";

export interface ToolbarPanelControllerHost {
  stateStore: ChatStateStore;
  threadActions: ChatThreadActions;
  scheduleRender: (options?: ChatViewRenderScheduleOptions) => void;
}

export interface ToolbarOutsidePointerContext {
  target: EventTarget | null;
  viewWindow: ToolbarDomWindow | null;
  contains: (element: Element) => boolean;
  renameEditing: boolean;
}

type ToolbarDomWindow = Window & { Element: typeof Element };

export class ToolbarPanelController {
  private archiveConfirmThreadId: string | null = null;

  constructor(private readonly host: ToolbarPanelControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  archiveConfirmId(): string | null {
    return this.archiveConfirmThreadId;
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
    this.archiveConfirmThreadId = null;
  }

  startArchive(threadId: string): void {
    this.archiveConfirmThreadId = threadId;
    this.host.scheduleRender({ forceSlots: true });
  }

  async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
    if (this.archiveConfirmThreadId === threadId) this.archiveConfirmThreadId = null;
    await this.host.threadActions.archiveThread(threadId, saveMarkdown);
    this.host.scheduleRender({ forceSlots: true });
  }

  closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void {
    if (!this.hasOpenPanel()) return;

    const target = context.target;
    if (isToolbarElement(target, context.viewWindow)) {
      const insideToolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
      if (insideToolbarPanel && context.contains(insideToolbarPanel)) {
        if (this.archiveConfirmThreadId && !target.closest(".codex-panel__archive-confirm")) {
          this.archiveConfirmThreadId = null;
          this.host.scheduleRender({ forceSlots: true });
        }
        return;
      }
    }

    if (this.archiveConfirmThreadId) {
      this.archiveConfirmThreadId = null;
      this.host.scheduleRender({ forceSlots: true });
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
    this.archiveConfirmThreadId = null;
    this.host.scheduleRender({ forceSlots: true });
  }
}

function isToolbarElement(target: EventTarget | null, viewWindow: ToolbarDomWindow | null): target is Element {
  return Boolean(viewWindow && target instanceof viewWindow.Element);
}
