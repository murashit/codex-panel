import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../../../src/domain/threads/model";
import type { ComposerSubmissionClaim } from "../../../../../src/features/chat/application/composer/submission-claim";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../../../../../src/features/chat/application/state/panel-target";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { submitComposer } from "../../../../../src/features/chat/application/submission/composer-submit-command";
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

function submissionClaim(
  text: string,
  inputSnapshot: ComposerSubmissionClaim["inputSnapshot"],
  settle: ComposerSubmissionClaim["settle"],
  isCurrent: () => boolean = () => true,
): ComposerSubmissionClaim {
  return { text, inputSnapshot, isCurrent, markAdopted: vi.fn(), adoptPanelTarget: vi.fn(), settle };
}

function createHost(
  draft: string,
  options: { subagent?: boolean; threadCommandTarget?: { command: "resume"; threadId: string; title: string } } = {},
) {
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
  const inputSnapshot = {
    sourcePath: "snapshot.md",
    ...(options.threadCommandTarget ? { threadCommandTarget: options.threadCommandTarget } : {}),
  } as never;
  const captureInputSnapshot = vi.fn(() => inputSnapshot);
  const settleSubmission = vi.fn();
  const claimSubmission = vi.fn<() => ComposerSubmissionClaim | null>(() => {
    const panelTarget = capturePanelTargetLease(stateStore.getState());
    return submissionClaim(
      draft,
      inputSnapshot,
      settleSubmission,
      vi.fn(() => panelTargetLeaseIsCurrent(stateStore.getState(), panelTarget)),
    );
  });
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
      claimSubmission,
      isSubmissionPreparing: vi.fn(() => false),
      failActiveSubmissionClaim: vi.fn(),
    },
    slashCommandExecutor: { execute },
    turnSubmissionCommand: { sendTurnText },
    connection: {
      ensureConnected,
    },
    turnPort: { interruptTurn },
    status: {
      setStatus: vi.fn(),
      addSystemMessage: vi.fn(),
    },
    scroll: { showLatest },
  };
  return {
    host,
    captureInputSnapshot,
    claimSubmission,
    ensureConnected,
    execute,
    inputSnapshot,
    interruptTurn,
    sendTurnText,
    setDraft,
    settleSubmission,
    showLatest,
    stateStore,
  };
}

