import { approvalResponse, approvalTitle, toPendingApproval, type ApprovalAction, type PendingApproval } from "../approvals/model";
import {
  appendAssistantDelta,
  appendItemOutput,
  appendItemText,
  appendPlanDelta,
  appendToolOutput,
  createAutoReviewResultItem,
  completeReasoningItems,
  createReviewResultItem,
  createSystemItem,
  displayItemFromThreadItem,
  displayItemsFromTurns,
  normalizeFileChanges,
  planProgressDisplayItem,
  shouldSuppressLifecycleItem,
  shouldSuppressThreadItem,
  upsertDisplayItem,
} from "../display/model";
import type { DisplayItem, DisplayKind, MessageDisplayItem } from "../display/types";
import type { RequestId } from "../generated/app-server/RequestId";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { ServerRequest } from "../generated/app-server/ServerRequest";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import { clearActiveThreadState, type PanelState } from "../state/panel-state";
import { toPendingUserInput, userInputResponse, type PendingUserInput } from "../user-input/model";
import { jsonPreview } from "../utils";
import { classifyAppServerLog } from "./app-server-logs";
import { hookRunDisplayItem } from "./hook-display";
import { clearUserInputDrafts, createUserInputResultItem } from "./request-state";

export interface PanelControllerActions {
  refreshThreads: () => void;
  maybeNameThread: (threadId: string, turn: Turn) => void;
  respondToServerRequest: (requestId: RequestId, result: unknown) => boolean;
  rejectServerRequest: (requestId: RequestId, code: number, message: string) => boolean;
}

export class PanelController {
  constructor(
    private readonly state: PanelState,
    private readonly actions: PanelControllerActions,
  ) {}

