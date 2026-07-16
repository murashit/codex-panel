import { describe, expect, it } from "vitest";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import {
  initialUiState,
  maybeClearGoalObjectiveExpansion,
  reduceUiSlice,
} from "../../../../../src/features/chat/application/state/ui-state";

describe("chat UI state", () => {
  it("keeps toolbar panels mutually exclusive", () => {
    let state = reduceUiSlice(initialUiState(), { type: "ui/panel-set", panel: "history" });
    state = reduceUiSlice(state, { type: "ui/panel-set", panel: "chat-actions" });
    state = reduceUiSlice(state, { type: "ui/panel-set", panel: "status-panel" });

    expect(state.toolbarPanel).toBe("status-panel");
  });

  it("updates disclosures, the action menu, and goal editor through typed actions", () => {
    let state = reduceUiSlice(initialUiState(), {
      type: "ui/disclosure-set",
      bucket: "approvalDetails",
      id: "1:details",
      open: true,
    });
    state = reduceUiSlice(state, { type: "ui/thread-stream-fork-menu-set", itemId: "message-1" });
    state = reduceUiSlice(state, {
      type: "ui/goal-editor-started",
      threadId: "thread",
      objective: "old",
      tokenBudget: 10,
    });
    state = reduceUiSlice(state, { type: "ui/goal-editor-draft-updated", objective: "new" });

    expect(state.disclosures.approvalDetails.has("1:details")).toBe(true);
    expect(state.threadStreamActionMenu.forkMenuItemId).toBe("message-1");
    expect(state.goalEditor).toEqual({
      kind: "editing",
      threadId: "thread",
      objectiveDraft: "new",
      tokenBudgetDraft: 10,
    });
  });

  it("scopes rename generation callbacks to the active thread and generation", () => {
    let state = reduceUiSlice(initialUiState(), {
      type: "ui/rename-started",
      threadId: "thread",
      draft: "Original",
    });
    state = reduceUiSlice(state, {
      type: "ui/rename-generation-started",
      threadId: "thread",
      generationToken: 1,
    });
    state = reduceUiSlice(state, {
      type: "ui/rename-generation-succeeded",
      threadId: "other-thread",
      generationToken: 1,
      draft: "Wrong thread",
    });
    state = reduceUiSlice(state, {
      type: "ui/rename-generation-succeeded",
      threadId: "thread",
      generationToken: 2,
      draft: "Wrong generation",
    });
    state = reduceUiSlice(state, {
      type: "ui/rename-draft-updated",
      threadId: "thread",
      draft: "Manual draft",
    });
    state = reduceUiSlice(state, {
      type: "ui/rename-generation-succeeded",
      threadId: "thread",
      generationToken: 1,
      draft: "Late title",
    });
    state = reduceUiSlice(state, {
      type: "ui/rename-generation-finished",
      threadId: "thread",
      generationToken: 1,
    });

    expect(state.rename).toEqual({ kind: "editing", threadId: "thread", draft: "Manual draft" });
  });

  it("clears goal expansion only when the displayed goal identity changes", () => {
    const current = goal();
    const expanded = reduceUiSlice(initialUiState(), {
      type: "ui/disclosure-set",
      bucket: "goalObjectiveExpanded",
      id: "thread",
      open: true,
    });

    const usageOnly = maybeClearGoalObjectiveExpansion(expanded, current, {
      ...current,
      tokensUsed: 10,
      timeUsedSeconds: 30,
    });
    const changed = maybeClearGoalObjectiveExpansion(usageOnly, current, {
      ...current,
      objective: "Changed",
    });

    expect(usageOnly.disclosures.goalObjectiveExpanded.has("thread")).toBe(true);
    expect(changed.disclosures.goalObjectiveExpanded.size).toBe(0);
  });
});

function goal(): ThreadGoal {
  return {
    threadId: "thread",
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}
