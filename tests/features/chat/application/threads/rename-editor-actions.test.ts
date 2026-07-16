import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { TurnItem, TurnRecord } from "../../../../../src/app-server/protocol/turn";
import { normalizeExplicitThreadName, type Thread } from "../../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createThreadRenameEditorActions,
  type ThreadRenameEditorActions,
  type ThreadRenameEditorActionsHost,
} from "../../../../../src/features/chat/application/threads/rename-editor-actions";
import { deferred } from "../../../../support/async";

describe("ThreadRenameEditorActions", () => {
  it("stores controlled rename drafts in chat UI state", () => {
    const { actions } = actionsFixture();

    actions.start("thread");
    actions.updateDraft("thread", "New name");

    expect(actions.editState("thread")).toEqual({ draft: "New name", generating: false });
  });

  it("starts rename drafts from useful titles instead of id fallbacks", () => {
    const { actions, stateStore } = actionsFixture();
    stateStore.dispatch({ type: "thread-list/applied", threads: [{ ...threadFixture("thread"), preview: "" }] });

    actions.start("thread");

    expect(actions.editState("thread")).toEqual({ draft: "", generating: false });
  });

  it("clears inline rename state through chat UI state", () => {
    const { actions } = actionsFixture();

    actions.start("thread");
    actions.updateDraft("thread", "New name");
    actions.cancel("thread");

    expect(actions.editState("thread")).toBeNull();
  });

  it("applies generated rename drafts and clears the generating state", async () => {
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { actions } = actionsFixture({ generateThreadTitle });

    actions.start("thread");
    await actions.autoNameDraft("thread");

    expect(generateThreadTitle).toHaveBeenCalledOnce();
    expect(actions.editState("thread")).toEqual({ draft: "Generated title", generating: false });
  });

  it("does not revive rename generation after cancellation while connection is pending", async () => {
    const connection = deferred<undefined>();
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { actions } = actionsFixture({
      ensureConnected: vi.fn(() => connection.promise),
      generateThreadTitle,
    });

    actions.start("thread");
    const autoName = actions.autoNameDraft("thread");
    actions.cancel("thread");
    connection.resolve(undefined);
    await autoName;

    expect(generateThreadTitle).not.toHaveBeenCalled();
    expect(actions.editState("thread")).toBeNull();
  });

  it("does not save after cancellation while connection is pending", async () => {
    const connection = deferred<undefined>();
    const renameThreadRequest = vi.fn().mockResolvedValue({});
    const client = fakeClient({ renameThreadRequest });
    const { actions } = actionsFixture({
      ensureConnected: vi.fn(() => connection.promise),
      currentClient: () => client,
    });

    actions.start("thread");
    const save = actions.save("thread", "Saved title");
    actions.cancel("thread");
    connection.resolve(undefined);
    await save;

    expect(renameThreadRequest).not.toHaveBeenCalled();
    expect(actions.editState("thread")).toBeNull();
  });

  it("does not clear a newer inline rename when an older save finishes", async () => {
    const saved = deferred<object>();
    const renameThreadRequest = vi.fn(() => saved.promise);
    const { actions, stateStore, notifyThreadRenamed } = actionsFixture({
      currentClient: () => fakeClient({ renameThreadRequest }),
    });

    actions.start("thread");
    const save = actions.save("thread", " Saved   title ");
    await flushPromises();

    actions.cancel("thread");
    actions.start("thread");
    actions.updateDraft("thread", "New draft");
    saved.resolve({});
    await save;

    expect(renameThreadRequest).toHaveBeenCalledWith({ threadId: "thread", name: "Saved title" });
    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("Saved title");
    expect(notifyThreadRenamed).toHaveBeenCalledWith("thread", "Saved title");
    expect(actions.editState("thread")).toEqual({ draft: "New draft", generating: false });
  });

  it("keeps an edited draft when auto-name generation finishes later", async () => {
    const generatedTitle = deferred<string>();
    const { actions } = actionsFixture({
      generateThreadTitle: vi.fn(() => generatedTitle.promise),
    });

    actions.start("thread");
    const autoName = actions.autoNameDraft("thread");
    await flushPromises();

    expect(actions.editState("thread")).toEqual({ draft: "Thread preview", generating: true });

    actions.updateDraft("thread", "Manual draft");
    generatedTitle.resolve("Generated title");
    await autoName;

    expect(actions.editState("thread")).toEqual({ draft: "Manual draft", generating: false });
  });

  it("does not let an older auto-name request finish a newer generation", async () => {
    const firstGeneratedTitle = deferred<string>();
    const secondGeneratedTitle = deferred<string>();
    const generateThreadTitle = vi.fn().mockReturnValueOnce(firstGeneratedTitle.promise).mockReturnValueOnce(secondGeneratedTitle.promise);
    const { actions } = actionsFixture({ generateThreadTitle });

    actions.start("thread");
    const firstAutoName = actions.autoNameDraft("thread");
    await flushPromises();
    actions.cancel("thread");
    actions.start("thread");
    const secondAutoName = actions.autoNameDraft("thread");
    await flushPromises();

    firstGeneratedTitle.resolve("Old generated title");
    await firstAutoName;

    expect(actions.editState("thread")).toEqual({ draft: "Thread preview", generating: true });

    secondGeneratedTitle.resolve("New generated title");
    await secondAutoName;

    expect(actions.editState("thread")).toEqual({ draft: "New generated title", generating: false });
  });

  it("does not publish or report title work invalidated by a context replacement", async () => {
    const oldTitle = deferred<string>();
    const generateThreadTitle = vi.fn().mockReturnValueOnce(oldTitle.promise).mockResolvedValueOnce("Fresh title");
    const addSystemMessage = vi.fn();
    const { actions } = actionsFixture({ generateThreadTitle, addSystemMessage });

    actions.start("thread");
    const staleAutoName = actions.autoNameDraft("thread");
    await flushPromises();
    actions.invalidate();

    actions.start("thread");
    await actions.autoNameDraft("thread");
    oldTitle.resolve("Stale title");
    await staleAutoName;

    expect(actions.editState("thread")).toEqual({ draft: "Fresh title", generating: false });
    expect(addSystemMessage).not.toHaveBeenCalled();
  });
});

