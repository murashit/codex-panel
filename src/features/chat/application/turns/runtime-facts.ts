import type { TurnTranscriptSummary } from "../../../../domain/threads/transcript";
import type { PendingRequestId } from "../../domain/pending-requests/model";
import type { TurnOutcome } from "../../domain/runtime/turn-outcome";
import type {
  HookThreadStreamItem,
  ReviewResultThreadStreamItem,
  SystemThreadStreamItem,
  TaskProgressThreadStreamItem,
  ThreadStreamItem,
  UserThreadStreamDialogueItem,
} from "../../domain/thread-stream/items";
import type { AuthRecoveryProgress } from "./auth-recovery";

type TurnRuntimeTextItemKind = "tool" | "hook" | "reasoning";
type TurnRuntimeOutputItemKind = "command" | "fileChange";

export type TurnRuntimeFact =
  | {
      type: "authRecoveryUpdated";
      turnId: string;
      progress: AuthRecoveryProgress;
    }
  | {
      type: "assistantDelta";
      turnId: string;
      itemId: string;
      delta: string;
      completeReasoning: boolean;
    }
  | {
      type: "planDelta";
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "textDelta";
      turnId: string;
      itemId: string;
      label: string;
      delta: string;
      kind: TurnRuntimeTextItemKind;
      source: "summary" | "body";
    }
  | {
      type: "toolOutputDelta";
      turnId: string;
      itemId: string;
      delta: string;
      fallbackLabel: string;
    }
  | {
      type: "itemOutputDelta";
      turnId: string;
      itemId: string;
      delta: string;
      kind: TurnRuntimeOutputItemKind;
      fallbackText: string;
    }
  | {
      type: "itemStarted" | "itemContentUpdated";
      item: ThreadStreamItem;
    }
  | {
      type: "taskProgressUpdated";
      item: TaskProgressThreadStreamItem;
    }
  | {
      type: "userMessageObserved";
      item: UserThreadStreamDialogueItem;
    }
  | {
      type: "itemCompleted";
      turnId: string;
      item: ThreadStreamItem;
    }
  | {
      type: "autoReviewUpdated";
      item: ReviewResultThreadStreamItem;
    }
  | {
      type: "turnStarted";
      threadId: string;
      turnId: string;
    }
  | {
      type: "turnCompleted";
      threadId: string;
      turnId: string;
      outcome: TurnOutcome;
      completedItems: readonly ThreadStreamItem[];
      completedTurnTranscriptSummary: TurnTranscriptSummary | null;
    }
  | {
      type: "turnDiffUpdated";
      turnId: string;
      diff: string;
    }
  | {
      type: "hookRunObserved";
      item: HookThreadStreamItem;
    }
  | {
      type: "requestResolved";
      requestId: PendingRequestId;
    }
  | {
      type: "reviewWarning";
      item: ReviewResultThreadStreamItem;
    }
  | {
      type: "systemNotice";
      item: SystemThreadStreamItem;
    };
