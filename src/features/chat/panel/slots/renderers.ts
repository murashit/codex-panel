import { activeComposerThreadName, composerMetaViewModel, composerPlaceholder, renderComposerSlot } from "./composer";
import { renderGoalSlot } from "./goal";
import { pendingRequestsSignature, renderMessagesSlot } from "./messages";
import { renderToolbarSlot } from "./toolbar";
import type { ChatViewSlotRendererPorts } from "./types";

export class ChatViewSlotRenderers {
  constructor(private readonly ports: ChatViewSlotRendererPorts) {}

  renderToolbar(toolbar: HTMLElement): void {
    renderToolbarSlot(toolbar, this.ports);
  }

  renderGoal(goal: HTMLElement): void {
    renderGoalSlot(goal, this.ports);
  }

  renderMessages(parent: HTMLElement): void {
    renderMessagesSlot(parent, this.ports);
  }

  renderComposer(parent: HTMLElement): void {
    renderComposerSlot(parent, this.ports);
  }

  composerPlaceholder(): string {
    return composerPlaceholder(this.ports);
  }

  composerMetaViewModel() {
    return composerMetaViewModel(this.ports);
  }

  activeComposerThreadName(): string | null {
    return activeComposerThreadName(this.ports);
  }

  pendingRequestsSignature(): string {
    return pendingRequestsSignature(this.ports);
  }
}
