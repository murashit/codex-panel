import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { jsonPreview } from "../../../../domain/display/json-preview";
import { authRecoveryProgress } from "../../application/turns/auth-recovery";
import type { TurnRuntimeFact } from "../../application/turns/runtime-facts";
import { createSystemItem } from "../../domain/thread-stream/factories/system-items";
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

export type RuntimeFactSource =
  | StreamUpdateNotification
  | TurnLifecycleNotification
  | Extract<ServerNotification, { method: "serverRequest/resolved" }>
  | UserVisibleNoticeNotification;

export function turnRuntimeFactsFromNotification(
  notification: RuntimeFactSource,
  localItemId: (prefix: string) => string,
): readonly TurnRuntimeFact[] {
  switch (notification.method) {
    case "modelProvider/authRecoveryStarted":
    case "modelProvider/authRecoveryCompleted":
      return [
        {
          type: "authRecoveryUpdated",
          turnId: notification.params.turnId,
          progress: authRecoveryProgress(
            notification.params.provider,
            notification.params.message,
            notification.method === "modelProvider/authRecoveryStarted" ? "running" : "completed",
          ),
        },
      ];
    case "item/agentMessage/delta":
      return [
        {
          type: "assistantDelta",
          itemId: notification.params.itemId,
          turnId: notification.params.turnId,
          delta: notification.params.delta,
          completeReasoning: true,
        },
      ];
    case "item/plan/delta":
      return [
        {
          type: "planDelta",
          itemId: notification.params.itemId,
          turnId: notification.params.turnId,
          delta: notification.params.delta,
        },
      ];
    case "turn/plan/updated":
      return [
        {
          type: "taskProgressUpdated",
          item: taskProgressThreadStreamItem(notification.params.turnId, notification.params.explanation, notification.params.plan),
        },
      ];
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return [
        {
          type: "textDelta",
          itemId: notification.params.itemId,
          turnId: notification.params.turnId,
          label: "reasoning",
          delta: notification.params.delta,
          kind: "reasoning",
          source: notification.method === "item/reasoning/textDelta" ? "body" : "summary",
        },
      ];
    case "item/reasoning/summaryPartAdded":
      return [
        {
          type: "textDelta",
          itemId: notification.params.itemId,
          turnId: notification.params.turnId,
          label: "reasoning",
          delta: "",
          kind: "reasoning",
          source: "summary",
        },
      ];
    case "item/started":
      return startedItemFacts(notification.params.item, notification.params.turnId);
    case "item/completed":
      return completedItemFacts(notification.params.item, notification.params.turnId);
    case "item/commandExecution/outputDelta":
      return [
        {
          type: "itemOutputDelta",
          itemId: notification.params.itemId,
          turnId: notification.params.turnId,
          delta: notification.params.delta,
          kind: "command",
          fallbackText: STREAMED_COMMAND_RUNNING_TEXT,
        },
      ];
    case "item/fileChange/patchUpdated":
      return [
        {
          type: "itemContentUpdated",
          item: fileChangeItem(notification.params.itemId, notification.params.turnId, notification.params.changes, "inProgress"),
        },
      ];
    case "turn/diff/updated":
      return [{ type: "turnDiffUpdated", turnId: notification.params.turnId, diff: notification.params.diff }];
    case "hook/started":
      return hookRunFacts(notification.params.run, notification.params.turnId, "running");
    case "hook/completed":
      return hookRunFacts(notification.params.run, notification.params.turnId, notification.params.run.status);
    case "item/mcpToolCall/progress":
      return [
        {
          type: "toolOutputDelta",
          itemId: notification.params.itemId,
          turnId: notification.params.turnId,
          delta: notification.params.message,
          fallbackLabel: STREAMED_MCP_PROGRESS_LABEL,
        },
      ];
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
      return [{ type: "autoReviewUpdated", item: createAutoReviewResultItem(notification.params) }];
    case "guardianWarning":
      return [{ type: "reviewWarning", item: createReviewResultItem(localItemId("review"), notification.params.message) }];
    case "turn/started":
      return [
        {
          type: "turnStarted",
          threadId: notification.params.threadId,
          turnId: notification.params.turn.id,
        },
      ];
    case "turn/completed":
      return [
        {
          type: "turnCompleted",
          threadId: notification.params.threadId,
          turnId: notification.params.turn.id,
          status: notification.params.turn.status,
          itemsView: notification.params.turn.itemsView,
          completedItems: threadStreamItemsFromTurns([notification.params.turn]),
          completedTurnTranscriptSummary: completedTurnTranscriptSummaryFromAppServerTurn(notification.params.turn),
        },
      ];
    case "serverRequest/resolved":
      return [{ type: "requestResolved", requestId: notification.params.requestId }];
    case "model/rerouted":
    case "deprecationNotice":
    case "error":
    case "warning":
    case "configWarning":
    case "windows/worldWritableWarning":
      return [jsonNoticeFact(notification, localItemId)];
    case "windowsSandbox/setupCompleted":
      return notification.params.success ? [] : [jsonNoticeFact(notification, localItemId)];
  }
}

function startedItemFacts(item: AppServerTurnItem, turnId: string): readonly TurnRuntimeFact[] {
  if (item.type === "userMessage") {
    const streamItem = threadStreamItemFromTurnItem(item, turnId);
    return streamItem?.kind === "dialogue" ? [{ type: "userMessageObserved", item: streamItem }] : [];
  }
  if (shouldSuppressLifecycleItem(item)) return [];
  const streamItem = threadStreamItemFromTurnItem(item, turnId);
  return streamItem ? [{ type: "itemStarted", item: streamItem }] : [];
}

function completedItemFacts(item: AppServerTurnItem, turnId: string): readonly TurnRuntimeFact[] {
  if (item.type === "userMessage") return [];
  const streamItem = threadStreamItemFromTurnItem(item, turnId);
  return streamItem ? [{ type: "itemCompleted", turnId, item: streamItem }] : [];
}

function fileChangeItem(itemId: string, turnId: string, changes: readonly AppServerFileChange[], status: string): ThreadStreamItem {
  return streamingFileChangeThreadStreamItem(itemId, turnId, normalizeFileChanges(changes), status);
}

function hookRunFacts(
  run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
  turnId: string | null,
  status: string,
): readonly TurnRuntimeFact[] {
  const item = hookRunThreadStreamItem(run, turnId, status);
  return item ? [{ type: "hookRunObserved", item, turnId, eventName: run.eventName }] : [];
}

function jsonNoticeFact(notification: UserVisibleNoticeNotification, localItemId: (prefix: string) => string): TurnRuntimeFact {
  return {
    type: "systemNotice",
    item: createSystemItem(localItemId("system"), `${notification.method}: ${jsonPreview(notification.params)}`),
  };
}
