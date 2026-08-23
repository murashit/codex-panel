import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { activeThreadId } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createThreadCommands,
  type ThreadCommandEffects,
  type ThreadCommands,
  type ThreadCommandsHost,
} from "../../../../../src/features/chat/application/threads/thread-commands";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { deferred, waitForAsyncWork } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { withChatStateStableThreadStreamItems } from "../../support/thread-stream";

interface ThreadCommandEffectsMock {
  compactThread: Mock<ThreadCommandEffects["compactThread"]>;
  forkThread: Mock<ThreadCommandEffects["forkThread"]>;
}

interface ThreadMutationCommandsMock {
  archiveThread: Mock<ThreadCommandsHost["mutations"]["archiveThread"]>;
  renameThread: Mock<ThreadCommandsHost["mutations"]["renameThread"]>;
  setThreadPinned: Mock<ThreadCommandsHost["mutations"]["setThreadPinned"]>;
}

type ThreadCommandsHostMock = Omit<
  ThreadCommandsHost,
  | "addSystemMessage"
  | "openThreadInCurrentPanel"
  | "openThreadInNewView"
  | "mutations"
  | "beginThreadReplacementPublication"
  | "applyThreadFact"
  | "setComposerText"
  | "setStatus"
  | "effects"
  | "ensureConnected"
> & {
  mutations: ThreadMutationCommandsMock;
  effects: ThreadCommandEffectsMock;
  ensureConnected: Mock<ThreadCommandsHost["ensureConnected"]>;
  addSystemMessage: Mock<ThreadCommandsHost["addSystemMessage"]>;
  setStatus: Mock<ThreadCommandsHost["setStatus"]>;
  setComposerText: Mock<ThreadCommandsHost["setComposerText"]>;
  openThreadInNewView: Mock<ThreadCommandsHost["openThreadInNewView"]>;
  openThreadInCurrentPanel: Mock<ThreadCommandsHost["openThreadInCurrentPanel"]>;
  replacementPublication: {
    attach: Mock<ReturnType<ThreadCommandsHost["beginThreadReplacementPublication"]>["attach"]>;
    finish: Mock<ReturnType<ThreadCommandsHost["beginThreadReplacementPublication"]>["finish"]>;
  };
  beginThreadReplacementPublication: Mock<ThreadCommandsHost["beginThreadReplacementPublication"]>;
  applyThreadFact: Mock<ThreadCommandsHost["applyThreadFact"]>;
};

