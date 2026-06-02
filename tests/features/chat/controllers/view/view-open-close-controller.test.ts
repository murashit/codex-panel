// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRef } from "obsidian";

import {
  ChatViewOpenCloseController,
  type ChatViewOpenCloseControllerHost,
} from "../../../../../src/features/chat/controllers/view/view-open-close-controller";
import { unmountChatPanelShell } from "../../../../../src/features/chat/ui/shell";
import { unmountUiRoot } from "../../../../../src/shared/ui/ui-root";

vi.mock("../../../../../src/features/chat/ui/shell", () => ({
  unmountChatPanelShell: vi.fn(),
}));

vi.mock("../../../../../src/shared/ui/ui-root", () => ({
  unmountUiRoot: vi.fn(),
}));

function createHost(overrides: Partial<ChatViewOpenCloseControllerHost> = {}) {
  const root = document.createElement("div");
  const toolbar = document.createElement("div");
  toolbar.className = "codex-panel__toolbar";
  root.appendChild(toolbar);
  const composer = document.createElement("div");
  composer.className = "codex-panel__slot--composer";
  root.appendChild(composer);
  const host: ChatViewOpenCloseControllerHost = {
    setOpened: vi.fn(),
    setClosing: vi.fn(),
    registerEvent: vi.fn(),
    registerComposerNoteIndexInvalidation: vi.fn((register) => {
      register({} as EventRef);
    }),
    registerPointerDown: vi.fn(),
    registerActiveLeafChange: vi.fn(),
    isOwnLeaf: vi.fn(() => false),
    scrollMessagesToBottomOnFocus: vi.fn(),
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
  return { controller: new ChatViewOpenCloseController(host), host, root };
}

describe("ChatViewOpenCloseController", () => {
  beforeEach(() => {
    vi.mocked(unmountChatPanelShell).mockClear();
    vi.mocked(unmountUiRoot).mockClear();
  });

  it("registers open events and schedules startup work", () => {
    const { controller, host } = createHost();

    controller.open();

    expect(host.setOpened).toHaveBeenCalledWith(true);
    expect(host.setClosing).toHaveBeenCalledWith(false);
    expect(host.registerEvent).toHaveBeenCalledOnce();
    expect(host.registerPointerDown).toHaveBeenCalledOnce();
    expect(host.registerActiveLeafChange).toHaveBeenCalledOnce();
    expect(host.applyCachedSharedAppServerState).toHaveBeenCalledOnce();
    expect(host.render).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredAppServerWarmup).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredRestoredThreadHydration).toHaveBeenCalledOnce();
  });

  it("disposes mounted resources and refreshes live state on close", () => {
    const { controller, host, root } = createHost();

    controller.close();

    expect(host.setOpened).toHaveBeenCalledWith(false);
    expect(host.setClosing).toHaveBeenCalledWith(true);
    expect(host.clearDeferredTasks).toHaveBeenCalledOnce();
    expect(unmountUiRoot).toHaveBeenCalledWith(root.querySelector(".codex-panel__toolbar"));
    expect(host.disposeMessages).toHaveBeenCalledOnce();
    expect(host.disposeComposer).toHaveBeenCalledOnce();
    expect(unmountChatPanelShell).toHaveBeenCalledWith(root);
    expect(host.disconnect).toHaveBeenCalledOnce();
    expect(host.clearClient).toHaveBeenCalledOnce();
    expect(host.refreshLiveState).toHaveBeenCalledOnce();
    expect(host.deferRefreshLiveState).toHaveBeenCalledOnce();
  });
});
