import { describe, expect, it, vi } from "vitest";

import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { ThreadRenameEditorController } from "../../../../src/features/chat/application/threads/rename-editor-controller";
import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { Thread } from "../../../../src/domain/threads/model";
import type { TurnItem, TurnRecord } from "../../../../src/app-server/protocol/turn";
import { threadRenameFromValue } from "../../../../src/app-server/services/thread-rename";
import { deferred } from "../../../support/async";

describe("ThreadRenameEditorController", () => {
  it("stores controlled rename drafts in chat UI state", () => {
    const { controller } = controllerFixture();

    controller.start("thread");
    controller.updateDraft("thread", "New name");

    expect(controller.editState("thread")).toEqual({ draft: "New name", generating: false });
  });

  it("clears inline rename state through chat UI state", () => {
    const { controller } = controllerFixture();

    controller.start("thread");
    controller.updateDraft("thread", "New name");
    controller.cancel("thread");

    expect(controller.editState("thread")).toBeNull();
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

  it("does not clear a newer inline rename when an older save finishes", async () => {
    const saved = deferred<object>();
    const setThreadName = vi.fn(() => saved.promise);
    const { controller, stateStore, notifyThreadRenamed } = controllerFixture({
      currentClient: () => fakeClient({ setThreadName }),
    });

    controller.start("thread");
    const save = controller.save("thread", " Saved   title ");
    await flushPromises();

    controller.cancel("thread");
    controller.start("thread");
    controller.updateDraft("thread", "New draft");
    saved.resolve({});
    await save;

    expect(setThreadName).toHaveBeenCalledWith("thread", "Saved title");
    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("Saved title");
    expect(notifyThreadRenamed).toHaveBeenCalledWith("thread", "Saved title");
    expect(controller.editState("thread")).toEqual({ draft: "New draft", generating: false });
  });

  it("keeps an edited draft when auto-name generation finishes later", async () => {
    const generatedTitle = deferred<string>();
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

  it("does not let an older auto-name request finish a newer generation", async () => {
    const firstGeneratedTitle = deferred<string>();
    const secondGeneratedTitle = deferred<string>();
    const generateThreadTitle = vi.fn().mockReturnValueOnce(firstGeneratedTitle.promise).mockReturnValueOnce(secondGeneratedTitle.promise);
    const { controller } = controllerFixture({ generateThreadTitle });

    controller.start("thread");
    const firstAutoName = controller.autoNameDraft("thread");
    await flushPromises();
    controller.cancel("thread");
    controller.start("thread");
    const secondAutoName = controller.autoNameDraft("thread");
    await flushPromises();

    firstGeneratedTitle.resolve("Old generated title");
    await firstAutoName;

    expect(controller.editState("thread")).toEqual({ draft: "Thread preview", generating: true });

    secondGeneratedTitle.resolve("New generated title");
    await secondAutoName;

    expect(controller.editState("thread")).toEqual({ draft: "New generated title", generating: false });
  });
});

function controllerFixture(
  overrides: Partial<Pick<ConstructorParameters<typeof ThreadRenameEditorController>[0], "ensureConnected" | "addSystemMessage">> & {
    currentClient?: () => AppServerClient;
    generateThreadTitle?: () => Promise<string>;
  } = {},
): ConstructorParameters<typeof ThreadRenameEditorController>[0] & {
  controller: ThreadRenameEditorController;
  notifyThreadRenamed: ReturnType<typeof vi.fn>;
} {
  const stateStore = createChatStateStore();
  stateStore.dispatch({ type: "thread-list/applied", threads: [threadFixture("thread")] });
  const currentClient = overrides.currentClient ?? (() => fakeClient());
  const notifyThreadRenamed = vi.fn();
  const host = {
    stateStore,
    ensureConnected: overrides.ensureConnected ?? vi.fn().mockResolvedValue(undefined),
    addSystemMessage: overrides.addSystemMessage ?? vi.fn(),
    operations: {
      renameThread: async (threadId: string, value: string) => {
        const rename = threadRenameFromValue(value);
        if (!rename) return false;
        await currentClient().setThreadName(threadId, rename.name);
        stateStore.dispatch({
          type: "thread-list/applied",
          threads: stateStore
            .getState()
            .threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name: rename.name } : thread)),
        });
        notifyThreadRenamed(threadId, rename.name);
        return true;
      },
    },
    titleService: {
      generateTitle: overrides.generateThreadTitle ?? vi.fn().mockResolvedValue("Generated title"),
    },
  } satisfies ConstructorParameters<typeof ThreadRenameEditorController>[0];
  return { ...host, notifyThreadRenamed, controller: new ThreadRenameEditorController(host) };
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
    preview: "Thread preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
  };
}

function turnFixture(items: TurnItem[]): TurnRecord {
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

function userMessage(id: string, text: string): TurnItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function assistantMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: null, memoryCitation: null };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
