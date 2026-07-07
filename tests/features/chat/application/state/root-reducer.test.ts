import { describe, expect, it } from "vitest";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import { activeTurnId, chatTurnBusy, pendingTurnStart } from "../../../../../src/features/chat/application/conversation/turn-state";
import { messageStreamItems } from "../../../../../src/features/chat/application/state/message-stream";
import { type ChatState, chatReducer } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";
import { setCollaborationModeIntent, setRuntimeIntentValue } from "../../../../../src/features/chat/domain/runtime/intent";
import { chatStateMessageStreamItems, withChatStateMessageStreamItems } from "../../support/message-stream";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("chatReducer", () => {
  it("clears active turn and thread-scoped state", () => {
    let state = threadScopedResidue({ draft: "keep me", messageId: "m1" });
    state = chatStateWith(state, {
      runtime: {
        active: {
          model: "gpt-5.1",
          reasoningEffort: "high",
          serviceTier: "fast",
          approvalsReviewer: "auto_review",
          activePermissionProfile: { id: ":workspace", extends: null },
        },
      },
    });
    let pendingState = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.2" });
    pendingState = chatReducer(pendingState, { type: "runtime/permission-profile-requested", permissionProfile: ":read-only" });
    pendingState = chatReducer(pendingState, { type: "runtime/reasoning-effort-requested", effort: "medium" });
    pendingState = chatReducer(pendingState, { type: "runtime/fast-mode-requested", fastMode: "disabled" });
    pendingState = chatReducer(pendingState, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "user" });

    const next = chatReducer(pendingState, { type: "active-thread/cleared" });

    expect(next.activeThread.id).toBeNull();
    expect(next.activeThread.goal).toBeNull();
    expect(next.runtime.active.model).toBeNull();
    expect(next.runtime.active.reasoningEffort).toBeNull();
    expect(next.runtime.active.serviceTier).toBeNull();
    expect(next.runtime.active.approvalsReviewer).toBeNull();
    expect(next.runtime.active.activePermissionProfile).toBeNull();
    expect(next.runtime.active.collaborationMode).toBeNull();
    expect(next.runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.permissionProfile).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.fastMode).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.approvalsReviewer).toEqual({ kind: "unchanged" });
    expect(next.runtime.pending.collaborationMode).toEqual({ kind: "unchanged" });
    expectThreadScopeReset(next, { items: [] });
  });

  it("resets thread-scoped state when resuming a thread", () => {
    const state = threadScopedResidue({ threadId: "previous-thread", turnId: "previous-turn" });
    const resumedItems = [message("resumed-message")];

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("resumed-thread"),
      cwd: "/vault",
      model: "gpt-5.1",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalsReviewer: "user",
      items: resumedItems,
    });

    expect(next.activeThread.id).toBe("resumed-thread");
    expect(next.activeThread.goal).toBeNull();
    expect(next.runtime.active.collaborationMode).toBeNull();
    expect(next.runtime.pending.collaborationMode).toEqual({ kind: "unchanged" });
    expectThreadScopeReset(next, { items: resumedItems });
  });

  it("preserves empty-panel runtime reservations when thread activation explicitly requests it", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.5" });
    state = chatReducer(state, { type: "runtime/permission-profile-requested", permissionProfile: ":workspace" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/fast-mode-requested", fastMode: "enabled" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });
    state = chatReducer(state, { type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("started-thread"),
      cwd: "/vault",
      model: "gpt-5",
      reasoningEffort: "medium",
      serviceTier: "fast",
      approvalsReviewer: "user",
      preserveRequestedRuntimeSettings: true,
    });

    expect(next.activeThread.id).toBe("started-thread");
    expect(next.runtime.active.model).toBe("gpt-5");
    expect(next.runtime.active.reasoningEffort).toBe("medium");
    expect(next.runtime.active.serviceTier).toBe("fast");
    expect(next.runtime.active.approvalsReviewer).toBe("user");
    expect(next.runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(next.runtime.pending.permissionProfile).toEqual({ kind: "set", value: ":workspace" });
    expect(next.runtime.pending.reasoningEffort).toEqual({ kind: "set", value: "high" });
    expect(next.runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(next.runtime.pending.approvalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(next.runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("plan"));
    expect(next.runtime.active.collaborationMode).toBeNull();
  });

  it("keeps reset and set permission profile requests explicit", () => {
    let state = chatStateFixture();

    state = chatReducer(state, { type: "runtime/permission-profile-requested", permissionProfile: ":workspace" });

    expect(state.runtime.pending.permissionProfile).toEqual(setRuntimeIntentValue(":workspace"));

    state = chatReducer(state, { type: "runtime/permission-profile-reset-to-config" });

    expect(state.runtime.pending.permissionProfile).toEqual({ kind: "resetToConfig" });
  });

  it("starts resumed threads with empty display state when no history items are supplied", () => {
    let state = chatStateFixture();
    state = withChatStateMessageStreamItems(state, [message("previous-message")]);

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("resumed-thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    expect(chatStateMessageStreamItems(next)).toEqual([]);
  });

  it("updates map-backed turn diffs and toolbar panel state", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { messageStream: { turnDiffs: new Map([["turn", "old"]]) } });
    state = chatStateWith(state, { ui: { toolbarPanel: "status-panel" } });

    const withDiff = chatReducer(state, { type: "message-stream/turn-diff-updated", turnId: "turn", diff: "new" });
    const withHistoryPanel = chatReducer(withDiff, { type: "ui/panel-set", panel: "history" });

    expect(withDiff.messageStream.turnDiffs.get("turn")).toBe("new");
    expect(withHistoryPanel.ui.toolbarPanel).toBe("history");
  });

  it("deduplicates reported logs", () => {
    const state = chatStateFixture();
    const item = { id: "log", kind: "system", role: "system", text: "once" } satisfies MessageStreamItem;

    const first = chatReducer(state, { type: "message-stream/deduped-log-added", text: "once", item });
    const second = chatReducer(first, { type: "message-stream/deduped-log-added", text: "once", item });

    expect(chatStateMessageStreamItems(first)).toEqual([item]);
    expect(chatStateMessageStreamItems(second)).toEqual([item]);
  });

  it("keeps turn lifecycle fields synchronized through start and completion", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: [] };
    const optimisticItem = {
      id: "local-user",
      kind: "message",
      messageKind: "user",
      role: "user",
      text: "hello",
    } satisfies MessageStreamItem;
    const acknowledgedItem = { ...optimisticItem, turnId: "turn" } satisfies MessageStreamItem;

    const optimistic = chatReducer(chatStateFixture(), {
      type: "turn/optimistic-started",
      item: optimisticItem,
      pendingTurnStart: pending,
    });
    expect(chatTurnBusy(optimistic)).toBe(true);
    expect(activeTurnId(optimistic)).toBeNull();
    expect(pendingTurnStart(optimistic)).toEqual(pending);

    const running = chatReducer(optimistic, {
      type: "turn/start-acknowledged",
      turnId: "turn",
      items: [acknowledgedItem],
    });
    expect(chatTurnBusy(running)).toBe(true);
    expect(activeTurnId(running)).toBe("turn");
    expect(pendingTurnStart(running)).toBeNull();

    const completed = chatReducer(running, {
      type: "turn/completed",
      turnId: "turn",
      status: "completed",
      items: [acknowledgedItem],
    });
    expect(chatTurnBusy(completed)).toBe(false);
    expect(activeTurnId(completed)).toBeNull();
    expect(pendingTurnStart(completed)).toBeNull();
  });

  it("appends streaming assistant deltas after stable history", () => {
    let state = chatStateFixture();
    state = withChatStateMessageStreamItems(state, [message("history")]);
    const running = chatReducer(state, { type: "turn/started", threadId: "thread", turnId: "turn" });

    const next = chatReducer(running, {
      type: "message-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn",
      delta: "hello",
    });

    expect(next.messageStream.activeSegment?.items).toEqual([expect.objectContaining({ id: "assistant", text: "hello", turnId: "turn" })]);
    expect(messageStreamItems(next.messageStream)).toEqual([
      message("history"),
      expect.objectContaining({ id: "assistant", text: "hello" }),
    ]);
  });

  it("updates repeated streaming output through the active source-item index", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "turn/started", threadId: "thread", turnId: "turn" });
    state = chatReducer(state, {
      type: "message-stream/item-output-appended",
      itemId: "cmd",
      turnId: "turn",
      delta: "one",
      kind: "command",
      fallbackText: "Command running",
    });

    const next = chatReducer(state, {
      type: "message-stream/item-output-appended",
      itemId: "cmd",
      turnId: "turn",
      delta: "two",
      kind: "command",
      fallbackText: "Command running",
    });

    expect(next.messageStream.activeSegment?.items).toHaveLength(1);
    expect(next.messageStream.activeSegment?.indexBySourceItemId.get("cmd")).toBe(0);
    expect(next.messageStream.activeSegment?.items[0]).toMatchObject({ id: "cmd", output: "onetwo" });
  });

  it("ignores streaming deltas for a different active turn", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "turn/started", threadId: "thread", turnId: "turn-active" });
    state = chatReducer(state, {
      type: "message-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn-active",
      delta: "active",
    });

    const next = chatReducer(state, {
      type: "message-stream/assistant-delta-appended",
      itemId: "stale",
      turnId: "turn-stale",
      delta: "stale",
    });

    expect(next).toBe(state);
    expect(next.messageStream.activeSegment?.turnId).toBe("turn-active");
    expect(next.messageStream.activeSegment?.items).toEqual([expect.objectContaining({ id: "assistant", text: "active" })]);
  });

  it("keeps optimistic active segment items when the first acknowledged delta arrives", () => {
    let state = chatStateFixture();
    state = chatReducer(state, {
      type: "turn/optimistic-started",
      pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: [] },
      item: message("local-user"),
    });

    const next = chatReducer(state, {
      type: "message-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn",
      delta: "ack",
    });

    expect(next.messageStream.activeSegment?.turnId).toBe("turn");
    expect(next.messageStream.activeSegment?.items).toEqual([
      expect.objectContaining({ id: "local-user" }),
      expect.objectContaining({ id: "assistant", text: "ack", turnId: "turn" }),
    ]);
  });

  it("does not append text to an existing item with a different kind", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "turn/started", threadId: "thread", turnId: "turn" });
    state = chatReducer(state, {
      type: "message-stream/item-text-appended",
      itemId: "shared-source",
      turnId: "turn",
      label: "Tool",
      delta: "tool text",
      kind: "tool",
    });

    const next = chatReducer(state, {
      type: "message-stream/item-text-appended",
      itemId: "shared-source",
      turnId: "turn",
      label: "Reasoning",
      delta: "reasoning text",
      kind: "reasoning",
    });

    expect(next).toBe(state);
    expect(next.messageStream.activeSegment?.items).toEqual([expect.objectContaining({ kind: "tool", text: "Tool: tool text" })]);
  });

  it("appends text to an existing item when the item kind matches", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "turn/started", threadId: "thread", turnId: "turn" });
    state = chatReducer(state, {
      type: "message-stream/item-text-appended",
      itemId: "reasoning",
      turnId: "turn",
      label: "Reasoning",
      delta: "one",
      kind: "reasoning",
    });

    const next = chatReducer(state, {
      type: "message-stream/item-text-appended",
      itemId: "reasoning",
      turnId: "turn",
      label: "Reasoning",
      delta: "two",
      kind: "reasoning",
    });

    expect(next.messageStream.activeSegment?.items).toEqual([expect.objectContaining({ kind: "reasoning", text: "Reasoning: onetwo" })]);
  });

  it("clears running state when a turn start fails", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      turn: { lifecycle: { kind: "starting", pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] } } },
    });

    const next = chatReducer(state, { type: "turn/start-failed", items: [] });

    expect(chatTurnBusy(next)).toBe(false);
    expect(activeTurnId(next)).toBeNull();
    expect(pendingTurnStart(next)).toBeNull();
  });

  it("ignores stale turn start failures after the turn is already running", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "turn" } } });
    state = withChatStateMessageStreamItems(state, [message("existing")]);

    const next = chatReducer(state, { type: "turn/start-failed", items: [] });

    expect(chatTurnBusy(next)).toBe(true);
    expect(activeTurnId(next)).toBe("turn");
    expect(chatStateMessageStreamItems(next)).toEqual([message("existing")]);
  });

  it("clears turn-scoped requests when clearing the local turn scope", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "turn" } } });
    state = chatStateWith(state, { requests: { approvals: [approval(1)] } });
    state = chatStateWith(state, { requests: { pendingUserInputs: [userInput(2)] } });
    state = chatStateWith(state, { requests: { userInputDrafts: new Map([["2:note", "draft"]]) } });
    state = withChatStateMessageStreamItems(state, [message("kept")]);
    state = chatStateWith(state, { ui: { disclosures: { approvalDetails: new Set(["1:details"]) } } });
    state = chatStateWith(state, { ui: { disclosures: { textDetails: new Set(["kept:details"]) } } });

    const next = chatReducer(state, { type: "turn/scoped-cleared" });

    expect(chatTurnBusy(next)).toBe(false);
    expect(activeTurnId(next)).toBeNull();
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(chatStateMessageStreamItems(next)).toEqual([message("kept")]);
    expect([...next.ui.disclosures.approvalDetails]).toEqual([]);
    expect([...next.ui.disclosures.textDetails]).toEqual(["kept:details"]);
  });

  it("resolves requests while optionally appending a result item", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { requests: { approvals: [approval(1)] } });
    state = chatStateWith(state, { requests: { pendingUserInputs: [userInput(2)] } });
    state = chatStateWith(state, {
      requests: {
        userInputDrafts: new Map([
          ["2:note", "draft"],
          ["2:note:other", "other draft"],
        ]),
      },
    });
    state = withChatStateMessageStreamItems(state, [message("existing")]);
    state = chatStateWith(state, { ui: { disclosures: { approvalDetails: new Set(["1:details"]) } } });
    state = chatStateWith(state, { ui: { disclosures: { textDetails: new Set(["existing:details"]) } } });

    const withoutResult = chatReducer(state, { type: "request/resolved", requestId: 1 });
    expect(withoutResult.requests.approvals).toEqual([]);
    expect(withoutResult.requests.pendingUserInputs).toEqual([userInput(2)]);
    expect(chatStateMessageStreamItems(withoutResult)).toEqual([message("existing")]);
    expect([...withoutResult.ui.disclosures.approvalDetails]).toEqual([]);
    expect([...withoutResult.ui.disclosures.textDetails]).toEqual(["existing:details"]);

    const resultItem = message("result");
    const withResult = chatReducer(withoutResult, { type: "request/resolved", requestId: 2, resultItem });
    expect(withResult.requests.pendingUserInputs).toEqual([]);
    expect(withResult.requests.userInputDrafts.size).toBe(0);
    expect(chatStateMessageStreamItems(withResult)).toEqual([message("existing"), resultItem]);
    expect([...withResult.ui.disclosures.textDetails]).toEqual(["existing:details"]);
  });

  it("ignores stale request resolutions without appending result items", () => {
    let state = chatStateFixture();
    state = withChatStateMessageStreamItems(state, [message("existing")]);
    state = chatStateWith(state, { ui: { disclosures: { textDetails: new Set(["existing:details"]) } } });

    const next = chatReducer(state, { type: "request/resolved", requestId: 99, resultItem: message("stale result") });

    expect(chatStateMessageStreamItems(next)).toEqual([message("existing")]);
    expect([...next.ui.disclosures.textDetails]).toEqual(["existing:details"]);
  });

  it("ignores turn start acknowledgements after the turn has already gone idle", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { turn: { lifecycle: { kind: "idle" } } });

    const next = chatReducer(state, {
      type: "turn/start-acknowledged",
      turnId: "completed-turn",
      items: [{ id: "local-user", kind: "message", messageKind: "user", role: "user", text: "hello", turnId: "completed-turn" }],
    });

    expect(chatTurnBusy(next)).toBe(false);
    expect(activeTurnId(next)).toBeNull();
  });

  it("ignores completed turns while a new turn is still starting", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] };
    let state = chatStateFixture();
    state = chatStateWith(state, { turn: { lifecycle: { kind: "starting", pendingTurnStart: pending } } });
    state = withChatStateMessageStreamItems(state, [
      { id: "local-user", kind: "message", messageKind: "user", role: "user", text: "hello" },
    ]);

    const next = chatReducer(state, {
      type: "turn/completed",
      turnId: "stale-turn",
      status: "completed",
      items: [],
    });

    expect(chatTurnBusy(next)).toBe(true);
    expect(pendingTurnStart(next)).toEqual(pending);
    expect(chatStateMessageStreamItems(next)).toEqual(chatStateMessageStreamItems(state));
  });

  it("keeps toolbar panels mutually exclusive", () => {
    let state = chatStateFixture();

    state = chatReducer(state, { type: "ui/panel-set", panel: "history" });
    expect(state.ui.toolbarPanel).toBe("history");

    state = chatReducer(state, { type: "ui/panel-set", panel: "chat-actions" });
    expect(state.ui.toolbarPanel).toBe("chat-actions");

    state = chatReducer(state, { type: "ui/panel-set", panel: "status-panel" });
    expect(state.ui.toolbarPanel).toBe("status-panel");
  });

  it("updates typed disclosures, message action menu, goal editor, and user input drafts through typed UI actions", () => {
    let state = chatStateFixture();

    state = chatReducer(state, { type: "ui/disclosure-set", bucket: "approvalDetails", id: "1:details", open: true });
    expect(state.ui.disclosures.approvalDetails.has("1:details")).toBe(true);
    state = chatReducer(state, { type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: "thread", open: true });
    expect(state.ui.disclosures.goalObjectiveExpanded.has("thread")).toBe(true);

    state = chatReducer(state, { type: "ui/message-fork-menu-set", itemId: "message-1" });
    expect(state.ui.messageActionMenu.forkMenuItemId).toBe("message-1");

    state = chatReducer(state, { type: "ui/goal-editor-started", threadId: "thread", objective: "old", tokenBudget: 10 });
    state = chatReducer(state, { type: "ui/goal-editor-draft-updated", objective: "new" });
    expect(state.ui.goalEditor).toEqual({ kind: "editing", threadId: "thread", objectiveDraft: "new", tokenBudgetDraft: 10 });

    state = chatReducer(state, { type: "request/user-input-draft-set", key: "1:note", value: "answer" });
    expect(state.requests.userInputDrafts.get("1:note")).toBe("answer");

    state = chatReducer(state, { type: "ui/disclosure-set", bucket: "approvalDetails", id: "1:details", open: false });
    expect(state.ui.disclosures.approvalDetails.has("1:details")).toBe(false);
    state = chatReducer(state, { type: "ui/goal-editor-closed" });
    expect(state.ui.goalEditor.kind).toBe("closed");
  });

  it("keeps rename generation callbacks scoped to the active generation", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "ui/rename-started", threadId: "thread", draft: "Original" });
    state = chatReducer(state, {
      type: "ui/rename-generation-started",
      threadId: "thread",
      generationToken: 1,
    });
    const generatingState = state.ui.rename;
    if (generatingState.kind !== "generating") throw new Error("Expected generating rename state.");

    const staleSucceeded = chatReducer(state, {
      type: "ui/rename-generation-succeeded",
      generatingState: { ...generatingState, generationToken: 2 },
      draft: "Late title",
    });
    expect(staleSucceeded).toBe(state);

    const manuallyEdited = chatReducer(state, { type: "ui/rename-draft-updated", threadId: "thread", draft: "Manual draft" });
    const generatedAfterManualEdit = chatReducer(manuallyEdited, {
      type: "ui/rename-generation-succeeded",
      generatingState,
      draft: "Generated title",
    });
    expect(generatedAfterManualEdit).toBe(manuallyEdited);

    const finished = chatReducer(manuallyEdited, {
      type: "ui/rename-generation-finished",
      threadId: "thread",
      generatingState,
    });
    expect(finished.ui.rename).toEqual({ kind: "editing", threadId: "thread", draft: "Manual draft" });
  });

  it("clears expanded goal objective state when the displayed goal identity changes", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "active-thread/goal-set", goal: goal("thread") });
    state = chatReducer(state, { type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: "thread", open: true });

    const usageOnly = chatReducer(state, {
      type: "active-thread/goal-set",
      goal: { ...goal("thread"), tokensUsed: 10, timeUsedSeconds: 30 },
    });
    expect(usageOnly.ui.disclosures.goalObjectiveExpanded.has("thread")).toBe(true);

    const objectiveChanged = chatReducer(usageOnly, {
      type: "active-thread/goal-set",
      goal: { ...goal("thread"), objective: "Changed" },
    });
    expect(objectiveChanged.ui.disclosures.goalObjectiveExpanded.size).toBe(0);
  });

  it("commits applied runtime settings and clears applied intents", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.1" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/fast-mode-requested", fastMode: "enabled" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });

    const next = chatReducer(state, {
      type: "runtime/pending-thread-settings-committed",
      update: {
        model: "gpt-5.1",
        effort: "high",
        serviceTier: "fast",
        approvalsReviewer: "auto_review",
        collaborationMode: { mode: "plan", settings: { model: "gpt-5.1", reasoningEffort: "high", developerInstructions: null } },
      },
    });

    expect(next.runtime.active.model).toBe("gpt-5.1");
    expect(next.runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(next.runtime.active.reasoningEffort).toBe("high");
    expect(next.runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
    expect(next.runtime.active.serviceTier).toBe("fast");
    expect(next.runtime.active.serviceTierKnown).toBe(true);
    expect(next.runtime.pending.fastMode).toEqual({ kind: "unchanged" });
    expect(next.runtime.active.approvalsReviewer).toBe("auto_review");
    expect(next.runtime.pending.approvalsReviewer).toEqual({ kind: "unchanged" });
    expect(next.runtime.active.collaborationMode).toBe("plan");
  });

  it("does not mark service tier as known when committing unrelated runtime settings", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.1" });

    const next = chatReducer(state, {
      type: "runtime/pending-thread-settings-committed",
      update: { model: "gpt-5.1" },
    });

    expect(next.runtime.active.model).toBe("gpt-5.1");
    expect(next.runtime.active.serviceTier).toBeNull();
    expect(next.runtime.active.serviceTierKnown).toBe(false);
  });

  it("preserves unknown service tier state when resuming from active runtime", () => {
    const state = chatReducer(chatStateFixture(), {
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread"),
      cwd: "/vault",
      model: "gpt-5.1",
      reasoningEffort: "high",
      serviceTier: null,
      serviceTierKnown: false,
      approvalsReviewer: "user",
    });

    expect(state.runtime.active.serviceTier).toBeNull();
    expect(state.runtime.active.serviceTierKnown).toBe(false);
  });

  it("keeps requested policy toggles pending until app-server settings commit", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { runtime: { active: { serviceTier: "flex" } } });
    state = chatStateWith(state, { runtime: { active: { approvalsReviewer: "user" } } });

    state = chatReducer(state, { type: "runtime/fast-mode-requested", fastMode: "enabled" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });

    expect(state.runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(state.runtime.active.serviceTier).toBe("flex");
    expect(state.runtime.pending.approvalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(state.runtime.active.approvalsReviewer).toBe("user");
  });

  it("keeps reset and unset runtime request semantics explicit", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.1" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/fast-mode-requested", fastMode: "enabled" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });

    state = chatReducer(state, { type: "runtime/model-reset-to-config" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-reset-to-config" });
    state = chatReducer(state, { type: "runtime/fast-mode-request-cleared" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-request-cleared" });

    expect(state.runtime.pending.model).toEqual({ kind: "resetToConfig" });
    expect(state.runtime.pending.reasoningEffort).toEqual({ kind: "resetToConfig" });
    expect(state.runtime.pending.fastMode).toEqual({ kind: "unchanged" });
    expect(state.runtime.pending.approvalsReviewer).toEqual({ kind: "unchanged" });
  });

  it("updates composer suggestions when insertion-only fields change", () => {
    const initialSuggestion = {
      display: "Alpha",
      detail: "alpha.md",
      replacement: "[[Alpha]]",
      start: 0,
      tabCursorOffset: -2,
    } satisfies ChatState["composer"]["suggestions"][number];
    const nextSuggestion = {
      ...initialSuggestion,
      tabCursorOffset: 0,
      suffixOnInsert: "]]",
    } satisfies ChatState["composer"]["suggestions"][number];

    let state = chatReducer(chatStateFixture(), { type: "composer/suggestions-set", suggestions: [initialSuggestion] });
    state = chatReducer(state, { type: "composer/suggestions-set", suggestions: [nextSuggestion] });

    expect(state.composer.suggestions).toEqual([nextSuggestion]);
  });

  it("stores updates through ChatStateStore without mutating the initial snapshot", () => {
    let initial = chatStateFixture();
    initial = withChatStateMessageStreamItems(initial, [message("initial")]);
    const store = createChatStateStore(initial);

    store.dispatch({ type: "message-stream/item-upserted", item: message("next") });

    expect(chatStateMessageStreamItems(initial)).toEqual([message("initial")]);
    expect(chatStateMessageStreamItems(store.getState())).toEqual([message("initial"), message("next")]);
  });

  it("keeps panel-local thread, request, and composer state isolated across stores", () => {
    const panelA = createChatStateStore();
    const panelB = createChatStateStore();

    panelA.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread-a"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    panelA.dispatch({ type: "composer/draft-set", draft: "panel A draft" });
    panelA.dispatch({ type: "request/user-input-queued", input: userInput(1) });
    panelA.dispatch({ type: "request/user-input-draft-set", key: "1:note", value: "panel A answer" });

    panelB.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread-b"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    panelB.dispatch({ type: "composer/draft-set", draft: "panel B draft" });
    panelB.dispatch({ type: "request/user-input-queued", input: userInput(2) });
    panelB.dispatch({ type: "request/user-input-draft-set", key: "2:note", value: "panel B answer" });

    panelA.dispatch({ type: "request/resolved", requestId: 1 });
    panelA.dispatch({ type: "active-thread/cleared" });

    expect(panelA.getState()).toMatchObject({
      activeThread: { id: null },
      composer: { draft: "" },
      requests: { pendingUserInputs: [] },
    });
    expect(panelA.getState().requests.userInputDrafts.size).toBe(0);

    expect(panelB.getState()).toMatchObject({
      activeThread: { id: "thread-b" },
      composer: { draft: "panel B draft" },
      requests: { pendingUserInputs: [expect.objectContaining({ requestId: 2 })] },
    });
    expect(panelB.getState().requests.userInputDrafts.get("2:note")).toBe("panel B answer");
  });
});

