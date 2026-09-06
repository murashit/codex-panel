import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { ThreadTitleContext } from "../../../../../src/domain/threads/title-context";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createThreadRenameEditorActions,
  type ThreadRenameEditorActions,
  type ThreadRenameEditorActionsHost,
} from "../../../../../src/features/chat/host/session/rename-editor";
import { deferred } from "../../../../support/async";

describe("ThreadRenameEditorActions", () => {
  it("edits and cancels a panel rename draft", () => {
    const { actions, stateStore } = actionsFixture();

    actions.start("thread");
    actions.updateDraft("thread", "New name");

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "New name", kind: "editing" });
    actions.cancel("thread");
    expect(stateStore.getState().ui.rename).toEqual({ kind: "idle" });
  });

  it("starts rename drafts from useful titles instead of id fallbacks", () => {
    const { actions, stateStore } = actionsFixture({ threads: [{ ...threadFixture("thread"), preview: "" }] });

    actions.start("thread");

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "", kind: "editing" });
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
    const { actions, stateStore } = actionsFixture({ resolveThreadTitleContext, generateThreadTitle });

    actions.start("thread");
    await flushPromises();
    await actions.autoNameDraft("thread");

    expect(generateThreadTitle).toHaveBeenCalledOnce();
    expect(generateThreadTitle).toHaveBeenCalledWith(context, expect.any(AbortSignal));
    expect(resolveThreadTitleContext).toHaveBeenCalledOnce();
    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Generated title", kind: "editing" });
  });

  it("returns to editing and ignores a generated title after auto-name cancellation", async () => {
    const generatedTitle = deferred<string>();
    let generationSignal: AbortSignal | undefined;
    const { actions, stateStore } = actionsFixture({
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
    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Thread preview", kind: "editing" });
    generatedTitle.resolve("Generated title");
    await autoName;

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Thread preview", kind: "editing" });
  });

  it("aborts auto-name when rename moves to another thread", async () => {
    const generatedTitle = deferred<string>();
    let generationSignal: AbortSignal | undefined;
    const { actions, stateStore } = actionsFixture({
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
    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "other", draft: "Other preview", kind: "editing" });
    generatedTitle.resolve("Stale generated title");
    await autoName;
    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "other", draft: "Other preview", kind: "editing" });
  });

  it("does not revive rename generation after cancellation while connection is pending", async () => {
    const connection = deferred<undefined>();
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { actions, stateStore } = actionsFixture({
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
    expect(stateStore.getState().ui.rename).toEqual({ kind: "idle" });
  });

  it("blocks cancellation while a rename save is pending", async () => {
    const connection = deferred<undefined>();
    const renameThreadRequest = vi.fn().mockResolvedValue(true);
    const { actions, stateStore } = actionsFixture({
      ensureConnected: vi.fn(() => connection.promise),
      renameThread: renameThreadRequest,
    });

    actions.start("thread");
    const save = actions.save("thread", "Saved title");
    actions.cancel("thread");
    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Thread preview", kind: "saving" });
    connection.resolve(undefined);
    await save;

    expect(renameThreadRequest).toHaveBeenCalledExactlyOnceWith("thread", "Saved title", { shouldStart: expect.any(Function) });
    expect(stateStore.getState().ui.rename).toEqual({ kind: "idle" });
  });

  it("keeps the draft and reports a connection failure while saving", async () => {
    const addSystemMessage = vi.fn();
    const { actions, stateStore } = actionsFixture({
      ensureConnected: vi.fn().mockRejectedValue(new Error("Could not connect.")),
      addSystemMessage,
    });

    actions.start("thread");
    actions.updateDraft("thread", "Unsaved draft");
    await actions.save("thread", "Unsaved draft");

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Unsaved draft", kind: "editing" });
    expect(addSystemMessage).toHaveBeenCalledWith("Could not connect.");
  });

  it("keeps the draft and reports an app-server rename failure", async () => {
    const addSystemMessage = vi.fn();
    const renameThreadRequest = vi.fn().mockRejectedValue(new Error("Rename failed."));
    const { actions, stateStore } = actionsFixture({
      renameThread: renameThreadRequest,
      addSystemMessage,
    });

    actions.start("thread");
    actions.updateDraft("thread", "Unsaved draft");
    await actions.save("thread", "Unsaved draft");

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Unsaved draft", kind: "editing" });
    expect(addSystemMessage).toHaveBeenCalledWith("Rename failed.");
  });

  it("keeps preparing auto-name while a rename save is in flight", async () => {
    const context = deferred<ThreadTitleContext | null>();
    const saved = deferred<boolean>();
    const readyContext = { userRequest: "Name this thread.", assistantResponse: "Done." };
    const resolveThreadTitleContext = vi.fn().mockReturnValue(context.promise);
    const generateThreadTitle = vi.fn().mockResolvedValue("Generated title");
    const { actions, stateStore } = actionsFixture({
      renameThread: vi.fn(() => saved.promise),
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
    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Generated title", kind: "editing" });
  });

  it("does not report a delayed save failure after the edit is invalidated", async () => {
    const saved = deferred<boolean>();
    const addSystemMessage = vi.fn();
    const { actions, stateStore } = actionsFixture({
      renameThread: vi.fn(() => saved.promise),
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

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "New draft", kind: "editing" });
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("forwards inline save validity to the rename host", async () => {
    const renamed = deferred<boolean>();
    const renameThread = vi.fn<ThreadRenameEditorActionsHost["renameThread"]>(() => renamed.promise);
    const stateStore = createChatStateStore();
    const actions = createThreadRenameEditorActions({
      stateStore,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      addSystemMessage: vi.fn(),
      threadById: () => threadFixture("thread"),
      renameThread,
      resolveThreadTitleContext: vi.fn().mockResolvedValue(null),
      generateThreadTitle: vi.fn(),
    });

    actions.start("thread");
    const saving = actions.save("thread", "Queued title");
    await vi.waitFor(() => expect(renameThread).toHaveBeenCalledOnce());
    const shouldStart = renameThread.mock.calls[0]?.[2]?.shouldStart;
    if (!shouldStart) throw new Error("Expected inline rename validity to be forwarded");
    expect(shouldStart()).toBe(true);

    actions.invalidate();
    expect(shouldStart()).toBe(false);
    renamed.resolve(false);
    await saving;
  });

  it("ignores draft updates while auto-name generation is active", async () => {
    const generatedTitle = deferred<string>();
    const { actions, stateStore } = actionsFixture({
      generateThreadTitle: vi.fn(() => generatedTitle.promise),
    });

    actions.start("thread");
    await flushPromises();
    const autoName = actions.autoNameDraft("thread");
    await flushPromises();

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Thread preview", kind: "generating" });

    actions.updateDraft("thread", "Manual draft");
    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Thread preview", kind: "generating" });
    generatedTitle.resolve("Generated title");
    await autoName;

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Generated title", kind: "editing" });
  });

  it("keeps a newer auto-name generation pending when the cancelled generation finishes", async () => {
    const firstTitle = deferred<string>();
    const secondTitle = deferred<string>();
    const generateThreadTitle = vi.fn().mockReturnValueOnce(firstTitle.promise).mockReturnValueOnce(secondTitle.promise);
    const { actions, stateStore } = actionsFixture({ generateThreadTitle });

    actions.start("thread");
    await flushPromises();
    const first = actions.autoNameDraft("thread");
    await vi.waitFor(() => expect(generateThreadTitle).toHaveBeenCalledTimes(1));
    actions.cancelAutoName("thread");
    const second = actions.autoNameDraft("thread");
    await vi.waitFor(() => expect(generateThreadTitle).toHaveBeenCalledTimes(2));

    firstTitle.resolve("Cancelled title");
    await first;

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Thread preview", kind: "generating" });
    secondTitle.resolve("Current title");
    await second;
    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Current title", kind: "editing" });
  });

  it("does not publish or report title work invalidated by a context replacement", async () => {
    const oldTitle = deferred<string>();
    const generateThreadTitle = vi.fn().mockReturnValueOnce(oldTitle.promise).mockResolvedValueOnce("Fresh title");
    const addSystemMessage = vi.fn();
    const { actions, stateStore } = actionsFixture({ generateThreadTitle, addSystemMessage });

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

    expect(stateStore.getState().ui.rename).toMatchObject({ threadId: "thread", draft: "Fresh title", kind: "editing" });
    expect(addSystemMessage).not.toHaveBeenCalled();
  });
});

function actionsFixture(
  overrides: Partial<Pick<ThreadRenameEditorActionsHost, "ensureConnected" | "addSystemMessage">> & {
    renameThread?: ThreadRenameEditorActionsHost["renameThread"];
    generateThreadTitle?: ThreadRenameEditorActionsHost["generateThreadTitle"];
    resolveThreadTitleContext?: ThreadRenameEditorActionsHost["resolveThreadTitleContext"];
    threads?: Thread[];
  } = {},
): ThreadRenameEditorActionsHost & { actions: ThreadRenameEditorActions } {
  const stateStore = createChatStateStore();
  const threads = overrides.threads ?? [threadFixture("thread")];
  const host = {
    stateStore,
    ensureConnected: overrides.ensureConnected ?? vi.fn().mockResolvedValue(undefined),
    addSystemMessage: overrides.addSystemMessage ?? vi.fn(),
    threadById: (threadId: string) => threads.find((thread) => thread.id === threadId),
    renameThread: overrides.renameThread ?? vi.fn().mockResolvedValue(true),
    resolveThreadTitleContext:
      overrides.resolveThreadTitleContext ?? vi.fn().mockResolvedValue({ userRequest: "Please name this.", assistantResponse: "Done." }),
    generateThreadTitle: overrides.generateThreadTitle ?? vi.fn().mockResolvedValue("Generated title"),
  } satisfies ThreadRenameEditorActionsHost;
  return { ...host, actions: createThreadRenameEditorActions(host) };
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
