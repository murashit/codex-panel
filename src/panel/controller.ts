import { approvalResponse, type ApprovalAction, type PendingApproval } from "../approvals/model";
import { planProgressDisplayItem } from "../display/plan";
import { createAutoReviewResultItem, createReviewResultItem } from "../display/review";
import {
  appendAssistantDelta,
  appendItemOutput,
  appendItemText,
  appendPlanDelta,
  appendToolOutput,
  completeReasoningItems,
  upsertDisplayItem,
} from "../display/stream-updates";
import { createStructuredSystemItem, createSystemItem } from "../display/system";
import {
  displayItemFromThreadItem,
  displayItemsFromTurns,
  normalizeFileChanges,
  shouldSuppressLifecycleItem,
  shouldSuppressThreadItem,
} from "../display/thread-items";
import type { DisplayDetailSection, DisplayItem, DisplayKind, MessageDisplayItem } from "../display/types";
import type { RequestId } from "../generated/app-server/RequestId";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { ServerRequest } from "../generated/app-server/ServerRequest";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import { clearActiveThreadState, type PanelState } from "./state";
import { userInputResponse, type PendingUserInput } from "../user-input/model";
import { jsonPreview } from "../utils";
import { classifyAppServerLog } from "./app-server-logs";
import { attachHookRunsToTurn, hookRunDisplayItem } from "./hook-display";
import { routeServerNotification, routeServerRequest } from "./inbound-routing";
import { clearUserInputDrafts, createApprovalResultItem, createUserInputResultItem } from "./request-state";

export interface PanelControllerActions {
  refreshThreads: () => void;
  refreshSkills: (forceReload?: boolean) => void;
  maybeNameThread: (threadId: string, turn: Turn) => void;
  recordMcpStartupStatus: (name: string, status: "starting" | "ready" | "failed" | "cancelled", message: string | null) => void;
  respondToServerRequest: (requestId: RequestId, result: unknown) => boolean;
  rejectServerRequest: (requestId: RequestId, code: number, message: string) => boolean;
}