function message(id: string): MessageStreamItem {
  return { id, kind: "message", role: "assistant", text: id, messageKind: "assistantResponse", messageState: "completed" };
}

function threadScopedResidue(options: { threadId?: string; turnId?: string; draft?: string; messageId?: string } = {}): ChatState {
  const threadId = options.threadId ?? "thread";
  const turnId = options.turnId ?? "turn";
  let state = chatStateFixture({
    activeThread: { id: threadId, goal: goal(threadId) },
    turn: { lifecycle: { kind: "running", turnId } },
    runtime: {
      active: { collaborationMode: "plan" },
      pending: { collaborationMode: setCollaborationModeIntent("plan") },
    },
    messageStream: {
      historyCursor: "cursor",
      loadingHistory: true,
      turnDiffs: new Map([[turnId, "@@"]]),
    },
    requests: {
      approvals: [approval(1)],
      pendingUserInputs: [userInput(2)],
      userInputDrafts: new Map([["2:note", "draft"]]),
    },
    composer: {
      draft: options.draft ?? "previous draft",
      suggestSelected: 1,
      suggestions: [suggestion("/plan")],
      suggestionsDismissedSignature: "dismissed",
    },
    ui: {
      disclosures: {
        approvalDetails: new Set(["1:details"]),
        textDetails: new Set(["previous:details"]),
      },
      messageActionMenu: { forkMenuItemId: "previous" },
      goalEditor: { kind: "editing", threadId, objectiveDraft: "draft", tokenBudgetDraft: null },
    },
  });
  state = withChatStateMessageStreamItems(state, [message(options.messageId ?? "previous-message")]);
  return state;
}

