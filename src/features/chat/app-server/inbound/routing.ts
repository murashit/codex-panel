import type { ServerNotification, ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type { PendingApproval, PendingMcpElicitation, PendingUserInput } from "../../../../domain/pending-requests/model";
import { toPendingApproval } from "../requests/approval";
import { toPendingMcpElicitation } from "../requests/mcp-elicitation";
import { toPendingUserInput } from "../requests/user-input";

export interface ActiveRouteScope {
  activeThreadId: string | null;
  activeTurnId: string | null;
}

export type ServerRequestRoute =
  | { kind: "approval"; request: ServerRequest; approval: PendingApproval }
  | { kind: "userInput"; request: ServerRequest; input: PendingUserInput }
  | { kind: "mcpElicitation"; request: ServerRequest; elicitation: PendingMcpElicitation }
  | { kind: "unsupported"; request: ServerRequest }
  | { kind: "unknown"; request: ServerRequest }
  | { kind: "inactive"; request: ServerRequest };

type ServerNotificationMethod = ServerNotification["method"];
type ServerRequestMethod = ServerRequest["method"];
type RoutedNotification<M extends ServerNotificationMethod> = Extract<ServerNotification, { method: M }>;
export type StreamUpdateNotification = RoutedNotification<StreamUpdateNotificationMethod>;
export type TurnLifecycleNotification = RoutedNotification<TurnLifecycleNotificationMethod>;
export type ThreadLifecycleNotification = RoutedNotification<ThreadLifecycleNotificationMethod>;
type RequestResolvedNotification = RoutedNotification<"serverRequest/resolved">;
export type DiagnosticStatusNotification = RoutedNotification<DiagnosticStatusNotificationMethod>;
export type UserVisibleNoticeNotification = RoutedNotification<UserVisibleNoticeNotificationMethod>;

export type ServerNotificationRoute =
  | { kind: "streamUpdate"; notification: StreamUpdateNotification }
  | { kind: "turnLifecycle"; notification: TurnLifecycleNotification }
  | { kind: "threadLifecycle"; notification: ThreadLifecycleNotification }
  | { kind: "requestResolved"; notification: RequestResolvedNotification }
  | { kind: "diagnosticStatus"; notification: DiagnosticStatusNotification }
  | { kind: "userVisibleNotice"; notification: UserVisibleNoticeNotification }
  | { kind: "unhandled"; notification: ServerNotification }
  | { kind: "inactive"; notification: ServerNotification };

interface MessageScope {
  threadId: string | null;
  turnId: string | null;
}

type ServerRequestRouteKindByMethod = Record<ServerRequestMethod, Exclude<ServerRequestRoute["kind"], "inactive" | "unknown">>;
type ServerNotificationScopeExtractors = {
  [Method in ServerNotificationMethod]: (notification: Extract<ServerNotification, { method: Method }>) => MessageScope;
};
type ServerRequestScopeExtractors = {
  [Method in ServerRequestMethod]: (request: Extract<ServerRequest, { method: Method }>) => MessageScope;
};

const GLOBALLY_ROUTED_THREAD_CATALOG_NOTIFICATION_METHODS = [
  "thread/started",
  "thread/archived",
  "thread/deleted",
  "thread/unarchived",
  "thread/name/updated",
] as const;

const STREAM_UPDATE_NOTIFICATION_METHODS = [
  "item/agentMessage/delta",
  "item/plan/delta",
  "turn/plan/updated",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryPartAdded",
  "item/started",
  "item/completed",
  "item/commandExecution/outputDelta",
  "item/fileChange/patchUpdated",
  "item/fileChange/outputDelta",
  "turn/diff/updated",
  "hook/started",
  "hook/completed",
  "item/mcpToolCall/progress",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "guardianWarning",
] as const;

export type StreamUpdateNotificationMethod = (typeof STREAM_UPDATE_NOTIFICATION_METHODS)[number];

const TURN_LIFECYCLE_NOTIFICATION_METHODS = ["turn/started", "turn/completed"] as const;

export type TurnLifecycleNotificationMethod = (typeof TURN_LIFECYCLE_NOTIFICATION_METHODS)[number];

const THREAD_LIFECYCLE_NOTIFICATION_METHODS = [
  "thread/started",
  "thread/archived",
  "thread/deleted",
  "thread/unarchived",
  "thread/name/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/settings/updated",
] as const;

export type ThreadLifecycleNotificationMethod = (typeof THREAD_LIFECYCLE_NOTIFICATION_METHODS)[number];

const DIAGNOSTIC_STATUS_NOTIFICATION_METHODS = [
  "thread/tokenUsage/updated",
  "account/rateLimits/updated",
  "skills/changed",
  "mcpServer/startupStatus/updated",
] as const;

export type DiagnosticStatusNotificationMethod = (typeof DIAGNOSTIC_STATUS_NOTIFICATION_METHODS)[number];

const USER_VISIBLE_NOTICE_NOTIFICATION_METHODS = [
  "thread/compacted",
  "model/rerouted",
  "deprecationNotice",
  "error",
  "warning",
  "configWarning",
] as const;

export type UserVisibleNoticeNotificationMethod = (typeof USER_VISIBLE_NOTICE_NOTIFICATION_METHODS)[number];

export const ROUTED_SERVER_NOTIFICATION_METHODS_BY_ROUTE_KIND = {
  streamUpdate: STREAM_UPDATE_NOTIFICATION_METHODS,
  turnLifecycle: TURN_LIFECYCLE_NOTIFICATION_METHODS,
  threadLifecycle: THREAD_LIFECYCLE_NOTIFICATION_METHODS,
  requestResolved: ["serverRequest/resolved"],
  diagnosticStatus: DIAGNOSTIC_STATUS_NOTIFICATION_METHODS,
  userVisibleNotice: USER_VISIBLE_NOTICE_NOTIFICATION_METHODS,
} satisfies Record<Exclude<ServerNotificationRoute["kind"], "inactive" | "unhandled">, readonly ServerNotificationMethod[]>;

const SERVER_NOTIFICATION_SCOPE_EXTRACTORS: ServerNotificationScopeExtractors = {
  error: threadTurnNotificationScope,
  "thread/started": threadStartedNotificationScope,
  "thread/status/changed": threadOnlyNotificationScope,
  "thread/archived": threadOnlyNotificationScope,
  "thread/deleted": threadOnlyNotificationScope,
  "thread/unarchived": threadOnlyNotificationScope,
  "thread/closed": threadOnlyNotificationScope,
  "skills/changed": unscopedNotificationScope,
  "thread/name/updated": threadOnlyNotificationScope,
  "thread/goal/updated": threadTurnNotificationScope,
  "thread/goal/cleared": threadOnlyNotificationScope,
  "thread/settings/updated": threadOnlyNotificationScope,
  "thread/tokenUsage/updated": threadTurnNotificationScope,
  "turn/started": turnNotificationScope,
  "hook/started": threadTurnNotificationScope,
  "turn/completed": turnNotificationScope,
  "hook/completed": threadTurnNotificationScope,
  "turn/diff/updated": threadTurnNotificationScope,
  "turn/plan/updated": threadTurnNotificationScope,
  "item/started": threadTurnNotificationScope,
  "item/autoApprovalReview/started": threadTurnNotificationScope,
  "item/autoApprovalReview/completed": threadTurnNotificationScope,
  "item/completed": threadTurnNotificationScope,
  "rawResponseItem/completed": threadTurnNotificationScope,
  "item/agentMessage/delta": threadTurnNotificationScope,
  "item/plan/delta": threadTurnNotificationScope,
  "command/exec/outputDelta": unscopedNotificationScope,
  "process/outputDelta": unscopedNotificationScope,
  "process/exited": unscopedNotificationScope,
  "item/commandExecution/outputDelta": threadTurnNotificationScope,
  "item/commandExecution/terminalInteraction": threadTurnNotificationScope,
  "item/fileChange/outputDelta": threadTurnNotificationScope,
  "item/fileChange/patchUpdated": threadTurnNotificationScope,
  "serverRequest/resolved": threadOnlyNotificationScope,
  "item/mcpToolCall/progress": threadTurnNotificationScope,
  "mcpServer/oauthLogin/completed": unscopedNotificationScope,
  "mcpServer/startupStatus/updated": threadOnlyNotificationScope,
  "account/updated": unscopedNotificationScope,
  "account/rateLimits/updated": unscopedNotificationScope,
  "app/list/updated": unscopedNotificationScope,
  "remoteControl/status/changed": unscopedNotificationScope,
  "externalAgentConfig/import/completed": unscopedNotificationScope,
  "fs/changed": unscopedNotificationScope,
  "item/reasoning/summaryTextDelta": threadTurnNotificationScope,
  "item/reasoning/summaryPartAdded": threadTurnNotificationScope,
  "item/reasoning/textDelta": threadTurnNotificationScope,
  "thread/compacted": threadTurnNotificationScope,
  "model/rerouted": threadTurnNotificationScope,
  "model/verification": threadTurnNotificationScope,
  "turn/moderationMetadata": threadTurnNotificationScope,
  warning: threadOnlyNotificationScope,
  guardianWarning: threadOnlyNotificationScope,
  deprecationNotice: unscopedNotificationScope,
  configWarning: unscopedNotificationScope,
  "fuzzyFileSearch/sessionUpdated": unscopedNotificationScope,
  "fuzzyFileSearch/sessionCompleted": unscopedNotificationScope,
  "thread/realtime/started": threadOnlyNotificationScope,
  "thread/realtime/itemAdded": threadOnlyNotificationScope,
  "thread/realtime/transcript/delta": threadOnlyNotificationScope,
  "thread/realtime/transcript/done": threadOnlyNotificationScope,
  "thread/realtime/outputAudio/delta": threadOnlyNotificationScope,
  "thread/realtime/sdp": threadOnlyNotificationScope,
  "thread/realtime/error": threadOnlyNotificationScope,
  "thread/realtime/closed": threadOnlyNotificationScope,
  "windows/worldWritableWarning": unscopedNotificationScope,
  "windowsSandbox/setupCompleted": unscopedNotificationScope,
  "account/login/completed": unscopedNotificationScope,
};

const SERVER_REQUEST_SCOPE_EXTRACTORS: ServerRequestScopeExtractors = {
  "item/commandExecution/requestApproval": threadTurnRequestScope,
  "item/fileChange/requestApproval": threadTurnRequestScope,
  "item/tool/requestUserInput": threadTurnRequestScope,
  "mcpServer/elicitation/request": threadTurnRequestScope,
  "item/permissions/requestApproval": threadTurnRequestScope,
  "item/tool/call": threadTurnRequestScope,
  "account/chatgptAuthTokens/refresh": unscopedRequestScope,
  "attestation/generate": unscopedRequestScope,
  applyPatchApproval: unscopedRequestScope,
  execCommandApproval: unscopedRequestScope,
};

const SERVER_REQUEST_ROUTE_KIND_BY_METHOD: ServerRequestRouteKindByMethod = {
  "item/commandExecution/requestApproval": "approval",
  "item/fileChange/requestApproval": "approval",
  "item/permissions/requestApproval": "approval",
  "item/tool/requestUserInput": "userInput",
  "mcpServer/elicitation/request": "mcpElicitation",
  "item/tool/call": "unsupported",
  "account/chatgptAuthTokens/refresh": "unsupported",
  "attestation/generate": "unsupported",
  applyPatchApproval: "unsupported",
  execCommandApproval: "unsupported",
};

export function routeServerRequest(request: ServerRequest, scope: ActiveRouteScope): ServerRequestRoute {
  if (!isServerRequest(request)) {
    if (!isMessageInActiveScope(request, scope)) return { kind: "inactive", request };
    if (isTurnScopedMessageForIdleActiveThread(request, scope)) return { kind: "inactive", request };
    return { kind: "unknown", request };
  }
  if (!isMessageInActiveScope(request, scope)) return { kind: "inactive", request };
  if (isTurnScopedMessageForIdleActiveThread(request, scope)) return { kind: "inactive", request };

  switch (SERVER_REQUEST_ROUTE_KIND_BY_METHOD[request.method]) {
    case "approval": {
      const approval = toPendingApproval(request);
      if (approval) return { kind: "approval", request, approval };
      return { kind: "unsupported", request };
    }
    case "userInput": {
      const input = toPendingUserInput(request);
      if (input) return { kind: "userInput", request, input };
      return { kind: "unsupported", request };
    }
    case "mcpElicitation": {
      const elicitation = toPendingMcpElicitation(request);
      if (elicitation) return { kind: "mcpElicitation", request, elicitation };
      return { kind: "unsupported", request };
    }
    case "unsupported":
      return { kind: "unsupported", request };
  }
}

export function routeServerNotification(notification: ServerNotification, scope: ActiveRouteScope): ServerNotificationRoute {
  if (isThreadCatalogNotification(notification)) return { kind: "threadLifecycle", notification };
  if (!isMessageInActiveScope(notification, scope)) return { kind: "inactive", notification };
  if (isIdleThreadStreamUpdate(notification, scope)) return { kind: "inactive", notification };

  if (isStreamUpdateNotification(notification)) return { kind: "streamUpdate", notification };
  if (isTurnLifecycleNotification(notification)) return { kind: "turnLifecycle", notification };
  if (isThreadLifecycleNotification(notification)) return { kind: "threadLifecycle", notification };
  if (notification.method === "serverRequest/resolved") return { kind: "requestResolved", notification };
  if (isDiagnosticStatusNotification(notification)) return { kind: "diagnosticStatus", notification };
  if (isUserVisibleNoticeNotification(notification)) return { kind: "userVisibleNotice", notification };
  return { kind: "unhandled", notification };
}

function isMessageInActiveScope(message: ServerNotification | ServerRequest, scope: ActiveRouteScope): boolean {
  const threadId = messageThreadId(message);
  // Scope identifiers are filters only when both the notification and the
  // active panel have one. Thread catalog and idle-thread notifications often
  // omit active turn scope, so missing ids stay eligible for the active route.
  if (threadId && scope.activeThreadId && threadId !== scope.activeThreadId) return false;

  const turnId = messageTurnId(message);
  if (turnId && scope.activeTurnId && turnId !== scope.activeTurnId) return false;

  return true;
}

function messageThreadId(message: ServerNotification | ServerRequest): string | null {
  if (isServerRequest(message)) return serverRequestScope(message).threadId;
  if (isServerNotification(message)) return serverNotificationScope(message).threadId;
  return fallbackMessageScope(message).threadId;
}

function messageTurnId(message: ServerNotification | ServerRequest): string | null {
  if (isServerRequest(message)) return serverRequestScope(message).turnId;
  if (isServerNotification(message)) return serverNotificationScope(message).turnId;
  return fallbackMessageScope(message).turnId;
}

function serverNotificationScope(notification: ServerNotification): MessageScope {
  const extractor = SERVER_NOTIFICATION_SCOPE_EXTRACTORS[notification.method] as (notification: ServerNotification) => MessageScope;
  return extractor(notification);
}

function serverRequestScope(request: ServerRequest): MessageScope {
  const extractor = SERVER_REQUEST_SCOPE_EXTRACTORS[request.method] as (request: ServerRequest) => MessageScope;
  return extractor(request);
}

function isServerRequest(message: ServerNotification | ServerRequest): message is ServerRequest {
  return Object.prototype.hasOwnProperty.call(SERVER_REQUEST_SCOPE_EXTRACTORS, message.method);
}

function isServerNotification(message: ServerNotification | ServerRequest): message is ServerNotification {
  return Object.prototype.hasOwnProperty.call(SERVER_NOTIFICATION_SCOPE_EXTRACTORS, message.method);
}

function threadTurnRequestScope(request: { params: { threadId: string; turnId: string | null } }): MessageScope {
  return { threadId: request.params.threadId, turnId: request.params.turnId };
}

function unscopedRequestScope(): MessageScope {
  return { threadId: null, turnId: null };
}

function threadStartedNotificationScope(notification: { params: { thread: { id: string } } }): MessageScope {
  return { threadId: notification.params.thread.id, turnId: null };
}

function turnNotificationScope(notification: { params: { threadId: string; turn: { id: string } } }): MessageScope {
  return { threadId: notification.params.threadId, turnId: notification.params.turn.id };
}

function threadTurnNotificationScope(notification: { params: { threadId: string | null; turnId: string | null } }): MessageScope {
  return { threadId: notification.params.threadId, turnId: notification.params.turnId };
}

function threadOnlyNotificationScope(notification: { params: { threadId: string | null } }): MessageScope {
  return { threadId: notification.params.threadId, turnId: null };
}

function unscopedNotificationScope(): MessageScope {
  return { threadId: null, turnId: null };
}

function fallbackMessageScope(message: ServerNotification | ServerRequest): MessageScope {
  const params = messageParams(message);
  return {
    threadId: stringParam(params, "threadId"),
    turnId: stringParam(params, "turnId"),
  };
}

function messageParams(message: { params?: unknown }): Record<string, unknown> | null {
  const params = message.params;
  return params !== null && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : null;
}

function stringParam(params: Record<string, unknown> | null, key: string): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isThreadCatalogNotification(notification: ServerNotification): notification is ThreadLifecycleNotification {
  return notificationMethodIn(notification.method, GLOBALLY_ROUTED_THREAD_CATALOG_NOTIFICATION_METHODS);
}

function isStreamUpdateNotification(notification: ServerNotification): notification is StreamUpdateNotification {
  return notificationMethodIn(notification.method, STREAM_UPDATE_NOTIFICATION_METHODS);
}

function isIdleThreadStreamUpdate(notification: ServerNotification, scope: ActiveRouteScope): boolean {
  return isTurnScopedMessageForIdleActiveThread(notification, scope) && isStreamUpdateNotification(notification);
}

function isTurnScopedMessageForIdleActiveThread(message: ServerNotification | ServerRequest, scope: ActiveRouteScope): boolean {
  return scope.activeThreadId !== null && scope.activeTurnId === null && messageTurnId(message) !== null;
}

function isTurnLifecycleNotification(notification: ServerNotification): notification is TurnLifecycleNotification {
  return notificationMethodIn(notification.method, TURN_LIFECYCLE_NOTIFICATION_METHODS);
}

function isThreadLifecycleNotification(notification: ServerNotification): notification is ThreadLifecycleNotification {
  return notificationMethodIn(notification.method, THREAD_LIFECYCLE_NOTIFICATION_METHODS);
}

function isDiagnosticStatusNotification(notification: ServerNotification): notification is DiagnosticStatusNotification {
  return notificationMethodIn(notification.method, DIAGNOSTIC_STATUS_NOTIFICATION_METHODS);
}

function isUserVisibleNoticeNotification(notification: ServerNotification): notification is UserVisibleNoticeNotification {
  return notificationMethodIn(notification.method, USER_VISIBLE_NOTICE_NOTIFICATION_METHODS);
}

function notificationMethodIn<M extends ServerNotificationMethod>(method: ServerNotificationMethod, methods: readonly M[]): method is M {
  return (methods as readonly ServerNotificationMethod[]).includes(method);
}
