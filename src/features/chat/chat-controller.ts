import { approvalResponse, type ApprovalAction, type PendingApproval } from "./approvals/model";
import { reportedServiceTier } from "../../app-server/service-tier";
import { planProgressDisplayItem } from "./display/plan";
import { createAutoReviewResultItem, createReviewResultItem } from "./display/review";
import {
  appendAssistantDelta,
  appendItemOutput,
  appendItemText,
  appendPlanDelta,
  appendToolOutput,
  completeReasoningItems,
  upsertDisplayItem,
} from "./display/stream-updates";
import { createStructuredSystemItem, createSystemItem } from "./display/system";
import {
  displayItemFromThreadItem,
  displayItemsFromTurns,
  normalizeFileChanges,
  shouldSuppressLifecycleItem,
} from "./display/thread-items";
import type { DisplayDetailSection, DisplayItem, DisplayKind, MessageDisplayItem } from "./display/types";
import type { RequestId } from "../../generated/app-server/RequestId";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import type { FileUpdateChange } from "../../generated/app-server/v2/FileUpdateChange";
import type { ThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn } from "../../generated/app-server/v2/Turn";
import {
  activeTurnId,
  pendingTurnStart as pendingTurnStartForState,
  type ChatAction,
  type ChatState,
  type ChatStateStore,
} from "./chat-state";
import { userInputResponse, type PendingUserInput } from "./user-input/model";
import { jsonPreview } from "../../utils";
import { classifyAppServerLog } from "./app-server-logs";
import { attachHookRunsToTurn, hookRunDisplayItem } from "./hook-display";
import { routeServerNotification, routeServerRequest } from "./inbound-routing";
import { createApprovalResultItem, createUserInputResultItem } from "./request-state";

export interface ChatControllerActions {
  refreshThreads: () => void;
  refreshSkills: (forceReload?: boolean) => void;
  publishAppServerMetadata: () => void;
  maybeNameThread: (threadId: string, turn: Turn) => void;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string | null) => void;
  recordMcpStartupStatus: (name: string, status: "starting" | "ready" | "failed" | "cancelled", message: string | null) => void;
  respondToServerRequest: (requestId: RequestId, result: unknown) => boolean;
  rejectServerRequest: (requestId: RequestId, code: number, message: string) => boolean;
}

export class ChatController {
  constructor(
    private readonly store: ChatStateStore,
    private readonly actions: ChatControllerActions,
  ) {}

  private get state(): ChatState {
    return this.store.getState();
  }

  private dispatch(action: ChatAction): void {
    this.store.dispatch(action);
  }

  handleNotification(notification: ServerNotification): void {
    const route = routeServerNotification(notification, this.activeRouteScope());
    switch (route.kind) {
      case "inactive":
      case "unhandled":
        return;
      case "streamUpdate":
        this.handleStreamUpdate(route.notification);
        return;
      case "turnLifecycle":
        this.handleTurnLifecycle(route.notification);
        return;
      case "threadLifecycle":
        this.handleThreadLifecycle(route.notification);
        return;
      case "requestResolved":
        this.handleRequestResolved(route.notification);
        return;
      case "diagnosticStatus":
        this.handleDiagnosticStatus(route.notification);
        return;
      case "userVisibleNotice":
        this.handleUserVisibleNotice(route.notification);
        return;
    }
  }

  handleServerRequest(request: ServerRequest): void {
    const route = routeServerRequest(request, this.activeRouteScope());
    switch (route.kind) {
      case "approval":
        this.queueApprovalRequest(route.approval);
        return;
      case "userInput":
        this.queueUserInputRequest(route.input);
        return;
      case "inactive":
        this.rejectServerRequest(request, `Rejected inactive app-server request: ${request.method}`);
        return;
      case "unsupported":
        this.rejectUnsupportedServerRequest(request);
        return;
    }
  }

  handleAppServerLog(message: string): void {
    const classified = classifyAppServerLog(message);
    if (classified === null) return;
    if (classified.kind === "plain") {
      this.addDedupedSystemMessage(classified.text);
    } else {
      this.addDedupedSystemMessage(`app-server error: ${classified.text}`);
    }
  }

