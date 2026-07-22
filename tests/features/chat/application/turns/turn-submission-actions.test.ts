import { describe, expect, it, vi } from "vitest";

import type { CodexInput } from "../../../../../src/domain/chat/input";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { activeThreadId, createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { RestorationController } from "../../../../../src/features/chat/application/threads/restoration-controller";
import { optimisticTurnStart } from "../../../../../src/features/chat/application/turns/optimistic-turn-start";
import {
  createTurnSubmissionActions,
  type TurnSubmissionActionsHost,
} from "../../../../../src/features/chat/application/turns/turn-submission-actions";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/turns/web-submission";
import { deferred } from "../../../../support/async";
import { chatStateThreadStreamItems } from "../../support/thread-stream";

const textInput = (text: string): CodexInput => [{ type: "text", text }];
const completedCurrent = <T>(value: T): EffectOutcome<T> => ({ kind: "completed-current", value });
const notStarted = <T>(): EffectOutcome<T> => ({ kind: "not-started" });

function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
    canAcceptDirectInput: null,
    provenance: { kind: "interactive" },
  };
}

type TurnSubmissionHostOverrides = Partial<TurnSubmissionActionsHost>;

function createHost(overrides: TurnSubmissionHostOverrides = {}) {
  const stateStore = createChatStateStore(createChatState());
  const startTurn = vi.fn().mockResolvedValue(completedCurrent({ turnId: "turn" }));
  const steerTurn = vi.fn().mockResolvedValue(completedCurrent(undefined));
  const host: TurnSubmissionActionsHost = {
    stateStore,
    turnTransport: {
      ensureConnected: vi.fn().mockResolvedValue(true),
      startTurn,
      steerTurn,
      interruptTurn: vi.fn().mockResolvedValue(true),
    },
    ensureRestoredThreadLoaded: vi.fn().mockResolvedValue(true),
    startThread: vi.fn().mockImplementation(async (_preview, options) => {
      resumeThread(stateStore, options?.preservePendingSubmissionId);
      return { kind: "created-activated", threadId: "thread" };
    }),
    notifyActiveThreadIdentityChanged: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    applyPendingThreadSettings: vi.fn().mockResolvedValue(true),
    prepareInput: vi.fn((text: string) => ({ text, input: textInput(text) })),
    setDraft: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    ...overrides,
    localItemIds: overrides.localItemIds ?? createLocalIdSource(),
  };
  return { host, startTurn, stateStore, steerTurn };
}

function resumeThread(stateStore: ReturnType<typeof createChatStateStore>, preservePendingSubmissionId?: string, threadId = "thread") {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: thread(threadId),
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
    ...(preservePendingSubmissionId ? { preservePendingSubmissionId } : {}),
  });
}

function resumeSubagentThread(stateStore: ReturnType<typeof createChatStateStore>, canAcceptDirectInput: boolean | null = null) {
  const child: Thread = {
    ...thread("child"),
    canAcceptDirectInput,
    provenance: {
      kind: "subagent",
      subagentKind: "thread-spawn",
      parentThreadId: "parent",
      sessionId: "session",
      depth: 1,
      agentNickname: null,
      agentRole: null,
    },
  };
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: child,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

function resumeSideChat(stateStore: ReturnType<typeof createChatStateStore>) {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: thread("side"),
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
    lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
  });
}

