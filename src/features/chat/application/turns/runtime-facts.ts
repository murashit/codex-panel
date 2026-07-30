import type { PendingRequestId } from "../../../../domain/pending-requests/model";
import type { TurnTranscriptSummary } from "../../../../domain/threads/transcript";
import type { ThreadStreamDialogueItem, ThreadStreamItem } from "../../domain/thread-stream/items";

type TurnRuntimeTextItemKind = "tool" | "hook" | "reasoning";
type TurnRuntimeOutputItemKind = "command" | "fileChange";

export type TurnRuntimeFact =
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
      type: "itemUpserted";
      item: ThreadStreamItem;
    }
  | {
      type: "userMessageObserved";
      item: ThreadStreamDialogueItem;
    }
  | {
      type: "itemCompleted";
      turnId: string;
      item: ThreadStreamItem;
    }
  | {
      type: "autoReviewUpdated";
      item: ThreadStreamItem;
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
      status: string;
      itemsView: "notLoaded" | "summary" | "full";
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
      item: ThreadStreamItem;
      turnId: string | null;
      eventName: string;
    }
  | {
      type: "requestResolved";
      requestId: PendingRequestId;
    }
  | {
      type: "reviewWarning";
      item: ThreadStreamItem;
    }
  | {
      type: "systemNotice";
      item: ThreadStreamItem;
    };
