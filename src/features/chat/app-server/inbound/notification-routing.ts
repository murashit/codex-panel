import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import {
  type ActiveRouteScope,
  type AppServerRouteScope,
  fallbackAppServerRouteScope,
  isAppServerRouteScopeInActiveRouteScope,
  isTurnScopedAppServerRouteForIdlePanelTurn,
} from "./route-scope";

type ServerNotificationMethod = ServerNotification["method"];
type RoutedNotification<M extends ServerNotificationMethod> = Extract<ServerNotification, { method: M }>;
type NotificationRouteKind =
  | "streamUpdate"
  | "turnLifecycle"
  | "threadLifecycle"
  | "requestResolved"
  | "diagnosticStatus"
  | "userVisibleNotice"
  | "ignored";
type NotificationDescriptor<M extends ServerNotificationMethod> =
  | {
      readonly kind: NotificationRouteKind;
      readonly delivery: "activeScope";
      readonly scope: (notification: RoutedNotification<M>) => AppServerRouteScope;
    }
  | {
      readonly kind: NotificationRouteKind;
      readonly delivery: "threadCatalog";
      readonly scope: null;
    };
type NotificationRegistry = Partial<{
  [Method in ServerNotificationMethod]: NotificationDescriptor<Method>;
}>;

export type ServerNotificationRoute =
  | { kind: "streamUpdate"; notification: StreamUpdateNotification }
  | { kind: "turnLifecycle"; notification: TurnLifecycleNotification }
  | { kind: "threadLifecycle"; notification: ThreadLifecycleNotification }
  | { kind: "requestResolved"; notification: RequestResolvedNotification }
  | { kind: "diagnosticStatus"; notification: DiagnosticStatusNotification }
  | { kind: "userVisibleNotice"; notification: UserVisibleNoticeNotification }
  | { kind: "ignored"; notification: ServerNotification }
  | { kind: "unhandled"; notification: ServerNotification }
  | { kind: "inactive"; notification: ServerNotification; scope: AppServerRouteScope };

const ACTIVE_SCOPE_DELIVERY: { readonly delivery: "activeScope" } = { delivery: "activeScope" };
const THREAD_CATALOG_DELIVERY = { delivery: "threadCatalog", scope: null } as const;

const SERVER_NOTIFICATION_REGISTRY = {
  "thread/started": { ...THREAD_CATALOG_DELIVERY, kind: "threadLifecycle" },
  "thread/goal/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "threadLifecycle", scope: threadTurnNotificationScope },
  "thread/goal/cleared": { ...ACTIVE_SCOPE_DELIVERY, kind: "threadLifecycle", scope: threadOnlyNotificationScope },
  "thread/settings/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "threadLifecycle", scope: threadOnlyNotificationScope },

  "item/agentMessage/delta": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/plan/delta": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "turn/plan/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/reasoning/summaryTextDelta": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/reasoning/textDelta": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/reasoning/summaryPartAdded": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/started": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/commandExecution/outputDelta": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/fileChange/patchUpdated": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "turn/diff/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "hook/started": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "hook/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/mcpToolCall/progress": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/autoApprovalReview/started": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "item/autoApprovalReview/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "modelProvider/authRecoveryStarted": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  "modelProvider/authRecoveryCompleted": { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadTurnNotificationScope },
  guardianWarning: { ...ACTIVE_SCOPE_DELIVERY, kind: "streamUpdate", scope: threadOnlyNotificationScope },

  "turn/started": { ...ACTIVE_SCOPE_DELIVERY, kind: "turnLifecycle", scope: turnNotificationScope },
  "turn/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "turnLifecycle", scope: turnNotificationScope },

  "serverRequest/resolved": { ...ACTIVE_SCOPE_DELIVERY, kind: "requestResolved", scope: threadOnlyNotificationScope },

  "thread/tokenUsage/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "diagnosticStatus", scope: threadTurnNotificationScope },
  "app/list/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "diagnosticStatus", scope: unscopedNotificationScope },
  "mcpServer/oauthLogin/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "diagnosticStatus", scope: unscopedNotificationScope },
  "mcpServer/startupStatus/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "diagnosticStatus", scope: threadOnlyNotificationScope },

  "model/rerouted": { ...ACTIVE_SCOPE_DELIVERY, kind: "userVisibleNotice", scope: threadTurnNotificationScope },
  deprecationNotice: { ...ACTIVE_SCOPE_DELIVERY, kind: "userVisibleNotice", scope: unscopedNotificationScope },
  error: { ...ACTIVE_SCOPE_DELIVERY, kind: "userVisibleNotice", scope: threadTurnNotificationScope },
  warning: { ...ACTIVE_SCOPE_DELIVERY, kind: "userVisibleNotice", scope: threadOnlyNotificationScope },
  configWarning: { ...ACTIVE_SCOPE_DELIVERY, kind: "userVisibleNotice", scope: unscopedNotificationScope },
  "windows/worldWritableWarning": { ...ACTIVE_SCOPE_DELIVERY, kind: "userVisibleNotice", scope: unscopedNotificationScope },
  "windowsSandbox/setupCompleted": { ...ACTIVE_SCOPE_DELIVERY, kind: "userVisibleNotice", scope: unscopedNotificationScope },

  "thread/status/changed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/closed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "rawResponseItem/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadTurnNotificationScope },
  "rawResponse/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadTurnNotificationScope },
  "thread/environment/connected": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/environment/disconnected": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "command/exec/outputDelta": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "process/outputDelta": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "process/exited": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "item/commandExecution/terminalInteraction": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadTurnNotificationScope },
  "account/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "remoteControl/status/changed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "externalAgentConfig/import/progress": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "externalAgentConfig/import/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "fs/changed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "model/verification": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadTurnNotificationScope },
  "turn/moderationMetadata": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadTurnNotificationScope },
  "model/safetyBuffering/updated": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadTurnNotificationScope },
  "autoApprovalReview/strictReviewRequired": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadTurnNotificationScope },
  "fuzzyFileSearch/sessionUpdated": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "fuzzyFileSearch/sessionCompleted": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
  "thread/realtime/started": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/realtime/itemAdded": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/realtime/transcript/delta": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/realtime/transcript/done": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/realtime/outputAudio/delta": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/realtime/sdp": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/realtime/error": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "thread/realtime/closed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: threadOnlyNotificationScope },
  "account/login/completed": { ...ACTIVE_SCOPE_DELIVERY, kind: "ignored", scope: unscopedNotificationScope },
} satisfies NotificationRegistry;