describe("thread management commands", () => {
  it("allows direct compaction of an active side chat", async () => {
    const host = hostMock({
      items: [],
      activeThread: {
        id: "side-thread",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });

    await threadCommands(host).compactThread("side-thread");

    expect(host.effects.compactThread).toHaveBeenCalledWith("side-thread");
  });

  it("does not compact an old panel target after connection completes", async () => {
    const connection = deferred<boolean>();
    const host = hostMock({
      items: [],
      activeThread: { id: "source" },
      ensureConnected: vi.fn(() => connection.promise),
    });
    const compacting = threadCommands(host).compactThread("source");
    await waitForAsyncWork(() => expect(host.ensureConnected).toHaveBeenCalledOnce());

    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    connection.resolve(true);
    await compacting;

    expect(host.effects.compactThread).not.toHaveBeenCalled();
    expect(activeThreadId(host.stateStore.getState())).toBe("other");
  });

  it("does not fork an ephemeral side chat", async () => {
    const host = hostMock({
      items: [],
      activeThread: {
        id: "side-thread",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    const controller = threadCommands(host);

    await controller.forkThread("side-thread");

    expect(host.effects.forkThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Side chats cannot be forked.");
  });

  it("allows subagent threads to be forked by app-server", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: {
        id: "agent-thread",
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
    });

    await threadCommands(host).forkThread("agent-thread");

    expect(host.effects.forkThread).toHaveBeenCalledWith("agent-thread");
    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Agent threads cannot be forked.");
  });

  it("rejects rollback for subagent threads", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: {
        id: "agent-thread",
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
    });

    await threadCommands(host).rollbackThread("agent-thread");

    expect(host.effects.forkThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Agent threads cannot be rolled back.");
  });

  it.each([
    {
      name: "fork",
      invoke: (actions: ThreadCommands) => actions.forkThread("source"),
      message: "Finish or interrupt the current turn before forking threads.",
    },
    {
      name: "rollback",
      invoke: (actions: ThreadCommands) => actions.rollbackThread("source"),
      message: "Interrupt the current turn before rolling back.",
    },
  ])("rejects $name while a turn is busy", async ({ invoke, message }) => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    host.stateStore.dispatch({ type: "turn/started", threadId: "source", turnId: "turn-running" });

    await invoke(threadCommands(host));

    expect(host.effects.forkThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith(message);
  });

  it("requests thread compaction and reports the shared status", async () => {
    const host = hostMock({ items: [] });
    const controller = threadCommands(host);

    await controller.compactThread("source");

    expect(host.effects.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).toHaveBeenCalledWith("Compaction requested.");
  });

  it("reports compacting without an active thread", async () => {
    const host = hostMock({ items: [] });
    const controller = threadCommands(host);

    await controller.compactActiveThread();

    expect(host.addSystemMessage).toHaveBeenCalledWith("No active thread to compact.");
    expect(host.effects.compactThread).not.toHaveBeenCalled();
  });

  it("does not report compaction completion after the panel switches threads", async () => {
    const compact = deferred<EffectOutcome<void>>();
    const host = hostMock({ items: [] });
    host.effects.compactThread.mockReturnValue(compact.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    const controller = threadCommands(host);

    const pendingCompact = controller.compactThread("source");
    await waitForAsyncWork(() => {
      expect(host.effects.compactThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    compact.resolve(completed(undefined));
    await pendingCompact;

    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("does not report compaction completion when the method rejects the mutation", async () => {
    const host = hostMock({
      items: [],
      effects: {
        compactThread: vi.fn<ThreadCommandEffects["compactThread"]>().mockResolvedValue({ kind: "not-started" }),
      },
    });
    const controller = threadCommands(host);

    await controller.compactThread("source");

    expect(host.effects.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("reports archive operation failures", async () => {
    const host = hostMock({
      items: [],
      mutations: {
        archiveThread: vi.fn<ThreadCommandsHost["mutations"]["archiveThread"]>().mockRejectedValue(new Error("disk full")),
      },
    });
    const controller = threadCommands(host);

    await controller.archiveThread("source");

    expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", {});
    expect(host.addSystemMessage).toHaveBeenCalledWith("disk full");
  });

  it("forks through a selected turn", async () => {
    const items = [...turnItems().slice(0, 2), taskProgress("turn-1"), ...turnItems().slice(2)];
    const host = hostMock({ items });
    host.stateStore.dispatch({ type: "thread-stream/turn-diff-updated", turnId: "turn-1", diff: "diff one" });
    host.stateStore.dispatch({ type: "thread-stream/turn-diff-updated", turnId: "turn-2", diff: "diff two" });
    const controller = threadCommands(host);

    await controller.forkThreadFromTurn("source", "turn-1", false);

    expect(host.effects.forkThread).toHaveBeenCalledWith("source", {
      position: { kind: "through-turn", turnId: "turn-1" },
    });
    expect(host.applyThreadFact).toHaveBeenCalledWith({
      type: "thread-upserted",
      thread: expect.objectContaining({ id: "forked" }),
    });
    expect(host.openThreadInNewView).toHaveBeenCalledWith("forked", {
      items: items.slice(0, 3),
      turnDiffs: new Map([["turn-1", "diff one"]]),
    });
    expect(callOrder(host.applyThreadFact)).toBeLessThan(callOrder(host.openThreadInNewView));
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
  });

  it("replaces the panel before archiving the source during fork and archive", async () => {
    const host = hostMock({ items: turnItems() });
    const controller = threadCommands(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(host.effects.forkThread).toHaveBeenCalledWith("source", {
      position: { kind: "through-turn", turnId: "turn-3" },
    });
    expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", replacementArchiveOptions());
    expect(host.openThreadInCurrentPanel).toHaveBeenCalledWith("forked", expect.any(Object));
    expect(callOrder(host.beginThreadReplacementPublication)).toBeLessThan(callOrder(host.effects.forkThread));
    expect(callOrder(host.openThreadInCurrentPanel)).toBeLessThan(callOrder(host.mutations.archiveThread));
    expect(host.beginThreadReplacementPublication).toHaveBeenCalledWith("source");
    expect(host.replacementPublication.attach).toHaveBeenCalledWith(panelThread("forked"));
    expect(host.replacementPublication.finish).toHaveBeenCalledWith(true);
    expect(host.applyThreadFact).not.toHaveBeenCalled();
  });

  it("keeps the replacement panel when source archiving fails", async () => {
    const host = hostMock({
      items: turnItems(),
      mutations: {
        archiveThread: vi.fn<ThreadCommandsHost["mutations"]["archiveThread"]>().mockRejectedValue(new Error("archive failed")),
      },
    });
    const controller = threadCommands(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", replacementArchiveOptions());
    expect(host.openThreadInCurrentPanel).toHaveBeenCalledWith("forked", expect.any(Object));
    expect(activeThreadId(host.stateStore.getState())).toBe("forked");
    expect(host.replacementPublication.finish).toHaveBeenCalledWith(false);
    expect(host.applyThreadFact).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Forked the thread, but could not archive the previous version: archive failed");
  });

  it("reports when source archiving is not completed after replacement", async () => {
    const host = hostMock({
      items: turnItems(),
      mutations: {
        archiveThread: vi.fn<ThreadCommandsHost["mutations"]["archiveThread"]>().mockResolvedValue(false),
      },
    });
    const controller = threadCommands(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", replacementArchiveOptions());
    expect(activeThreadId(host.stateStore.getState())).toBe("forked");
    expect(host.replacementPublication.finish).toHaveBeenCalledWith(false);
    expect(host.applyThreadFact).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith(
      "Forked the thread, but could not archive the previous version: archive was not completed",
    );
  });

  it("keeps the source when a fork cannot replace the current panel", async () => {
    const host = hostMock({ items: turnItems() });
    host.openThreadInCurrentPanel.mockRejectedValue(new Error("resume failed"));
    const controller = threadCommands(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Forked thread forked, but could not open it in the current panel: resume failed");
  });

  it("does not archive or replace the panel from stale fork responses", async () => {
    const fork = deferred<EffectOutcome<Thread>>();
    const host = hostMock({ items: turnItems() });
    host.effects.forkThread.mockReturnValue(fork.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    const controller = threadCommands(host);

    const pendingFork = controller.forkThreadFromTurn("source", null, true);
    await waitForAsyncWork(() => {
      expect(host.effects.forkThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    fork.resolve(completed(panelThread("forked")));
    await pendingFork;

    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
    expect(host.mutations.renameThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer panel while committed source cleanup completes", async () => {
    const archive = deferred<boolean>();
    const host = hostMock({
      items: turnItems(),
      activeThread: { id: "source" },
      mutations: { archiveThread: vi.fn(() => archive.promise) },
    });

    const pendingFork = threadCommands(host).forkThreadFromTurn("source", null, true);
    await waitForAsyncWork(() => expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", replacementArchiveOptions()));
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    archive.resolve(true);
    await pendingFork;

    expect(host.openThreadInCurrentPanel).toHaveBeenCalledWith("forked", expect.any(Object));
    expect(activeThreadId(host.stateStore.getState())).toBe("other");
  });

  it("does not open or publish fork responses when the method has no result", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: { id: "source" },
      effects: {
        forkThread: vi.fn<ThreadCommandEffects["forkThread"]>().mockResolvedValue({ kind: "not-started" }),
      },
    });
    const controller = threadCommands(host);

    await controller.forkThreadFromTurn("source", null, false);

    expect(host.applyThreadFact).not.toHaveBeenCalled();
    expect(host.openThreadInNewView).not.toHaveBeenCalled();
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
  });

  it("forks before the latest turn, adopts it, restores the prompt, and archives the source", async () => {
    const items = [...turnItems().slice(0, 4), taskProgress("turn-2"), ...turnItems().slice(4)];
    const host = hostMock({ items });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "thread-stream/items-replaced",
      items,
      historyCursor: null,
      loadingHistory: false,
    });
    host.stateStore.dispatch({ type: "thread-stream/turn-diff-updated", turnId: "turn-2", diff: "diff two" });
    host.stateStore.dispatch({ type: "thread-stream/turn-diff-updated", turnId: "turn-3", diff: "diff three" });
    const controller = threadCommands(host);

    await controller.rollbackThread("source");

    expect(host.effects.forkThread).toHaveBeenCalledWith("source", {
      position: { kind: "before-turn", turnId: "turn-3" },
      deferGoalContinuation: true,
      runtime: { reasoningEffort: null, serviceTier: null },
    });
    expect(host.openThreadInCurrentPanel).toHaveBeenCalledWith("forked", {
      items: items.slice(0, 5),
      turnDiffs: new Map([["turn-2", "diff two"]]),
    });
    expect(host.setComposerText).toHaveBeenCalledWith("three");
    expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", replacementArchiveOptions(false));
    expect(callOrder(host.openThreadInCurrentPanel)).toBeLessThan(callOrder(host.mutations.archiveThread));
    expect(callOrder(host.setComposerText)).toBeLessThan(callOrder(host.addSystemMessage));
    expect(host.beginThreadReplacementPublication).toHaveBeenCalledWith("source");
    expect(host.replacementPublication.attach).toHaveBeenCalledWith(panelThread("forked"));
    expect(host.replacementPublication.finish).toHaveBeenCalledWith(true);
    expect(host.applyThreadFact).not.toHaveBeenCalled();
    expect(activeThreadId(host.stateStore.getState())).toBe("forked");
  });

  it("uses the first turn itself as the marker when rolling back a one-turn thread", async () => {
    const host = hostMock({ items: turnItems().slice(0, 2), activeThread: { id: "source" } });

    await threadCommands(host).rollbackThread("source");

    expect(host.effects.forkThread).toHaveBeenCalledWith("source", {
      position: { kind: "before-turn", turnId: "turn-1" },
      deferGoalContinuation: true,
      runtime: { reasoningEffort: null },
    });
    expect(host.setComposerText).toHaveBeenCalledWith("one");
    expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", replacementArchiveOptions(false));
  });

  it("preserves the active thread runtime when creating a rollback fork", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: "never",
      sandboxPolicy: null,
      activePermissionProfile: { id: ":workspace", extends: null },
      thread: panelThread("source"),
      model: "gpt-5.6",
      reasoningEffort: "high",
      serviceTier: "priority",
      approvalsReviewer: "auto_review",
    });
    host.stateStore.dispatch({
      type: "thread-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });

    await threadCommands(host).rollbackThread("source");

    expect(host.effects.forkThread).toHaveBeenCalledWith("source", {
      position: { kind: "before-turn", turnId: "turn-3" },
      deferGoalContinuation: true,
      runtime: {
        model: "gpt-5.6",
        reasoningEffort: "high",
        serviceTier: "priority",
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        permissions: ":workspace",
      },
    });
  });

  it("keeps the source when the rollback fork is not adopted", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    host.openThreadInCurrentPanel.mockResolvedValue(false);

    await threadCommands(host).rollbackThread("source");

    expect(host.replacementPublication.finish).toHaveBeenCalledWith(false);
    expect(host.applyThreadFact).not.toHaveBeenCalled();
    expect(activeThreadId(host.stateStore.getState())).toBe("source");
    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith(
      "The rolled-back version was created but could not be opened in this panel. Open it from thread history.",
    );
  });

  it("commits rollback cleanup from the adoption result", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    host.openThreadInCurrentPanel.mockImplementation(async (threadId) => {
      adoptThread(host, threadId);
      return true;
    });

    await threadCommands(host).rollbackThread("source");

    expect(host.setComposerText).toHaveBeenCalledWith("three");
    expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", replacementArchiveOptions(false));
    expect(activeThreadId(host.stateStore.getState())).toBe("forked");
  });

  it("hands the rollback draft to the submission owner before adopting the fork", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    const adoptPanelTarget = vi.fn(() => {
      expect(activeThreadId(host.stateStore.getState())).toBe("source");
    });
    host.openThreadInCurrentPanel.mockImplementation(async (threadId) => {
      adoptThread(host, threadId);
      return true;
    });

    await threadCommands(host).rollbackThread("source", { adoptPanelTarget });

    expect(adoptPanelTarget).toHaveBeenCalledWith("forked", "three");
    expect(host.setComposerText).not.toHaveBeenCalled();
  });

  it("keeps the adopted rollback when archiving its source fails", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: { id: "source" },
      mutations: {
        archiveThread: vi.fn<ThreadCommandsHost["mutations"]["archiveThread"]>().mockRejectedValue(new Error("archive failed")),
      },
    });

    await threadCommands(host).rollbackThread("source");

    expect(activeThreadId(host.stateStore.getState())).toBe("forked");
    expect(host.setComposerText).toHaveBeenCalledWith("three");
    expect(host.addSystemMessage).toHaveBeenCalledWith(
      "Rolled back the latest turn, but could not archive the previous version: archive failed",
    );
  });

  it("does not roll back an ephemeral side chat", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: {
        id: "side-thread",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    const controller = threadCommands(host);

    await controller.rollbackThread("side-thread");

    expect(host.effects.forkThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Side chats cannot be rolled back.");
  });

  it("does not adopt or archive a rollback fork after the panel switches threads", async () => {
    const rollback = deferred<EffectOutcome<Thread>>();
    const host = hostMock({ items: turnItems() });
    host.effects.forkThread.mockReturnValue(rollback.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "thread-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });
    const controller = threadCommands(host);

    const pendingRollback = controller.rollbackThread("source");
    await waitForAsyncWork(() => {
      expect(host.effects.forkThread).toHaveBeenCalledWith("source", {
        position: { kind: "before-turn", turnId: "turn-3" },
        deferGoalContinuation: true,
        runtime: { reasoningEffort: null, serviceTier: null },
      });
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    rollback.resolve(completed(panelThread("forked")));
    await pendingRollback;

    expect(activeThreadId(host.stateStore.getState())).toBe("other");
    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.replacementPublication.attach).toHaveBeenCalledWith(panelThread("forked"));
    expect(host.replacementPublication.finish).toHaveBeenCalledWith(false);
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
  });

  it("does not adopt or archive a rollback fork after a new turn starts in the source", async () => {
    const rollback = deferred<EffectOutcome<Thread>>();
    const host = hostMock({ items: turnItems() });
    host.effects.forkThread.mockReturnValue(rollback.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({ type: "thread-stream/items-replaced", items: turnItems(), historyCursor: null, loadingHistory: false });
    const controller = threadCommands(host);

    const pendingRollback = controller.rollbackThread("source");
    await waitForAsyncWork(() => expect(host.effects.forkThread).toHaveBeenCalledOnce());
    host.stateStore.dispatch({ type: "turn/started", threadId: "source", turnId: "new-turn" });
    rollback.resolve(completed(panelThread("forked")));
    await pendingRollback;

    expect(host.stateStore.getState().activeTurn.lifecycle).toEqual({ kind: "running", turnId: "new-turn" });
    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.replacementPublication.attach).toHaveBeenCalledWith(panelThread("forked"));
    expect(host.replacementPublication.finish).toHaveBeenCalledWith(false);
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
  });

  it("keeps the source when marker fork has no result", async () => {
    const host = hostMock({
      items: turnItems(),
      effects: {
        forkThread: vi.fn<ThreadCommandEffects["forkThread"]>().mockResolvedValue({ kind: "not-started" }),
      },
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "thread-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });
    const controller = threadCommands(host);

    await controller.rollbackThread("source");

    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.applyThreadFact).not.toHaveBeenCalled();
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
  });
});

function turnItems(): ThreadStreamItem[] {
  return [
    { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "one", turnId: "turn-1" },
    {
      id: "a1",
      kind: "dialogue",
      role: "assistant",
      text: "one answer",
      turnId: "turn-1",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "two", turnId: "turn-2" },
    {
      id: "a2",
      kind: "dialogue",
      role: "assistant",
      text: "two answer",
      turnId: "turn-2",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "u3", kind: "dialogue", dialogueKind: "user", role: "user", text: "three", turnId: "turn-3" },
    {
      id: "a3",
      kind: "dialogue",
      role: "assistant",
      text: "three answer",
      turnId: "turn-3",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
  ];
}

function taskProgress(turnId: string): ThreadStreamItem {
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    turnId,
    explanation: null,
    steps: [{ step: "Keep this", status: "completed" }],
    status: "completed",
    executionState: "completed",
  };
}

function threadCommands(host: ThreadCommandsHost): ThreadCommands {
  return createThreadCommands(host);
}

function replacementArchiveOptions(saveMarkdown?: boolean) {
  return saveMarkdown === undefined ? {} : { saveMarkdown };
}

function hostMock({
  items,
  activeThread,
  mutations: mutationOverrides = {},
  effects: effectsOverrides = {},
  ensureConnected = vi.fn<ThreadCommandsHost["ensureConnected"]>().mockResolvedValue(true),
}: {
  items: ThreadStreamItem[];
  activeThread?: NonNullable<Parameters<typeof chatStateWith>[1]["activeThread"]>;
  mutations?: Partial<ThreadMutationCommandsMock>;
  effects?: Partial<ThreadCommandEffectsMock>;
  ensureConnected?: ThreadCommandsHostMock["ensureConnected"];
}): ThreadCommandsHostMock {
  let state = withChatStateStableThreadStreamItems(chatStateFixture(), items);
  if (activeThread) state = chatStateWith(state, { activeThread });
  const stateStore = createChatStateStore(state);
  const effects: ThreadCommandEffectsMock = {
    compactThread: vi.fn<ThreadCommandEffects["compactThread"]>().mockResolvedValue(completed(undefined)),
    forkThread: vi.fn<ThreadCommandEffects["forkThread"]>().mockResolvedValue(completed(panelThread("forked"))),
    ...effectsOverrides,
  };
  const mutations: ThreadMutationCommandsMock = {
    archiveThread: vi.fn<ThreadCommandsHost["mutations"]["archiveThread"]>().mockResolvedValue(true),
    renameThread: vi.fn<ThreadCommandsHost["mutations"]["renameThread"]>().mockResolvedValue(true),
    setThreadPinned: vi.fn<ThreadCommandsHost["mutations"]["setThreadPinned"]>().mockResolvedValue(undefined),
    ...mutationOverrides,
  };
  const replacementPublication = {
    attach: vi.fn<ReturnType<ThreadCommandsHost["beginThreadReplacementPublication"]>["attach"]>(),
    finish: vi.fn<ReturnType<ThreadCommandsHost["beginThreadReplacementPublication"]>["finish"]>(),
  };
  return {
    stateStore,
    effects,
    ensureConnected,
    mutations,
    addSystemMessage: vi.fn<ThreadCommandsHost["addSystemMessage"]>(),
    setStatus: vi.fn<ThreadCommandsHost["setStatus"]>(),
    setComposerText: vi.fn<ThreadCommandsHost["setComposerText"]>(),
    openThreadInNewView: vi.fn<ThreadCommandsHost["openThreadInNewView"]>().mockResolvedValue(undefined),
    openThreadInCurrentPanel: vi.fn<ThreadCommandsHost["openThreadInCurrentPanel"]>().mockImplementation(async (threadId) => {
      adoptThread({ stateStore }, threadId);
      return true;
    }),
    replacementPublication,
    beginThreadReplacementPublication: vi
      .fn<ThreadCommandsHost["beginThreadReplacementPublication"]>()
      .mockReturnValue(replacementPublication),
    applyThreadFact: vi.fn<ThreadCommandsHost["applyThreadFact"]>(),
  };
}

function adoptThread(host: Pick<ThreadCommandsHost, "stateStore">, threadId: string): void {
  host.stateStore.dispatch({
    type: "active-thread/resumed",
    canAcceptDirectInput: null,
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: panelThread(threadId),
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

function panelThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

function callOrder(fn: Mock): number {
  const order = fn.mock.invocationCallOrder[0];
  if (order === undefined) throw new Error("Expected function to be called.");
  return order;
}

function completed<T>(value: T): EffectOutcome<T> {
  return { kind: "completed", value };
}
