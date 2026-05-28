import { describe, expect, it, vi } from "vitest";

import { createChatStateStore } from "../../../src/features/chat/chat-state";
import { ThreadRenameController } from "../../../src/features/chat/thread-rename";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";

describe("ThreadRenameController", () => {
  it("rerenders after updating a controlled rename draft", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "thread/list-applied", threads: [threadFixture("thread")] });
    const render = vi.fn();
    const controller = new ThreadRenameController({
      stateStore,
      vaultPath: "/vault",
      settings: () => DEFAULT_SETTINGS,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      currentClient: () => null,
      refreshThreads: vi.fn().mockResolvedValue(undefined),
      render,
      addSystemMessage: vi.fn(),
      notifyThreadRenamed: vi.fn(),
    });

    controller.start("thread");
    render.mockClear();
    controller.updateDraft("thread", "New name");

    expect(render).toHaveBeenCalledOnce();
    expect(controller.editState("thread")).toEqual({ draft: "New name", generating: false });
  });
});

function threadFixture(id: string): Thread {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    preview: "Thread preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}
