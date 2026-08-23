import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { CodexInput } from "../../../../../src/domain/turns/input";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import { activeThreadId, createChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { optimisticTurnStart } from "../../../../../src/features/chat/application/submission/optimistic-turn-start";
import {
  createTurnSubmissionCommand,
  type TurnSubmissionCommandHost,
} from "../../../../../src/features/chat/application/submission/turn-submission-command";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/submission/web-submission";
import { RestorationController } from "../../../../../src/features/chat/application/threads/restoration-controller";
import { deferred } from "../../../../support/async";
import { chatStateThreadStreamItems } from "../../support/thread-stream";

const textInput = (text: string): CodexInput => [{ type: "text", text }];
const completed = <T>(value: T): EffectOutcome<T> => ({ kind: "completed", value });
const notStarted = <T>(): EffectOutcome<T> => ({ kind: "not-started" });

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

type TurnSubmissionHostOverrides = Partial<TurnSubmissionCommandHost>;

function createHost(overrides: TurnSubmissionHostOverrides = {}) {
  const stateStore = createChatStateStore(createChatState());
  const startTurn = vi.fn().mockResolvedValue(completed({ turnId: "turn" }));
  const steerTurn = vi.fn().mockResolvedValue(completed(undefined));
  const host: TurnSubmissionCommandHost & { setDraft: ReturnType<typeof vi.fn> } = {
    stateStore,
    ensureConnected: vi.fn().mockResolvedValue(true),
    turnPort: {
      startTurn,
      steerTurn,
      interruptTurn: vi.fn().mockResolvedValue(true),
    },
    ensureRestoredThreadLoaded: vi.fn().mockResolvedValue(true),
    startThread: vi.fn().mockImplementation(async (_preview, options) => {
      options?.adoptPanelTarget?.("thread");
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
    canAcceptDirectInput: null,
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
    canAcceptDirectInput,
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
    canAcceptDirectInput: null,
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

describe("TurnSubmissionCommand", () => {
  it("aborts when restoration changes target while hydration is pending", async () => {
    const { host, startTurn, stateStore } = createHost();
    const restoration = new RestorationController({ stateStore });
    const resume = deferred<void>();
    const loadThread = vi.fn(() => resume.promise);
    host.ensureRestoredThreadLoaded = () => restoration.ensureLoaded(loadThread);
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "first", fallbackTitle: null });
    const commands = createTurnSubmissionCommand(host);

    const submitting = commands.sendTurnText({ text: "hello" });
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
      ensureConnected,
      turnPort: {
        startTurn: vi.fn().mockResolvedValue(completed({ turnId: "turn" })),
        steerTurn: vi.fn().mockResolvedValue(completed(undefined)),
        interruptTurn: vi.fn().mockResolvedValue(true),
      },
    });
    resumeThread(stateStore, undefined, "first");
    const commands = createTurnSubmissionCommand(host);

    const submitting = commands.sendTurnText({ text: "hello" });
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
    const commands = createTurnSubmissionCommand(host);

    await expect(commands.sendTurnText({ text: "hello" })).resolves.toBe(false);

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Messages are unavailable in agent threads. Start a new chat to continue.");
  });

  it("submits to a subagent when the loaded server capability allows direct input", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeSubagentThread(stateStore, true);
    const commands = createTurnSubmissionCommand(host);

    await expect(commands.sendTurnText({ text: "hello" })).resolves.toBe(true);

    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ threadId: "child", input: textInput("hello") }));
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("does not start a turn when the loaded thread rejects direct input", async () => {
    const { host, startTurn, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: false,
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
    const commands = createTurnSubmissionCommand(host);

    await expect(commands.sendTurnText({ text: "hello" })).resolves.toBe(false);

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("This thread cannot accept messages.");
  });

  it("starts a side-chat turn when no pending runtime setting needs port", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeSideChat(stateStore);
    const commands = createTurnSubmissionCommand(host);

    await expect(commands.sendTurnText({ text: "hello" })).resolves.toBe(true);

    expect(host.applyPendingThreadSettings).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ threadId: "side", input: textInput("hello") }));
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("starts a thread when needed and acknowledges the optimistic turn", async () => {
    const { host, startTurn, stateStore } = createHost();
    const commands = createTurnSubmissionCommand(host);

    const submitted = await commands.sendTurnText({ text: "hello" });

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
    expect(stateStore.getState().activeTurn.lifecycle).toEqual({ kind: "running", turnId: "turn" });
    expect(host.setDraft).not.toHaveBeenCalled();
    expect(host.setStatus).toHaveBeenCalledWith("Turn running...");
  });

  it("hands an owned first-turn claim across the thread activation boundary", async () => {
    const { host } = createHost();
    const adoptPanelTarget = vi.fn();

    await createTurnSubmissionCommand(host).sendTurnText({
      text: "first message",
      submissionClaim: {
        text: "first message",
        inputSnapshot: {} as never,
        isCurrent: vi.fn(() => true),
        markAdopted: vi.fn(),
        adoptPanelTarget,
        settle: vi.fn(),
      },
    });

    expect(adoptPanelTarget).toHaveBeenCalledWith("thread");
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
        phase: "cancellable",
      },
    });
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({
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
        phase: "cancellable",
      },
    });
    const commands = createTurnSubmissionCommand(host);

    const submitting = commands.sendTurnText({
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
        phase: "cancellable",
      },
    } as never);
    const commands = createTurnSubmissionCommand(host);

    const submitting = commands.sendTurnText({
      text: pending.text,
      codexInputOverride: textInput(pending.text),
      pendingSubmissionId: pending.id,
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
        phase: "cancellable",
      },
    });
    const commands = createTurnSubmissionCommand(host);

    await expect(
      commands.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        pendingSubmissionId: pending.id,
      }),
    ).resolves.toBe(false);

    expect(startTurn).not.toHaveBeenCalled();
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(host.setDraft).not.toHaveBeenCalled();
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
        phase: "cancellable",
      },
    });
    const commands = createTurnSubmissionCommand(host);

    await expect(
      commands.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        pendingSubmissionId: pending.id,
      }),
    ).resolves.toBe(false);

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(host.setDraft).not.toHaveBeenCalled();
  });

  it("moves a pending web import into the steer queue before the RPC settles", async () => {
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
        phase: "cancellable",
      },
    } as never);
    const commands = createTurnSubmissionCommand(host);

    const submitting = commands.sendTurnText({
      text: pending.text,
      codexInputOverride: textInput(pending.text),
      pendingSubmissionId: pending.id,
    });
    await vi.waitFor(() => expect(steerTurn).toHaveBeenCalledOnce());

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([
      expect.objectContaining({ id: pending.id, clientId: expect.stringMatching(/^local-steer-/), turnId: "turn" }),
    ]);
    stateStore.dispatch({ type: "web-submission/cancelled", submissionId: pending.id });
    expect(stateStore.getState().activeTurn.pendingSteers).toHaveLength(1);

    steering.resolve(completed(undefined));
    await expect(submitting).resolves.toBe(true);
    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().activeTurn.pendingSteers[0]).toMatchObject({ id: pending.id, turnId: "turn" });
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
        phase: "cancellable",
      },
    } as never);
    const commands = createTurnSubmissionCommand(host);

    await expect(
      commands.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        pendingSubmissionId: pending.id,
      }),
    ).resolves.toBe(false);

    expect(stateStore.getState().pendingSubmission).toBeNull();
    expect(host.setDraft).not.toHaveBeenCalled();
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
        phase: "cancellable",
      },
    });
    const commands = createTurnSubmissionCommand(host);

    await expect(
      commands.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        pendingSubmissionId: pending.id,
      }),
    ).resolves.toBe(false);

    expect(host.setDraft).not.toHaveBeenCalled();
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
        phase: "cancellable",
      },
    });
    const commands = createTurnSubmissionCommand(host);

    await expect(
      commands.sendTurnText({
        text: pending.text,
        codexInputOverride: textInput(pending.text),
        pendingSubmissionId: pending.id,
      }),
    ).resolves.toBe(false);

    expect(host.setDraft).not.toHaveBeenCalled();
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
        phase: "cancellable",
      },
    });
    const commands = createTurnSubmissionCommand(host);

    const submitting = commands.sendTurnText({
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

  it("does not create a second thread after the first creation loses its panel target", async () => {
    const { host, startTurn } = createHost({
      startThread: vi.fn().mockResolvedValue({ kind: "created-not-activated" }),
    });
    const commands = createTurnSubmissionCommand(host);

    await expect(commands.sendTurnText({ text: "hello" })).resolves.toBe(true);

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("applies reserved runtime settings after creating a thread and before starting the turn", async () => {
    const { host, startTurn, stateStore } = createHost();
    const applyPendingThreadSettings = vi.fn().mockImplementation(async () => {
      expect(activeThreadId(stateStore.getState())).toBe("thread");
      return true;
    });
    host.applyPendingThreadSettings = applyPendingThreadSettings;
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({ text: "hello" });

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
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({ text: "fix @selection", inputSnapshot });

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
    const commands = createTurnSubmissionCommand(host);

    const submitted = await commands.sendTurnText({
      text: "[[Codex Clippings/Example.md]] summarize [[Attachment.png]]",
      codexInputOverride: input,
    });

    expect(submitted).toBe(false);
    expect(host.setDraft).not.toHaveBeenCalled();
  });

  it("prepares turn input with the provided composer input snapshot", async () => {
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const { host, stateStore } = createHost();
    resumeThread(stateStore);
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({ text: "hello", inputSnapshot });

    expect(host.prepareInput).toHaveBeenCalledWith("hello", inputSnapshot);
  });

  it("does not restore stale drafts or report stale start failures after the active thread changes", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeThread(stateStore);
    startTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      throw new Error("offline");
    });
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({ text: "hello" });

    expect(host.setDraft).not.toHaveBeenCalled();
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("steers a running turn instead of starting another turn", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({ text: "follow up" });

    expect(steerTurn).toHaveBeenCalledWith({
      threadId: "thread",
      turnId: "turn",
      input: textInput("follow up"),
      clientUserMessageId: expect.stringMatching(/^local-steer-\d+-[A-Za-z0-9_-]+-[a-z0-9]+$/),
    });
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setStatus).toHaveBeenCalledWith("Steered current turn.");
    const localSteerId = steerTurn.mock.calls[0]?.[0].clientUserMessageId;
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([
      expect.objectContaining({ id: localSteerId, clientId: localSteerId, text: "follow up", turnId: "turn" }),
    ]);
  });

  it("does not clear a newer composer draft when steering with a claimed submission", async () => {
    const { host, stateStore } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    const settle = vi.fn();
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({
      text: "follow up",
      submissionClaim: {
        text: "follow up",
        inputSnapshot: {} as never,
        isCurrent: vi.fn(() => true),
        markAdopted: vi.fn(),
        adoptPanelTarget: vi.fn(),
        settle,
      },
    });

    expect(host.setDraft).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith("accepted");
  });

  it("commits a successful pending web steer when its user message arrives before the RPC settles", async () => {
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
        phase: "cancellable",
      },
    });
    const steering = deferred<EffectOutcome<void>>();
    steerTurn.mockImplementation(() => steering.promise);
    const commands = createTurnSubmissionCommand(host);
    const input = [
      { type: "text" as const, text: pending.text },
      {
        type: "additionalContext" as const,
        key: "codex_panel_web_context",
        kind: "untrusted" as const,
        value: "Web page context for the current user input:\nSource: https://example.com/\n\nReadable article",
      },
    ];

    const submitting = commands.sendTurnText({
      text: pending.text,
      codexInputOverride: input,
      pendingSubmissionId: pending.id,
    });
    await vi.waitFor(() => expect(steerTurn).toHaveBeenCalledOnce());
    const clientId = steerTurn.mock.calls[0]?.[0].clientUserMessageId;
    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([
      expect.objectContaining({ id: pending.id, clientId, text: pending.text }),
    ]);
    stateStore.dispatch({
      type: "thread-stream/pending-steer-committed",
      item: {
        id: "server-user",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: pending.text,
        copyText: pending.text,
        turnId: "turn",
        clientId,
      },
    });
    steering.resolve(completed(undefined));

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

  it("keeps an indeterminate steer pending so a later user-message observation can commit it", async () => {
    const { host, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockResolvedValue({ kind: "delivery-unknown" });
    const commands = createTurnSubmissionCommand(host);

    await expect(commands.sendTurnText({ text: "follow up" })).resolves.toBe(true);
    const clientId = steerTurn.mock.calls[0]?.[0].clientUserMessageId;
    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([expect.objectContaining({ clientId })]);
    expect(host.addSystemMessage).not.toHaveBeenCalled();

    stateStore.dispatch({
      type: "thread-stream/pending-steer-committed",
      item: {
        id: "server-user",
        clientId,
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "follow up",
        turnId: "turn",
      },
    });

    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([]);
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([expect.objectContaining({ id: "server-user", clientId })]);
  });

  it("removes and reports a steer explicitly rejected by app-server", async () => {
    const { host, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockResolvedValue({ kind: "failed", error: new Error("cannot steer this turn") });
    const commands = createTurnSubmissionCommand(host);

    await expect(commands.sendTurnText({ text: "follow up" })).resolves.toBe(false);

    expect(stateStore.getState().activeTurn.pendingSteers).toEqual([]);
    expect(host.addSystemMessage).toHaveBeenCalledWith("cannot steer this turn");
  });

  it("does not publish a steer rejection into a newly selected thread", async () => {
    const { host, stateStore, steerTurn } = createHost();
    resumeThread(stateStore, undefined, "first");
    stateStore.dispatch({ type: "turn/started", threadId: "first", turnId: "turn" });
    steerTurn.mockImplementation(async () => {
      resumeThread(stateStore, undefined, "second");
      return { kind: "failed", error: new Error("first thread rejected the steer") };
    });
    const commands = createTurnSubmissionCommand(host);

    await expect(commands.sendTurnText({ text: "follow up" })).resolves.toBe(false);

    expect(activeThreadId(stateStore.getState())).toBe("second");
    expect(host.addSystemMessage).not.toHaveBeenCalled();
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
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({ text: "follow up" });

    expect(host.addSystemMessage).toHaveBeenCalledWith("Current turn is not steerable yet.");
    expect(steerTurn).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("rejects a second submission while the first submission is still preparing", async () => {
    const settings = deferred<boolean>();
    const { host, startTurn, stateStore } = createHost({ applyPendingThreadSettings: vi.fn(() => settings.promise) });
    resumeThread(stateStore);
    const commands = createTurnSubmissionCommand(host);

    const first = commands.sendTurnText({ text: "first" });
    await Promise.resolve();
    const second = commands.sendTurnText({ text: "second" });
    settings.resolve(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(startTurn).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ input: textInput("first") }));
  });

  it("settles claimed submissions without running delayed draft clear or restoration", async () => {
    const settings = deferred<boolean>();
    const { host, startTurn, stateStore } = createHost({ applyPendingThreadSettings: vi.fn(() => settings.promise) });
    resumeThread(stateStore);
    const commands = createTurnSubmissionCommand(host);
    const firstSettle = vi.fn();
    const secondSettle = vi.fn();
    const firstMarkAdopted = vi.fn();
    const secondMarkAdopted = vi.fn();

    const first = commands.sendTurnText({
      text: "first",
      submissionClaim: {
        text: "first",
        inputSnapshot: {} as never,
        isCurrent: vi.fn(() => true),
        markAdopted: firstMarkAdopted,
        adoptPanelTarget: vi.fn(),
        settle: firstSettle,
      },
    });
    await Promise.resolve();
    const second = commands.sendTurnText({
      text: "second",
      submissionClaim: {
        text: "second",
        inputSnapshot: {} as never,
        isCurrent: vi.fn(() => true),
        markAdopted: secondMarkAdopted,
        adoptPanelTarget: vi.fn(),
        settle: secondSettle,
      },
    });
    settings.resolve(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(firstSettle).toHaveBeenCalledOnce();
    expect(firstSettle).toHaveBeenCalledWith("accepted");
    expect(secondSettle).toHaveBeenCalledOnce();
    expect(secondSettle).toHaveBeenCalledWith("failed");
    expect(firstMarkAdopted).toHaveBeenCalledOnce();
    expect(secondMarkAdopted).not.toHaveBeenCalled();
    expect(firstMarkAdopted.mock.invocationCallOrder[0]).toBeLessThan(startTurn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(host.setDraft).not.toHaveBeenCalled();
  });

  it("keeps local user ids distinct when submissions share the same timestamp", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const first = createHost();
      const second = createHost();
      for (const host of [first.host, second.host]) {
        resumeThread(host.stateStore);
      }

      await createTurnSubmissionCommand(first.host).sendTurnText({ text: "first" });
      await createTurnSubmissionCommand(second.host).sendTurnText({ text: "second" });

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
      return completed(undefined);
    });
    const commands = createTurnSubmissionCommand(host);

    await commands.sendTurnText({ text: "follow up" });

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setDraft).not.toHaveBeenCalled();
    expect(host.setStatus).not.toHaveBeenCalledWith("Steered current turn.");
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
  });
});