describe("submitComposer", () => {
  it("claims a plain submission before restored-thread loading and passes the claim to turn preparation", async () => {
    const restored = deferred<boolean>();
    const { host, inputSnapshot, sendTurnText } = createHost("first message");
    const settle = vi.fn();
    const claim = submissionClaim("first message", inputSnapshot, settle);
    host.composer.claimSubmission = vi.fn(() => claim);
    const hostWithRestoration = { ...host, ensureRestoredThreadLoaded: vi.fn(() => restored.promise) };

    const submitting = submitComposer(hostWithRestoration);

    expect(host.composer.claimSubmission).toHaveBeenCalledOnce();
    expect(sendTurnText).not.toHaveBeenCalled();

    restored.resolve(true);
    await submitting;

    expect(sendTurnText).toHaveBeenCalledWith({
      text: "first message",
      inputSnapshot,
      submissionClaim: claim,
    });
  });

  it("settles a claimed submission when a web submission appears during restored-thread loading", async () => {
    const restored = deferred<boolean>();
    const { host, inputSnapshot, sendTurnText, stateStore } = createHost("first message");
    const settle = vi.fn();
    host.composer.claimSubmission = vi.fn(() => {
      const panelTarget = capturePanelTargetLease(stateStore.getState());
      return submissionClaim(
        "first message",
        inputSnapshot,
        settle,
        vi.fn(() => panelTargetLeaseIsCurrent(stateStore.getState(), panelTarget)),
      );
    });
    const hostWithRestoration = { ...host, ensureRestoredThreadLoaded: vi.fn(() => restored.promise) };
    const submitting = submitComposer(hostWithRestoration);
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: "local-web",
        item: {
          id: "local-web",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "https://example.com/ summarize",
        },
        targetThreadId: null,
        phase: "cancellable",
      },
    });

    restored.resolve(true);
    await submitting;

    expect(sendTurnText).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith("failed");
  });

  it("settles a claimed submission without restoring it after the panel target changes during loading", async () => {
    const restored = deferred<boolean>();
    const { host, inputSnapshot, sendTurnText, stateStore } = createHost("first message");
    const settle = vi.fn();
    host.composer.claimSubmission = vi.fn(() => {
      const panelTarget = capturePanelTargetLease(stateStore.getState());
      return submissionClaim(
        "first message",
        inputSnapshot,
        settle,
        vi.fn(() => panelTargetLeaseIsCurrent(stateStore.getState(), panelTarget)),
      );
    });
    const hostWithRestoration = { ...host, ensureRestoredThreadLoaded: vi.fn(() => restored.promise) };
    const submitting = submitComposer(hostWithRestoration);
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    restored.resolve(true);
    await submitting;

    expect(sendTurnText).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith("failed");
  });

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
      phase: "committed" as const,
    };
    stateStore.dispatch({ type: "web-submission/pending", submission: pending } as never);

    await submitComposer(host);

    expect(stateStore.getState().pendingSubmission).toEqual(pending);
    expect(setDraft).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks composer submission from subagent threads", async () => {
    const { host, execute, sendTurnText } = createHost("hello", { subagent: true });

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
    expect(sendTurnText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "hello", inputSnapshot, submissionClaim: expect.any(Object) }),
    );
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
    expect(execute).toHaveBeenCalledWith("clear", "hello", inputSnapshot, {
      isCurrent: expect.any(Function),
      markAdopted: expect.any(Function),
      adoptPanelTarget: expect.any(Function),
    });
    expect(showLatest).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "hello", inputSnapshot, submissionClaim: expect.any(Object) }),
    );
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

    expect(sendTurnText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "[[Note]] (L1:C1-L1:C2)",
        inputSnapshot,
        codexInputOverride: [{ type: "text", text: "referenced input" }],
        submissionClaim: expect.any(Object),
      }),
    );
  });

  it("restores slash command text when command send results are not submitted", async () => {
    const { host, execute, inputSnapshot, sendTurnText } = createHost("/web https://example.com [[Note]]");
    execute.mockResolvedValue({
      sendText: "https://example.com/ [[Note]]",
      sendInput: [
        { type: "text", text: "https://example.com/ [[Note]]" },
        { type: "additionalContext", key: "codex_panel_web_context", kind: "untrusted", value: "Readable article" },
        { type: "fileReference", name: "Note", path: "Note.md" },
      ],
    });
    sendTurnText.mockResolvedValue(false);

    await submitComposer(host);

    expect(sendTurnText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://example.com/ [[Note]]",
        inputSnapshot,
        codexInputOverride: [
          { type: "text", text: "https://example.com/ [[Note]]" },
          { type: "additionalContext", key: "codex_panel_web_context", kind: "untrusted", value: "Readable article" },
          { type: "fileReference", name: "Note", path: "Note.md" },
        ],
        pendingSubmissionId: expect.stringMatching(/^local-web-/),
        submissionClaim: expect.any(Object),
      }),
    );
    expect(host.composer.failActiveSubmissionClaim).toHaveBeenCalled();
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
    expect(setDraft).not.toHaveBeenCalled();
    expect(showLatest).toHaveBeenCalledOnce();
    expect(sendTurnText).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);

    fetch.resolve({ sendText: "https://example.com/ summarize", sendInput: [{ type: "text", text: "prepared" }] });
    await submitting;

    expect(sendTurnText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "https://example.com/ summarize",
        inputSnapshot,
        codexInputOverride: [{ type: "text", text: "prepared" }],
        pendingSubmissionId: pending?.id,
        submissionClaim: expect.any(Object),
      }),
    );
  });

  it("cancels a pending web import and restores its exact draft before late success", async () => {
    const { host, execute, sendTurnText, stateStore } = createHost("  /web https://example.com summarize  ");
    const fetch = deferred<{ sendText: string }>();
    execute.mockImplementation(() => fetch.promise);

    const first = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    await submitComposer(host);

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(host.composer.failActiveSubmissionClaim).toHaveBeenCalledOnce();
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

    expect(setDraft).not.toHaveBeenCalled();
    expect(host.composer.failActiveSubmissionClaim).toHaveBeenCalledOnce();
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
    expect(setDraft).not.toHaveBeenCalled();
    expect(host.composer.failActiveSubmissionClaim).toHaveBeenCalledOnce();
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

    expect(setDraft).not.toHaveBeenCalled();
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
    expect(stateStore.getState().pendingSubmission).toBeNull();
  });

  it("leaves web draft recovery to the claim and ignores late fetch success after the connection scope clears", async () => {
    const { host, execute, sendTurnText, setDraft, stateStore } = createHost("  /web https://example.com summarize  ");
    const fetch = deferred<{ sendText: string }>();
    execute.mockImplementation(() => fetch.promise);

    const submitting = submitComposer(host);
    await vi.waitFor(() => expect(stateStore.getState().pendingSubmission).not.toBeNull());
    stateStore.dispatch({ type: "connection/scoped-cleared" });

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(stateStore.getState().composer.draft).toBe("");

    fetch.resolve({ sendText: "https://example.com/ summarize" });
    await submitting;

    expect(sendTurnText).not.toHaveBeenCalled();
    expect(setDraft).not.toHaveBeenCalled();
    expect(stateStore.getState().composer.draft).toBe("");
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
    expect(setDraft).not.toHaveBeenCalled();
    expect(host.composer.failActiveSubmissionClaim).toHaveBeenCalledOnce();
  });

  it("restores slash command composer drafts from command results", async () => {
    const { host, ensureConnected, execute, sendTurnText, setDraft, settleSubmission, showLatest } = createHost("/goal edit");
    execute.mockResolvedValue({ composerDraft: "/goal set Current objective" });

    await submitComposer(host);

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(setDraft).not.toHaveBeenCalled();
    expect(settleSubmission).toHaveBeenCalledWith("accepted", "/goal set Current objective");
    expect(showLatest).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("restores slash command text and reports executor errors", async () => {
    const { host, execute, sendTurnText, setDraft, settleSubmission, showLatest } = createHost(
      "/web https://obsidian.md/help/plugins/web-viewer 読める？",
    );
    execute.mockRejectedValue(new Error("No readable content found for https://obsidian.md/help/plugins/web-viewer"));

    await submitComposer(host);

    expect(setDraft).not.toHaveBeenCalled();
    expect(settleSubmission).toHaveBeenCalledWith("failed");
    expect(host.status.addSystemMessage).toHaveBeenCalledWith("No readable content found for https://obsidian.md/help/plugins/web-viewer");
    expect(showLatest).toHaveBeenCalledOnce();
    expect(sendTurnText).not.toHaveBeenCalled();
    expect(chatStateThreadStreamItems(host.stateStore.getState())).toEqual([]);
  });

  it("restores the completed thread target when slash execution fails", async () => {
    const threadCommandTarget = { command: "resume" as const, threadId: "target-thread", title: "Completed title" };
    const { host, execute, setDraft, settleSubmission } = createHost('/resume "Completed title"', { threadCommandTarget });
    execute.mockRejectedValue(new Error("offline"));

    await submitComposer(host);

    expect(setDraft).not.toHaveBeenCalled();
    expect(settleSubmission).toHaveBeenCalledWith("failed");
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

  it("interrupts a running turn even when the thread rejects direct input", async () => {
    const { host, interruptTurn, sendTurnText, stateStore } = createHost("unsent draft");
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: { ...thread("thread"), canAcceptDirectInput: false },
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });

    await submitComposer(host);

    expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
    expect(sendTurnText).not.toHaveBeenCalled();
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
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
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}
