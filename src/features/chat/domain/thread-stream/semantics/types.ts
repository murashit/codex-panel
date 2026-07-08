import type { ExecutionState, ThreadStreamItem } from "../items";
import type { ThreadStreamItemProvenance } from "../provenance";

type ThreadStreamTurnRole = "initiator" | "steer" | "detail" | "outcome";

export type ThreadStreamPlacement =
  | {
      scope: "thread";
    }
  | {
      scope: "turn";
      turnId: string;
      turnRole: ThreadStreamTurnRole;
    }
  | {
      scope: "pendingTurn";
      turnRole: Extract<ThreadStreamTurnRole, "initiator" | "steer">;
    }
  | {
      scope: "item";
      parentItemId: string;
      turnId?: string;
    }
  | {
      scope: "panel";
    };

export type ThreadStreamMeaningPlane =
  | "dialogue"
  | "interaction"
  | "execution"
  | "workspace"
  | "coordination"
  | "permission"
  | "review"
  | "context"
  | "diagnostic";

export type ThreadStreamMeaningEvent =
  | "request"
  | "response"
  | "proposal"
  | "progress"
  | "evidence"
  | "result"
  | "decision"
  | "stateChange"
  | "notice";

export interface ThreadStreamMeaning {
  plane: ThreadStreamMeaningPlane;
  event: ThreadStreamMeaningEvent;
}

export interface ThreadStreamLifecycle {
  state: Exclude<ExecutionState, null>;
}

export interface ThreadStreamSemanticCapabilities {
  canForkFromHere: boolean;
  canRollbackToPrompt: boolean;
  canImplementPlan: boolean;
  isTurnOutcome: boolean;
}

export interface ThreadStreamSemanticClassification {
  item: ThreadStreamItem;
  provenance?: ThreadStreamItemProvenance;
  placement: ThreadStreamPlacement;
  meaning: ThreadStreamMeaning;
  lifecycle?: ThreadStreamLifecycle;
  capabilities: ThreadStreamSemanticCapabilities;
}
