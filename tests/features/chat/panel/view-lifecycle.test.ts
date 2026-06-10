// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRef } from "obsidian";

import { closeChatView, openChatView, type ChatViewLifecycleHost } from "../../../../src/features/chat/panel/view-lifecycle";
import { unmountChatPanelShell } from "../../../../src/features/chat/ui/shell";

vi.mock("../../../../src/features/chat/ui/shell", () => ({
  unmountChatPanelShell: vi.fn(),
}));

function createHost(overrides: Partial<ChatViewLifecycleHost> = {}) {
  const root = document.createElement("div");
  const host: ChatViewLifecycleHost = {
    setOpened: vi.fn(),
    setClosing: vi.fn(),
    registerEvent: vi.fn(),
    registerComposerNoteIndexInvalidation: vi.fn((register) => {
      register({} as EventRef);
    }),
    registerPointerDown: vi.fn(),
    registerActiveLeafChange: vi.fn(),
    handleActiveLeafChange: vi.fn(),
    applyCachedSharedAppServerState: vi.fn(),
    render: vi.fn(),
    scheduleDeferredAppServerWarmup: vi.fn(),
    scheduleDeferredRestoredThreadHydration: vi.fn(),
    closeToolbarPanelOnOutsidePointer: vi.fn(),
    invalidateConnectionWork: vi.fn(),
    invalidateResumeWork: vi.fn(),
    clearDeferredTasks: vi.fn(),
    panelRoot: () => root,
    disposeMessages: vi.fn(),
    disposeComposer: vi.fn(),
    disconnect: vi.fn(),
    clearClient: vi.fn(),
    refreshLiveState: vi.fn(),
    deferRefreshLiveState: vi.fn(),
    ...overrides,
  };
  return { host, root };
}

describe("chat view lifecycle", () => {
  beforeEach(() => {
    vi.mocked(unmountChatPanelShell).mockClear();
  });

  it("registers open events and schedules startup work", () => {
    const { host } = createHost();

    openChatView(host);

    expect(host.setOpened).toHaveBeenCalledWith(true);
    expect(host.setClosing).toHaveBeenCalledWith(false);
    expect(host.registerEvent).toHaveBeenCalledOnce();
    expect(host.registerPointerDown).toHaveBeenCalledOnce();
    expect(host.registerActiveLeafChange).toHaveBeenCalledWith(host.handleActiveLeafChange);
    expect(host.applyCachedSharedAppServerState).toHaveBeenCalledOnce();
    expect(host.render).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredAppServerWarmup).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredRestoredThreadHydration).toHaveBeenCalledOnce();
  });

  it("disposes mounted resources and refreshes live state on close", () => {
    const { host, root } = createHost();

    closeChatView(host);

    expect(host.setOpened).toHaveBeenCalledWith(false);
    expect(host.setClosing).toHaveBeenCalledWith(true);
    expect(host.clearDeferredTasks).toHaveBeenCalledOnce();
    expect(host.disposeMessages).toHaveBeenCalledOnce();
    expect(host.disposeComposer).toHaveBeenCalledOnce();
    expect(unmountChatPanelShell).toHaveBeenCalledWith(root);
    expect(host.disconnect).toHaveBeenCalledOnce();
    expect(host.clearClient).toHaveBeenCalledOnce();
    expect(host.refreshLiveState).toHaveBeenCalledOnce();
    expect(host.deferRefreshLiveState).toHaveBeenCalledOnce();
  });
});
