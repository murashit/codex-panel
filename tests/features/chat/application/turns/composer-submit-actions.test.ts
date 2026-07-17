import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../../../src/domain/threads/model";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { submitComposer } from "../../../../../src/features/chat/application/turns/composer-submit-actions";
import { deferred } from "../../../../support/async";
import { chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems } from "../../support/thread-stream";

function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
  };
}

function createHost(draft: string, options: { subagent?: boolean } = {}) {
  const initialState = createChatState();
  const stateStore = createChatStateStore(
    options.subagent
      ? chatStateWith(initialState, {
          activeThread: {
            id: "child",
            provenance: {
              kind: "subagent",
              subagentKind: "thread-spawn",
              parentThreadId: "parent",
              sessionId: "session",
              depth: 1,
              agentNickname: "Scout",
              agentRole: "explorer",
            },
          },
        })
      : initialState,
  );
  const interruptTurn = vi.fn().mockResolvedValue({});
  const setDraft = vi.fn();
  const sendTurnText = vi.fn().mockResolvedValue(true);
  const execute = vi.fn().mockResolvedValue(undefined);
  const showLatest = vi.fn();
  const ensureConnected = vi.fn().mockResolvedValue(true);
  const inputSnapshot = { sourcePath: "snapshot.md" } as never;
  const captureInputSnapshot = vi.fn(() => inputSnapshot);
  const host = {
    stateStore,
    localItemIds: createLocalIdSource(),
    composer: {
      get draft() {
        return draft;
      },
      get trimmedDraft() {
        return draft.trim();
      },
      setDraft,
      captureInputSnapshot,
    },
    slashCommandExecutor: { execute },
    turnSubmission: { sendTurnText },
    connection: {
      ensureConnected,
    },
    turnTransport: { interruptTurn },
    status: {
      setStatus: vi.fn(),
      addSystemMessage: vi.fn(),
    },
    scroll: { showLatest },
  };
  return {
    host,
    captureInputSnapshot,
    ensureConnected,
    execute,
    inputSnapshot,
    interruptTurn,
    sendTurnText,
    setDraft,
    showLatest,
    stateStore,
  };
}

