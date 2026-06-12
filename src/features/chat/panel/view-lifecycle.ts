import type { EventRef } from "obsidian";

import { unmountChatPanelShell } from "../ui/shell";

export interface ChatViewLifecycleHost {
  lifecycle: {
    setOpened: (opened: boolean) => void;
    setClosing: (closing: boolean) => void;
    invalidateConnectionWork: () => void;
    invalidateResumeWork: () => void;
    clearDeferredTasks: () => void;
    scheduleDeferredAppServerWarmup: () => void;
    scheduleDeferredRestoredThreadHydration: () => void;
  };
  events: {
    registerEvent: (eventRef: EventRef) => void;
    registerComposerNoteIndexInvalidation: (register: (eventRef: EventRef) => void) => void;
    registerPointerDown: (handler: (event: PointerEvent) => void) => void;
    closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
  };
  render: {
    panelRoot: () => HTMLElement | null;
    now: () => void;
  };
  sharedState: {
    applyCachedAppServerState: () => void;
  };
  resources: {
    disposeMessages: () => void;
    disposeComposer: () => void;
    disconnect: () => void;
    clearClient: () => void;
  };
  liveState: {
    refresh: () => void;
    deferRefresh: () => void;
  };
}

export function openChatView(host: ChatViewLifecycleHost): void {
  host.lifecycle.setOpened(true);
  host.lifecycle.setClosing(false);
  host.events.registerComposerNoteIndexInvalidation((eventRef) => {
    host.events.registerEvent(eventRef);
  });
  host.events.registerPointerDown((event) => {
    host.events.closeToolbarPanelOnOutsidePointer(event);
  });
  host.sharedState.applyCachedAppServerState();
  host.render.now();
  host.lifecycle.scheduleDeferredAppServerWarmup();
  host.lifecycle.scheduleDeferredRestoredThreadHydration();
}

export function closeChatView(host: ChatViewLifecycleHost): void {
  host.lifecycle.setOpened(false);
  host.lifecycle.setClosing(true);
  host.lifecycle.invalidateConnectionWork();
  host.lifecycle.invalidateResumeWork();
  host.lifecycle.clearDeferredTasks();
  const panelRoot = host.render.panelRoot();
  host.resources.disposeMessages();
  host.resources.disposeComposer();
  unmountChatPanelShell(panelRoot);
  host.resources.disconnect();
  host.resources.clearClient();
  host.liveState.refresh();
  host.liveState.deferRefresh();
}
