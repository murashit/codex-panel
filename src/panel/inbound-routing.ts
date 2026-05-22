import { toPendingApproval, type PendingApproval } from "../approvals/model";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { ServerRequest } from "../generated/app-server/ServerRequest";
import { toPendingUserInput, type PendingUserInput } from "../user-input/model";

export interface ActiveRouteScope {
  activeThreadId: string | null;
  activeTurnId: string | null;
}

export type ServerRequestRoute =
  | { kind: "approval"; request: ServerRequest; approval: PendingApproval }
  | { kind: "userInput"; request: ServerRequest; input: PendingUserInput }
  | { kind: "unsupported"; request: ServerRequest }
  | { kind: "inactive"; request: ServerRequest };

export type ServerNotificationRoute =
  | { kind: "streamUpdate"; notification: ServerNotification }
  | { kind: "turnLifecycle"; notification: ServerNotification }
  | { kind: "threadLifecycle"; notification: ServerNotification }
  | { kind: "requestResolved"; notification: Extract<ServerNotification, { method: "serverRequest/resolved" }> }
  | { kind: "diagnosticStatus"; notification: ServerNotification }
  | { kind: "userVisibleNotice"; notification: ServerNotification }
  | { kind: "unhandled"; notification: ServerNotification }
  | { kind: "inactive"; notification: ServerNotification };

export function routeServerRequest(request: ServerRequest, scope: ActiveRouteScope): ServerRequestRoute {
  if (!isMessageInActiveScope(request, scope)) return { kind: "inactive", request };

  const approval = toPendingApproval(request);
  if (approval) return { kind: "approval", request, approval };

  const input = toPendingUserInput(request);
  if (input) return { kind: "userInput", request, input };

  return { kind: "unsupported", request };
}

export function routeServerNotification(notification: ServerNotification, scope: ActiveRouteScope): ServerNotificationRoute {
  if (!isMessageInActiveScope(notification, scope)) return { kind: "inactive", notification };

  if (isStreamUpdateNotification(notification)) return { kind: "streamUpdate", notification };
  if (isTurnLifecycleNotification(notification)) return { kind: "turnLifecycle", notification };
  if (isThreadLifecycleNotification(notification)) return { kind: "threadLifecycle", notification };
  if (notification.method === "serverRequest/resolved") return { kind: "requestResolved", notification };
  if (isDiagnosticStatusNotification(notification)) return { kind: "diagnosticStatus", notification };
  if (isUserVisibleNoticeNotification(notification)) return { kind: "userVisibleNotice", notification };
  return { kind: "unhandled", notification };
}

export function isMessageInActiveScope(message: ServerNotification | ServerRequest, scope: ActiveRouteScope): boolean {
  const threadId = messageThreadId(message);
  if (threadId && scope.activeThreadId && threadId !== scope.activeThreadId) return false;

  const turnId = messageTurnId(message);
  if (turnId && scope.activeTurnId && turnId !== scope.activeTurnId) return false;

  return true;
}

export function messageThreadId(message: ServerNotification | ServerRequest): string | null {
  const params = message.params as { threadId?: unknown };
  return typeof params.threadId === "string" ? params.threadId : null;
}

export function messageTurnId(message: ServerNotification | ServerRequest): string | null {
  const params = message.params as { turnId?: unknown; turn?: { id?: unknown } };
  if (typeof params.turnId === "string") return params.turnId;
  return typeof params.turn?.id === "string" ? params.turn.id : null;
}

function isStreamUpdateNotification(notification: ServerNotification): boolean {
  switch (notification.method) {
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "turn/plan/updated":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/started":
    case "item/completed":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/patchUpdated":
    case "item/fileChange/outputDelta":
    case "turn/diff/updated":
    case "hook/started":
    case "hook/completed":
    case "item/mcpToolCall/progress":
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
    case "guardianWarning":
      return true;
    default:
      return false;
  }
}

function isTurnLifecycleNotification(notification: ServerNotification): boolean {
  switch (notification.method) {
    case "turn/started":
    case "turn/completed":
      return true;
    default:
      return false;
  }
}

function isThreadLifecycleNotification(notification: ServerNotification): boolean {
  switch (notification.method) {
    case "thread/started":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/name/updated":
    case "thread/goal/updated":
    case "thread/goal/cleared":
    case "thread/settings/updated":
      return true;
    default:
      return false;
  }
}

function isDiagnosticStatusNotification(notification: ServerNotification): boolean {
  switch (notification.method) {
    case "thread/tokenUsage/updated":
    case "account/rateLimits/updated":
    case "skills/changed":
    case "mcpServer/startupStatus/updated":
      return true;
    default:
      return false;
  }
}

function isUserVisibleNoticeNotification(notification: ServerNotification): boolean {
  switch (notification.method) {
    case "thread/compacted":
    case "model/rerouted":
    case "deprecationNotice":
    case "error":
    case "warning":
    case "configWarning":
      return true;
    default:
      return false;
  }
}
