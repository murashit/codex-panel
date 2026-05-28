import { describe, expect, it, vi } from "vitest";

import { chatReducer, createChatState, createChatStateStore, type ChatState } from "../../../src/features/chat/chat-state";
import type { DisplayItem } from "../../../src/features/chat/display/types";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";

describe("chatReducer", () => {
  it("clears active turn and thread state without dropping local composer draft", () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.activeTurnId = "turn";
    state.activeModel = "gpt-5.1";
    state.historyCursor = "cursor";
    state.loadingHistory = true;
    state.composerDraft = "keep me";
    state.displayItems = [message("m1")];
    state.turnDiffs = new Map([["turn", "@@"]]);
    state.approvals = [approval(1)];
    state.pendingUserInputs = [userInput(2)];
    state.userInputDrafts = new Map([["2:note", "draft"]]);

    const next = chatReducer(state, { type: "thread/active-cleared" });

    expect(next).not.toBe(state);
    expect(next.activeThreadId).toBeNull();
    expect(next.activeTurnId).toBeNull();
    expect(next.displayItems).toEqual([]);
    expect(next.turnDiffs.size).toBe(0);
    expect(next.historyCursor).toBeNull();
    expect(next.loadingHistory).toBe(false);
    expect(next.approvals).toEqual([]);
    expect(next.pendingUserInputs).toEqual([]);
    expect(next.userInputDrafts.size).toBe(0);
    expect(next.composerDraft).toBe("keep me");
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
    state = chatReducer(state, { type: "runtime/requested-approvals-reviewer-set", approvalsReviewer: "auto_review" });

    const next = chatReducer(state, {
      type: "runtime/pending-thread-settings-committed",
      update: {
        model: "gpt-5.1",
        effort: "high",
        approvalsReviewer: "auto_review",
        collaborationMode: { mode: "plan", settings: { model: "gpt-5.1", reasoning_effort: "high", developer_instructions: null } },
      },
    });

    expect(next.activeModel).toBe("gpt-5.1");
    expect(next.requestedModel).toEqual({ kind: "default" });
    expect(next.activeReasoningEffort).toBe("high");
    expect(next.requestedReasoningEffort).toEqual({ kind: "default" });
    expect(next.activeApprovalsReviewer).toBe("auto_review");
    expect(next.requestedApprovalsReviewer).toBeNull();
    expect(next.activeCollaborationMode).toBe("plan");
  });

  it("stores updates through ChatStateStore without mutating the initial snapshot", () => {
    const initial = createChatState();
    initial.displayItems = [message("initial")];
    const store = createChatStateStore(initial);

    store.dispatch({ type: "display/item-upserted", item: message("next") });

    expect(initial.displayItems).toEqual([message("initial")]);
    expect(store.getState().displayItems).toEqual([message("initial"), message("next")]);
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

  it("keeps equal composer suggestion updates as no-ops", () => {
    const store = createChatStateStore();
    const listener = vi.fn();
    const suggestions = [{ display: "/plan", detail: "Plan mode", replacement: "/plan", start: 0, appendSpaceOnInsert: true }];
    store.subscribe(listener);

    store.dispatch({ type: "composer/suggestions-set", suggestions, selected: 0 });
    expect(listener).toHaveBeenCalledTimes(1);

    store.dispatch({ type: "composer/suggestions-set", suggestions: suggestions.map((item) => ({ ...item })), selected: 0 });
    expect(listener).toHaveBeenCalledTimes(1);

    store.dispatch({ type: "composer/suggestions-set", suggestions: [], selected: 0 });
    expect(listener).toHaveBeenCalledTimes(2);
    store.dispatch({ type: "composer/suggestions-set", suggestions: [], selected: 0 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

function message(id: string): DisplayItem {
  return { id, kind: "message", role: "assistant", text: id };
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