describe("TurnSubmissionActions", () => {
  it("aborts when restoration changes target while hydration is pending", async () => {
    const { host, startTurn, stateStore } = createHost();
    const restoration = new RestorationController({ stateStore });
    const resume = deferred<void>();
    const loadThread = vi.fn(() => resume.promise);
    host.ensureRestoredThreadLoaded = () => restoration.ensureLoaded(loadThread);
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "first", fallbackTitle: null });
    const actions = createTurnSubmissionActions(host);

    const submitting = actions.sendTurnText({ text: "hello" });
    await vi.waitFor(() => {
      expect(loadThread).toHaveBeenCalledWith("first");
    });
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "second", fallbackTitle: null });
    resume.resolve(undefined);

    await expect(submitting).resolves.toBe(false);
    expect(host.startThread).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("does not submit to an old thread after the panel changes during connection", async () => {
    const connection = deferred<boolean>();
    const ensureConnected = vi.fn(() => connection.promise);
    const { host, startTurn, stateStore } = createHost({
      turnTransport: {
        ensureConnected,
        startTurn: vi.fn().mockResolvedValue(completedCurrent({ turnId: "turn" })),
        steerTurn: vi.fn().mockResolvedValue(completedCurrent(undefined)),
        interruptTurn: vi.fn().mockResolvedValue(true),
      },
    });
    resumeThread(stateStore, undefined, "first");
    const actions = createTurnSubmissionActions(host);

    const submitting = actions.sendTurnText({ text: "hello" });
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledOnce());
    resumeThread(stateStore, undefined, "second");
    connection.resolve(true);

    await expect(submitting).resolves.toBe(false);
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.applyPendingThreadSettings).not.toHaveBeenCalled();
    expect(host.setDraft).not.toHaveBeenCalled();
    expect(activeThreadId(stateStore.getState())).toBe("second");
  });

  it("blocks direct turn submission after a restored thread resolves to a subagent", async () => {
    const { host, startTurn, stateStore } = createHost({
      ensureRestoredThreadLoaded: vi.fn().mockImplementation(async () => {
        resumeSubagentThread(stateStore);
        return true;
      }),
    });
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "child", fallbackTitle: "Agent" });
    const actions = createTurnSubmissionActions(host);

    await expect(actions.sendTurnText({ text: "hello" })).resolves.toBe(false);

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Messages are unavailable in agent threads. Start a new chat to continue.");
  });

  it("submits to a subagent when the loaded server capability allows direct input", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeSubagentThread(stateStore, true);
    const actions = createTurnSubmissionActions(host);

    await expect(actions.sendTurnText({ text: "hello" })).resolves.toBe(true);

    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ threadId: "child", input: textInput("hello") }));
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not start a turn when the loaded thread rejects direct input", async () => {
    const { host, startTurn, stateStore } = createHost();
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
    const actions = createTurnSubmissionActions(host);

    await expect(actions.sendTurnText({ text: "hello" })).resolves.toBe(false);

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("This thread cannot accept messages.");
  });

  it("starts a side-chat turn when no pending runtime setting needs transport", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeSideChat(stateStore);
    const actions = createTurnSubmissionActions(host);

    await expect(actions.sendTurnText({ text: "hello" })).resolves.toBe(true);

    expect(host.applyPendingThreadSettings).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ threadId: "side", input: textInput("hello") }));
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("starts a thread when needed and acknowledges the optimistic turn", async () => {
    const { host, startTurn, stateStore } = createHost();
    const actions = createTurnSubmissionActions(host);

    const submitted = await actions.sendTurnText({ text: "hello" });

    expect(submitted).toBe(true);
    expect(host.startThread).toHaveBeenCalledWith("hello");
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(startTurn).toHaveBeenCalledWith({
      threadId: "thread",
      input: textInput("hello"),
      clientUserMessageId: expect.stringMatching(/^local-user-\d+-[A-Za-z0-9_-]+-[a-z0-9]+$/),
    });
    expect(host.prepareInput).not.toHaveBeenCalled();
    expect(stateStore.getState().turn.lifecycle).toEqual({ kind: "running", turnId: "turn" });
    expect(host.setDraft).toHaveBeenCalledWith("");
    expect(host.setStatus).toHaveBeenCalledWith("Turn running...");
  });

  it("replaces a pending web submission when starting a turn", async () => {
    const { host, stateStore } = createHost();
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: null,
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({
      text: "https://example.com/ summarize",
      codexInputOverride: textInput("https://example.com/ summarize"),
      pendingSubmissionId: pending.id,
    });

    const dialogues = chatStateThreadStreamItems(stateStore.getState()).filter((item) => item.kind === "dialogue");
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0]).toMatchObject({
      id: pending.id,
      clientId: expect.stringMatching(/^local-user-/),
      text: "https://example.com/ summarize",
    });
  });

  it("keeps a pending web submission visible through internal thread creation and settings", async () => {
    const settings = deferred<boolean>();
    const { host, startTurn, stateStore } = createHost({ applyPendingThreadSettings: vi.fn(() => settings.promise) });
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: null,
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const actions = createTurnSubmissionActions(host);

    const submitting = actions.sendTurnText({
      text: pending.text,
      codexInputOverride: textInput(pending.text),
      pendingSubmissionId: pending.id,
    });
    await vi.waitFor(() => expect(host.applyPendingThreadSettings).toHaveBeenCalledOnce());

    expect(activeThreadId(stateStore.getState())).toBe("thread");
    expect(stateStore.getState().pendingSubmission).toMatchObject({
      id: pending.id,
      targetThreadId: "thread",
      phase: "committed",
    });
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);

    settings.resolve(true);
    await expect(submitting).resolves.toBe(true);

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(chatStateThreadStreamItems(stateStore.getState())[0]).toMatchObject({
      id: pending.id,
      clientId: startTurn.mock.calls[0]?.[0].clientUserMessageId,
    });
  });

  it("commits a pending web import before thread creation and ignores cancellation during the RPC", async () => {
    const threadStarting = deferred<void>();
    const { host, startTurn, stateStore } = createHost();
    host.startThread = vi.fn().mockImplementation(async (_preview, options) => {
      await threadStarting.promise;
      resumeThread(stateStore, options?.preservePendingSubmissionId);
      return { kind: "created-activated", threadId: "thread" };
    });
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: null,
        originalDraft: "/web https://example.com summarize",
        phase: "cancellable",
      },
    } as never);
    const actions = createTurnSubmissionActions(host);

    const submitting = actions.sendTurnText({
      text: pending.text,
      codexInputOverride: textInput(pending.text),
      preserveComposerContextOnFailure: true,
      pendingSubmissionId: pending.id,
      failureDraft: "/web https://example.com summarize",
    });
    await vi.waitFor(() => expect(host.startThread).toHaveBeenCalledOnce());

    expect(stateStore.getState().pendingSubmission?.phase).toBe("committed");
    stateStore.dispatch({ type: "web-submission/cancelled", submissionId: pending.id });
    expect(stateStore.getState().pendingSubmission?.phase).toBe("committed");

    threadStarting.resolve(undefined);
    await expect(submitting).resolves.toBe(true);
    expect(startTurn).toHaveBeenCalledOnce();
    expect(stateStore.getState().pendingSubmission).toBeNull();
  });

  it("cleans up a committed web import when pending runtime settings fail", async () => {
    const { host, startTurn, stateStore } = createHost({ applyPendingThreadSettings: vi.fn().mockResolvedValue(false) });
    resumeThread(stateStore);
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com summarize",
        phase: "cancellable",
      },
    });
    const actions = createTurnSubmissionActions(host);

    await expect(
      actions.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        preserveComposerContextOnFailure: true,
        pendingSubmissionId: pending.id,
        failureDraft: "/web https://example.com summarize",
      }),
    ).resolves.toBe(false);

    expect(startTurn).not.toHaveBeenCalled();
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(host.setDraft).toHaveBeenCalledWith("/web https://example.com summarize", { preserveContext: true });
  });

  it("cleans up a committed web import when starting the turn fails", async () => {
    const { host, startTurn, stateStore } = createHost();
    startTurn.mockResolvedValue(notStarted());
    resumeThread(stateStore);
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com summarize",
        phase: "cancellable",
      },
    });
    const actions = createTurnSubmissionActions(host);

    await expect(
      actions.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        preserveComposerContextOnFailure: true,
        pendingSubmissionId: pending.id,
        failureDraft: "/web https://example.com summarize",
      }),
    ).resolves.toBe(false);

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(host.setDraft).toHaveBeenCalledWith("/web https://example.com summarize", { preserveContext: true });
  });

  it("commits a pending web import before steering and lets the late result adopt it", async () => {
    const steering = deferred<EffectOutcome<void>>();
    const { host, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockImplementation(() => steering.promise);
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com summarize",
        phase: "cancellable",
      },
    } as never);
    const actions = createTurnSubmissionActions(host);

    const submitting = actions.sendTurnText({
      text: pending.text,
      codexInputOverride: textInput(pending.text),
      preserveComposerContextOnFailure: true,
      pendingSubmissionId: pending.id,
      failureDraft: "/web https://example.com summarize",
    });
    await vi.waitFor(() => expect(steerTurn).toHaveBeenCalledOnce());

    expect(stateStore.getState().pendingSubmission?.phase).toBe("committed");
    stateStore.dispatch({ type: "web-submission/cancelled", submissionId: pending.id });
    expect(stateStore.getState().pendingSubmission?.phase).toBe("committed");

    steering.resolve(completedCurrent(undefined));
    await expect(submitting).resolves.toBe(true);
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(chatStateThreadStreamItems(stateStore.getState())[0]).toMatchObject({ id: pending.id, turnId: "turn" });
  });

  it("cleans up and restores a committed pending web steer when the RPC fails", async () => {
    const { host, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockResolvedValue(notStarted());
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com summarize",
        phase: "cancellable",
      },
    } as never);
    const actions = createTurnSubmissionActions(host);

    await expect(
      actions.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        preserveComposerContextOnFailure: true,
        pendingSubmissionId: pending.id,
        failureDraft: "/web https://example.com summarize",
      }),
    ).resolves.toBe(false);

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(host.setDraft).toHaveBeenCalledWith("/web https://example.com summarize", { focus: true, preserveContext: true });
  });

  it("restores the original web command when starting the adopted turn returns no response", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeThread(stateStore);
    startTurn.mockResolvedValue(notStarted());
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const actions = createTurnSubmissionActions(host);

    await expect(
      actions.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        preserveComposerContextOnFailure: true,
        pendingSubmissionId: pending.id,
        failureDraft: "/web https://example.com summarize",
      }),
    ).resolves.toBe(false);

    expect(host.setDraft).toHaveBeenCalledWith("/web https://example.com summarize", { preserveContext: true });
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
  });

  it("restores the original web command when starting the adopted turn throws", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeThread(stateStore);
    startTurn.mockRejectedValue(new Error("offline"));
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const actions = createTurnSubmissionActions(host);

    await expect(
      actions.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        preserveComposerContextOnFailure: true,
        pendingSubmissionId: pending.id,
        failureDraft: "/web https://example.com summarize",
      }),
    ).resolves.toBe(false);

    expect(host.setDraft).toHaveBeenCalledWith("/web https://example.com summarize", { preserveContext: true });
    expect(host.addSystemMessage).toHaveBeenCalledWith("offline");
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
  });

  it("does not send fetched web context to a thread selected while settings are pending", async () => {
    const settings = deferred<boolean>();
    const { host, startTurn, stateStore } = createHost({ applyPendingThreadSettings: vi.fn(() => settings.promise) });
    resumeThread(stateStore);
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const actions = createTurnSubmissionActions(host);

    const submitting = actions.sendTurnText({
      text: pending.text,
      codexInputOverride: textInput(pending.text),
      pendingSubmissionId: pending.id,
    });
    await vi.waitFor(() => expect(host.applyPendingThreadSettings).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "active-thread/cleared" });
    resumeThread(stateStore, undefined, "other-thread");
    settings.resolve(true);

    await expect(submitting).resolves.toBe(false);
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setDraft).not.toHaveBeenCalledWith(pending.text, expect.anything());
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not create a second thread after the first creation completes in a stale context", async () => {
    const { host, startTurn } = createHost({
      startThread: vi.fn().mockResolvedValue({ kind: "created-not-activated", threadId: "created" }),
    });
    const actions = createTurnSubmissionActions(host);

    await expect(actions.sendTurnText({ text: "hello" })).resolves.toBe(true);

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith(
      "Created thread created, but the connection changed before it could be opened. Select it from history to continue.",
    );
  });

  it("applies reserved runtime settings after creating a thread and before starting the turn", async () => {
    const { host, startTurn, stateStore } = createHost();
    const applyPendingThreadSettings = vi.fn().mockImplementation(async () => {
      expect(activeThreadId(stateStore.getState())).toBe("thread");
      return true;
    });
    host.applyPendingThreadSettings = applyPendingThreadSettings;
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({ text: "hello" });

    expect(applyPendingThreadSettings).toHaveBeenCalledOnce();
    expect(vi.mocked(host.startThread).mock.invocationCallOrder[0]).toBeLessThan(
      applyPendingThreadSettings.mock.invocationCallOrder[0] ?? 0,
    );
    expect(applyPendingThreadSettings.mock.invocationCallOrder[0]).toBeLessThan(startTurn.mock.invocationCallOrder[0] ?? 0);
  });

  it("uses prepared visible text for optimistic history and app-server input", async () => {
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const { host, startTurn, stateStore } = createHost({
      prepareInput: vi.fn(() => ({
        text: "fix [[notes/Alpha]] (L42:C5-L47:C1)",
        input: [
          { type: "text", text: "fix [[notes/Alpha]] (L42:C5-L47:C1)" },
          { type: "fileReference", name: "Alpha", path: "notes/Alpha.md" },
          { type: "additionalContext", key: "codex_panel_obsidian_context", kind: "untrusted", value: "selected text" },
        ] satisfies CodexInput,
      })),
    });
    resumeThread(stateStore);
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({ text: "fix @selection", inputSnapshot });

    expect(host.prepareInput).toHaveBeenCalledWith("fix @selection", inputSnapshot);
    expect(startTurn).toHaveBeenCalledWith({
      threadId: "thread",
      input: [
        { type: "text", text: "fix [[notes/Alpha]] (L42:C5-L47:C1)" },
        { type: "fileReference", name: "Alpha", path: "notes/Alpha.md" },
        { type: "additionalContext", key: "codex_panel_obsidian_context", kind: "untrusted", value: "selected text" },
      ],
      clientUserMessageId: expect.any(String),
    });
    expect(chatStateThreadStreamItems(stateStore.getState())[0]).toMatchObject({
      kind: "dialogue",
      text: "fix [[notes/Alpha]] (L42:C5-L47:C1)",
      referencedFiles: [{ name: "Alpha", path: "notes/Alpha.md" }],
    });
  });

  it("preserves composer context when overridden slash command input fails to start", async () => {
    const input = [
      { type: "text" as const, text: "[[Codex Clippings/Example.md]] summarize [[Attachment.png]]" },
      { type: "fileReference" as const, name: "Example", path: "Codex Clippings/Example.md" },
      { type: "additionalContext" as const, key: "codex_panel_obsidian_context", kind: "untrusted" as const, value: "selection" },
      { type: "fileReference" as const, name: "Attachment.png", path: "Attachment.png" },
      { type: "localImage" as const, path: "Attachment.png" },
    ] satisfies CodexInput;
    const { host, startTurn, stateStore } = createHost();
    startTurn.mockResolvedValue(notStarted());
    resumeThread(stateStore);
    const actions = createTurnSubmissionActions(host);

    const submitted = await actions.sendTurnText({
      text: "[[Codex Clippings/Example.md]] summarize [[Attachment.png]]",
      codexInputOverride: input,
      preserveComposerContextOnFailure: true,
    });

    expect(submitted).toBe(false);
    expect(host.setDraft).toHaveBeenCalledWith("", { preserveContext: true });
    expect(host.setDraft).toHaveBeenCalledWith("[[Codex Clippings/Example.md]] summarize [[Attachment.png]]", {
      preserveContext: true,
    });
  });

  it("does not restore a turn that completed in a superseded app-server context", async () => {
    const { host, startTurn, stateStore } = createHost();
    startTurn.mockResolvedValue({ kind: "completed-stale", value: { turnId: "turn" } });
    resumeThread(stateStore);
    const actions = createTurnSubmissionActions(host);

    await expect(actions.sendTurnText({ text: "hello" })).resolves.toBe(true);

    expect(host.setDraft).toHaveBeenCalledWith("");
    expect(host.setDraft).not.toHaveBeenCalledWith("hello");
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("prepares turn input with the provided composer input snapshot", async () => {
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const { host, stateStore } = createHost();
    resumeThread(stateStore);
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({ text: "hello", inputSnapshot });

    expect(host.prepareInput).toHaveBeenCalledWith("hello", inputSnapshot);
  });

  it("does not restore stale drafts or report stale start failures after the active thread changes", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeThread(stateStore);
    startTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      throw new Error("offline");
    });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({ text: "hello" });

    expect(host.setDraft).toHaveBeenCalledWith("");
    expect(host.setDraft).not.toHaveBeenCalledWith("hello");
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("steers a running turn instead of starting another turn", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({ text: "follow up" });

    expect(steerTurn).toHaveBeenCalledWith({
      threadId: "thread",
      turnId: "turn",
      input: textInput("follow up"),
      clientUserMessageId: expect.stringMatching(/^local-steer-\d+-[A-Za-z0-9_-]+-[a-z0-9]+$/),
    });
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setStatus).toHaveBeenCalledWith("Steered current turn.");
    const localSteerId = steerTurn.mock.calls[0]?.[0].clientUserMessageId;
    expect(
      chatStateThreadStreamItems(stateStore.getState()).some(
        (item) => item.kind === "dialogue" && item.id === localSteerId && item.text === "follow up",
      ),
    ).toBe(true);
  });

  it("replaces a pending web submission after steering succeeds", async () => {
    const { host, stateStore } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({
      text: "https://example.com/ summarize",
      codexInputOverride: textInput("https://example.com/ summarize"),
      pendingSubmissionId: pending.id,
    });

    const dialogues = chatStateThreadStreamItems(stateStore.getState()).filter((item) => item.kind === "dialogue");
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0]).toMatchObject({
      id: pending.id,
      clientId: expect.stringMatching(/^local-steer-/),
      text: "https://example.com/ summarize",
      turnId: "turn",
    });
  });

  it("adopts a successful pending web steer after the active turn completes", async () => {
    const { host, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const steering = deferred<EffectOutcome<void>>();
    steerTurn.mockImplementation(() => steering.promise);
    const actions = createTurnSubmissionActions(host);
    const input = [
      { type: "text" as const, text: pending.text },
      {
        type: "additionalContext" as const,
        key: "codex_panel_web_context",
        kind: "untrusted" as const,
        value: "Web page context for the current user input:\nSource: https://example.com/\n\nReadable article",
      },
    ];

    const submitting = actions.sendTurnText({
      text: pending.text,
      codexInputOverride: input,
      preserveComposerContextOnFailure: true,
      pendingSubmissionId: pending.id,
      failureDraft: "/web https://example.com summarize",
    });
    await vi.waitFor(() => expect(steerTurn).toHaveBeenCalledOnce());
    const clientId = steerTurn.mock.calls[0]?.[0].clientUserMessageId;
    stateStore.dispatch({
      type: "turn/completed",
      turnId: "turn",
      status: "completed",
      items: [
        {
          id: "server-user",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: pending.text,
          copyText: pending.text,
          turnId: "turn",
          clientId,
        },
      ],
    });
    steering.resolve(completedCurrent(undefined));

    await expect(submitting).resolves.toBe(true);
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({
        id: "server-user",
        clientId,
        contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      }),
    ]);
  });

  it("reports busy turns that cannot be steered", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    const optimistic = optimisticTurnStart({ id: "local-user", text: "pending", codexInput: textInput("pending") });
    stateStore.dispatch({
      type: "turn/optimistic-started",
      item: optimistic.item,
      pendingTurnStart: optimistic.pendingTurnStart,
    });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({ text: "follow up" });

    expect(host.addSystemMessage).toHaveBeenCalledWith("Current turn is not steerable yet.");
    expect(steerTurn).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("rejects a second submission while the first submission is still preparing", async () => {
    const settings = deferred<boolean>();
    const { host, startTurn, stateStore } = createHost({ applyPendingThreadSettings: vi.fn(() => settings.promise) });
    resumeThread(stateStore);
    const actions = createTurnSubmissionActions(host);

    const first = actions.sendTurnText({ text: "first" });
    await Promise.resolve();
    const second = actions.sendTurnText({ text: "second" });
    settings.resolve(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(startTurn).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ input: textInput("first") }));
  });

  it("keeps local user ids distinct when submissions share the same timestamp", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const first = createHost();
      const second = createHost();
      for (const host of [first.host, second.host]) {
        resumeThread(host.stateStore);
      }

      await createTurnSubmissionActions(first.host).sendTurnText({ text: "first" });
      await createTurnSubmissionActions(second.host).sendTurnText({ text: "second" });

      const firstId = first.startTurn.mock.calls[0]?.[0].clientUserMessageId;
      const secondId = second.startTurn.mock.calls[0]?.[0].clientUserMessageId;
      expect(firstId).toMatch(/^local-user-1234-[A-Za-z0-9_-]+-[a-z0-9]+$/);
      expect(secondId).toMatch(/^local-user-1234-[A-Za-z0-9_-]+-[a-z0-9]+$/);
      expect(firstId).not.toBe(secondId);
    } finally {
      now.mockRestore();
    }
  });

  it("does not append stale steer dialogues after the active turn changes", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      return completedCurrent(undefined);
    });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({ text: "follow up" });

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(host.setStatus).not.toHaveBeenCalledWith("Steered current turn.");
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
  });

  it("does not restore a steer that completed in a superseded app-server context", async () => {
    const { host, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockResolvedValue({ kind: "completed-stale", value: undefined });
    const actions = createTurnSubmissionActions(host);

    await expect(actions.sendTurnText({ text: "follow up" })).resolves.toBe(true);

    expect(host.setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(host.setDraft).not.toHaveBeenCalledWith("follow up", { focus: true });
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not restore stale steer drafts or report stale steer failures after the active turn changes", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      throw new Error("offline");
    });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText({ text: "follow up" });

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(host.setDraft).not.toHaveBeenCalledWith("follow up", { focus: true });
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });
});