  resolveApproval(approval: PendingApproval, action: ApprovalAction): void {
    if (!this.state.approvals.some((item) => item.requestId === approval.requestId)) return;
    if (!this.actions.respondToServerRequest(approval.requestId, approvalResponse(approval, action))) {
      this.addSystemMessage("Could not send approval response because Codex app-server is not connected.");
      return;
    }
    this.dispatch({ type: "request/resolved", requestId: approval.requestId, resultItem: createApprovalResultItem(approval, action) });
  }

  resolveUserInput(input: PendingUserInput, answers: Record<string, string>): void {
    if (!this.state.pendingUserInputs.some((item) => item.requestId === input.requestId)) return;
    if (!this.actions.respondToServerRequest(input.requestId, userInputResponse(input, answers))) {
      this.addSystemMessage("Could not send user input because Codex app-server is not connected.");
      return;
    }
    this.dispatch({
      type: "request/resolved",
      requestId: input.requestId,
      resultItem: createUserInputResultItem(input, answers, "submitted"),
    });
  }

  cancelUserInput(input: PendingUserInput): void {
    if (!this.state.pendingUserInputs.some((item) => item.requestId === input.requestId)) return;
    if (!this.actions.rejectServerRequest(input.requestId, -32000, "User cancelled input request.")) {
      this.addSystemMessage("Could not cancel user input because Codex app-server is not connected.");
      return;
    }
    this.dispatch({ type: "request/resolved", requestId: input.requestId, resultItem: createUserInputResultItem(input, {}, "cancelled") });
  }

  addSystemMessage(text: string): void {
    this.dispatch({ type: "system/message-added", item: createSystemItem(this.localItemId("system"), text) });
  }

  addStructuredSystemMessage(text: string, details: DisplayDetailSection[]): void {
    this.dispatch({ type: "system/message-added", item: createStructuredSystemItem(this.localItemId("system"), text, details) });
  }

  addDedupedSystemMessage(text: string): void {
    this.dispatch({ type: "system/deduped-log-added", text, item: createSystemItem(this.localItemId("system"), text) });
  }

