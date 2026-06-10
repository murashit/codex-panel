import type { ChatViewRenderScheduleOptions } from "./lifecycle";
import type { ChatShellRenderPort } from "./shell-render";

export interface ChatViewRenderControllerHost {
  shell: ChatShellRenderPort;
  panelRoot: () => HTMLElement | null;
  clearScheduledRender: () => void;
}

export interface ChatViewSlotRenderers {
  renderToolbar: (toolbar: HTMLElement) => void;
  renderGoal: (goal: HTMLElement) => void;
  renderMessages: (parent: HTMLElement) => void;
  renderComposer: (parent: HTMLElement) => void;
}

export class ChatViewRenderController {
  private shellRenderVersion = 0;
  private slotRenderers: ChatViewSlotRenderers | null = null;

  constructor(private readonly host: ChatViewRenderControllerHost) {}

  setSlotRenderers(slotRenderers: ChatViewSlotRenderers): void {
    this.slotRenderers = slotRenderers;
  }

  render(options: ChatViewRenderScheduleOptions = {}): void {
    this.host.clearScheduledRender();
    const root = this.host.panelRoot();
    if (!root) return;
    if (options.forceSlots) this.shellRenderVersion += 1;
    this.host.shell.render(root, this.shellRenderVersion, {
      renderToolbar: this.renderToolbarSlot,
      renderGoal: this.renderGoalSlot,
      renderMessages: this.renderMessagesSlot,
      renderComposer: this.renderComposerSlot,
    });
  }

  renderShellSlots(): void {
    this.render({ forceSlots: true });
  }

  private readonly renderToolbarSlot = (toolbar: HTMLElement): void => {
    this.slotRenderers?.renderToolbar(toolbar);
  };

  private readonly renderGoalSlot = (goal: HTMLElement): void => {
    this.slotRenderers?.renderGoal(goal);
  };

  private readonly renderMessagesSlot = (parent: HTMLElement): void => {
    this.slotRenderers?.renderMessages(parent);
  };

  private readonly renderComposerSlot = (parent: HTMLElement): void => {
    this.slotRenderers?.renderComposer(parent);
  };
}
