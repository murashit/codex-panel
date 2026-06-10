import type { ChatShellRenderPort } from "./shell-render";

export interface ChatViewRenderControllerHost {
  shell: ChatShellRenderPort;
  panelRoot: () => HTMLElement | null;
  clearScheduledRender: () => void;
}

export class ChatViewRenderController {
  constructor(private readonly host: ChatViewRenderControllerHost) {}

  render(): void {
    this.host.clearScheduledRender();
    const root = this.host.panelRoot();
    if (!root) return;
    this.host.shell.render(root);
  }
}