  private handleStreamUpdate(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "item/agentMessage/delta") {
      const displayItems = appendAssistantDelta(
        completeReasoningItems(this.state.displayItems, params.turnId),
        params.itemId,
        params.turnId,
        params.delta,
      );
      this.dispatch({ type: "display/items-replaced", items: displayItems });
    } else if (method === "item/plan/delta") {
      this.dispatch({
        type: "display/items-replaced",
        items: appendPlanDelta(this.state.displayItems, params.itemId, params.turnId, params.delta),
      });
    } else if (method === "turn/plan/updated") {
      this.dispatch({ type: "display/item-upserted", item: planProgressDisplayItem(params.turnId, params.explanation, params.plan) });
    } else if (method === "item/reasoning/summaryTextDelta") {
      this.appendToolText(params.itemId, params.turnId, "reasoning", params.delta, "reasoning");
    } else if (method === "item/reasoning/textDelta") {
      this.appendToolText(params.itemId, params.turnId, "reasoning", params.delta, "reasoning");
    } else if (method === "item/reasoning/summaryPartAdded") {
      this.appendToolText(params.itemId, params.turnId, "reasoning", "", "reasoning");
    } else if (method === "item/started") {
      this.handleStartedItem(params.item, params.turnId);
    } else if (method === "item/completed") {
      this.handleCompletedItem(params.item, params.turnId);
    } else if (method === "item/commandExecution/outputDelta") {
      this.dispatch({
        type: "display/items-replaced",
        items: appendItemOutput(this.state.displayItems, params.itemId, params.turnId, params.delta, "command", "Command running"),
      });
    } else if (method === "item/fileChange/patchUpdated") {
      this.upsertFileChange(params.itemId, params.turnId, params.changes, "inProgress");
    } else if (method === "item/fileChange/outputDelta") {
      this.dispatch({
        type: "display/items-replaced",
        items: appendItemOutput(
          this.state.displayItems,
          params.itemId,
          params.turnId,
          params.delta,
          "fileChange",
          "File change inProgress",
        ),
      });
    } else if (method === "turn/diff/updated") {
      this.dispatch({ type: "display/turn-diff-updated", turnId: params.turnId, diff: params.diff });
    } else if (method === "hook/started") {
      this.upsertHookRun(params.run, params.turnId, "running");
    } else if (method === "hook/completed") {
      this.upsertHookRun(params.run, params.turnId, params.run.status);
    } else if (method === "item/mcpToolCall/progress") {
      this.dispatch({
        type: "display/items-replaced",
        items: appendToolOutput(this.state.displayItems, params.itemId, params.turnId, params.message, "mcp progress"),
      });
    } else if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
      const reviewItem = createAutoReviewResultItem(params);
      this.dispatch({
        type: "display/items-replaced",
        items: upsertDisplayItem(removeUnstructuredAutoReviewWarnings(this.state.displayItems), reviewItem),
      });
    } else if (method === "guardianWarning") {
      const item = createReviewResultItem(this.localItemId("review"), params.message);
      if (!isUnstructuredAutoReviewWarning(item) || !hasStructuredAutoReviewResult(this.state.displayItems, activeTurnId(this.state))) {
        this.dispatch({ type: "display/item-upserted", item });
      }
    }
  }

  private handleTurnLifecycle(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "turn/started") {
      this.dispatch({
        type: "turn/started",
        threadId: params.threadId,
        turnId: params.turn.id,
        displayItems: this.displayItemsWithPendingPromptSubmitHooks(params.turn.id),
      });
    } else if (method === "turn/completed") {
      if (activeTurnId(this.state) !== params.turn.id) return;
      this.dispatch({
        type: "turn/completed",
        turnId: params.turn.id,
        status: params.turn.status,
        displayItems: completeReasoningItems(this.reconciledCompletedTurnItems(params.turn), params.turn.id),
      });
      this.actions.maybeNameThread(params.threadId, params.turn);
      this.actions.refreshThreads();
    }
  }

  private handleThreadLifecycle(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "thread/started") {
      if (!this.state.activeThreadId || this.state.activeThreadId === params.thread.id) {
        this.dispatch({ type: "thread/cwd-set", cwd: params.thread.cwd });
      }
    } else if (method === "thread/archived") {
      this.dispatch({ type: "thread/list-applied", threads: this.state.listedThreads.filter((thread) => thread.id !== params.threadId) });
      if (this.state.activeThreadId === params.threadId) {
        this.dispatch({ type: "thread/active-cleared" });
      }
      this.actions.notifyThreadArchived(params.threadId);
    } else if (method === "thread/unarchived") {
      this.actions.refreshThreads();
    } else if (method === "thread/name/updated") {
      const name = typeof params.threadName === "string" && params.threadName.trim() ? params.threadName.trim() : null;
      this.dispatch({
        type: "thread/list-applied",
        threads: this.state.listedThreads.map((thread) => (thread.id === params.threadId ? { ...thread, name } : thread)),
      });
      this.actions.notifyThreadRenamed(params.threadId, name);
    } else if (method === "thread/settings/updated") {
      if (this.state.activeThreadId !== params.threadId) return;
      this.applyThreadSettings(params.threadSettings);
    } else if (method === "thread/goal/updated") {
      this.addSystemMessage(`Thread goal updated: status ${params.goal.status}. Codex Panel does not support goals.`);
    } else if (method === "thread/goal/cleared") {
      this.addSystemMessage("Thread goal cleared. Codex Panel does not support goals.");
    }
  }

  private handleRequestResolved(notification: Extract<ServerNotification, { method: "serverRequest/resolved" }>): void {
    const { requestId } = notification.params;
    this.dispatch({ type: "request/resolved", requestId });
  }

  private handleDiagnosticStatus(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "thread/tokenUsage/updated") {
      this.dispatch({ type: "thread/token-usage-set", tokenUsage: params.tokenUsage });
    } else if (method === "account/rateLimits/updated") {
      this.dispatch({ type: "thread/list-applied", rateLimit: params.rateLimits });
      this.actions.publishAppServerMetadata();
    } else if (method === "skills/changed") {
      this.actions.refreshSkills(true);
    } else if (method === "mcpServer/startupStatus/updated") {
      this.handleMcpStartupStatus(params);
      this.actions.publishAppServerMetadata();
    }
  }

  private handleUserVisibleNotice(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "thread/compacted") {
      this.addSystemMessage("Context compacted.");
    } else if (method === "model/rerouted" || method === "deprecationNotice") {
      this.addSystemMessage(`${method}: ${jsonPreview(params)}`);
    } else if (method === "error" || method === "warning" || method === "configWarning") {
      this.addSystemMessage(`${method}: ${jsonPreview(params)}`);
    }
  }

  private queueApprovalRequest(approval: PendingApproval): void {
    this.dispatch({ type: "request/approval-queued", approval });
  }

  private queueUserInputRequest(userInput: PendingUserInput): void {
    this.dispatch({ type: "request/user-input-queued", input: userInput });
  }

  private activeRouteScope(): { activeThreadId: string | null; activeTurnId: string | null } {
    return {
      activeThreadId: this.state.activeThreadId,
      activeTurnId: activeTurnId(this.state),
    };
  }

  private rejectUnsupportedServerRequest(request: ServerRequest): void {
    const message = `Rejected unsupported app-server request: ${request.method}`;
    this.rejectServerRequest(request, message);
  }

  private rejectServerRequest(request: ServerRequest, message: string): void {
    this.addSystemMessage(message);
    if (!this.actions.rejectServerRequest(request.id, -32601, message)) {
      this.addSystemMessage("Could not reject app-server request because Codex app-server is not connected.");
    }
  }

  private handleStartedItem(item: ThreadItem, turnId: string): void {
    if (shouldSuppressLifecycleItem(item)) return;
    const displayItem = displayItemFromThreadItem(item, turnId);
    if (displayItem) this.dispatch({ type: "display/item-upserted", item: displayItem });
  }

  private handleCompletedItem(item: ThreadItem, turnId: string): void {
    if (item.type === "userMessage") return;
    const displayItem = displayItemFromThreadItem(item, turnId);
    if (displayItem) {
      let displayItems = upsertDisplayItem(this.state.displayItems, displayItem);
      if (displayItem.kind === "reasoning") {
        displayItems = completeReasoningItems(displayItems, turnId);
      }
      this.dispatch({ type: "display/items-replaced", items: displayItems });
    }
  }

  private reconciledCompletedTurnItems(turn: Turn): readonly DisplayItem[] {
    const turnItems = displayItemsFromTurns([turn]);
    if (turnItems.length === 0) return this.state.displayItems;
    const serverUserTexts = new Set(turnItems.filter(isUserMessage).map((item) => item.text));
    let mergedTurnItems = this.state.displayItems
      .filter((item) => item.turnId === turn.id)
      .filter((item) => !isOptimisticUserMessage(item, serverUserTexts));
    for (const item of turnItems) {
      mergedTurnItems = upsertDisplayItem(mergedTurnItems, item);
    }
    const retainedItems = this.state.displayItems
      .filter((item) => item.turnId !== turn.id)
      .filter((item) => !isOptimisticUserMessage(item, serverUserTexts));
    return [...retainedItems, ...mergedTurnItems];
  }

  private upsertFileChange(itemId: string, turnId: string, changes: FileUpdateChange[], status: string): void {
    this.dispatch({
      type: "display/item-upserted",
      item: {
        id: itemId,
        kind: "fileChange",
        role: "tool",
        text: `File change ${status}`,
        turnId,
        itemId,
        status,
        changes: normalizeFileChanges(changes),
      },
    });
  }

  private appendToolText(
    itemId: string,
    turnId: string,
    label: string,
    delta: string,
    kind: Extract<DisplayKind, "tool" | "hook" | "reasoning"> = "tool",
  ): void {
    this.dispatch({ type: "display/items-replaced", items: appendItemText(this.state.displayItems, itemId, turnId, label, delta, kind) });
  }

  private upsertHookRun(
    run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
    turnId: string | null,
    status: string,
  ): void {
    const resolvedTurnId = this.hookRunTurnId(run, turnId);
    const item = hookRunDisplayItem(run, resolvedTurnId, status);
    if (!item) return;
    const currentPendingTurnStart = pendingTurnStartForState(this.state);
    let pendingTurnStart = currentPendingTurnStart;
    if (!resolvedTurnId && currentPendingTurnStart && run.eventName === "userPromptSubmit") {
      const hookIds = currentPendingTurnStart.promptSubmitHookItemIds;
      pendingTurnStart = hookIds.includes(item.id)
        ? currentPendingTurnStart
        : { ...currentPendingTurnStart, promptSubmitHookItemIds: [...hookIds, item.id] };
    }
    this.dispatch({
      type: "display/pending-turn-item-upserted",
      item,
      pendingTurnStart,
    });
  }

  private hookRunTurnId(
    run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
    turnId: string | null,
  ): string | null {
    if (turnId) return turnId;
    if (run.eventName === "userPromptSubmit" && !pendingTurnStartForState(this.state)) return activeTurnId(this.state);
    return null;
  }

  private displayItemsWithPendingPromptSubmitHooks(turnId: string): readonly DisplayItem[] {
    const pending = pendingTurnStartForState(this.state);
    if (!pending) return this.state.displayItems;
    return attachHookRunsToTurn(this.state.displayItems, turnId, pending.promptSubmitHookItemIds, pending.anchorItemId);
  }

  private handleMcpStartupStatus(params: Extract<ServerNotification, { method: "mcpServer/startupStatus/updated" }>["params"]): void {
    if (params.name.length === 0) return;
    this.actions.recordMcpStartupStatus(params.name, params.status, params.error);
  }

  private applyThreadSettings(
    settings: Extract<ServerNotification, { method: "thread/settings/updated" }>["params"]["threadSettings"],
  ): void {
    this.dispatch({
      type: "thread/settings-applied",
      cwd: settings.cwd,
      model: settings.model,
      reasoningEffort: settings.effort,
      collaborationMode: settings.collaborationMode.mode,
      serviceTier: reportedServiceTier(settings.serviceTier),
      approvalPolicy: settings.approvalPolicy,
      approvalsReviewer: settings.approvalsReviewer,
      activePermissionProfile: settings.activePermissionProfile,
    });
  }

  private localItemId(prefix: string): string {
    return `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  }
}

function removeUnstructuredAutoReviewWarnings(items: readonly DisplayItem[]): DisplayItem[] {
  return items.filter((item) => !isUnstructuredAutoReviewWarning(item));
}

function hasStructuredAutoReviewResult(items: readonly DisplayItem[], activeTurnId: string | null): boolean {
  return items.some(
    (item) =>
      item.kind === "reviewResult" &&
      Boolean(item.turnId) &&
      (!activeTurnId || item.turnId === activeTurnId) &&
      isAutoReviewText(item.text),
  );
}

function isUnstructuredAutoReviewWarning(item: DisplayItem): boolean {
  return item.kind === "reviewResult" && !item.turnId && isAutoReviewText(item.text);
}

function isAutoReviewText(text: string): boolean {
  return /^Auto-review\b/i.test(text.trim());
}

function isUserMessage(item: DisplayItem): item is MessageDisplayItem & { role: "user" } {
  return item.kind === "message" && item.role === "user";
}

function isOptimisticUserMessage(item: DisplayItem, serverUserTexts: Set<string>): boolean {
  return isUserMessage(item) && (item.id.startsWith("local-user-") || item.id.startsWith("local-steer-")) && serverUserTexts.has(item.text);
}
