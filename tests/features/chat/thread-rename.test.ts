import { describe, expect, it, vi } from "vitest";

import { createChatStateStore } from "../../../src/features/chat/chat-state";
import { ThreadRenameController } from "../../../src/features/chat/threads/thread-rename-controller";
import type { AppServerClient } from "../../../src/app-server/client";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import type { ThreadItem } from "../../../src/generated/app-server/v2/ThreadItem";
import type { Turn } from "../../../src/generated/app-server/v2/Turn";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import { deferred } from "../../support/async";

describe("ThreadRenameController", () => {
  it("rerenders after updating a controlled rename draft", () => {
    const { controller, render } = controllerFixture();

    controller.start("thread");
    render.mockClear();
    controller.updateDraft("thread", "New name");

    expect(render).toHaveBeenCalledOnce();
    expect(controller.editState("thread")).toEqual({ draft: "New name", generating: false });
  });

  it("applies generated rename drafts and clears the generating state", async () => {
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { controller } = controllerFixture({ generateThreadTitle });

    controller.start("thread");
    await controller.autoNameDraft("thread");

    expect(generateThreadTitle).toHaveBeenCalledOnce();
    expect(controller.editState("thread")).toEqual({ draft: "Generated title", generating: false });
  });

  it("does not revive rename generation after cancellation while connection is pending", async () => {
    const connection = deferred<undefined>();
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { controller } = controllerFixture({
      ensureConnected: vi.fn(() => connection.promise),
      generateThreadTitle,
    });

    controller.start("thread");
    const autoName = controller.autoNameDraft("thread");
    controller.cancel("thread");
    connection.resolve(undefined);
    await autoName;

    expect(generateThreadTitle).not.toHaveBeenCalled();
    expect(controller.editState("thread")).toBeNull();
  });

  it("does not save after cancellation while connection is pending", async () => {
    const connection = deferred<undefined>();
    const setThreadName = vi.fn().mockResolvedValue({});
    const client = fakeClient({ setThreadName });
    const { controller } = controllerFixture({
      ensureConnected: vi.fn(() => connection.promise),
      currentClient: () => client,
    });

    controller.start("thread");
    const save = controller.save("thread", "Saved title");
    controller.cancel("thread");
    connection.resolve(undefined);
    await save;

    expect(setThreadName).not.toHaveBeenCalled();
    expect(controller.editState("thread")).toBeNull();
  });

  it("renames a thread without entering inline edit state", async () => {
    const setThreadName = vi.fn().mockResolvedValue({});
    const client = fakeClient({ setThreadName });
    const { controller, notifyThreadRenamed, stateStore } = controllerFixture({
      currentClient: () => client,
    });

    await controller.rename("thread", " Slash command title ");

    expect(setThreadName).toHaveBeenCalledWith("thread", "Slash command title");
    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("Slash command title");
    expect(notifyThreadRenamed).toHaveBeenCalledWith("thread", "Slash command title");
    expect(controller.editState("thread")).toBeNull();
  });

  it("ignores empty slash command rename titles", async () => {
    const setThreadName = vi.fn().mockResolvedValue({});
    const client = fakeClient({ setThreadName });
    const { controller } = controllerFixture({
      currentClient: () => client,
    });

    await controller.rename("thread", "   ");

    expect(setThreadName).not.toHaveBeenCalled();
  });

  it("keeps an edited draft when auto-name generation finishes later", async () => {
    const generatedTitle = deferred<string | null>();
    const { controller } = controllerFixture({
      generateThreadTitle: vi.fn(() => generatedTitle.promise),
    });

    controller.start("thread");
    const autoName = controller.autoNameDraft("thread");
    await flushPromises();

    expect(controller.editState("thread")).toEqual({ draft: "Thread preview", generating: true });

    controller.updateDraft("thread", "Manual draft");
    generatedTitle.resolve("Generated title");
    await autoName;

    expect(controller.editState("thread")).toEqual({ draft: "Manual draft", generating: false });
  });
});

function controllerFixture(
  overrides: Partial<ConstructorParameters<typeof ThreadRenameController>[0]> = {},
): ConstructorParameters<typeof ThreadRenameController>[0] & { controller: ThreadRenameController; render: ReturnType<typeof vi.fn> } {
  const stateStore = createChatStateStore();
  stateStore.dispatch({ type: "thread-list/applied", threads: [threadFixture("thread")] });
  const render = vi.fn();
  const host = {
    stateStore,
    vaultPath: "/vault",
    settings: () => DEFAULT_SETTINGS,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    currentClient: () => fakeClient(),
    refreshThreads: vi.fn().mockResolvedValue(undefined),
    render,
    addSystemMessage: vi.fn(),
    notifyThreadRenamed: vi.fn(),
    ...overrides,
  } satisfies ConstructorParameters<typeof ThreadRenameController>[0];
  return { ...host, controller: new ThreadRenameController(host), render };
}

function fakeClient(options: { setThreadName?: ReturnType<typeof vi.fn> } = {}): AppServerClient {
  return {
    setThreadName: options.setThreadName ?? vi.fn().mockResolvedValue({}),
    threadTurnsList: vi.fn().mockResolvedValue({
      data: [turnFixture([userMessage("user", "Please name this."), assistantMessage("assistant", "Done.")])],
      nextCursor: null,
    }),
  } as unknown as AppServerClient;
}

function threadFixture(id: string): Thread {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
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

function turnFixture(items: ThreadItem[]): Turn {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1000,
  };
}

function userMessage(id: string, text: string): ThreadItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function assistantMessage(id: string, text: string): ThreadItem {
  return { type: "agentMessage", id, text, phase: null, memoryCitation: null };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
