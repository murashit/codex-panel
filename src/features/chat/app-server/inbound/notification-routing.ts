import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import {
  type ActiveRouteScope,
  type AppServerRouteScope,
  fallbackAppServerRouteScope,
  isAppServerRouteScopeInActiveRouteScope,
  isTurnScopedAppServerRouteForIdleActiveThread,
} from "../../../../app-server/routing/scope";

type ServerNotificationMethod = ServerNotification["method"];
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
  | { kind: "ignored"; notification: ServerNotification }
  | { kind: "unhandled"; notification: ServerNotification }
  | { kind: "inactive"; notification: ServerNotification };

type ServerNotificationScopeExtractors = Partial<{
  [Method in ServerNotificationMethod]: (notification: Extract<ServerNotification, { method: Method }>) => AppServerRouteScope;
}>;

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
  "turn/diff/updated",
  "hook/started",
  "hook/completed",
  "item/mcpToolCall/progress",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "guardianWarning",
] as const;

type StreamUpdateNotificationMethod = (typeof STREAM_UPDATE_NOTIFICATION_METHODS)[number];

const TURN_LIFECYCLE_NOTIFICATION_METHODS = ["turn/started", "turn/completed"] as const;

type TurnLifecycleNotificationMethod = (typeof TURN_LIFECYCLE_NOTIFICATION_METHODS)[number];

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

type ThreadLifecycleNotificationMethod = (typeof THREAD_LIFECYCLE_NOTIFICATION_METHODS)[number];

const DIAGNOSTIC_STATUS_NOTIFICATION_METHODS = [
  "thread/tokenUsage/updated",
  "account/rateLimits/updated",
  "skills/changed",
  "app/list/updated",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
] as const;

type DiagnosticStatusNotificationMethod = (typeof DIAGNOSTIC_STATUS_NOTIFICATION_METHODS)[number];

const USER_VISIBLE_NOTICE_NOTIFICATION_METHODS = [
  "model/rerouted",
  "deprecationNotice",
  "error",
  "warning",
  "configWarning",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
] as const;

type UserVisibleNoticeNotificationMethod = (typeof USER_VISIBLE_NOTICE_NOTIFICATION_METHODS)[number];

const IGNORED_SERVER_NOTIFICATION_METHODS = [
  "thread/status/changed",
  "thread/closed",
  "rawResponseItem/completed",
  "command/exec/outputDelta",
  "process/outputDelta",
  "process/exited",
  "item/commandExecution/terminalInteraction",
  "account/updated",
  "remoteControl/status/changed",
  "externalAgentConfig/import/progress",
  "externalAgentConfig/import/completed",
  "fs/changed",
  "model/verification",
  "turn/moderationMetadata",
  "model/safetyBuffering/updated",
  "fuzzyFileSearch/sessionUpdated",
  "fuzzyFileSearch/sessionCompleted",
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/error",
  "thread/realtime/closed",
  "account/login/completed",
] as const satisfies readonly ServerNotificationMethod[];

type IgnoredServerNotificationMethod = (typeof IGNORED_SERVER_NOTIFICATION_METHODS)[number];

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
  "item/fileChange/patchUpdated": threadTurnNotificationScope,
  "serverRequest/resolved": threadOnlyNotificationScope,
  "item/mcpToolCall/progress": threadTurnNotificationScope,
  "mcpServer/oauthLogin/completed": unscopedNotificationScope,
  "mcpServer/startupStatus/updated": threadOnlyNotificationScope,
  "account/updated": unscopedNotificationScope,
  "account/rateLimits/updated": unscopedNotificationScope,
  "app/list/updated": unscopedNotificationScope,
  "remoteControl/status/changed": unscopedNotificationScope,
  "externalAgentConfig/import/progress": unscopedNotificationScope,
  "externalAgentConfig/import/completed": unscopedNotificationScope,
  "fs/changed": unscopedNotificationScope,
  "item/reasoning/summaryTextDelta": threadTurnNotificationScope,
  "item/reasoning/summaryPartAdded": threadTurnNotificationScope,
  "item/reasoning/textDelta": threadTurnNotificationScope,
  "model/rerouted": threadTurnNotificationScope,
  "model/verification": threadTurnNotificationScope,
  "turn/moderationMetadata": threadTurnNotificationScope,
  "model/safetyBuffering/updated": threadTurnNotificationScope,
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

