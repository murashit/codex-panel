import { describe, expect, it } from "vitest";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createGoalEditorActions } from "../../../../../src/features/chat/application/threads/goal-editor-actions";
import { chatStateFixture } from "../../support/state";

describe("GoalEditorActions", () => {
  it("owns only panel-local editor and disclosure state", () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const actions = createGoalEditorActions({ stateStore });

    actions.startEditing("thread", "Ship it", 1200);
    actions.updateObjectiveDraft("Ship it safely");
    actions.setObjectiveExpanded("thread", true);

    expect(stateStore.getState().ui.goalEditor).toEqual({
      kind: "editing",
      threadId: "thread",
      objectiveDraft: "Ship it safely",
      tokenBudgetDraft: 1200,
    });
    expect(stateStore.getState().ui.disclosures.goalObjectiveExpanded.has("thread")).toBe(true);

    actions.closeEditor();
    expect(stateStore.getState().ui.goalEditor).toEqual({ kind: "closed" });
  });
});
