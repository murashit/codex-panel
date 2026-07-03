import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { jsonPreview } from "../../../../domain/display/json-preview";
import type { ConversationRuntimeEvent } from "../../application/conversation/runtime-events";
import {
  STREAMED_COMMAND_RUNNING_TEXT,
  STREAMED_FILE_CHANGE_IN_PROGRESS_TEXT,
  STREAMED_MCP_PROGRESS_LABEL,
} from "../../domain/message-stream/factories/streaming-items";
import { createSystemItem } from "../../domain/message-stream/factories/system-items";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import {
  type AppServerFileChange,
  normalizeFileChanges,
  streamingFileChangeMessageStreamItem,
} from "../mappers/message-stream/file-changes";
import { hookRunMessageStreamItem } from "../mappers/message-stream/hook-run-items";
import { createAutoReviewResultItem, createReviewResultItem } from "../mappers/message-stream/review-result-items";
import { taskProgressMessageStreamItem } from "../mappers/message-stream/task-progress";
import {
  type AppServerTurnItem,
  completedConversationSummaryFromAppServerTurn,
  messageStreamItemFromTurnItem,
  messageStreamItemsFromTurns,
  shouldSuppressLifecycleItem,
} from "../mappers/message-stream/turn-items";
import type { StreamUpdateNotification, TurnLifecycleNotification, UserVisibleNoticeNotification } from "./notification-routing";

const MESSAGE_CONTEXT_COMPACTED = "Context compacted.";

type RuntimeEventSource =
  | StreamUpdateNotification
  | TurnLifecycleNotification
  | Extract<ServerNotification, { method: "serverRequest/resolved" }>
  | UserVisibleNoticeNotification;

export function conversationRuntimeEventsFromNotification(
  notification: RuntimeEventSource,
  localItemId: (prefix: string) => string,
): readonly ConversationRuntimeEvent[] {
  switch (notification.method) {
    case "item/agentMessage/delta":
      return [
        {
          type: "assistantDelta",
          itemId: notification.params.itemId,
          runId: notification.params.turnId,
          delta: notification.params.delta,
          completeReasoning: true,
        },
      ];
    case "item/plan/delta":
      return [
        {
          type: "planDelta",
          itemId: notification.params.itemId,
          runId: notification.params.turnId,
          delta: notification.params.delta,
        },
      ];
    case "turn/plan/updated":
      return [
        {
          type: "itemUpserted",
          item: taskProgressMessageStreamItem(notification.params.turnId, notification.params.explanation, notification.params.plan),
        },
      ];
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return [
        {
          type: "textDelta",
          itemId: notification.params.itemId,
          runId: notification.params.turnId,
          label: "reasoning",
          delta: notification.params.delta,
          kind: "reasoning",
        },
      ];
    case "item/reasoning/summaryPartAdded":
      return [
        {
          type: "textDelta",
          itemId: notification.params.itemId,
          runId: notification.params.turnId,
          label: "reasoning",
          delta: "",
          kind: "reasoning",
        },
      ];
    case "item/started":
      return startedItemEvents(notification.params.item, notification.params.turnId);
    case "item/completed":
      return completedItemEvents(notification.params.item, notification.params.turnId);
    case "item/commandExecution/outputDelta":
      return [
        {
          type: "itemOutputDelta",
          itemId: notification.params.itemId,
          runId: notification.params.turnId,
          delta: notification.params.delta,
          kind: "command",
          fallbackText: STREAMED_COMMAND_RUNNING_TEXT,
        },
      ];
    case "item/fileChange/patchUpdated":
      return [
        {
          type: "itemUpserted",
          item: fileChangeItem(notification.params.itemId, notification.params.turnId, notification.params.changes, "inProgress"),
        },
      ];
    case "item/fileChange/outputDelta":
      return [
        {
          type: "itemOutputDelta",
          itemId: notification.params.itemId,
          runId: notification.params.turnId,
          delta: notification.params.delta,
          kind: "fileChange",
          fallbackText: STREAMED_FILE_CHANGE_IN_PROGRESS_TEXT,
        },
      ];
    case "turn/diff/updated":
      return [{ type: "turnDiffUpdated", runId: notification.params.turnId, diff: notification.params.diff }];
    case "hook/started":
      return hookRunEvents(notification.params.run, notification.params.turnId, "running");
    case "hook/completed":
      return hookRunEvents(notification.params.run, notification.params.turnId, notification.params.run.status);
    case "item/mcpToolCall/progress":
      return [
        {
          type: "toolOutputDelta",
          itemId: notification.params.itemId,
          runId: notification.params.turnId,
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
          type: "runStarted",
          threadId: notification.params.threadId,
          runId: notification.params.turn.id,
          recencyAt: notification.params.turn.startedAt,
        },
      ];
    case "turn/completed":
      return [
        {
          type: "runCompleted",
          threadId: notification.params.threadId,
          runId: notification.params.turn.id,
          status: notification.params.turn.status,
          completedItems: messageStreamItemsFromTurns([notification.params.turn]),
          completedSummary: completedConversationSummaryFromAppServerTurn(notification.params.turn),
        },
      ];
    case "serverRequest/resolved":
      return [{ type: "requestResolved", requestId: notification.params.requestId }];
    case "thread/compacted":
      return [{ type: "systemNotice", item: createSystemItem(localItemId("system"), MESSAGE_CONTEXT_COMPACTED) }];
    case "model/rerouted":
    case "deprecationNotice":
    case "error":
    case "warning":
    case "configWarning":
    case "windows/worldWritableWarning":
      return [jsonNoticeEvent(notification, localItemId)];
    case "windowsSandbox/setupCompleted":
      return notification.params.success ? [] : [jsonNoticeEvent(notification, localItemId)];
  }
}

function startedItemEvents(item: AppServerTurnItem, runId: string): readonly ConversationRuntimeEvent[] {
  if (shouldSuppressLifecycleItem(item)) return [];
  const streamItem = messageStreamItemFromTurnItem(item, runId);
  return streamItem ? [{ type: "itemUpserted", item: streamItem }] : [];
}

function completedItemEvents(item: AppServerTurnItem, runId: string): readonly ConversationRuntimeEvent[] {
  if (item.type === "userMessage") return [];
  const streamItem = messageStreamItemFromTurnItem(item, runId);
  return streamItem ? [{ type: "itemCompleted", runId, item: streamItem }] : [];
}

function fileChangeItem(itemId: string, runId: string, changes: readonly AppServerFileChange[], status: string): MessageStreamItem {
  return streamingFileChangeMessageStreamItem(itemId, runId, normalizeFileChanges(changes), status);
}

function hookRunEvents(
  run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
  runId: string | null,
  status: string,
): readonly ConversationRuntimeEvent[] {
  const item = hookRunMessageStreamItem(run, runId, status);
  return item ? [{ type: "hookRunObserved", item, runId, eventName: run.eventName }] : [];
}

function jsonNoticeEvent(
  notification: Extract<UserVisibleNoticeNotification, { method: Exclude<UserVisibleNoticeNotification["method"], "thread/compacted"> }>,
  localItemId: (prefix: string) => string,
): ConversationRuntimeEvent {
  return {
    type: "systemNotice",
    item: createSystemItem(localItemId("system"), `${notification.method}: ${jsonPreview(notification.params)}`),
  };
}
