// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

import type { Thread } from "../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../src/features/chat/state/reducer";
import { runtimeSnapshotForChatState } from "../../../../src/features/chat/runtime/snapshot";
import { createToolbarArchiveConfirmState, ToolbarPanelController } from "../../../../src/features/chat/panel/regions/toolbar";
import type { ChatPanelToolbarPorts } from "../../../../src/features/chat/panel/regions/ports";
import type { ChatThreadActions } from "../../../../src/features/chat/threads/actions";
import { renderChatPanelShell, unmountChatPanelShell } from "../../../../src/features/chat/ui/shell";
import { chatPanelToolbarRegionNode } from "../../../../src/features/chat/panel/regions/render";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("chat toolbar archive confirmation signal", () => {
  it("updates a mounted toolbar archive confirmation without a scheduled shell render", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    const archiveConfirm = createToolbarArchiveConfirmState();
    const scheduleRender = vi.fn();
    const controller = new ToolbarPanelController({
      stateStore: store,
      threadActions: { archiveThread: vi.fn() } as unknown as ChatThreadActions,
      archiveConfirm,
      scheduleRender,
    });
    store.dispatch({ type: "thread-list/applied", threads: [threadFixture("thread-1", "Thread one")] });
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, {
        stateStore: store,
        showToolbar: true,
        toolbarNode: () => chatPanelToolbarRegionNode(toolbarPorts(store, controller)),
        goalNode: () => null,
        messageStreamNode: () => <div className="codex-panel__region codex-panel__region--message-stream codex-panel__messages" />,
        composerNode: () => null,
      });
      await settle();
    });

    expect(container.querySelector(".codex-panel__archive-confirm")).toBeNull();

    await act(async () => {
      controller.startArchive("thread-1");
      await settle();
    });

    expect(scheduleRender).not.toHaveBeenCalled();
    expect(container.querySelector(".codex-panel__archive-confirm")).not.toBeNull();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });
});

function toolbarPorts(store: ReturnType<typeof createChatStateStore>, controller: ToolbarPanelController): ChatPanelToolbarPorts {
  return {
    state: {
      chat: () => store.getState(),
      connected: () => false,
      turnBusy: () => false,
    },
    settings: {
      vaultPath: () => "/vault",
      configuredCommand: () => "codex",
      archiveExportEnabled: () => true,
    },
    runtime: {
      snapshot: () => runtimeSnapshotForChatState(store.getState()),
    },
    view: {
      toolbar: {
        archiveConfirmId: () => controller.archiveConfirmId(),
        archiveConfirmSubscribe: (listener) => controller.onArchiveConfirmChange(listener),
        renameState: () => null,
        renameSubscribe: () => () => undefined,
      },
    },
    actions: {
      toolbar: {
        startNewThread: vi.fn(),
        toggleChatActions: vi.fn(),
        compactConversation: vi.fn(),
        setGoal: vi.fn(),
        toggleHistory: vi.fn(),
        toggleStatusPanel: vi.fn(),
        connect: vi.fn(),
        refreshStatus: vi.fn(),
        resumeThread: vi.fn(),
        startArchiveThread: (threadId) => {
          controller.startArchive(threadId);
        },
        archiveThread: vi.fn(),
        startRenameThread: vi.fn(),
        updateRenameDraft: vi.fn(),
        saveRenameThread: vi.fn(),
        cancelRenameThread: vi.fn(),
        autoNameThread: vi.fn(),
      },
    },
  };
}

function threadFixture(id: string, name: string): Thread {
  return {
    id,
    name,
    preview: "",
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
