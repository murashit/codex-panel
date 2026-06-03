import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
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
} from "../../../../../src/features/chat/controllers/submission/turn-submission-controller";
import { createSubmissionStatePort } from "../../../../../src/features/chat/controllers/state-ports";
import type { Thread } from "../../../../../src/generated/app-server/v2/Thread";
import type { UserInput } from "../../../../../src/generated/app-server/v2/UserInput";

const textInput = (text: string): UserInput[] => [{ type: "text", text, text_elements: [] }];

function thread(id: string): Thread {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "test",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
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
        type: "thread/resumed",
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
    forceMessagesToBottom: vi.fn(),
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
    state: createSubmissionStatePort(stateStore),
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
    expect(startTurn).toHaveBeenCalledWith("thread", "/vault", textInput("hello"), expect.stringMatching(/^local-user-\d+$/));
    expect(stateStore.getState().turnLifecycle).toEqual({ kind: "running", turnId: "turn" });
    expect(host.composer.setDraft).toHaveBeenCalledWith("");
    expect(host.status.setStatus).toHaveBeenCalledWith("Turn running...");
    expect(host.view.scheduleRender).toHaveBeenCalledOnce();
  });

  it("steers a running turn instead of starting another turn", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
    stateStore.dispatch({
      type: "thread/resumed",
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

    expect(steerTurn).toHaveBeenCalledWith("thread", "turn", textInput("follow up"), expect.stringMatching(/^local-steer-\d+$/));
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.status.setStatus).toHaveBeenCalledWith("Steered current turn.");
    const localSteerId = steerTurn.mock.calls[0]?.[3];
    expect(
      stateStore.getState().displayItems.some((item) => item.kind === "message" && item.id === localSteerId && item.text === "follow up"),
    ).toBe(true);
  });
});
