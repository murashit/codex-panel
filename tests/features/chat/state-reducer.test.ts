import { describe, expect, it } from "vitest";

import {
  activeTurnId,
  chatReducer,
  chatTurnBusy,
  pendingTurnStart,
  type ChatState,
} from "../../../src/features/chat/application/state/root-reducer";
import { transitionChatTurnLifecycleState } from "../../../src/features/chat/application/conversation/turn-state";
import { createChatStateStore } from "../../../src/features/chat/application/state/store";
import { messageStreamItems } from "../../../src/features/chat/application/state/message-stream";
import type { ThreadGoal } from "../../../src/domain/threads/goal";
import type { MessageStreamItem } from "../../../src/features/chat/domain/message-stream/items";
import type { Thread } from "../../../src/domain/threads/model";
import { chatStateMessageStreamItems, withChatStateMessageStreamItems } from "./support/message-stream";
import { chatStateFixture, chatStateWith } from "./support/state";

describe("chatReducer", () => {
  it("clears active turn and thread-scoped state", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "turn" } } });
    state = chatStateWith(state, { runtime: { activeModel: "gpt-5.1" } });
    state = chatStateWith(state, { runtime: { activeReasoningEffort: "high" } });
    state = chatStateWith(state, { runtime: { activeServiceTier: "fast" } });
    state = chatStateWith(state, { runtime: { activeApprovalPolicy: "on-request" } });
    state = chatStateWith(state, { runtime: { activeApprovalsReviewer: "auto_review" } });
    state = chatStateWith(state, { runtime: { activeCollaborationMode: "plan" } });
    state = chatStateWith(state, { runtime: { selectedCollaborationMode: "plan" } });
    state = chatStateWith(state, { activeThread: { goal: goal("thread") } });
    state = chatStateWith(state, { messageStream: { historyCursor: "cursor" } });
    state = chatStateWith(state, { messageStream: { loadingHistory: true } });
    state = chatStateWith(state, { composer: { draft: "keep me" } });
    state = withChatStateMessageStreamItems(state, [message("m1")]);
    state = chatStateWith(state, { messageStream: { turnDiffs: new Map([["turn", "@@"]]) } });
    state = chatStateWith(state, { requests: { approvals: [approval(1)] } });
    state = chatStateWith(state, { requests: { pendingUserInputs: [userInput(2)] } });
    state = chatStateWith(state, { requests: { userInputDrafts: new Map([["2:note", "draft"]]) } });
    state = chatStateWith(state, { composer: { suggestSelected: 1 } });
    state = chatStateWith(state, { composer: { suggestions: [suggestion("/plan")] } });
    state = chatStateWith(state, { composer: { suggestionsDismissedSignature: "dismissed" } });
    state = chatStateWith(state, { ui: { disclosures: { approvalDetails: new Set(["1:details"]) } } });
    state = chatStateWith(state, { ui: { disclosures: { textDetails: new Set(["previous:details"]) } } });
    state = chatStateWith(state, { ui: { messageActions: { forkActionsItemId: "previous" } } });
    state = chatStateWith(state, {
      ui: { goalEditor: { kind: "editing", threadId: "thread", objectiveDraft: "draft", tokenBudgetDraft: null } },
    });
    let pendingState = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.2" });
    pendingState = chatReducer(pendingState, { type: "runtime/reasoning-effort-requested", effort: "medium" });
    pendingState = chatReducer(pendingState, { type: "runtime/service-tier-requested", serviceTier: "off" });
    pendingState = chatReducer(pendingState, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "user" });

    const next = chatReducer(pendingState, { type: "active-thread/cleared" });

    expect(next.activeThread.id).toBeNull();
    expect(next.activeThread.goal).toBeNull();
    expect(next.runtime.activeModel).toBeNull();
    expect(next.runtime.activeReasoningEffort).toBeNull();
    expect(next.runtime.activeServiceTier).toBeNull();
    expect(next.runtime.activeApprovalPolicy).toBeNull();
    expect(next.runtime.activeApprovalsReviewer).toBeNull();
    expect(next.runtime.activeCollaborationMode).toBeNull();
    expect(next.runtime.requestedModel).toEqual({ kind: "unchanged" });
    expect(next.runtime.requestedReasoningEffort).toEqual({ kind: "unchanged" });
    expect(next.runtime.requestedServiceTier).toEqual({ kind: "unchanged" });
    expect(next.runtime.requestedApprovalsReviewer).toEqual({ kind: "unchanged" });
    expect(next.runtime.selectedCollaborationMode).toBe("default");
    expect(activeTurnId(next)).toBeNull();
    expect(chatStateMessageStreamItems(next)).toEqual([]);
    expect(next.messageStream.turnDiffs.size).toBe(0);
    expect(next.messageStream.historyCursor).toBeNull();
    expect(next.messageStream.loadingHistory).toBe(false);
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(next.composer.draft).toBe("");
    expect(next.composer.suggestSelected).toBe(0);
    expect(next.composer.suggestions).toEqual([]);
    expect(next.composer.suggestionsDismissedSignature).toBeNull();
    expect(uiDisclosureCount(next)).toBe(0);
    expect(next.ui.messageActions.forkActionsItemId).toBeNull();
    expect(next.ui.goalEditor.kind).toBe("closed");
  });

  it("resets thread-scoped state when resuming a thread", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "previous-thread" } });
    state = chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "previous-turn" } } });
    state = chatStateWith(state, { messageStream: { historyCursor: "cursor" } });
    state = chatStateWith(state, { activeThread: { goal: goal("previous-thread") } });
    state = chatStateWith(state, { messageStream: { loadingHistory: true } });
    state = chatStateWith(state, { composer: { draft: "previous draft" } });
    state = withChatStateMessageStreamItems(state, [message("previous-message")]);
    state = chatStateWith(state, { messageStream: { turnDiffs: new Map([["previous-turn", "@@"]]) } });
    state = chatStateWith(state, { requests: { approvals: [approval(1)] } });
    state = chatStateWith(state, { requests: { pendingUserInputs: [userInput(2)] } });
    state = chatStateWith(state, { requests: { userInputDrafts: new Map([["2:note", "draft"]]) } });
    state = chatStateWith(state, { composer: { suggestSelected: 1 } });
    state = chatStateWith(state, { composer: { suggestions: [suggestion("/plan")] } });
    state = chatStateWith(state, { composer: { suggestionsDismissedSignature: "dismissed" } });
    state = chatStateWith(state, { runtime: { activeCollaborationMode: "plan" } });
    state = chatStateWith(state, { runtime: { selectedCollaborationMode: "plan" } });
    state = chatStateWith(state, { ui: { disclosures: { approvalDetails: new Set(["1:details"]) } } });
    state = chatStateWith(state, { ui: { disclosures: { textDetails: new Set(["previous:details"]) } } });
    state = chatStateWith(state, { ui: { messageActions: { forkActionsItemId: "previous" } } });
    state = chatStateWith(state, {
      ui: { goalEditor: { kind: "editing", threadId: "previous-thread", objectiveDraft: "draft", tokenBudgetDraft: null } },
    });
    const resumedItems = [message("resumed-message")];

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      thread: thread("resumed-thread"),
      cwd: "/vault",
      model: "gpt-5.1",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      activePermissionProfile: null,
      items: resumedItems,
    });

    expect(next.activeThread.id).toBe("resumed-thread");
    expect(next.activeThread.goal).toBeNull();
    expect(activeTurnId(next)).toBeNull();
    expect(next.messageStream.historyCursor).toBeNull();
    expect(next.messageStream.loadingHistory).toBe(false);
    expect(next.composer.draft).toBe("");
    expect(chatStateMessageStreamItems(next)).toEqual(resumedItems);
    expect(next.messageStream.turnDiffs.size).toBe(0);
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(next.composer.suggestSelected).toBe(0);
    expect(next.composer.suggestions).toEqual([]);
    expect(next.composer.suggestionsDismissedSignature).toBeNull();
    expect(next.runtime.activeCollaborationMode).toBeNull();
    expect(next.runtime.selectedCollaborationMode).toBe("default");
    expect(uiDisclosureCount(next)).toBe(0);
    expect(next.ui.messageActions.forkActionsItemId).toBeNull();
    expect(next.ui.goalEditor.kind).toBe("closed");
  });

  it("preserves empty-panel runtime reservations when thread activation explicitly requests it", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.5" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/service-tier-requested", serviceTier: "fast" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });
    state = chatReducer(state, { type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      thread: thread("started-thread"),
      cwd: "/vault",
      model: "gpt-5",
      reasoningEffort: "medium",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      activePermissionProfile: null,
      preserveRequestedRuntimeSettings: true,
    });

    expect(next.activeThread.id).toBe("started-thread");
    expect(next.runtime.activeModel).toBe("gpt-5");
    expect(next.runtime.activeReasoningEffort).toBe("medium");
    expect(next.runtime.activeServiceTier).toBe("fast");
    expect(next.runtime.activeApprovalsReviewer).toBe("user");
    expect(next.runtime.requestedModel).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(next.runtime.requestedReasoningEffort).toEqual({ kind: "set", value: "high" });
    expect(next.runtime.requestedServiceTier).toEqual({ kind: "set", value: "fast" });
    expect(next.runtime.requestedApprovalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(next.runtime.selectedCollaborationMode).toBe("plan");
    expect(next.runtime.activeCollaborationMode).toBeNull();
  });

  it("starts resumed threads with empty display state when no history items are supplied", () => {
    let state = chatStateFixture();
    state = withChatStateMessageStreamItems(state, [message("previous-message")]);

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      thread: thread("resumed-thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    expect(chatStateMessageStreamItems(next)).toEqual([]);
  });

  it("keeps composer state when restoring a thread placeholder", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "previous-thread" } });
    state = chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "previous-turn" } } });
    state = chatStateWith(state, { runtime: { activeModel: "gpt-5.1" } });
    state = chatStateWith(state, { activeThread: { goal: goal("previous-thread") } });
    state = chatStateWith(state, { messageStream: { historyCursor: "cursor" } });
    state = chatStateWith(state, { messageStream: { loadingHistory: true } });
    state = chatStateWith(state, { composer: { draft: "draft in this panel" } });
    state = chatStateWith(state, { composer: { suggestSelected: 1 } });
    state = chatStateWith(state, { composer: { suggestions: [suggestion("/resume")] } });
    state = chatStateWith(state, { composer: { suggestionsDismissedSignature: "dismissed" } });
    state = withChatStateMessageStreamItems(state, [message("previous-message")]);
    state = chatStateWith(state, { messageStream: { turnDiffs: new Map([["previous-turn", "@@"]]) } });
    state = chatStateWith(state, { requests: { approvals: [approval(1)] } });
    state = chatStateWith(state, { requests: { pendingUserInputs: [userInput(2)] } });
    state = chatStateWith(state, { requests: { userInputDrafts: new Map([["2:note", "answer"]]) } });

    const next = chatReducer(state, {
      type: "active-thread/restored-placeholder",
      threadId: "restored-thread",
    });

    expect(next.activeThread.id).toBe("restored-thread");
    expect(activeTurnId(next)).toBeNull();
    expect(next.runtime.activeModel).toBeNull();
    expect(next.activeThread.goal).toBeNull();
    expect(next.messageStream.historyCursor).toBeNull();
    expect(next.messageStream.loadingHistory).toBe(false);
    expect(chatStateMessageStreamItems(next)).toEqual([]);
    expect(next.messageStream.turnDiffs.size).toBe(0);
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(next.composer.draft).toBe("draft in this panel");
    expect(next.composer.suggestSelected).toBe(1);
    expect(next.composer.suggestions).toEqual([suggestion("/resume")]);
    expect(next.composer.suggestionsDismissedSignature).toBe("dismissed");
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

  it("keeps turn lifecycle transition rules explicit", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] };
    const optimistic = transitionChatTurnLifecycleState({ kind: "idle" }, { type: "optimistic-started", pendingTurnStart: pending });
    const running = transitionChatTurnLifecycleState(optimistic, { type: "start-acknowledged", turnId: "turn" });

    expect(optimistic).toEqual({ kind: "starting", pendingTurnStart: pending });
    expect(running).toEqual({ kind: "running", turnId: "turn" });
    expect(transitionChatTurnLifecycleState(running, { type: "completed", turnId: "stale-turn" })).toEqual({
      kind: "running",
      turnId: "turn",
    });
    expect(transitionChatTurnLifecycleState({ kind: "idle" }, { type: "start-acknowledged", turnId: "turn" })).toEqual({
      kind: "idle",
    });
    expect(transitionChatTurnLifecycleState(running, { type: "completed", turnId: "turn" })).toEqual({ kind: "idle" });
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

  it("updates typed disclosures, message actions, goal editor, and user input drafts through typed UI actions", () => {
    let state = chatStateFixture();

    state = chatReducer(state, { type: "ui/disclosure-set", bucket: "approvalDetails", id: "1:details", open: true });
    expect(state.ui.disclosures.approvalDetails.has("1:details")).toBe(true);
    state = chatReducer(state, { type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: "thread", open: true });
    expect(state.ui.disclosures.goalObjectiveExpanded.has("thread")).toBe(true);

    state = chatReducer(state, { type: "ui/message-fork-actions-set", itemId: "message-1" });
    expect(state.ui.messageActions.forkActionsItemId).toBe("message-1");

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

  it("commits pending runtime settings and resets applied overrides", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.1" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/service-tier-requested", serviceTier: "fast" });
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

    expect(next.runtime.activeModel).toBe("gpt-5.1");
    expect(next.runtime.requestedModel).toEqual({ kind: "unchanged" });
    expect(next.runtime.activeReasoningEffort).toBe("high");
    expect(next.runtime.requestedReasoningEffort).toEqual({ kind: "unchanged" });
    expect(next.runtime.activeServiceTier).toBe("fast");
    expect(next.runtime.requestedServiceTier).toEqual({ kind: "unchanged" });
    expect(next.runtime.activeApprovalsReviewer).toBe("auto_review");
    expect(next.runtime.requestedApprovalsReviewer).toEqual({ kind: "unchanged" });
    expect(next.runtime.activeCollaborationMode).toBe("plan");
  });

  it("keeps requested policy toggles pending until app-server settings commit", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { runtime: { activeServiceTier: "flex" } });
    state = chatStateWith(state, { runtime: { activeApprovalsReviewer: "user" } });

    state = chatReducer(state, { type: "runtime/service-tier-requested", serviceTier: "fast" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });

    expect(state.runtime.requestedServiceTier).toEqual({ kind: "set", value: "fast" });
    expect(state.runtime.activeServiceTier).toBe("flex");
    expect(state.runtime.requestedApprovalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(state.runtime.activeApprovalsReviewer).toBe("user");
  });

  it("keeps reset and unset runtime request semantics explicit", () => {
    let state = chatStateFixture();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.1" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/service-tier-requested", serviceTier: "fast" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });

    state = chatReducer(state, { type: "runtime/model-reset-to-config" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-reset-to-config" });
    state = chatReducer(state, { type: "runtime/service-tier-request-cleared" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-request-cleared" });

    expect(state.runtime.requestedModel).toEqual({ kind: "resetToConfig" });
    expect(state.runtime.requestedReasoningEffort).toEqual({ kind: "resetToConfig" });
    expect(state.runtime.requestedServiceTier).toEqual({ kind: "unchanged" });
    expect(state.runtime.requestedApprovalsReviewer).toEqual({ kind: "unchanged" });
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
      thread: thread("thread-a"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    panelA.dispatch({ type: "composer/draft-set", draft: "panel A draft" });
    panelA.dispatch({ type: "request/user-input-queued", input: userInput(1) });
    panelA.dispatch({ type: "request/user-input-draft-set", key: "1:note", value: "panel A answer" });

    panelB.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread-b"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
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

function suggestion(display: string): ChatState["composer"]["suggestions"][number] {
  return { display, detail: "Plan mode", replacement: display, start: 0, appendSpaceOnInsert: true };
}

function approval(requestId: number): ChatState["requests"]["approvals"][number] {
  return {
    requestId,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread", turnId: "turn", itemId: "item", command: "pwd", cwd: "/tmp", reason: "Need access", startedAtMs: 1 },
  };
}

function userInput(requestId: number): ChatState["requests"]["pendingUserInputs"][number] {
  return {
    requestId,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "input",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
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
    disclosures.toolResults.size +
    disclosures.activityGroups.size +
    disclosures.agentDetails.size +
    disclosures.textDetails.size +
    disclosures.userMessageExpanded.size +
    disclosures.goalObjectiveExpanded.size +
    disclosures.approvalDetails.size
  );
}

export function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
  };
}