function actionsFixture(
  overrides: Partial<Pick<ThreadRenameEditorActionsHost, "ensureConnected" | "addSystemMessage">> & {
    currentClient?: () => AppServerClient;
    generateThreadTitle?: () => Promise<string>;
  } = {},
): ThreadRenameEditorActionsHost & {
  actions: ThreadRenameEditorActions;
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
    renameThread: async (threadId: string, value: string) => {
      const name = normalizeExplicitThreadName(value);
      if (!name) return false;
      await currentClient().request("thread/name/set", { threadId, name });
      stateStore.dispatch({
        type: "thread-list/applied",
        threads: stateStore.getState().threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name } : thread)),
      });
      notifyThreadRenamed(threadId, name);
      return true;
    },
    generateThreadTitle: overrides.generateThreadTitle ?? vi.fn().mockResolvedValue("Generated title"),
  } satisfies ThreadRenameEditorActionsHost;
  return { ...host, notifyThreadRenamed, actions: createThreadRenameEditorActions(host) };
}

function fakeClient(options: { renameThreadRequest?: ReturnType<typeof vi.fn> } = {}): AppServerClient {
  const renameThreadRequest = options.renameThreadRequest ?? vi.fn().mockResolvedValue({});
  return {
    request: vi.fn((method: string, params: { threadId: string; name: string }) => {
      if (method === "thread/name/set") {
        return (renameThreadRequest as unknown as (params: { threadId: string; name: string }) => Promise<unknown>)(params);
      }
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [turnFixture([userMessage("user", "Please name this."), assistantMessage("assistant", "Done.")])],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected app-server request: ${method}`);
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
    provenance: { kind: "interactive" },
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