function expectThreadScopeReset(state: ChatState, options: { items: readonly MessageStreamItem[] }): void {
  expect(activeTurnId(state)).toBeNull();
  expect(chatStateMessageStreamItems(state)).toEqual(options.items);
  expect(state.messageStream.turnDiffs.size).toBe(0);
  expect(state.messageStream.historyCursor).toBeNull();
  expect(state.messageStream.loadingHistory).toBe(false);
  expect(state.requests.approvals).toEqual([]);
  expect(state.requests.pendingUserInputs).toEqual([]);
  expect(state.requests.userInputDrafts.size).toBe(0);
  expect(state.composer.draft).toBe("");
  expect(state.composer.suggestSelected).toBe(0);
  expect(state.composer.suggestions).toEqual([]);
  expect(state.composer.suggestionsDismissedSignature).toBeNull();
  expect(uiDisclosureCount(state)).toBe(0);
  expect(state.ui.messageActionMenu.forkMenuItemId).toBeNull();
  expect(state.ui.goalEditor.kind).toBe("closed");
}

function suggestion(display: string): ChatState["composer"]["suggestions"][number] {
  return { display, detail: "Plan mode", replacement: display, start: 0, appendSpaceOnInsert: true };
}

function approval(requestId: number): ChatState["requests"]["approvals"][number] {
  return {
    requestId,
    kind: "command",
    turnId: "turn",
    title: "Command approval",
    summary: "Need access\npwd",
    resultSummary: "Need access",
    details: [
      { key: "reason", value: "Need access" },
      { key: "command", value: "pwd" },
      { key: "cwd", value: "/tmp" },
    ],
    responses: { accept: {}, acceptSession: {}, decline: {}, cancel: {} },
    actionOptions: null,
  };
}

function userInput(requestId: number): ChatState["requests"]["pendingUserInputs"][number] {
  return {
    requestId,
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "input",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
      autoResolutionMs: null,
    },
  };
}

function goal(threadId: string): ThreadGoal {
  return {
    threadId,
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function uiDisclosureCount(state: ChatState): number {
  const disclosures = state.ui.disclosures;
  return (
    disclosures.details.size +
    disclosures.activityGroups.size +
    disclosures.textDetails.size +
    disclosures.userMessageExpanded.size +
    disclosures.goalObjectiveExpanded.size +
    disclosures.approvalDetails.size
  );
}

function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
  };
}
