import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { TurnItem, TurnRecord } from "../../../../../src/app-server/protocol/turn";
import { normalizeExplicitThreadName, type Thread } from "../../../../../src/domain/threads/model";
import type { ThreadTitleContext } from "../../../../../src/domain/threads/title-generation-model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createThreadRenameEditorActions,
  type ThreadRenameEditorActions,
  type ThreadRenameEditorActionsHost,
} from "../../../../../src/features/chat/host/session/rename-editor";
import { deferred } from "../../../../support/async";

describe("ThreadRenameEditorActions", () => {
  it("stores controlled rename drafts in chat UI state", () => {
    const { actions } = actionsFixture();

    actions.start("thread");
    actions.updateDraft("thread", "New name");

    expect(actions.editState("thread")).toEqual({ draft: "New name", generating: false });
  });

  it("starts rename drafts from useful titles instead of id fallbacks", () => {
    const { actions } = actionsFixture({ threads: [{ ...threadFixture("thread"), preview: "" }] });

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

  it("keeps auto-name disabled when no title context is available", async () => {
    const resolvedContext = deferred<null>();
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const addSystemMessage = vi.fn();
    const { actions, stateStore } = actionsFixture({
      resolveThreadTitleContext: vi.fn(() => resolvedContext.promise),
      generateThreadTitle,
      addSystemMessage,
    });

    actions.start("thread");
    expect(stateStore.getState().ui.rename).toMatchObject({ autoName: { kind: "checking" } });
    await actions.autoNameDraft("thread");
    expect(generateThreadTitle).not.toHaveBeenCalled();

    resolvedContext.resolve(null);
    await flushPromises();

    expect(stateStore.getState().ui.rename).toMatchObject({ autoName: { kind: "unavailable" } });
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("applies generated rename drafts and clears the generating state", async () => {
    const context = { userRequest: "Please name this.", assistantResponse: "Done." };
    const resolveThreadTitleContext = vi.fn().mockResolvedValue(context);
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { actions } = actionsFixture({ resolveThreadTitleContext, generateThreadTitle });

    actions.start("thread");
    await flushPromises();
    await actions.autoNameDraft("thread");

    expect(generateThreadTitle).toHaveBeenCalledOnce();
    expect(generateThreadTitle).toHaveBeenCalledWith(context, expect.any(AbortSignal));
    expect(resolveThreadTitleContext).toHaveBeenCalledOnce();
    expect(actions.editState("thread")).toEqual({ draft: "Generated title", generating: false });
  });

  it("returns to editing and ignores a generated title after auto-name cancellation", async () => {
    const generatedTitle = deferred<string>();
    let generationSignal: AbortSignal | undefined;
    const { actions } = actionsFixture({
      generateThreadTitle: vi.fn((_threadId, signal) => {
        generationSignal = signal;
        return generatedTitle.promise;
      }),
    });

    actions.start("thread");
    await flushPromises();
    const autoName = actions.autoNameDraft("thread");
    await Promise.resolve();
    expect(generationSignal?.aborted).toBe(false);
    actions.cancelAutoName("thread");

    expect(generationSignal?.aborted).toBe(true);
    expect(actions.editState("thread")).toEqual({ draft: "Thread preview", generating: false });
    generatedTitle.resolve("Generated title");
    await autoName;

    expect(actions.editState("thread")).toEqual({ draft: "Thread preview", generating: false });
  });

  it("aborts auto-name when rename moves to another thread", async () => {
    const generatedTitle = deferred<string>();
    let generationSignal: AbortSignal | undefined;
    const { actions } = actionsFixture({
      threads: [threadFixture("thread"), { ...threadFixture("other"), preview: "Other preview" }],
      generateThreadTitle: vi.fn((_threadId, signal) => {
        generationSignal = signal;
        return generatedTitle.promise;
      }),
    });
    actions.start("thread");
    await flushPromises();
    const autoName = actions.autoNameDraft("thread");
    await Promise.resolve();
    actions.start("other");

    expect(generationSignal?.aborted).toBe(true);
    expect(actions.editState("other")).toEqual({ draft: "Other preview", generating: false });
    generatedTitle.resolve("Stale generated title");
    await autoName;
    expect(actions.editState("other")).toEqual({ draft: "Other preview", generating: false });
  });

  it("does not revive rename generation after cancellation while connection is pending", async () => {
    const connection = deferred<undefined>();
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { actions } = actionsFixture({
      ensureConnected: vi.fn(() => connection.promise),
      generateThreadTitle,
    });

    actions.start("thread");
    await flushPromises();
    const autoName = actions.autoNameDraft("thread");
    actions.cancel("thread");
    connection.resolve(undefined);
    await autoName;

    expect(generateThreadTitle).not.toHaveBeenCalled();
    expect(actions.editState("thread")).toBeNull();
  });

  it("blocks cancellation while a rename save is pending", async () => {
    const connection = deferred<undefined>();
    const renameThreadRequest = vi.fn().mockResolvedValue({});
    const client = fakeClient({ renameThreadRequest });
    const { actions, stateStore } = actionsFixture({
      ensureConnected: vi.fn(() => connection.promise),
      currentClient: () => client,
    });

    actions.start("thread");
    const save = actions.save("thread", "Saved title");
    actions.cancel("thread");
    expect(actions.editState("thread")).toEqual({ draft: "Thread preview", generating: false });
    expect(stateStore.getState().ui.rename.kind).toBe("saving");
    connection.resolve(undefined);
    await save;

    expect(renameThreadRequest).toHaveBeenCalledOnce();
    expect(actions.editState("thread")).toBeNull();
  });

  it("keeps the draft and reports a connection failure while saving", async () => {
    const addSystemMessage = vi.fn();
    const { actions } = actionsFixture({
      ensureConnected: vi.fn().mockRejectedValue(new Error("Could not connect.")),
      addSystemMessage,
    });

    actions.start("thread");
    actions.updateDraft("thread", "Unsaved draft");
    await actions.save("thread", "Unsaved draft");

    expect(actions.editState("thread")).toEqual({ draft: "Unsaved draft", generating: false });
    expect(addSystemMessage).toHaveBeenCalledWith("Could not connect.");
  });

  it("keeps the draft and reports an app-server rename failure", async () => {
    const addSystemMessage = vi.fn();
    const renameThreadRequest = vi.fn().mockRejectedValue(new Error("Rename failed."));
    const { actions } = actionsFixture({
      currentClient: () => fakeClient({ renameThreadRequest }),
      addSystemMessage,
    });

    actions.start("thread");
    actions.updateDraft("thread", "Unsaved draft");
    await actions.save("thread", "Unsaved draft");

    expect(actions.editState("thread")).toEqual({ draft: "Unsaved draft", generating: false });
    expect(addSystemMessage).toHaveBeenCalledWith("Rename failed.");
  });

  it("keeps preparing auto-name while a rename save is in flight", async () => {
    const context = deferred<ThreadTitleContext | null>();
    const saved = deferred<void>();
    const readyContext = { userRequest: "Name this thread.", assistantResponse: "Done." };
    const resolveThreadTitleContext = vi.fn().mockReturnValue(context.promise);
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { actions, stateStore } = actionsFixture({
      currentClient: () => fakeClient({ renameThreadRequest: vi.fn(() => saved.promise) }),
      resolveThreadTitleContext,
      generateThreadTitle,
    });

    actions.start("thread");
    await flushPromises();
    expect(resolveThreadTitleContext).toHaveBeenCalledOnce();

    const saving = actions.save("thread", "Unsaved draft");
    await flushPromises();
    actions.updateDraft("thread", "Changed while saving");
    context.resolve(readyContext);
    await flushPromises();
    expect(stateStore.getState().ui.rename.kind).toBe("saving");
    saved.reject(new Error("Rename failed."));
    await saving;
    await flushPromises();
    expect(resolveThreadTitleContext).toHaveBeenCalledOnce();

    await actions.autoNameDraft("thread");
    expect(generateThreadTitle).toHaveBeenCalledWith(readyContext, expect.any(AbortSignal));
    expect(actions.editState("thread")).toEqual({ draft: "Generated title", generating: false });
  });

  it("does not report a delayed save failure after the edit is invalidated", async () => {
    const saved = deferred<object>();
    const addSystemMessage = vi.fn();
    const { actions } = actionsFixture({
      currentClient: () => fakeClient({ renameThreadRequest: vi.fn(() => saved.promise) }),
      addSystemMessage,
    });

    actions.start("thread");
    const save = actions.save("thread", "Old draft");
    await flushPromises();

    actions.invalidate();
    actions.start("thread");
    actions.updateDraft("thread", "New draft");
    saved.reject(new Error("Stale rename failed."));
    await save;

    expect(actions.editState("thread")).toEqual({ draft: "New draft", generating: false });
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("blocks starting another inline rename while a save is pending", async () => {
    const saved = deferred<object>();
    const renameThreadRequest = vi.fn(() => saved.promise);
    const { actions, threadById, notifyThreadRenamed } = actionsFixture({
      currentClient: () => fakeClient({ renameThreadRequest }),
    });

    actions.start("thread");
    actions.updateDraft("thread", "Saved title");
    const save = actions.save("thread", " Saved   title ");
    await flushPromises();

    actions.cancel("thread");
    actions.start("thread");
    actions.updateDraft("thread", "New draft");
    expect(actions.editState("thread")).toEqual({ draft: "Saved title", generating: false });
    saved.resolve({});
    await save;

    expect(renameThreadRequest).toHaveBeenCalledWith({ threadId: "thread", name: "Saved title" });
    expect(threadById("thread")?.name).toBe("Saved title");
    expect(notifyThreadRenamed).toHaveBeenCalledWith("thread", "Saved title");
    expect(actions.editState("thread")).toBeNull();
  });

  it("ignores draft updates while auto-name generation is active", async () => {
    const generatedTitle = deferred<string>();
    const { actions } = actionsFixture({
      generateThreadTitle: vi.fn(() => generatedTitle.promise),
    });

    actions.start("thread");
    await flushPromises();
    const autoName = actions.autoNameDraft("thread");
    await flushPromises();

    expect(actions.editState("thread")).toEqual({ draft: "Thread preview", generating: true });

    actions.updateDraft("thread", "Manual draft");
    expect(actions.editState("thread")).toEqual({ draft: "Thread preview", generating: true });
    generatedTitle.resolve("Generated title");
    await autoName;

    expect(actions.editState("thread")).toEqual({ draft: "Generated title", generating: false });
  });

  it("does not let an older auto-name request finish a newer generation", async () => {
    const firstGeneratedTitle = deferred<string>();
    const secondGeneratedTitle = deferred<string>();
    const generateThreadTitle = vi.fn().mockReturnValueOnce(firstGeneratedTitle.promise).mockReturnValueOnce(secondGeneratedTitle.promise);
    const { actions } = actionsFixture({ generateThreadTitle });

    actions.start("thread");
    await flushPromises();
    const firstAutoName = actions.autoNameDraft("thread");
    await flushPromises();
    actions.cancel("thread");
    actions.start("thread");
    await flushPromises();
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
    await flushPromises();
    const staleAutoName = actions.autoNameDraft("thread");
    await flushPromises();
    actions.invalidate();

    actions.start("thread");
    await flushPromises();
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
    generateThreadTitle?: ThreadRenameEditorActionsHost["generateThreadTitle"];
    resolveThreadTitleContext?: ThreadRenameEditorActionsHost["resolveThreadTitleContext"];
    threads?: Thread[];
  } = {},
): ThreadRenameEditorActionsHost & {
  actions: ThreadRenameEditorActions;
  notifyThreadRenamed: ReturnType<typeof vi.fn>;
} {
  const stateStore = createChatStateStore();
  let threads = overrides.threads ?? [threadFixture("thread")];
  const currentClient = overrides.currentClient ?? (() => fakeClient());
  const notifyThreadRenamed = vi.fn();
  const host = {
    stateStore,
    ensureConnected: overrides.ensureConnected ?? vi.fn().mockResolvedValue(undefined),
    addSystemMessage: overrides.addSystemMessage ?? vi.fn(),
    threadById: (threadId: string) => threads.find((thread) => thread.id === threadId),
    renameThread: async (threadId: string, value: string) => {
      const name = normalizeExplicitThreadName(value);
      if (!name) return false;
      await currentClient().request("thread/name/set", { threadId, name });
      threads = threads.map((thread) => (thread.id === threadId ? { ...thread, name } : thread));
      notifyThreadRenamed(threadId, name);
      return true;
    },
    resolveThreadTitleContext:
      overrides.resolveThreadTitleContext ?? vi.fn().mockResolvedValue({ userRequest: "Please name this.", assistantResponse: "Done." }),
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
