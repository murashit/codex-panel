import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import type { TurnOutcome } from "../../../../domain/runtime/turn-outcome";
import { authRecoveryProgress } from "../../application/turns/auth-recovery";
import type { TurnRuntimeFact } from "../../application/turns/runtime-facts";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { STREAMED_COMMAND_RUNNING_TEXT, STREAMED_MCP_PROGRESS_LABEL } from "../../domain/thread-stream/streaming-items";
import { type AppServerFileChange, normalizeFileChanges, streamingFileChangeThreadStreamItem } from "../mappers/thread-stream/file-changes";
import { hookRunThreadStreamItem } from "../mappers/thread-stream/hook-run-items";
import { createAutoReviewResultItem, createReviewResultItem } from "../mappers/thread-stream/review-result-items";
import { taskProgressThreadStreamItem } from "../mappers/thread-stream/task-progress";
import {
  type AppServerTurnItem,
  completedTurnTranscriptSummaryFromAppServerTurn,
  shouldSuppressLifecycleItem,
  threadStreamItemFromTurnItem,
  threadStreamItemsFromTurns,
} from "../mappers/thread-stream/turn-items";
import type { StreamUpdateNotification, TurnLifecycleNotification, UserVisibleNoticeNotification } from "./notification-routing";
import { userVisibleNoticeItem } from "./user-visible-notice";

export type RuntimeFactSource =
  | StreamUpdateNotification
  | TurnLifecycleNotification
  | Extract<ServerNotification, { method: "serverRequest/resolved" }>
  | UserVisibleNoticeNotification;

export function turnRuntimeFactFromNotification(
  notification: RuntimeFactSource,
  localItemId: (prefix: string) => string,
): TurnRuntimeFact | null {
  switch (notification.method) {
    case "modelProvider/authRecoveryStarted":
    case "modelProvider/authRecoveryCompleted":
      return {
        type: "authRecoveryUpdated",
        turnId: notification.params.turnId,
        progress: authRecoveryProgress(
          notification.params.provider,
          notification.params.message,
          notification.method === "modelProvider/authRecoveryStarted" ? "running" : "completed",
        ),
      };
    case "item/agentMessage/delta":
      return {
        type: "assistantDelta",
        itemId: notification.params.itemId,
        turnId: notification.params.turnId,
        delta: notification.params.delta,
        completeReasoning: true,
      };
    case "item/plan/delta":
      return {
        type: "planDelta",
        itemId: notification.params.itemId,
        turnId: notification.params.turnId,
        delta: notification.params.delta,
      };
    case "turn/plan/updated":
      return {
        type: "taskProgressUpdated",
        item: taskProgressThreadStreamItem(notification.params.turnId, notification.params.explanation, notification.params.plan),
      };
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return {
        type: "textDelta",
        itemId: notification.params.itemId,
        turnId: notification.params.turnId,
        label: "reasoning",
        delta: notification.params.delta,
        kind: "reasoning",
        source: notification.method === "item/reasoning/textDelta" ? "body" : "summary",
      };
    case "item/reasoning/summaryPartAdded":
      return {
        type: "textDelta",
        itemId: notification.params.itemId,
        turnId: notification.params.turnId,
        label: "reasoning",
        delta: "",
        kind: "reasoning",
        source: "summary",
      };
    case "item/started":
      return startedItemFact(notification.params.item, notification.params.turnId);
    case "item/completed":
      return completedItemFact(notification.params.item, notification.params.turnId);
    case "item/commandExecution/outputDelta":
      return {
        type: "itemOutputDelta",
        itemId: notification.params.itemId,
        turnId: notification.params.turnId,
        delta: notification.params.delta,
        kind: "command",
        fallbackText: STREAMED_COMMAND_RUNNING_TEXT,
      };
    case "item/fileChange/patchUpdated":
      return {
        type: "itemContentUpdated",
        item: fileChangeItem(notification.params.itemId, notification.params.turnId, notification.params.changes, "inProgress"),
      };
    case "turn/diff/updated":
      return { type: "turnDiffUpdated", turnId: notification.params.turnId, diff: notification.params.diff };
    case "hook/started":
      return hookRunFact(notification.params.run, notification.params.turnId, "running");
    case "hook/completed":
      return hookRunFact(notification.params.run, notification.params.turnId, notification.params.run.status);
    case "item/mcpToolCall/progress":
      return {
        type: "toolOutputDelta",
        itemId: notification.params.itemId,
        turnId: notification.params.turnId,
        delta: notification.params.message,
        fallbackLabel: STREAMED_MCP_PROGRESS_LABEL,
      };
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
      return { type: "autoReviewUpdated", item: createAutoReviewResultItem(notification.params) };
    case "guardianWarning":
      return { type: "reviewWarning", item: createReviewResultItem(localItemId("review"), notification.params.message) };
    case "turn/started":
      return {
        type: "turnStarted",
        threadId: notification.params.threadId,
        turnId: notification.params.turn.id,
      };
    case "turn/completed":
      return {
        type: "turnCompleted",
        threadId: notification.params.threadId,
        turnId: notification.params.turn.id,
        outcome: completedTurnOutcome(notification.params.turn.status),
        completedItems: notification.params.turn.itemsView === "notLoaded" ? [] : threadStreamItemsFromTurns([notification.params.turn]),
        completedTurnTranscriptSummary: completedTurnTranscriptSummaryFromAppServerTurn(notification.params.turn),
      };
    case "serverRequest/resolved":
      return { type: "requestResolved", requestId: notification.params.requestId };
    case "model/rerouted":
    case "deprecationNotice":
    case "error":
    case "warning":
    case "configWarning":
    case "windows/worldWritableWarning":
    case "windowsSandbox/setupCompleted": {
      const item = userVisibleNoticeItem(notification, localItemId("system"));
      return item ? { type: "systemNotice", item } : null;
    }
  }
}

function startedItemFact(item: AppServerTurnItem, turnId: string): TurnRuntimeFact | null {
  if (item.type === "userMessage") {
    const streamItem = threadStreamItemFromTurnItem(item, turnId);
    return streamItem?.kind === "dialogue" ? { type: "userMessageObserved", item: streamItem } : null;
  }
  if (shouldSuppressLifecycleItem(item)) return null;
  const streamItem = threadStreamItemFromTurnItem(item, turnId);
  return streamItem ? { type: "itemStarted", item: streamItem } : null;
}

function completedItemFact(item: AppServerTurnItem, turnId: string): TurnRuntimeFact | null {
  if (item.type === "userMessage") return null;
  const streamItem = threadStreamItemFromTurnItem(item, turnId);
  return streamItem ? { type: "itemCompleted", turnId, item: streamItem } : null;
}

function fileChangeItem(itemId: string, turnId: string, changes: readonly AppServerFileChange[], status: string): ThreadStreamItem {
  return streamingFileChangeThreadStreamItem(itemId, turnId, normalizeFileChanges(changes), status);
}

function hookRunFact(
  run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
  turnId: string | null,
  status: string,
): TurnRuntimeFact | null {
  const item = hookRunThreadStreamItem(run, turnId, status);
  return item ? { type: "hookRunObserved", item, turnId, isPromptSubmission: run.eventName === "userPromptSubmit" } : null;
}

function completedTurnOutcome(status: Extract<ServerNotification, { method: "turn/completed" }>["params"]["turn"]["status"]): TurnOutcome {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "inProgress":
      return "unknown";
  }
}