  handleNotification(notification: ServerNotification): void {
    if (!this.isInActiveScope(notification)) return;

    const { method, params } = notification;
    if (method === "turn/started") {
      this.state.activeThreadId = params.threadId;
      this.state.activeTurnId = params.turn.id ?? this.state.activeTurnId;
      this.state.busy = true;
      this.state.status = "Turn running...";
    } else if (method === "item/agentMessage/delta") {
      this.state.displayItems = completeReasoningItems(this.state.displayItems, params.turnId);
      this.state.displayItems = appendAssistantDelta(this.state.displayItems, params.itemId, params.turnId, params.delta ?? "");
    } else if (method === "item/plan/delta") {
      this.state.displayItems = appendPlanDelta(this.state.displayItems, params.itemId, params.turnId, params.delta ?? "");
    } else if (method === "turn/plan/updated") {
      this.state.displayItems = upsertDisplayItem(
        this.state.displayItems,
        planProgressDisplayItem(params.turnId, params.explanation ?? null, params.plan ?? []),
      );
    } else if (method === "item/reasoning/summaryTextDelta") {
      this.appendToolText(params.itemId, params.turnId, "reasoning", params.delta ?? "", "reasoning");
    } else if (method === "item/reasoning/textDelta") {
      this.appendToolText(params.itemId, params.turnId, "reasoning", params.delta ?? "", "reasoning");
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
        params.delta ?? "",
        "command",
        "Command running",
      );
    } else if (method === "item/fileChange/patchUpdated") {
      this.upsertFileChange(params.itemId, params.turnId, params.changes ?? [], "inProgress");
    } else if (method === "item/fileChange/outputDelta") {
      this.state.displayItems = appendItemOutput(
        this.state.displayItems,
        params.itemId,
        params.turnId,
        params.delta ?? "",
        "fileChange",
        "File change inProgress",
      );
    } else if (method === "turn/completed") {
      this.reconcileCompletedTurn(params.turn);
      this.state.displayItems = completeReasoningItems(this.state.displayItems, params.turn.id);
      this.state.busy = false;
      this.state.activeTurnId = null;
      this.state.status = `Turn ${params.turn.status ?? "completed"}.`;
      this.actions.maybeNameThread(params.threadId, params.turn);
      this.actions.refreshThreads();
    } else if (method === "thread/tokenUsage/updated") {
      this.state.tokenUsage = params.tokenUsage ?? null;
    } else if (method === "account/rateLimits/updated") {
      this.state.rateLimit = params.rateLimits ?? null;
    } else if (method === "hook/started") {
      this.upsertHookRun(params.run, params.turnId, "running");
    } else if (method === "hook/completed") {
      this.upsertHookRun(params.run, params.turnId, params.run?.status ?? "completed");
    } else if (method === "item/mcpToolCall/progress") {
      this.state.displayItems = appendToolOutput(
        this.state.displayItems,
        params.itemId,
        params.turnId,
        params.message ?? "",
        "mcp progress",
      );
    } else if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
      const reviewItem = createAutoReviewResultItem(params);
      this.state.displayItems = upsertDisplayItem(removeUnstructuredAutoReviewWarnings(this.state.displayItems), reviewItem);
    } else if (method === "thread/started") {
      if (params.thread) {
        if (!this.state.activeThreadId || this.state.activeThreadId === params.thread.id) {
          this.state.activeThreadCwd = params.thread.cwd ?? this.state.activeThreadCwd;
        }
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
    } else if (method === "serverRequest/resolved") {
      this.state.approvals = this.state.approvals.filter((approval) => approval.requestId !== params.requestId);
      const resolvedInputs = this.state.pendingUserInputs.filter((input) => input.requestId === params.requestId);
      this.state.pendingUserInputs = this.state.pendingUserInputs.filter((input) => input.requestId !== params.requestId);
      for (const input of resolvedInputs) clearUserInputDrafts(this.state.userInputDrafts, input);
    } else if (method === "thread/compacted") {
      this.addSystemMessage("Context compacted.");
    } else if (method === "guardianWarning") {
      const item = createReviewResultItem(params.message);
      if (!isUnstructuredAutoReviewWarning(item) || !hasStructuredAutoReviewResult(this.state.displayItems, this.state.activeTurnId)) {
        this.state.displayItems = upsertDisplayItem(this.state.displayItems, item);
      }
    } else if (method === "model/rerouted" || method === "deprecationNotice") {
      this.addSystemMessage(`${method}: ${jsonPreview(params)}`);
    } else if (method === "mcpServer/startupStatus/updated") {
      this.handleMcpStartupStatus(params);
    } else if (method === "error" || method === "warning" || method === "configWarning") {
      this.addSystemMessage(`${method}: ${jsonPreview(params)}`);
    }
  }

  handleServerRequest(request: ServerRequest): void {
    if (!this.isRequestInActiveScope(request)) {
      this.rejectServerRequest(request, `Rejected inactive app-server request: ${request.method}`);
      return;
    }

    const approval = toPendingApproval(request);
    if (approval) {
      this.queueApprovalRequest(approval);
      return;
    }

    const userInput = toPendingUserInput(request);
    if (userInput) {
      this.queueUserInputRequest(userInput);
      return;
    }

    this.rejectUnsupportedServerRequest(request);
  }

  handleAppServerLog(message: string): void {
    const classified = classifyAppServerLog(message);
    if (classified === null) return;
    if (classified.kind === "plain") {
      this.addDedupedSystemMessage(classified.text);
    } else if (classified.kind === "error") {
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
    this.state.displayItems.push({
      id: `approval-${String(approval.requestId)}`,
      kind: "approvalResult",
      role: "tool",
      text: `${approvalTitle(approval)}: ${action}`,
      turnId: approvalTurnId(approval),
      markdown: false,
    });
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

  addDedupedSystemMessage(text: string): void {
    if (this.state.reportedLogs.has(text)) return;
    this.state.reportedLogs.add(text);
    this.addSystemMessage(text);
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

  private isInActiveScope(notification: ServerNotification): boolean {
    const threadId = notificationThreadId(notification);
    if (threadId && this.state.activeThreadId && threadId !== this.state.activeThreadId) {
      if (notification.method === "thread/started") return true;
      return false;
    }

    const turnId = notificationTurnId(notification);
    if (turnId && this.state.activeTurnId && turnId !== this.state.activeTurnId) return false;
    return true;
  }

  private isRequestInActiveScope(request: ServerRequest): boolean {
    const threadId = messageThreadId(request);
    if (threadId && this.state.activeThreadId && threadId !== this.state.activeThreadId) return false;

    const turnId = messageTurnId(request);
    if (turnId && this.state.activeTurnId && turnId !== this.state.activeTurnId) return false;
    return true;
  }

  private handleStartedItem(item: ThreadItem, turnId: string): void {
    if (!item || shouldSuppressThreadItem(item) || shouldSuppressLifecycleItem(item)) return;
    const displayItem = displayItemFromThreadItem(item, turnId);
    if (displayItem) this.state.displayItems = upsertDisplayItem(this.state.displayItems, displayItem);
  }

  private handleCompletedItem(item: ThreadItem, turnId: string): void {
    if (!item || shouldSuppressThreadItem(item) || item.type === "userMessage") return;
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
    const item = hookRunDisplayItem(run, turnId, status);
    if (item) this.state.displayItems = upsertDisplayItem(this.state.displayItems, item);
  }

  private handleMcpStartupStatus(params: Extract<ServerNotification, { method: "mcpServer/startupStatus/updated" }>["params"]): void {
    if (!params?.name) return;
    if (params.status === "failed") {
      const key = `${params.name}:${params.error ?? ""}`;
      if (this.state.reportedMcpFailures.has(key)) return;
      this.state.reportedMcpFailures.add(key);
      this.addSystemMessage(
        `MCP server failed to start: ${params.name}\n${params.error ?? ""}\n\nThis is non-fatal for the Codex thread unless that MCP server is needed.`,
      );
    }
  }
}

function notificationThreadId(notification: ServerNotification): string | null {
  return messageThreadId(notification);
}

function notificationTurnId(notification: ServerNotification): string | null {
  return messageTurnId(notification);
}

function messageThreadId(message: ServerNotification | ServerRequest): string | null {
  const params = message.params as { threadId?: unknown };
  if (typeof params.threadId === "string") return params.threadId;
  return null;
}

function messageTurnId(message: ServerNotification | ServerRequest): string | null {
  const params = message.params as { turnId?: unknown; turn?: { id?: unknown } };
  if (typeof params.turnId === "string") return params.turnId;
  return typeof params.turn?.id === "string" ? params.turn.id : null;
}

function approvalTurnId(approval: PendingApproval): string | undefined {
  const params = approval.params as { turnId?: unknown };
  return typeof params.turnId === "string" ? params.turnId : undefined;
}

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