describe("submitComposer", () => {
  it("does not cancel or restore a committed web submission", async () => {
    const { host, execute, setDraft, stateStore } = createHost("");
    const pending = {
      id: "local-web",
      item: {
        id: "local-web",
        kind: "dialogue" as const,
        dialogueKind: "user" as const,
        role: "user" as const,
        text: "https://example.com/ summarize",
      },
      targetThreadId: null,
      originalDraft: "/web https://example.com summarize",
      phase: "committed" as const,
    };
    stateStore.dispatch({ type: "web-submission/pending", submission: pending } as never);

    await submitComposer(host);

    expect(stateStore.getState().pendingSubmission).toEqual(pending);
    expect(setDraft).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["hello", "/status"])("blocks composer submission from subagent threads for %s", async (draft) => {
    const { host, execute, sendTurnText } = createHost(draft, { subagent: true });

    await submitComposer(host);

    expect(execute).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
    expect(host.status.addSystemMessage).toHaveBeenCalledWith("Messages are unavailable in agent threads. Start a new chat to continue.");
  });

  it("sends plain drafts as turn text", async () => {
    const { host, ensureConnected, inputSnapshot, sendTurnText, showLatest } = createHost("hello");

    await submitComposer(host);

    expect(showLatest).toHaveBeenCalledOnce();
    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).toHaveBeenCalledWith({ text: "hello", inputSnapshot });
    const [showLatestOrder] = showLatest.mock.invocationCallOrder;
    const [sendTurnTextOrder] = sendTurnText.mock.invocationCallOrder;
    if (showLatestOrder === undefined || sendTurnTextOrder === undefined) {
      throw new Error("Expected showLatest and sendTurnText to be called");
    }
    expect(showLatestOrder).toBeLessThan(sendTurnTextOrder);
  });

  it("executes slash commands and forwards command send results", async () => {
    const { host, ensureConnected, execute, inputSnapshot, sendTurnText, setDraft, showLatest } = createHost("/clear hello");
    execute.mockResolvedValue({ sendText: "hello" });

    await submitComposer(host);

    expect(setDraft).not.toHaveBeenCalled();
    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("clear", "hello", inputSnapshot, expect.any(Function));
    expect(showLatest).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith({
      text: "hello",
      inputSnapshot,
    });
  });

  it("passes the same input snapshot through slash command send results", async () => {
    const { host, execute, inputSnapshot, sendTurnText } = createHost("/refer Other [[Note]] (L1:C1-L1:C2)");
    execute.mockImplementation(async (_command, _args, snapshot) => {
      expect(snapshot).toBe(inputSnapshot);
      return { sendText: "[[Note]] (L1:C1-L1:C2)", sendInput: [{ type: "text", text: "referenced input" }] };
    });
    sendTurnText.mockImplementation(async (request) => {
      expect(request.inputSnapshot).toBe(inputSnapshot);
    });

    await submitComposer(host);

    expect(sendTurnText).toHaveBeenCalledWith({
      text: "[[Note]] (L1:C1-L1:C2)",
      inputSnapshot,
      codexInputOverride: [{ type: "text", text: "referenced input" }],
      preserveComposerContextOnFailure: true,
    });
  });

  it("restores slash command text when command send results are not submitted", async () => {
    const { host, execute, inputSnapshot, sendTurnText, setDraft } = createHost("/web https://example.com [[Note]]");
    execute.mockResolvedValue({
      sendText: "https://example.com/ [[Note]]",
      sendInput: [
        { type: "text", text: "https://example.com/ [[Note]]" },
        { type: "additionalContext", key: "codex_panel_web_context", kind: "untrusted", value: "Readable article" },
        { type: "mention", name: "Note", path: "Note.md" },
      ],
    });
    sendTurnText.mockResolvedValue(false);

    await submitComposer(host);

    expect(sendTurnText).toHaveBeenCalledWith({
      text: "https://example.com/ [[Note]]",
      inputSnapshot,
      codexInputOverride: [
        { type: "text", text: "https://example.com/ [[Note]]" },
        { type: "additionalContext", key: "codex_panel_web_context", kind: "untrusted", value: "Readable article" },
        { type: "mention", name: "Note", path: "Note.md" },
      ],
      preserveComposerContextOnFailure: true,
      pendingSubmissionId: expect.stringMatching(/^local-web-/),
      failureDraft: "/web https://example.com [[Note]]",
    });
    expect(setDraft).toHaveBeenCalledWith("/web https://example.com [[Note]]", {
      focus: true,
      clearSuggestions: true,
      preserveContext: true,
    });
  });

  it("shows a pending web message while context is fetched and hands it to turn submission", async () => {
    const { host, execute, inputSnapshot, sendTurnText, setDraft, showLatest, stateStore } = createHost(
      "/web https://example.com summarize",
    );
    const fetch = deferred<{ sendText: string; sendInput: [{ type: "text"; text: string }] }>();
    execute.mockImplementation(() => fetch.promise);

    const submitting = submitComposer(host);
    await vi.waitFor(() => {
      expect(stateStore.getState().pendingSubmission).not.toBeNull();
    });

    const pending = stateStore.getState().pendingSubmission?.item;
    expect(pending).toMatchObject({
      kind: "dialogue",
      text: "https://example.com/ summarize",
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      provenance: { source: "localUser", channel: "preflight" },
    });
    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true, preserveContext: true });
    expect(showLatest).toHaveBeenCalledOnce();
    expect(sendTurnText).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);

    fetch.resolve({ sendText: "https://example.com/ summarize", sendInput: [{ type: "text", text: "prepared" }] });
    await submitting;

    expect(sendTurnText).toHaveBeenCalledWith({
      text: "https://example.com/ summarize",
      inputSnapshot,
      codexInputOverride: [{ type: "text", text: "prepared" }],
      preserveComposerContextOnFailure: true,
      pendingSubmissionId: pending?.id,
      failureDraft: "/web https://example.com summarize",
    });
  });

  it("cancels a pending web import and restores its exact draft before late success", async () => {
    const { host, execute, sendTurnText, setDraft, stateStore } = createHost("  /web https://example.com summarize  ");
    const fetch = deferred<{ sendText: string }>();
    execute.mockImplementation(() => fetch.promise);

    const first = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    await submitComposer(host);

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(setDraft.mock.calls.at(-1)).toEqual([
      "  /web https://example.com summarize  ",
      { focus: true, clearSuggestions: true, preserveContext: true },
    ]);
    expect(execute).toHaveBeenCalledOnce();
    fetch.resolve({ sendText: "https://example.com/ summarize" });
    await first;
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("ignores a late web import failure after explicit cancellation", async () => {
    const { host, execute, setDraft, stateStore } = createHost("/web https://example.com summarize");
    const fetch = deferred<{ sendText: string }>();
    execute.mockImplementation(() => fetch.promise);

    const first = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    await submitComposer(host);
    fetch.reject(new Error("offline"));
    await first;

    expect(setDraft.mock.calls).toEqual([
      ["", { clearSuggestions: true, preserveContext: true }],
      ["/web https://example.com summarize", { focus: true, clearSuggestions: true, preserveContext: true }],
    ]);
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });

  it.each([true, false])("ignores late connection result %s after explicit web cancellation", async (connected) => {
    const { host, ensureConnected, execute, setDraft, stateStore } = createHost("/web https://example.com summarize");
    const connecting = deferred<boolean>();
    ensureConnected.mockImplementation(() => connecting.promise);

    const first = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    await submitComposer(host);
    connecting.resolve(connected);
    await first;

    expect(execute).not.toHaveBeenCalled();
    expect(setDraft.mock.calls.at(-1)).toEqual([
      "/web https://example.com summarize",
      { focus: true, clearSuggestions: true, preserveContext: true },
    ]);
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not create pending UI for a web URL containing credentials", async () => {
    const { host, execute, stateStore } = createHost("/web https://user:secret@example.com/article summarize");
    const reading = deferred<undefined>();
    execute.mockImplementation(() => reading.promise);

    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    expect(stateStore.getState().pendingSubmission).toBeNull();
    reading.resolve(undefined);
    await submitting;
  });

  it("drops a pending web submission when the active thread changes during fetch", async () => {
    const { host, execute, sendTurnText, stateStore } = createHost("/web https://example.com summarize");
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("first"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    const fetch = deferred<{ sendText: string }>();
    execute.mockImplementation(() => fetch.promise);

    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    stateStore.dispatch({ type: "active-thread/cleared" });
    fetch.resolve({ sendText: "https://example.com/ summarize" });
    await submitting;

    expect(sendTurnText).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().pendingSubmission).toBeNull();
  });

  it("does not restore or report a stale web fetch failure after the active thread changes", async () => {
    const { host, execute, setDraft, stateStore } = createHost("/web https://example.com summarize");
    resumeActiveThread(stateStore, "first");
    const fetch = deferred<{ sendText: string }>();
    execute.mockImplementation(() => fetch.promise);

    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    stateStore.dispatch({ type: "active-thread/cleared" });
    fetch.reject(new Error("offline"));
    await submitting;

    expect(setDraft.mock.calls).toEqual([["", { clearSuggestions: true, preserveContext: true }]]);
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
    expect(stateStore.getState().pendingSubmission).toBeNull();
  });

  it.each([
    "connection/scoped-cleared",
    "connection/context-replaced",
  ] as const)("recovers the web draft and ignores late fetch success after %s", async (type) => {
    const { host, execute, sendTurnText, setDraft, stateStore } = createHost("  /web https://example.com summarize  ");
    const fetch = deferred<{ sendText: string }>();
    execute.mockImplementation(() => fetch.promise);

    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    stateStore.dispatch({ type });

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(stateStore.getState().composer.draft).toBe("  /web https://example.com summarize  ");

    fetch.resolve({ sendText: "https://example.com/ summarize" });
    await submitting;

    expect(sendTurnText).not.toHaveBeenCalled();
    expect(setDraft.mock.calls).toEqual([["", { clearSuggestions: true, preserveContext: true }]]);
    expect(stateStore.getState().composer.draft).toBe("  /web https://example.com summarize  ");
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not execute connection-dependent slash commands when connection fails", async () => {
    const { host, ensureConnected, execute, setDraft } = createHost("/clear");
    ensureConnected.mockResolvedValue(false);

    await submitComposer(host);

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(setDraft).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not execute an old slash intent after leaving and returning during connection", async () => {
    const { host, ensureConnected, execute, stateStore } = createHost("/clear");
    const connection = deferred<boolean>();
    ensureConnected.mockImplementation(() => connection.promise);
    resumeActiveThread(stateStore, "first");

    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledOnce());
    resumeActiveThread(stateStore, "other");
    resumeActiveThread(stateStore, "first");
    connection.resolve(true);
    await submitting;

    expect(execute).not.toHaveBeenCalled();
  });

  it("rolls back a pending web message when connection setup fails", async () => {
    const { host, ensureConnected, execute, setDraft, stateStore } = createHost("/web https://example.com summarize");
    ensureConnected.mockResolvedValue(false);

    await submitComposer(host);

    expect(execute).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(setDraft.mock.calls).toEqual([
      ["", { clearSuggestions: true, preserveContext: true }],
      ["/web https://example.com summarize", { focus: true, clearSuggestions: true, preserveContext: true }],
    ]);
  });

  it("executes reconnect without a connected client preflight", async () => {
    const { host, ensureConnected, execute, setDraft } = createHost("/reconnect");

    await submitComposer(host);

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("reconnect", "", expect.any(Object), expect.any(Function));
  });

  it("executes compact without a connected client preflight", async () => {
    const { host, ensureConnected, execute, setDraft } = createHost("/compact");

    await submitComposer(host);

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("compact", "", expect.any(Object), expect.any(Function));
  });

  it("restores slash command composer drafts from command results", async () => {
    const { host, ensureConnected, execute, sendTurnText, setDraft, showLatest } = createHost("/goal edit");
    execute.mockResolvedValue({ composerDraft: "/goal set Current objective" });

    await submitComposer(host);

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(setDraft).not.toHaveBeenCalledWith("", expect.anything());
    expect(setDraft).toHaveBeenCalledWith("/goal set Current objective", { focus: true, clearSuggestions: true });
    expect(showLatest).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("restores slash command text and reports executor errors", async () => {
    const { host, execute, sendTurnText, setDraft, showLatest } = createHost("/web https://obsidian.md/help/plugins/web-viewer 読める？");
    execute.mockRejectedValue(new Error("No readable content found for https://obsidian.md/help/plugins/web-viewer"));

    await submitComposer(host);

    expect(setDraft).toHaveBeenCalledWith("/web https://obsidian.md/help/plugins/web-viewer 読める？", {
      focus: true,
      clearSuggestions: true,
    });
    expect(setDraft.mock.calls.at(-1)).toEqual([
      "/web https://obsidian.md/help/plugins/web-viewer 読める？",
      { focus: true, clearSuggestions: true },
    ]);
    expect(host.status.addSystemMessage).toHaveBeenCalledWith("No readable content found for https://obsidian.md/help/plugins/web-viewer");
    expect(showLatest).toHaveBeenCalledOnce();
    expect(sendTurnText).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(host.stateStore.getState())).toEqual([]);
  });

  it("interrupts a running turn when submitting an empty draft", async () => {
    const { host, interruptTurn, showLatest, stateStore } = createHost("");
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });

    await submitComposer(host);

    expect(showLatest).not.toHaveBeenCalled();
    expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
  });
});

function resumeActiveThread(stateStore: ReturnType<typeof createChatStateStore>, id: string): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: thread(id),
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}
