import { describe, expect, it, vi } from "vitest";

import {
  activeTurnId,
  chatReducer,
  chatTurnBusy,
  createChatState,
  createChatStateStore,
  pendingTurnStart,
  transitionChatTurnLifecycleState,
  type ChatState,
} from "../../../src/features/chat/chat-state";
import type { DisplayItem } from "../../../src/features/chat/display/types";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";

describe("chatReducer", () => {
  it("clears active turn and thread-scoped state", () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.turnLifecycle = { kind: "running", turnId: "turn" };
    state.activeModel = "gpt-5.1";
    state.historyCursor = "cursor";
    state.loadingHistory = true;
    state.composerDraft = "keep me";
    state.displayItems = [message("m1")];
    state.turnDiffs = new Map([["turn", "@@"]]);
    state.approvals = [approval(1)];
    state.pendingUserInputs = [userInput(2)];
    state.userInputDrafts = new Map([["2:note", "draft"]]);
    state.composerSuggestSelected = 1;
    state.composerSuggestions = [suggestion("/plan")];
    state.composerSuggestionsDismissedSignature = "dismissed";

    const next = chatReducer(state, { type: "thread/active-cleared" });

    expect(next).not.toBe(state);
    expect(next.activeThreadId).toBeNull();
    expect(activeTurnId(next)).toBeNull();
    expect(next.displayItems).toEqual([]);
    expect(next.turnDiffs.size).toBe(0);
    expect(next.historyCursor).toBeNull();
    expect(next.loadingHistory).toBe(false);
    expect(next.approvals).toEqual([]);
    expect(next.pendingUserInputs).toEqual([]);
    expect(next.userInputDrafts.size).toBe(0);
    expect(next.composerDraft).toBe("");
    expect(next.composerSuggestSelected).toBe(0);
    expect(next.composerSuggestions).toEqual([]);
    expect(next.composerSuggestionsDismissedSignature).toBeNull();
  });

  it("resets thread-scoped state when resuming a thread", () => {
    const state = createChatState();
    state.activeThreadId = "previous-thread";
    state.turnLifecycle = { kind: "running", turnId: "previous-turn" };
    state.historyCursor = "cursor";
    state.loadingHistory = true;
    state.composerDraft = "previous draft";
    state.displayItems = [message("previous-message")];
    state.turnDiffs = new Map([["previous-turn", "@@"]]);
    state.approvals = [approval(1)];
    state.pendingUserInputs = [userInput(2)];
    state.userInputDrafts = new Map([["2:note", "draft"]]);
    state.composerSuggestSelected = 1;
    state.composerSuggestions = [suggestion("/plan")];
    state.composerSuggestionsDismissedSignature = "dismissed";
    state.messagesPinnedToBottom = false;
    const resumedItems = [message("resumed-message")];

    const next = chatReducer(state, {
      type: "thread/resumed",
      thread: thread("resumed-thread"),
      cwd: "/vault",
      model: "gpt-5.1",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      activePermissionProfile: null,
      displayItems: resumedItems,
    });

    expect(next.activeThreadId).toBe("resumed-thread");
    expect(activeTurnId(next)).toBeNull();
    expect(next.historyCursor).toBeNull();
    expect(next.loadingHistory).toBe(false);
    expect(next.composerDraft).toBe("");
    expect(next.displayItems).toEqual(resumedItems);
    expect(next.turnDiffs.size).toBe(0);
    expect(next.approvals).toEqual([]);
    expect(next.pendingUserInputs).toEqual([]);
    expect(next.userInputDrafts.size).toBe(0);
    expect(next.composerSuggestSelected).toBe(0);
    expect(next.composerSuggestions).toEqual([]);
    expect(next.composerSuggestionsDismissedSignature).toBeNull();
    expect(next.messagesPinnedToBottom).toBe(true);
  });

  it("starts resumed threads with empty display state when no history items are supplied", () => {
    const state = createChatState();
    state.displayItems = [message("previous-message")];

    const next = chatReducer(state, {
      type: "thread/resumed",
      thread: thread("resumed-thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    expect(next.displayItems).toEqual([]);
  });

  it("clones map and set backed state when updating turn diffs and open panels", () => {
    const state = createChatState();
    state.turnDiffs = new Map([["turn", "old"]]);
    state.openDetails = new Set(["status-panel"]);

    const withDiff = chatReducer(state, { type: "display/turn-diff-updated", turnId: "turn", diff: "new" });
    const withHistoryPanel = chatReducer(withDiff, { type: "ui/panel-set", panel: "history" });

    expect(withDiff.turnDiffs).not.toBe(state.turnDiffs);
    expect(withDiff.turnDiffs.get("turn")).toBe("new");
    expect(withHistoryPanel.openDetails).not.toBe(withDiff.openDetails);
    expect(withHistoryPanel.openDetails.has("history")).toBe(true);
    expect(withHistoryPanel.openDetails.has("status-panel")).toBe(false);
  });

  it("returns the same state reference for no-op actions", () => {
    const state = createChatState();

    expect(chatReducer(state, { type: "status/set", status: "Idle" })).toBe(state);
    expect(chatReducer(state, { type: "request/approval-queued", approval: approval(1) })).not.toBe(state);
    const queued = chatReducer(state, { type: "request/approval-queued", approval: approval(1) });
    expect(chatReducer(queued, { type: "request/approval-queued", approval: approval(1) })).toBe(queued);
  });

  it("deduplicates reported logs while keeping reported log state immutable", () => {
    const state = createChatState();
    const item = { id: "log", kind: "system", role: "system", text: "once" } satisfies DisplayItem;

    const first = chatReducer(state, { type: "system/deduped-log-added", text: "once", item });
    const second = chatReducer(first, { type: "system/deduped-log-added", text: "once", item });

    expect(first.reportedLogs).not.toBe(state.reportedLogs);
    expect(first.displayItems).toEqual([item]);
    expect(second).toBe(first);
  });

  it("keeps turn lifecycle fields synchronized through start and completion", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: [] };
    const optimisticItem = { id: "local-user", kind: "message", role: "user", text: "hello" } satisfies DisplayItem;
    const acknowledgedItem = { ...optimisticItem, turnId: "turn" } satisfies DisplayItem;

    const optimistic = chatReducer(createChatState(), {
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
      displayItems: [acknowledgedItem],
    });
    expect(chatTurnBusy(running)).toBe(true);
    expect(activeTurnId(running)).toBe("turn");
    expect(pendingTurnStart(running)).toBeNull();

    const completed = chatReducer(running, {
      type: "turn/completed",
      turnId: "turn",
      status: "completed",
      displayItems: [acknowledgedItem],
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
    expect(transitionChatTurnLifecycleState(running, { type: "completed", turnId: "stale-turn" })).toBe(running);
    expect(transitionChatTurnLifecycleState({ kind: "idle" }, { type: "start-acknowledged", turnId: "turn" })).toEqual({
      kind: "idle",
    });
    expect(transitionChatTurnLifecycleState(running, { type: "completed", turnId: "turn" })).toEqual({ kind: "idle" });
  });

  it("clears running state when a turn start fails", () => {
    const state = createChatState();
    state.turnLifecycle = { kind: "starting", pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] } };

    const next = chatReducer(state, { type: "turn/start-failed", displayItems: [] });

    expect(chatTurnBusy(next)).toBe(false);
    expect(activeTurnId(next)).toBeNull();
    expect(pendingTurnStart(next)).toBeNull();
  });

  it("ignores turn start acknowledgements after the turn has already gone idle", () => {
    const state = createChatState();
    state.turnLifecycle = { kind: "idle" };

    const next = chatReducer(state, {
      type: "turn/start-acknowledged",
      turnId: "completed-turn",
      displayItems: [{ id: "local-user", kind: "message", role: "user", text: "hello", markdown: true, turnId: "completed-turn" }],
    });

    expect(next).toBe(state);
    expect(chatTurnBusy(next)).toBe(false);
    expect(activeTurnId(next)).toBeNull();
  });

  it("ignores completed turns while a new turn is still starting", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] };
    const state = createChatState();
    state.turnLifecycle = { kind: "starting", pendingTurnStart: pending };
    state.displayItems = [{ id: "local-user", kind: "message", role: "user", text: "hello", markdown: true }];

    const next = chatReducer(state, {
      type: "turn/completed",
      turnId: "stale-turn",
      status: "completed",
      displayItems: [],
    });

    expect(next).toBe(state);
    expect(chatTurnBusy(next)).toBe(true);
    expect(pendingTurnStart(next)).toEqual(pending);
    expect(next.displayItems).toEqual(state.displayItems);
  });

  it("keeps toolbar panels mutually exclusive", () => {
    let state = createChatState();

    state = chatReducer(state, { type: "ui/panel-set", panel: "history" });
    state = chatReducer(state, { type: "ui/panel-set", panel: "model" });
    expect(state.openDetails.size).toBe(0);
    expect(state.runtimePicker).toBe("model");

    state = chatReducer(state, { type: "ui/panel-set", panel: "status-panel" });
    expect(state.openDetails.has("status-panel")).toBe(true);
    expect(state.runtimePicker).toBeNull();
  });

  it("updates remembered details and user input drafts through typed UI actions", () => {
    let state = createChatState();

    state = chatReducer(state, { type: "ui/detail-open-set", key: "request:1", open: true });
    expect(state.openDetails.has("request:1")).toBe(true);
    expect(chatReducer(state, { type: "ui/detail-open-set", key: "request:1", open: true })).toBe(state);

    state = chatReducer(state, { type: "request/user-input-draft-set", key: "1:note", value: "answer" });
    expect(state.userInputDrafts.get("1:note")).toBe("answer");
    expect(chatReducer(state, { type: "request/user-input-draft-set", key: "1:note", value: "answer" })).toBe(state);

    state = chatReducer(state, { type: "ui/detail-open-set", key: "request:1", open: false });
    expect(state.openDetails.has("request:1")).toBe(false);
  });

  it("commits pending runtime settings and resets applied overrides", () => {
    let state = createChatState();
    state = chatReducer(state, { type: "runtime/requested-model-set", model: "gpt-5.1" });
    state = chatReducer(state, { type: "runtime/requested-effort-set", effort: "high" });
    state = chatReducer(state, { type: "runtime/requested-service-tier-set", serviceTier: "fast" });
    state = chatReducer(state, { type: "runtime/requested-approvals-reviewer-set", approvalsReviewer: "auto_review" });

    const next = chatReducer(state, {
      type: "runtime/pending-thread-settings-committed",
      update: {
        model: "gpt-5.1",
        effort: "high",
        serviceTier: "fast",
        approvalsReviewer: "auto_review",
        collaborationMode: { mode: "plan", settings: { model: "gpt-5.1", reasoning_effort: "high", developer_instructions: null } },
      },
    });

    expect(next.activeModel).toBe("gpt-5.1");
    expect(next.requestedModel).toEqual({ kind: "unchanged" });
    expect(next.activeReasoningEffort).toBe("high");
    expect(next.requestedReasoningEffort).toEqual({ kind: "unchanged" });
    expect(next.activeServiceTier).toBe("fast");
    expect(next.requestedServiceTier).toEqual({ kind: "unchanged" });
    expect(next.activeApprovalsReviewer).toBe("auto_review");
    expect(next.requestedApprovalsReviewer).toEqual({ kind: "unchanged" });
    expect(next.activeCollaborationMode).toBe("plan");
  });

  it("keeps requested policy toggles pending until app-server settings commit", () => {
    let state = createChatState();
    state.activeServiceTier = "flex";
    state.activeApprovalsReviewer = "user";

    state = chatReducer(state, { type: "runtime/requested-service-tier-set", serviceTier: "fast" });
    state = chatReducer(state, { type: "runtime/requested-approvals-reviewer-set", approvalsReviewer: "auto_review" });

    expect(state.requestedServiceTier).toEqual({ kind: "set", value: "fast" });
    expect(state.activeServiceTier).toBe("flex");
    expect(state.requestedApprovalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(state.activeApprovalsReviewer).toBe("user");
  });

  it("stores updates through ChatStateStore without mutating the initial snapshot", () => {
    const initial = createChatState();
    initial.displayItems = [message("initial")];
    const store = createChatStateStore(initial);

    store.dispatch({ type: "display/item-upserted", item: message("next") });

    expect(initial.displayItems).toEqual([message("initial")]);
    expect(store.getState().displayItems).toEqual([message("initial"), message("next")]);
  });

  it("keeps panel-local thread, request, and composer state isolated across stores", () => {
    const panelA = createChatStateStore();
    const panelB = createChatStateStore();

    panelA.dispatch({
      type: "thread/resumed",
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
      type: "thread/resumed",
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
    panelA.dispatch({ type: "thread/active-cleared" });

    expect(panelA.getState()).toMatchObject({
      activeThreadId: null,
      composerDraft: "",
      pendingUserInputs: [],
    });
    expect(panelA.getState().userInputDrafts.size).toBe(0);

    expect(panelB.getState()).toMatchObject({
      activeThreadId: "thread-b",
      composerDraft: "panel B draft",
      pendingUserInputs: [expect.objectContaining({ requestId: 2 })],
    });
    expect(panelB.getState().userInputDrafts.get("2:note")).toBe("panel B answer");
  });

  it("notifies ChatStateStore subscribers only when the state reference changes", () => {
    const store = createChatStateStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.dispatch({ type: "status/set", status: "Idle" });
    expect(listener).not.toHaveBeenCalled();

    store.dispatch({ type: "status/set", status: "Working" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.dispatch({ type: "status/set", status: "Done" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

function message(id: string): DisplayItem {
  return { id, kind: "message", role: "assistant", text: id };
}

function suggestion(display: string): ChatState["composerSuggestions"][number] {
  return { display, detail: "Plan mode", replacement: display, start: 0, appendSpaceOnInsert: true };
}

function approval(requestId: number): ChatState["approvals"][number] {
  return {
    requestId,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread", turnId: "turn", itemId: "item", command: "pwd", cwd: "/tmp", reason: "Need access", startedAtMs: 1 },
  };
}

function userInput(requestId: number): ChatState["pendingUserInputs"][number] {
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

export function thread(id: string): Thread {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "codex-cli 1.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}
