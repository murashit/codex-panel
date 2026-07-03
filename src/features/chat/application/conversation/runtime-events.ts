import type { PendingRequestId } from "../../../../domain/pending-requests/model";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import type { MessageStreamItem } from "../../domain/message-stream/items";

type ConversationRuntimeTextItemKind = "tool" | "hook" | "reasoning";
type ConversationRuntimeOutputItemKind = "command" | "fileChange";

export type ConversationRuntimeEvent =
  | {
      type: "assistantDelta";
      runId: string;
      itemId: string;
      delta: string;
      completeReasoning: boolean;
    }
  | {
      type: "planDelta";
      runId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "textDelta";
      runId: string;
      itemId: string;
      label: string;
      delta: string;
      kind: ConversationRuntimeTextItemKind;
    }
  | {
      type: "toolOutputDelta";
      runId: string;
      itemId: string;
      delta: string;
      fallbackLabel: string;
    }
  | {
      type: "itemOutputDelta";
      runId: string;
      itemId: string;
      delta: string;
      kind: ConversationRuntimeOutputItemKind;
      fallbackText: string;
    }
  | {
      type: "itemUpserted";
      item: MessageStreamItem;
    }
  | {
      type: "itemCompleted";
      runId: string;
      item: MessageStreamItem;
    }
  | {
      type: "autoReviewUpdated";
      item: MessageStreamItem;
    }
  | {
      type: "runStarted";
      threadId: string;
      runId: string;
      recencyAt: number | null;
    }
  | {
      type: "runCompleted";
      threadId: string;
      runId: string;
      status: string;
      completedItems: readonly MessageStreamItem[];
      completedSummary: ThreadConversationSummary | null;
    }
  | {
      type: "turnDiffUpdated";
      runId: string;
      diff: string;
    }
  | {
      type: "hookRunObserved";
      item: MessageStreamItem;
      runId: string | null;
      eventName: string;
    }
  | {
      type: "requestResolved";
      requestId: PendingRequestId;
    }
  | {
      type: "reviewWarning";
      item: MessageStreamItem;
    }
  | {
      type: "systemNotice";
      item: MessageStreamItem;
    };
