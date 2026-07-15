import type { ComponentChild as UiNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { isComposerSendKey, type SendShortcut } from "../../../domain/input/send-shortcut";
import type { ThreadGoal, ThreadGoalStatus } from "../../../domain/threads/goal";
import { IconButton } from "../../../shared/obsidian/components.obsidian";
import {
  closeGoalEditorOnOutsidePointer,
  collapseGoalObjectiveOnOutsidePointer,
  focusGoalObjectiveEditor,
  observeGoalObjectiveOverflow,
  syncGoalObjectiveHeight,
} from "./goal.dom";

export interface GoalPanelActions {
  onSave: (objective: string, tokenBudget: number | null) => void;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onObjectiveDraftChange: (objective: string) => void;
  onObjectiveExpandedChange: (expanded: boolean) => void;
}

export interface GoalPanelOptions {
  sendShortcut: SendShortcut;
}

export interface GoalPanelEditorState {
  editing: boolean;
  objectiveDraft: string;
  tokenBudgetDraft: number | null;
}

export interface GoalPanelDisplayState {
  objectiveExpanded: boolean;
}

export function GoalPanel({
  goal,
  actions,
  options,
  editor,
  display,
}: {
  goal: ThreadGoal | null;
  actions: GoalPanelActions;
  options: GoalPanelOptions;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
}): UiNode {
  const [objectiveOverflows, setObjectiveOverflows] = useState(false);
  const goalRef = useRef<HTMLDivElement | null>(null);
  const objectiveContentRef = useRef<HTMLDivElement | null>(null);
  const objectiveRef = useRef<HTMLTextAreaElement | null>(null);

  const resetThreadId = goal?.threadId ?? null;
  const resetObjective = goal?.objective ?? "";
  const resetStatus = goal?.status ?? null;
  const resetTokenBudget = goal?.tokenBudget ?? null;
  const editing = editor.editing;
  const objective = editor.objectiveDraft;
  const tokenBudget = editor.tokenBudgetDraft;
  const objectiveExpanded = display.objectiveExpanded;

  useLayoutEffect(() => {
    setObjectiveOverflows(false);
  }, [resetThreadId, resetObjective, resetStatus, resetTokenBudget]);

  useLayoutEffect(() => {
    if (editing) syncGoalObjectiveHeight(objectiveRef.current);
  }, [editing, objective]);

  useLayoutEffect(() => {
    if (!editing) return;
    focusGoalObjectiveEditor(objectiveRef.current);
  }, [editing]);

  useLayoutEffect(() => {
    if (editing) return;
    const content = objectiveContentRef.current;
    if (!content) return;
    return observeGoalObjectiveOverflow(content, setObjectiveOverflows);
  }, [editing, resetObjective]);

  useEffect(() => {
    if (!editing) return;
    const root = goalRef.current;
    if (!root) return;
    return closeGoalEditorOnOutsidePointer(root, actions.onCancelEditing);
  }, [actions, editing]);

  useEffect(() => {
    if (!objectiveExpanded) return;
    const root = goalRef.current;
    if (!root) return;
    return collapseGoalObjectiveOnOutsidePointer(root, () => {
      actions.onObjectiveExpandedChange(false);
    });
  }, [actions, objectiveExpanded]);

  if (!goal && !editing) return null;

  const terminal = goal ? terminalGoalStatus(goal.status) : false;
  const saveDisabled = objective.trim().length === 0;
  const saveObjective = () => {
    if (saveDisabled) return;
    actions.onSave(objective, tokenBudget);
  };

  return (
    <div ref={goalRef} className={goalClassName(goal?.status ?? null, terminal)}>
      <div className="codex-panel__goal-main">
        <div className="codex-panel__goal-role">
          <span>Goal</span>
          <div className="codex-panel__goal-actions">
            {goal && !editing ? (
              <IconButton
                icon="pencil"
                label="Edit goal"
                className="clickable-icon codex-panel__hover-action codex-panel__goal-action"
                onClick={actions.onStartEditing}
              />
            ) : null}
            {goal && !terminal && !editing && goal.status === "active" ? (
              <IconButton
                icon="pause"
                label="Pause goal"
                className="clickable-icon codex-panel__hover-action codex-panel__goal-action"
                onClick={actions.onPause}
              />
            ) : null}
            {goal && !terminal && !editing && goal.status === "paused" ? (
              <IconButton
                icon="play"
                label="Resume goal"
                className="clickable-icon codex-panel__hover-action codex-panel__goal-action"
                onClick={actions.onResume}
              />
            ) : null}
            {goal && !editing ? (
              <IconButton
                icon="x"
                label="Clear goal"
                className="clickable-icon codex-panel__hover-action codex-panel__goal-action"
                onClick={actions.onClear}
              />
            ) : null}
          </div>
        </div>
        {editing ? (
          <div className="codex-panel__goal-editor">
            <div className="codex-panel-ui__text-input-frame codex-panel__goal-editor-frame">
              <textarea
                ref={objectiveRef}
                className="codex-panel-ui__text-input codex-panel__goal-objective-input"
                value={objective}
                onInput={(event) => {
                  actions.onObjectiveDraftChange(event.currentTarget.value);
                  syncGoalObjectiveHeight(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (!isComposerSendKey(event, options.sendShortcut)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  saveObjective();
                }}
              />
              <IconButton
                icon="check"
                label="Save goal"
                className="clickable-icon codex-panel-ui__icon-button codex-panel__goal-save"
                disabled={saveDisabled}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={saveObjective}
              />
            </div>
          </div>
        ) : (
          <>
            <div
              className={[
                "codex-panel__goal-objective-collapse",
                objectiveOverflows ? "codex-panel__goal-objective-collapse--overflow" : "",
                objectiveOverflows && objectiveExpanded ? "codex-panel__goal-objective-collapse--expanded" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div
                ref={objectiveContentRef}
                className={[
                  "codex-panel__goal-objective",
                  objectiveOverflows && !objectiveExpanded ? "codex-panel__goal-objective--collapsed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {goal?.objective}
              </div>
              <details
                className="codex-panel__goal-objective-collapse-details"
                hidden={!objectiveOverflows || objectiveExpanded}
                onToggle={(event) => {
                  if (!event.currentTarget.open) return;
                  event.currentTarget.open = false;
                  actions.onObjectiveExpandedChange(true);
                }}
              >
                <summary tabIndex={-1}>Show more</summary>
              </details>
            </div>
            {goal ? <div className="codex-panel__goal-usage">{goalUsage(goal)}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}

function terminalGoalStatus(status: ThreadGoalStatus): boolean {
  return status === "complete" || status === "blocked" || status === "usageLimited" || status === "budgetLimited";
}

function goalClassName(status: ThreadGoalStatus | null, terminal: boolean): string {
  return ["codex-panel__goal", goalStatusClassName(status), terminal ? "is-terminal" : ""].filter(Boolean).join(" ");
}

function goalStatusClassName(status: ThreadGoalStatus | null): string {
  if (status === "active") return "codex-panel__goal--active";
  if (status === "blocked") return "codex-panel__goal--blocked";
  if (status === "budgetLimited") return "codex-panel__goal--budgetLimited";
  if (status === "complete") return "codex-panel__goal--complete";
  if (status === "paused") return "codex-panel__goal--paused";
  if (status === "usageLimited") return "codex-panel__goal--usageLimited";
  return "";
}

function goalUsage(goal: ThreadGoal): string {
  const tokens =
    goal.tokenBudget === null ? `${String(goal.tokensUsed)} tokens` : `${String(goal.tokensUsed)} / ${String(goal.tokenBudget)} tokens`;
  return `${tokens}, ${formatElapsed(goal.timeUsedSeconds)}`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(remainingSeconds)}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(remainingMinutes)}m`;
}