export class PanelController {
  constructor(
    private readonly state: PanelState,
    private readonly actions: PanelControllerActions,
  ) {}

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
    this.state.approvals = this.state.approvals.filter((item) => item.requestId !== approval.requestId);
    this.state.displayItems.push(createApprovalResultItem(approval, action));
  }

  resolveUserInput(input: PendingUserInput, answers: Record<string, string>): void {
    if (!this.state.pendingUserInputs.some((item) => item.requestId === input.requestId)) return;
    if (!this.actions.respondToServerRequest(input.requestId, userInputResponse(input, answers))) {
      this.addSystemMessage("Could not send user input because Codex app-server is not connected.");
      return;
    }
    this.state.pendingUserInputs = this.state.pendingUserInputs.filter((item) => item.requestId !== input.requestId);
    clearUserInputDrafts(this.state.userInputDrafts, input);
    this.state.displayItems.push(createUserInputResultItem(input, answers, "submitted"));
  }

  cancelUserInput(input: PendingUserInput): void {
    if (!this.state.pendingUserInputs.some((item) => item.requestId === input.requestId)) return;
    if (!this.actions.rejectServerRequest(input.requestId, -32000, "User cancelled input request.")) {
      this.addSystemMessage("Could not cancel user input because Codex app-server is not connected.");
      return;
    }
    this.state.pendingUserInputs = this.state.pendingUserInputs.filter((item) => item.requestId !== input.requestId);
    clearUserInputDrafts(this.state.userInputDrafts, input);
    this.state.displayItems.push(createUserInputResultItem(input, {}, "cancelled"));
  }

  addSystemMessage(text: string): void {
    this.state.displayItems.push(createSystemItem(text));
  }

  addStructuredSystemMessage(text: string, details: DisplayDetailSection[]): void {
    this.state.displayItems.push(createStructuredSystemItem(text, details));
  }

  addDedupedSystemMessage(text: string): void {
    if (this.state.reportedLogs.has(text)) return;
    this.state.reportedLogs.add(text);
    this.addSystemMessage(text);
  }

  private handleStreamUpdate(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "item/agentMessage/delta") {
      this.state.displayItems = completeReasoningItems(this.state.displayItems, params.turnId);
      this.state.displayItems = appendAssistantDelta(this.state.displayItems, params.itemId, params.turnId, params.delta);
    } else if (method === "item/plan/delta") {
      this.state.displayItems = appendPlanDelta(this.state.displayItems, params.itemId, params.turnId, params.delta);
    } else if (method === "turn/plan/updated") {
      this.state.displayItems = upsertDisplayItem(
        this.state.displayItems,
        planProgressDisplayItem(params.turnId, params.explanation, params.plan),
      );
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
      this.state.displayItems = appendItemOutput(
        this.state.displayItems,
        params.itemId,
        params.turnId,
        params.delta,
        "command",
        "Command running",
      );
    } else if (method === "item/fileChange/patchUpdated") {
      this.upsertFileChange(params.itemId, params.turnId, params.changes, "inProgress");
    } else if (method === "item/fileChange/outputDelta") {
      this.state.displayItems = appendItemOutput(
        this.state.displayItems,
        params.itemId,
        params.turnId,
        params.delta,
        "fileChange",
        "File change inProgress",
      );
    } else if (method === "turn/diff/updated") {
      if (params.diff.trim().length > 0) {
        this.state.turnDiffs.set(params.turnId, params.diff);
      } else {
        this.state.turnDiffs.delete(params.turnId);
      }
    } else if (method === "hook/started") {
      this.upsertHookRun(params.run, params.turnId, "running");
    } else if (method === "hook/completed") {
      this.upsertHookRun(params.run, params.turnId, params.run.status);
    } else if (method === "item/mcpToolCall/progress") {
      this.state.displayItems = appendToolOutput(this.state.displayItems, params.itemId, params.turnId, params.message, "mcp progress");
    } else if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
      const reviewItem = createAutoReviewResultItem(params);
      this.state.displayItems = upsertDisplayItem(removeUnstructuredAutoReviewWarnings(this.state.displayItems), reviewItem);
    } else if (method === "guardianWarning") {
      const item = createReviewResultItem(params.message);
      if (!isUnstructuredAutoReviewWarning(item) || !hasStructuredAutoReviewResult(this.state.displayItems, this.state.activeTurnId)) {
        this.state.displayItems = upsertDisplayItem(this.state.displayItems, item);
      }
    }
  }

  private handleTurnLifecycle(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "turn/started") {
      this.state.activeThreadId = params.threadId;
      this.state.activeTurnId = params.turn.id;
      this.attachPendingPromptSubmitHooks(params.turn.id);
      this.state.busy = true;
      this.state.status = "Turn running...";
    } else if (method === "turn/completed") {
      this.reconcileCompletedTurn(params.turn);
      this.state.displayItems = completeReasoningItems(this.state.displayItems, params.turn.id);
      this.state.busy = false;
      this.state.activeTurnId = null;
      this.state.status = `Turn ${params.turn.status}.`;
      this.actions.maybeNameThread(params.threadId, params.turn);
      this.actions.refreshThreads();
    }
  }

  private handleThreadLifecycle(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "thread/started") {
      if (!this.state.activeThreadId || this.state.activeThreadId === params.thread.id) {
        this.state.activeThreadCwd = params.thread.cwd;
      }
    } else if (method === "thread/archived") {
      this.state.listedThreads = this.state.listedThreads.filter((thread) => thread.id !== params.threadId);
      if (this.state.activeThreadId === params.threadId) {
        clearActiveThreadState(this.state);
      }
    } else if (method === "thread/unarchived") {
      this.actions.refreshThreads();
    } else if (method === "thread/name/updated") {
      const name = typeof params.threadName === "string" && params.threadName.trim() ? params.threadName.trim() : null;
      this.state.listedThreads = this.state.listedThreads.map((thread) => (thread.id === params.threadId ? { ...thread, name } : thread));
      this.actions.refreshThreads();
    } else if (method === "thread/settings/updated") {
      this.applyThreadSettings(params.threadSettings);
    } else if (method === "thread/goal/updated") {
      this.addSystemMessage(`Thread goal updated: status ${params.goal.status}. Codex Panel does not support goals.`);
    } else if (method === "thread/goal/cleared") {
      this.addSystemMessage("Thread goal cleared. Codex Panel does not support goals.");
    }
  }

  private handleRequestResolved(notification: Extract<ServerNotification, { method: "serverRequest/resolved" }>): void {
    const { requestId } = notification.params;
    this.state.approvals = this.state.approvals.filter((approval) => approval.requestId !== requestId);
    const resolvedInputs = this.state.pendingUserInputs.filter((input) => input.requestId === requestId);
    this.state.pendingUserInputs = this.state.pendingUserInputs.filter((input) => input.requestId !== requestId);
    for (const input of resolvedInputs) clearUserInputDrafts(this.state.userInputDrafts, input);
  }

  private handleDiagnosticStatus(notification: ServerNotification): void {
    const { method, params } = notification;
    if (method === "thread/tokenUsage/updated") {
      this.state.tokenUsage = params.tokenUsage;
    } else if (method === "account/rateLimits/updated") {
      this.state.rateLimit = params.rateLimits;
    } else if (method === "skills/changed") {
      this.actions.refreshSkills(true);
    } else if (method === "mcpServer/startupStatus/updated") {
      this.handleMcpStartupStatus(params);
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
    if (!this.state.approvals.some((existing) => existing.requestId === approval.requestId)) {
      this.state.approvals.push(approval);
    }
  }

  private queueUserInputRequest(userInput: PendingUserInput): void {
    if (!this.state.pendingUserInputs.some((existing) => existing.requestId === userInput.requestId)) {
      this.state.pendingUserInputs.push(userInput);
    }
  }

  private activeRouteScope(): { activeThreadId: string | null; activeTurnId: string | null } {
    return {
      activeThreadId: this.state.activeThreadId,
      activeTurnId: this.state.activeTurnId,
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
    if (shouldSuppressThreadItem(item) || shouldSuppressLifecycleItem(item)) return;
    const displayItem = displayItemFromThreadItem(item, turnId);
    if (displayItem) this.state.displayItems = upsertDisplayItem(this.state.displayItems, displayItem);
  }

  private handleCompletedItem(item: ThreadItem, turnId: string): void {
    if (shouldSuppressThreadItem(item) || item.type === "userMessage") return;
    const displayItem = displayItemFromThreadItem(item, turnId);
    if (displayItem) {
      this.state.displayItems = upsertDisplayItem(this.state.displayItems, displayItem);
      if (displayItem.kind === "reasoning") {
        this.state.displayItems = completeReasoningItems(this.state.displayItems, turnId);
      }
    }
  }

  private reconcileCompletedTurn(turn: Turn): void {
    const turnItems = displayItemsFromTurns([turn]);
    if (turnItems.length === 0) return;
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
    this.state.displayItems = [...retainedItems, ...mergedTurnItems];
  }

  private upsertFileChange(itemId: string, turnId: string, changes: unknown[], status: string): void {
    this.state.displayItems = upsertDisplayItem(this.state.displayItems, {
      id: itemId,
      kind: "fileChange",
      role: "tool",
      text: `File change ${status}`,
      turnId,
      itemId,
      status,
      changes: normalizeFileChanges(changes),
    });
  }

  private appendToolText(
    itemId: string,
    turnId: string,
    label: string,
    delta: string,
    kind: Extract<DisplayKind, "tool" | "hook" | "reasoning"> = "tool",
  ): void {
    this.state.displayItems = appendItemText(this.state.displayItems, itemId, turnId, label, delta, kind);
  }

  private upsertHookRun(
    run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
    turnId: string | null,
    status: string,
  ): void {
    const resolvedTurnId = this.hookRunTurnId(run, turnId);
    const item = hookRunDisplayItem(run, resolvedTurnId, status);
    if (!item) return;
    this.state.displayItems = upsertDisplayItem(this.state.displayItems, item);
    if (!resolvedTurnId && this.state.pendingTurnStart && run.eventName === "userPromptSubmit") {
      const hookIds = this.state.pendingTurnStart.promptSubmitHookItemIds;
      if (!hookIds.includes(item.id)) hookIds.push(item.id);
    }
  }

  private hookRunTurnId(
    run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
    turnId: string | null,
  ): string | null {
    if (turnId) return turnId;
    if (run.eventName === "userPromptSubmit" && !this.state.pendingTurnStart) return this.state.activeTurnId;
    return null;
  }

  private attachPendingPromptSubmitHooks(turnId: string): void {
    const pending = this.state.pendingTurnStart;
    if (!pending) return;
    this.state.displayItems = attachHookRunsToTurn(this.state.displayItems, turnId, pending.promptSubmitHookItemIds, pending.anchorItemId);
    this.state.pendingTurnStart = null;
  }

  private handleMcpStartupStatus(params: Extract<ServerNotification, { method: "mcpServer/startupStatus/updated" }>["params"]): void {
    if (params.name.length === 0) return;
    this.actions.recordMcpStartupStatus(params.name, params.status, params.error);
  }

  private applyThreadSettings(
    settings: Extract<ServerNotification, { method: "thread/settings/updated" }>["params"]["threadSettings"],
  ): void {
    this.state.activeThreadCwd = settings.cwd;
    this.state.activeModel = settings.model;
    this.state.activeReasoningEffort = settings.effort;
    this.state.activeCollaborationMode = settings.collaborationMode.mode;
    this.state.requestedCollaborationMode = settings.collaborationMode.mode;
    const nullableSettings: ThreadSettingsWithNullableReviewer = settings;
    const serviceTierOverride = this.state.activeServiceTierOverride || this.state.requestedServiceTier !== null;
    const approvalsReviewerOverride = this.state.activeApprovalsReviewerOverride || this.state.requestedApprovalsReviewer !== null;
    this.state.activeServiceTier = settings.serviceTier ?? (serviceTierOverride ? this.state.activeServiceTier : null);
    this.state.activeServiceTierOverride = serviceTierOverride;
    this.state.activeApprovalsReviewer =
      nullableSettings.approvalsReviewer ?? (approvalsReviewerOverride ? this.state.activeApprovalsReviewer : null);
    this.state.activeApprovalsReviewerOverride = approvalsReviewerOverride;
  }
}

type ThreadSettings = Extract<ServerNotification, { method: "thread/settings/updated" }>["params"]["threadSettings"];
type ThreadSettingsWithNullableReviewer = Omit<ThreadSettings, "approvalsReviewer"> & {
  approvalsReviewer: ThreadSettings["approvalsReviewer"] | null;
};

function removeUnstructuredAutoReviewWarnings(items: DisplayItem[]): DisplayItem[] {
  return items.filter((item) => !isUnstructuredAutoReviewWarning(item));
}

function hasStructuredAutoReviewResult(items: DisplayItem[], activeTurnId: string | null): boolean {
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
