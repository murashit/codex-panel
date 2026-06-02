import type { EventRef, WorkspaceLeaf } from "obsidian";

import { unmountChatPanelShell } from "../../ui/shell";

export interface ChatViewOpenCloseControllerHost {
  setOpened: (opened: boolean) => void;
  setClosing: (closing: boolean) => void;
  registerEvent: (eventRef: EventRef) => void;
  registerComposerNoteIndexInvalidation: (register: (eventRef: EventRef) => void) => void;
  registerPointerDown: (handler: (event: PointerEvent) => void) => void;
  registerActiveLeafChange: (handler: (leaf: WorkspaceLeaf | null) => void) => void;
  isOwnLeaf: (leaf: WorkspaceLeaf | null) => boolean;
  scrollMessagesToBottomOnFocus: () => void;
  applyCachedSharedAppServerState: () => void;
  render: () => void;
  scheduleDeferredAppServerWarmup: () => void;
  scheduleDeferredRestoredThreadHydration: () => void;
  closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
  invalidateConnectionWork: () => void;
  invalidateResumeWork: () => void;
  clearDeferredTasks: () => void;
  panelRoot: () => HTMLElement | null;
  disposeMessages: () => void;
  disposeComposer: () => void;
  disconnect: () => void;
  clearClient: () => void;
  refreshLiveState: () => void;
  deferRefreshLiveState: () => void;
}

export class ChatViewOpenCloseController {
  constructor(private readonly host: ChatViewOpenCloseControllerHost) {}

  open(): void {
    this.host.setOpened(true);
    this.host.setClosing(false);
    this.host.registerComposerNoteIndexInvalidation((eventRef) => {
      this.host.registerEvent(eventRef);
    });
    this.host.registerPointerDown((event) => {
      this.host.closeToolbarPanelOnOutsidePointer(event);
    });
    this.host.registerActiveLeafChange((leaf) => {
      if (this.host.isOwnLeaf(leaf)) this.host.scrollMessagesToBottomOnFocus();
    });
    this.host.applyCachedSharedAppServerState();
    this.host.render();
    this.host.scheduleDeferredAppServerWarmup();
    this.host.scheduleDeferredRestoredThreadHydration();
  }

  close(): void {
    this.host.setOpened(false);
    this.host.setClosing(true);
    this.host.invalidateConnectionWork();
    this.host.invalidateResumeWork();
    this.host.clearDeferredTasks();
    const panelRoot = this.host.panelRoot();
    this.host.disposeMessages();
    this.host.disposeComposer();
    unmountChatPanelShell(panelRoot);
    this.host.disconnect();
    this.host.clearClient();
    this.host.refreshLiveState();
    this.host.deferRefreshLiveState();
  }
}
