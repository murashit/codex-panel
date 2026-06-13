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
    lifecycle: {
      setOpened: vi.fn(),
      setClosing: vi.fn(),
      invalidateConnectionWork: vi.fn(),
      invalidateResumeWork: vi.fn(),
      clearDeferredTasks: vi.fn(),
      scheduleDeferredAppServerWarmup: vi.fn(),
      scheduleDeferredRestoredThreadHydration: vi.fn(),
    },
    events: {
      registerEvent: vi.fn(),
      registerComposerNoteIndexInvalidation: vi.fn((register) => {
        register({} as EventRef);
      }),
      registerPointerDown: vi.fn(),
      closeToolbarPanelOnOutsidePointer: vi.fn(),
    },
    render: {
      panelRoot: () => root,
      mountOrRepairShell: vi.fn(),
    },
    sharedState: {
      applyCachedAppServerState: vi.fn(),
    },
    resources: {
      disposeMessages: vi.fn(),
      disposeComposer: vi.fn(),
      disconnect: vi.fn(),
    },
    liveState: {
      refresh: vi.fn(),
      deferRefresh: vi.fn(),
    },
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

    expect(host.lifecycle.setOpened).toHaveBeenCalledWith(true);
    expect(host.lifecycle.setClosing).toHaveBeenCalledWith(false);
    expect(host.events.registerEvent).toHaveBeenCalledOnce();
    expect(host.events.registerPointerDown).toHaveBeenCalledOnce();
    expect(host.sharedState.applyCachedAppServerState).toHaveBeenCalledOnce();
    expect(host.render.mountOrRepairShell).toHaveBeenCalledOnce();
    expect(host.lifecycle.scheduleDeferredAppServerWarmup).toHaveBeenCalledOnce();
    expect(host.lifecycle.scheduleDeferredRestoredThreadHydration).toHaveBeenCalledOnce();
  });

  it("disposes mounted resources and refreshes live state on close", () => {
    const { host, root } = createHost();

    closeChatView(host);

    expect(host.lifecycle.setOpened).toHaveBeenCalledWith(false);
    expect(host.lifecycle.setClosing).toHaveBeenCalledWith(true);
    expect(host.lifecycle.clearDeferredTasks).toHaveBeenCalledOnce();
    expect(host.resources.disposeMessages).toHaveBeenCalledOnce();
    expect(host.resources.disposeComposer).toHaveBeenCalledOnce();
    expect(unmountChatPanelShell).toHaveBeenCalledWith(root);
    expect(host.resources.disconnect).toHaveBeenCalledOnce();
    expect(host.liveState.refresh).toHaveBeenCalledOnce();
    expect(host.liveState.deferRefresh).toHaveBeenCalledOnce();
  });
});
