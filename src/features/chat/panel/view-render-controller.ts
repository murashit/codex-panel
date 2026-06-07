import type { ChatViewRenderScheduleOptions } from "./lifecycle";
import type { ChatShellRenderPort } from "./shell-render";

export interface ChatViewRenderControllerHost {
  shell: ChatShellRenderPort;
  panelRoot: () => HTMLElement | null;
  renderToolbar: (toolbar: HTMLElement) => void;
  renderGoal: (goal: HTMLElement) => void;
  renderMessages: (parent: HTMLElement) => void;
  renderComposer: (parent: HTMLElement) => void;
  clearScheduledRender: () => void;
}

export class ChatViewRenderController {
  private shellRenderVersion = 0;

  constructor(private readonly host: ChatViewRenderControllerHost) {}

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
    this.host.renderToolbar(toolbar);
  };

  private readonly renderGoalSlot = (goal: HTMLElement): void => {
    this.host.renderGoal(goal);
  };

  private readonly renderMessagesSlot = (parent: HTMLElement): void => {
    this.host.renderMessages(parent);
  };

  private readonly renderComposerSlot = (parent: HTMLElement): void => {
    this.host.renderComposer(parent);
  };
}
