import { describe, expect, it, vi } from "vitest";

import type { CodexInput } from "../../../../../src/domain/chat/input";
import type { Thread } from "../../../../../src/domain/threads/model";
import { optimisticTurnStart } from "../../../../../src/features/chat/application/conversation/optimistic-turn-start";
import {
  createTurnSubmissionActions,
  type TurnSubmissionActionsHost,
} from "../../../../../src/features/chat/application/conversation/turn-submission-actions";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createLocalIdSource } from "../../../../../src/shared/id/local-id";
import { chatStateMessageStreamItems } from "../../support/message-stream";

const textInput = (text: string): CodexInput => [{ type: "text", text }];

function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
  };
}

type TurnSubmissionHostOverrides = Partial<TurnSubmissionActionsHost>;

function createHost(overrides: TurnSubmissionHostOverrides = {}) {
  const stateStore = createChatStateStore(createChatState());
  const startTurn = vi.fn().mockResolvedValue({ turnId: "turn" });
  const steerTurn = vi.fn().mockResolvedValue(true);
  const host: TurnSubmissionActionsHost = {
    stateStore,
    turnTransport: {
      ensureConnected: vi.fn().mockResolvedValue(true),
      startTurn,
      steerTurn,
      interruptTurn: vi.fn().mockResolvedValue(true),
    },
    ensureRestoredThreadLoaded: vi.fn().mockResolvedValue(true),
    startThread: vi.fn().mockImplementation(async () => {
      resumeThread(stateStore);
      return true;
    }),
    notifyActiveThreadIdentityChanged: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    applyPendingThreadSettings: vi.fn().mockResolvedValue(true),
    codexInput: vi.fn((text: string) => textInput(text)),
    setDraft: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    ...overrides,
    localItemIds: overrides.localItemIds ?? createLocalIdSource(),
  };
  return { host, startTurn, stateStore, steerTurn };
}

function resumeThread(stateStore: ReturnType<typeof createChatStateStore>) {
  stateStore.dispatch({
    type: "active-thread/resumed",
    thread: thread("thread"),
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

describe("TurnSubmissionActions", () => {
  it("starts a thread when needed and acknowledges the optimistic turn", async () => {
    const { host, startTurn, stateStore } = createHost();
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText("hello");

    expect(host.startThread).toHaveBeenCalledWith("hello");
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(startTurn).toHaveBeenCalledWith({
      threadId: "thread",
      input: textInput("hello"),
      clientUserMessageId: expect.stringMatching(/^local-user-\d+-[A-Za-z0-9_-]+-[a-z0-9]+$/),
    });
    expect(stateStore.getState().turn.lifecycle).toEqual({ kind: "running", turnId: "turn" });
    expect(host.setDraft).toHaveBeenCalledWith("");
    expect(host.setStatus).toHaveBeenCalledWith("Turn running...");
  });

  it("applies reserved runtime settings after creating a thread and before starting the turn", async () => {
    const { host, startTurn, stateStore } = createHost();
    const applyPendingThreadSettings = vi.fn().mockImplementation(async () => {
      expect(stateStore.getState().activeThread.id).toBe("thread");
      return true;
    });
    host.applyPendingThreadSettings = applyPendingThreadSettings;
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText("hello");

    expect(applyPendingThreadSettings).toHaveBeenCalledOnce();
    expect(vi.mocked(host.startThread).mock.invocationCallOrder[0]).toBeLessThan(
      applyPendingThreadSettings.mock.invocationCallOrder[0] ?? 0,
    );
    expect(applyPendingThreadSettings.mock.invocationCallOrder[0]).toBeLessThan(startTurn.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not restore stale drafts or report stale start failures after the active thread changes", async () => {
    const { host, startTurn, stateStore } = createHost();
    resumeThread(stateStore);
    startTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      throw new Error("offline");
    });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText("hello");

    expect(host.setDraft).toHaveBeenCalledWith("");
    expect(host.setDraft).not.toHaveBeenCalledWith("hello");
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("steers a running turn instead of starting another turn", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText("follow up");

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
      chatStateMessageStreamItems(stateStore.getState()).some(
        (item) => item.kind === "message" && item.id === localSteerId && item.text === "follow up",
      ),
    ).toBe(true);
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

    await actions.sendTurnText("follow up");

    expect(host.addSystemMessage).toHaveBeenCalledWith("Current turn is not steerable yet.");
    expect(steerTurn).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("keeps local user ids distinct when submissions share the same timestamp", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const first = createHost();
      const second = createHost();
      for (const host of [first.host, second.host]) {
        resumeThread(host.stateStore);
      }

      await createTurnSubmissionActions(first.host).sendTurnText("first");
      await createTurnSubmissionActions(second.host).sendTurnText("second");

      const firstId = first.startTurn.mock.calls[0]?.[0].clientUserMessageId;
      const secondId = second.startTurn.mock.calls[0]?.[0].clientUserMessageId;
      expect(firstId).toMatch(/^local-user-1234-[A-Za-z0-9_-]+-[a-z0-9]+$/);
      expect(secondId).toMatch(/^local-user-1234-[A-Za-z0-9_-]+-[a-z0-9]+$/);
      expect(firstId).not.toBe(secondId);
    } finally {
      now.mockRestore();
    }
  });

  it("does not append stale steer messages after the active turn changes", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    resumeThread(stateStore);
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      return {};
    });
    const actions = createTurnSubmissionActions(host);

    await actions.sendTurnText("follow up");

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(host.setStatus).not.toHaveBeenCalledWith("Steered current turn.");
    expect(chatStateMessageStreamItems(stateStore.getState())).toEqual([]);
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

    await actions.sendTurnText("follow up");

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(host.setDraft).not.toHaveBeenCalledWith("follow up", { focus: true });
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });
});
