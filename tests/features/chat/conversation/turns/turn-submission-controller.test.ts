import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import type { CodexInput } from "../../../../../src/app-server/request-input";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/state/reducer";
import {
  TurnSubmissionController,
  type TurnSubmissionControllerHost,
  type TurnSubmissionComposerPort,
  type TurnSubmissionConnectionPort,
  type TurnSubmissionRestoredThreadPort,
  type TurnSubmissionRuntimePort,
  type TurnSubmissionStatusPort,
  type TurnSubmissionThreadPort,
  type TurnSubmissionViewPort,
} from "../../../../../src/features/chat/conversation/turns/turn-submission-controller";
import type { Thread } from "../../../../../src/domain/threads/model";

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

interface TurnSubmissionHostOverrides extends Partial<
  Omit<TurnSubmissionControllerHost, "connection" | "restoredThread" | "thread" | "runtime" | "composer" | "view" | "status">
> {
  connection?: Partial<TurnSubmissionConnectionPort>;
  restoredThread?: Partial<TurnSubmissionRestoredThreadPort>;
  thread?: Partial<TurnSubmissionThreadPort>;
  runtime?: Partial<TurnSubmissionRuntimePort>;
  composer?: Partial<TurnSubmissionComposerPort>;
  view?: Partial<TurnSubmissionViewPort>;
  status?: Partial<TurnSubmissionStatusPort>;
}

function createHost(overrides: TurnSubmissionHostOverrides = {}) {
  const {
    connection: connectionOverrides,
    restoredThread: restoredThreadOverrides,
    thread: threadOverrides,
    runtime: runtimeOverrides,
    composer: composerOverrides,
    view: viewOverrides,
    status: statusOverrides,
    ...hostOverrides
  } = overrides;
  const stateStore = createChatStateStore(createChatState());
  const startTurn = vi.fn().mockResolvedValue({ turn: { id: "turn" } });
  const steerTurn = vi.fn().mockResolvedValue({});
  const client = {
    startTurn,
    steerTurn,
  } as unknown as AppServerClient;
  const connection: TurnSubmissionConnectionPort = {
    vaultPath: "/vault",
    currentClient: () => client,
    ...connectionOverrides,
  };
  const restoredThread: TurnSubmissionRestoredThreadPort = {
    ensureRestoredThreadLoaded: vi.fn().mockResolvedValue(true),
    ...restoredThreadOverrides,
  };
  const threadPort: TurnSubmissionThreadPort = {
    startThread: vi.fn().mockImplementation(async () => {
      stateStore.dispatch({
        type: "active-thread/resumed",
        thread: thread("thread"),
        cwd: "/vault",
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        approvalPolicy: null,
        approvalsReviewer: null,
        activePermissionProfile: null,
      });
      return {};
    }),
    notifyActiveThreadIdentityChanged: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    ...threadOverrides,
  };
  const runtime: TurnSubmissionRuntimePort = {
    applyPendingThreadSettings: vi.fn().mockResolvedValue(true),
    ...runtimeOverrides,
  };
  const composer: TurnSubmissionComposerPort = {
    codexInput: vi.fn((text: string) => textInput(text)),
    setDraft: vi.fn(),
    ...composerOverrides,
  };
  const view: TurnSubmissionViewPort = {
    render: vi.fn(),
    scheduleRender: vi.fn(),
    ...viewOverrides,
  };
  const status: TurnSubmissionStatusPort = {
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    ...statusOverrides,
  };
  const host: TurnSubmissionControllerHost = {
    stateStore,
    connection,
    restoredThread,
    thread: threadPort,
    runtime,
    composer,
    view,
    status,
    ...hostOverrides,
  };
  return { host, startTurn, stateStore, steerTurn };
}

describe("TurnSubmissionController", () => {
  it("starts a thread when needed and acknowledges the optimistic turn", async () => {
    const { host, startTurn, stateStore } = createHost();
    const controller = new TurnSubmissionController(host);

    await controller.sendTurnText("hello");

    expect(host.thread.startThread).toHaveBeenCalledWith("hello");
    expect(host.thread.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.thread.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(startTurn).toHaveBeenCalledWith({
      threadId: "thread",
      cwd: "/vault",
      input: textInput("hello"),
      clientUserMessageId: expect.stringMatching(/^local-user-\d+-\d+$/),
    });
    expect(stateStore.getState().turn.lifecycle).toEqual({ kind: "running", turnId: "turn" });
    expect(host.composer.setDraft).toHaveBeenCalledWith("");
    expect(host.status.setStatus).toHaveBeenCalledWith("Turn running...");
    expect(host.view.scheduleRender).toHaveBeenCalledOnce();
  });

  it("does not restore stale drafts or report stale start failures after the active thread changes", async () => {
    const { host, startTurn, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    startTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      throw new Error("offline");
    });
    const controller = new TurnSubmissionController(host);

    await controller.sendTurnText("hello");

    expect(host.composer.setDraft).toHaveBeenCalledWith("");
    expect(host.composer.setDraft).not.toHaveBeenCalledWith("hello");
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });

  it("steers a running turn instead of starting another turn", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    const controller = new TurnSubmissionController(host);

    await controller.sendTurnText("follow up");

    expect(steerTurn).toHaveBeenCalledWith("thread", "turn", textInput("follow up"), expect.stringMatching(/^local-steer-\d+-\d+$/));
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.status.setStatus).toHaveBeenCalledWith("Steered current turn.");
    const localSteerId = steerTurn.mock.calls[0]?.[3];
    expect(
      stateStore
        .getState()
        .messageStream.displayItems.some((item) => item.kind === "message" && item.id === localSteerId && item.text === "follow up"),
    ).toBe(true);
  });

  it("keeps local user ids distinct when submissions share the same timestamp", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const first = createHost();
      const second = createHost();
      for (const host of [first.host, second.host]) {
        host.stateStore.dispatch({
          type: "active-thread/resumed",
          thread: thread("thread"),
          cwd: "/vault",
          model: null,
          reasoningEffort: null,
          serviceTier: null,
          approvalPolicy: null,
          approvalsReviewer: null,
          activePermissionProfile: null,
        });
      }

      await new TurnSubmissionController(first.host).sendTurnText("first");
      await new TurnSubmissionController(second.host).sendTurnText("second");

      const firstId = first.startTurn.mock.calls[0]?.[0].clientUserMessageId;
      const secondId = second.startTurn.mock.calls[0]?.[0].clientUserMessageId;
      expect(firstId).toMatch(/^local-user-1234-\d+$/);
      expect(secondId).toMatch(/^local-user-1234-\d+$/);
      expect(firstId).not.toBe(secondId);
    } finally {
      now.mockRestore();
    }
  });

  it("does not append stale steer messages after the active turn changes", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      return {};
    });
    const controller = new TurnSubmissionController(host);

    await controller.sendTurnText("follow up");

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.composer.setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(host.status.setStatus).not.toHaveBeenCalledWith("Steered current turn.");
    expect(stateStore.getState().messageStream.displayItems).toEqual([]);
  });

  it("does not restore stale steer drafts or report stale steer failures after the active turn changes", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    steerTurn.mockImplementation(async () => {
      stateStore.dispatch({ type: "active-thread/cleared" });
      throw new Error("offline");
    });
    const controller = new TurnSubmissionController(host);

    await controller.sendTurnText("follow up");

    expect(startTurn).not.toHaveBeenCalled();
    expect(host.composer.setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(host.composer.setDraft).not.toHaveBeenCalledWith("follow up", { focus: true });
    expect(host.status.addSystemMessage).not.toHaveBeenCalled();
  });
});
