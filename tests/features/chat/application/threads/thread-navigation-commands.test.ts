import { describe, expect, it, vi } from "vitest";
import { createChatState } from "../../../../../src/features/chat/application/state/model";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ActiveThreadIdentitySync } from "../../../../../src/features/chat/application/threads/active-thread-identity-sync";
import { sideChatDraft } from "../../../../../src/features/chat/application/threads/fork-draft";
import { ChatResumeWorkTracker } from "../../../../../src/features/chat/application/threads/resume-work";
import {
  createThreadNavigationCommands,
  type ThreadNavigationCommandsHost,
} from "../../../../../src/features/chat/application/threads/thread-navigation-commands";
import { deferred } from "../../../../support/async";
import { threadActivationFixture } from "../../../../support/thread-activation";

function resumeThreadState(stateStore: ChatStateStore, threadId: string, subagent = false): void {
  stateStore.dispatch({
    ...threadActivationFixture({
      id: threadId,
      cliVersion: "test",
      provenance: subagent
        ? {
            kind: "subagent",
            subagentKind: "thread-spawn",
            parentThreadId: "parent",
            sessionId: "session",
            depth: 1,
            agentNickname: "Scout",
            agentRole: "explorer",
          }
        : { kind: "interactive" },
    } as never),
    type: "active-thread/resumed",
  });
}

function createActionsHarness(overrides: Partial<ThreadNavigationCommandsHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  const host: ThreadNavigationCommandsHost = {
    stateStore,
    identity: {
      clearActiveThreadIdentity: vi.fn(),
    } as unknown as ActiveThreadIdentitySync,
    closeForThreadSelection: vi.fn(),
    openThreadFromPanel: vi.fn().mockResolvedValue(undefined),
    resumeWork: new ChatResumeWorkTracker(),
    addSystemMessage: vi.fn(),
    focusComposer: vi.fn(),
    ephemeral: { prepareForNavigation: vi.fn().mockResolvedValue(true) },
    ...overrides,
  };
  return { commands: createThreadNavigationCommands(host), host, stateStore };
}

describe("ThreadNavigationCommands", () => {
  it("starts a blank chat by clearing active thread identity", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await commands.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).toHaveBeenCalledOnce();
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(stateStore.getState().connection.statusText).toBe("New chat.");
    expect(host.focusComposer).toHaveBeenCalledOnce();
  });

  it("ignores blank chat navigation while a turn is running", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await commands.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it("keeps the current turn when it starts during blank chat preparation", async () => {
    const prepared = deferred<boolean>();
    const { commands, host, stateStore } = createActionsHarness({
      ephemeral: { prepareForNavigation: vi.fn(() => prepared.promise) },
    });
    resumeThreadState(stateStore, "active");
    const pending = commands.startNewThread();
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });
    prepared.resolve(true);
    await pending;
    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it("keeps a side chat active when its cleanup fails", async () => {
    const { commands, host, stateStore } = createActionsHarness({
      ephemeral: { prepareForNavigation: vi.fn().mockResolvedValue(false) },
    });
    stateStore.dispatch({
      ...threadActivationFixture({ id: "side", provenance: { kind: "interactive" } } as never),
      type: "active-thread/resumed",
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: null },
    });

    await commands.startNewThread();

    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it("keeps the selected thread when a blank-target intent is superseded before adoption", async () => {
    const prepared = deferred<boolean>();
    const { commands, host, stateStore } = createActionsHarness({
      ephemeral: { prepareForNavigation: vi.fn(() => prepared.promise) },
    });
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    const startingNew = commands.startNewThread();
    host.resumeWork.begin("child");
    prepared.resolve(true);
    await startingNew;

    expect(host.identity.clearActiveThreadIdentity).not.toHaveBeenCalled();
  });

  it("allows switching away from a running subagent through workspace coordination", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "child", true);
    stateStore.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });

    await commands.selectThread("other");

    expect(host.openThreadFromPanel).toHaveBeenCalledWith("other", true);
  });

  it("blocks switching away while a turn is running", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    resumeThreadState(stateStore, "active");
    stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });

    await commands.selectThread("other");

    expect(host.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before switching threads.");
    expect(host.closeForThreadSelection).not.toHaveBeenCalled();
    expect(host.openThreadFromPanel).not.toHaveBeenCalled();
  });

  it("closes the toolbar panel before selecting from the toolbar", async () => {
    const { commands, host, stateStore } = createActionsHarness();
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await commands.selectThreadFromToolbar("thread");

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.openThreadFromPanel).toHaveBeenCalledWith("thread", true);
  });

  it.each(["turn", "persistent", "side-chat"] as const)("routes toolbar selection away from a busy origin (%s)", async (busy) => {
    const { commands, host, stateStore } = createActionsHarness();
    if (busy === "turn") {
      resumeThreadState(stateStore, "active");
      stateStore.dispatch({ type: "turn/started", threadId: "active", turnId: "turn" });
    } else {
      const preparation = sideChatDraft("source", "Source");
      stateStore.dispatch({
        type: "panel/fork-draft-applied",
        preparation:
          busy === "side-chat"
            ? preparation
            : {
                ...preparation,
                draft: { kind: "persistent", sourceThreadId: "source", boundary: { kind: "through-turn", turnId: "turn" } },
              },
      });
      stateStore.dispatch({ type: "panel/fork-operation-set", revision: stateStore.getState().panelTargetRevision, operation: "creating" });
    }
    stateStore.dispatch({ type: "ui/panel-set", panel: "history" });

    await commands.selectThreadFromToolbar("other");

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.addSystemMessage).not.toHaveBeenCalled();
    expect(host.closeForThreadSelection).toHaveBeenCalledOnce();
    expect(host.openThreadFromPanel).toHaveBeenCalledWith("other", false);
  });
});
