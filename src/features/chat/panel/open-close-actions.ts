import type { EventRef, WorkspaceLeaf } from "obsidian";

import { unmountChatPanelShell } from "../ui/shell";

export interface ChatViewOpenCloseActionsHost {
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

export interface ChatViewOpenCloseActions {
  open: () => void;
  close: () => void;
}

export function createChatViewOpenCloseActions(host: ChatViewOpenCloseActionsHost): ChatViewOpenCloseActions {
  return {
    open: () => {
      openChatView(host);
    },
    close: () => {
      closeChatView(host);
    },
  };
}

function openChatView(host: ChatViewOpenCloseActionsHost): void {
  host.setOpened(true);
  host.setClosing(false);
  host.registerComposerNoteIndexInvalidation((eventRef) => {
    host.registerEvent(eventRef);
  });
  host.registerPointerDown((event) => {
    host.closeToolbarPanelOnOutsidePointer(event);
  });
  host.registerActiveLeafChange((leaf) => {
    if (host.isOwnLeaf(leaf)) host.scrollMessagesToBottomOnFocus();
  });
  host.applyCachedSharedAppServerState();
  host.render();
  host.scheduleDeferredAppServerWarmup();
  host.scheduleDeferredRestoredThreadHydration();
}

function closeChatView(host: ChatViewOpenCloseActionsHost): void {
  host.setOpened(false);
  host.setClosing(true);
  host.invalidateConnectionWork();
  host.invalidateResumeWork();
  host.clearDeferredTasks();
  const panelRoot = host.panelRoot();
  host.disposeMessages();
  host.disposeComposer();
  unmountChatPanelShell(panelRoot);
  host.disconnect();
  host.clearClient();
  host.refreshLiveState();
  host.deferRefreshLiveState();
}
