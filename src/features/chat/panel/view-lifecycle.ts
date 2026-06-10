import type { EventRef, WorkspaceLeaf } from "obsidian";

import { unmountChatPanelShell } from "../ui/shell";

export interface ChatViewLifecycleHost {
  setOpened: (opened: boolean) => void;
  setClosing: (closing: boolean) => void;
  registerEvent: (eventRef: EventRef) => void;
  registerComposerNoteIndexInvalidation: (register: (eventRef: EventRef) => void) => void;
  registerPointerDown: (handler: (event: PointerEvent) => void) => void;
  registerActiveLeafChange: (handler: (leaf: WorkspaceLeaf | null) => void) => void;
  handleActiveLeafChange: (leaf: WorkspaceLeaf | null) => void;
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

export function openChatView(host: ChatViewLifecycleHost): void {
  host.setOpened(true);
  host.setClosing(false);
  host.registerComposerNoteIndexInvalidation((eventRef) => {
    host.registerEvent(eventRef);
  });
  host.registerPointerDown((event) => {
    host.closeToolbarPanelOnOutsidePointer(event);
  });
  host.registerActiveLeafChange(host.handleActiveLeafChange);
  host.applyCachedSharedAppServerState();
  host.render();
  host.scheduleDeferredAppServerWarmup();
  host.scheduleDeferredRestoredThreadHydration();
}

export function closeChatView(host: ChatViewLifecycleHost): void {
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