type RegisteredNotificationMethod = keyof typeof SERVER_NOTIFICATION_REGISTRY & ServerNotificationMethod;
type MethodsForKind<Kind extends NotificationRouteKind> = {
  [Method in RegisteredNotificationMethod]: (typeof SERVER_NOTIFICATION_REGISTRY)[Method] extends { readonly kind: Kind } ? Method : never;
}[RegisteredNotificationMethod];
type NotificationForKind<Kind extends NotificationRouteKind> = RoutedNotification<Extract<MethodsForKind<Kind>, ServerNotificationMethod>>;
type RegisteredNotification = {
  [Method in RegisteredNotificationMethod]: {
    readonly kind: (typeof SERVER_NOTIFICATION_REGISTRY)[Method]["kind"];
    readonly delivery: (typeof SERVER_NOTIFICATION_REGISTRY)[Method]["delivery"];
    readonly notification: RoutedNotification<Method>;
    readonly scope: (typeof SERVER_NOTIFICATION_REGISTRY)[Method] extends { readonly delivery: "threadCatalog" }
      ? null
      : AppServerRouteScope;
  };
}[RegisteredNotificationMethod];

export type StreamUpdateNotification = NotificationForKind<"streamUpdate">;
export type TurnLifecycleNotification = NotificationForKind<"turnLifecycle">;
export type ThreadLifecycleNotification = NotificationForKind<"threadLifecycle">;
type RequestResolvedNotification = NotificationForKind<"requestResolved">;
export type DiagnosticStatusNotification = NotificationForKind<"diagnosticStatus">;
export type UserVisibleNoticeNotification = NotificationForKind<"userVisibleNotice">;

export function routeServerNotification(notification: ServerNotification, scope: ActiveRouteScope): ServerNotificationRoute {
  const registered = registeredNotification(notification);
  if (registered === null) {
    const routeScope = fallbackAppServerRouteScope(notification);
    if (!isAppServerRouteScopeInActiveRouteScope(routeScope, scope)) return { kind: "inactive", notification, scope: routeScope };
    return { kind: "unhandled", notification };
  }

  switch (registered.delivery) {
    case "threadCatalog":
      return registeredRoute(registered);
    case "activeScope": {
      const routeScope = registered.scope;
      if (!isAppServerRouteScopeInActiveRouteScope(routeScope, scope)) return { kind: "inactive", notification, scope: routeScope };
      if (isTurnScopedAppServerRouteForIdlePanelTurn(routeScope, scope) && registered.kind === "streamUpdate") {
        return { kind: "inactive", notification, scope: routeScope };
      }

      return registeredRoute(registered);
    }
    default:
      throw new Error("Unhandled server notification delivery policy");
  }
}

function registeredRoute(notification: RegisteredNotification): ServerNotificationRoute {
  return { kind: notification.kind, notification: notification.notification } as ServerNotificationRoute;
}

function registeredNotification<M extends ServerNotificationMethod>(notification: RoutedNotification<M>): RegisteredNotification | null {
  if (!isRegisteredNotificationMethod(notification.method)) return null;
  // Registry membership guarantees method -> descriptor -> payload correlation; these assertions restore it after indexed lookup and mapped-union construction.
  const descriptor = SERVER_NOTIFICATION_REGISTRY[notification.method] as NotificationDescriptor<M>;
  if (descriptor.delivery === "threadCatalog") {
    return {
      kind: descriptor.kind,
      delivery: descriptor.delivery,
      notification,
      scope: null,
    } as RegisteredNotification;
  }

  return {
    kind: descriptor.kind,
    delivery: descriptor.delivery,
    notification,
    scope: descriptor.scope(notification),
  } as RegisteredNotification;
}

function isRegisteredNotificationMethod(method: ServerNotificationMethod): method is RegisteredNotificationMethod {
  return Object.hasOwn(SERVER_NOTIFICATION_REGISTRY, method);
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