export function routeServerNotification(notification: ServerNotification, scope: ActiveRouteScope): ServerNotificationRoute {
  if (isThreadCatalogNotification(notification)) return { kind: "threadLifecycle", notification };
  const routeScope = serverNotificationScope(notification);
  if (!isAppServerRouteScopeInActiveRouteScope(routeScope, scope)) return { kind: "inactive", notification };
  if (isIdleThreadStreamUpdate(notification, routeScope, scope)) return { kind: "inactive", notification };

  if (isStreamUpdateNotification(notification)) return { kind: "streamUpdate", notification };
  if (isTurnLifecycleNotification(notification)) return { kind: "turnLifecycle", notification };
  if (isThreadLifecycleNotification(notification)) return { kind: "threadLifecycle", notification };
  if (notification.method === "serverRequest/resolved") return { kind: "requestResolved", notification };
  if (isDiagnosticStatusNotification(notification)) return { kind: "diagnosticStatus", notification };
  if (isUserVisibleNoticeNotification(notification)) return { kind: "userVisibleNotice", notification };
  if (isIgnoredServerNotification(notification)) return { kind: "ignored", notification };
  return { kind: "unhandled", notification };
}

function serverNotificationScope(notification: ServerNotification): AppServerRouteScope {
  if (!isServerNotification(notification)) return fallbackAppServerRouteScope(notification);
  const extractor = SERVER_NOTIFICATION_SCOPE_EXTRACTORS[notification.method] as (notification: ServerNotification) => AppServerRouteScope;
  return extractor(notification);
}

function isServerNotification(notification: ServerNotification): boolean {
  return Object.hasOwn(SERVER_NOTIFICATION_SCOPE_EXTRACTORS, notification.method);
}

function threadStartedNotificationScope(notification: { params: { thread: { id: string } } }): AppServerRouteScope {
  return { threadId: notification.params.thread.id, turnId: null };
}

function turnNotificationScope(notification: { params: { threadId: string; turn: { id: string } } }): AppServerRouteScope {
  return { threadId: notification.params.threadId, turnId: notification.params.turn.id };
}

function threadTurnNotificationScope(notification: { params: { threadId: string | null; turnId: string | null } }): AppServerRouteScope {
  return { threadId: notification.params.threadId, turnId: notification.params.turnId };
}

function threadOnlyNotificationScope(notification: { params: { threadId: string | null } }): AppServerRouteScope {
  return { threadId: notification.params.threadId, turnId: null };
}

function unscopedNotificationScope(): AppServerRouteScope {
  return { threadId: null, turnId: null };
}

function isThreadCatalogNotification(notification: ServerNotification): notification is ThreadLifecycleNotification {
  return notificationMethodIn(notification.method, GLOBALLY_ROUTED_THREAD_CATALOG_NOTIFICATION_METHODS);
}

function isStreamUpdateNotification(notification: ServerNotification): notification is StreamUpdateNotification {
  return notificationMethodIn(notification.method, STREAM_UPDATE_NOTIFICATION_METHODS);
}

function isIdleThreadStreamUpdate(notification: ServerNotification, routeScope: AppServerRouteScope, scope: ActiveRouteScope): boolean {
  return isTurnScopedAppServerRouteForIdleActiveThread(routeScope, scope) && isStreamUpdateNotification(notification);
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

function isIgnoredServerNotification(
  notification: ServerNotification,
): notification is RoutedNotification<IgnoredServerNotificationMethod> {
  return notificationMethodIn(notification.method, IGNORED_SERVER_NOTIFICATION_METHODS);
}

function notificationMethodIn<M extends ServerNotificationMethod>(method: ServerNotificationMethod, methods: readonly M[]): method is M {
  return (methods as readonly ServerNotificationMethod[]).includes(method);
}
