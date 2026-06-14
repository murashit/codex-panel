import type { ExecutionState, MessageStreamItem } from "../items";
import type { MessageStreamItemProvenance } from "../provenance";

type MessageStreamTurnRole = "initiator" | "steer" | "detail" | "outcome";

export type MessageStreamPlacement =
  | {
      scope: "thread";
    }
  | {
      scope: "turn";
      turnId: string;
      turnRole: MessageStreamTurnRole;
    }
  | {
      scope: "pendingTurn";
      turnRole: Extract<MessageStreamTurnRole, "initiator" | "steer">;
    }
  | {
      scope: "item";
      parentItemId: string;
      turnId?: string;
    }
  | {
      scope: "panel";
    };

export type MessageStreamMeaningPlane =
  | "dialogue"
  | "interaction"
  | "execution"
  | "workspace"
  | "coordination"
  | "permission"
  | "review"
  | "context"
  | "diagnostic";

export type MessageStreamMeaningEvent =
  | "request"
  | "response"
  | "proposal"
  | "progress"
  | "evidence"
  | "result"
  | "decision"
  | "stateChange"
  | "notice";

export interface MessageStreamMeaning {
  plane: MessageStreamMeaningPlane;
  event: MessageStreamMeaningEvent;
}

export interface MessageStreamLifecycle {
  state: Exclude<ExecutionState, null>;
}

export interface MessageStreamSemanticActions {
  canForkFromHere: boolean;
  canRollbackToPrompt: boolean;
  canImplementPlan: boolean;
  isTurnOutcome: boolean;
}

export type MessageStreamRenderFamily = "text" | "toolResult" | "work";

export interface MessageStreamSemanticClassification {
  item: MessageStreamItem;
  provenance?: MessageStreamItemProvenance;
  placement: MessageStreamPlacement;
  meaning: MessageStreamMeaning;
  lifecycle?: MessageStreamLifecycle;
  actions: MessageStreamSemanticActions;
}
