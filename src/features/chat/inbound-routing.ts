import { toPendingApproval, type PendingApproval } from "./approvals/model";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import { toPendingUserInput, type PendingUserInput } from "./user-input/model";

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
  if (isGlobalThreadLifecycleNotification(notification)) return { kind: "threadLifecycle", notification };
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
  switch (message.method) {
    case "thread/started":
      return message.params.thread.id;
    case "error":
    case "thread/status/changed":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/closed":
    case "thread/name/updated":
    case "thread/goal/updated":
    case "thread/goal/cleared":
    case "thread/settings/updated":
    case "thread/tokenUsage/updated":
    case "turn/started":
    case "hook/started":
    case "turn/completed":
    case "hook/completed":
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "item/started":
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
    case "item/completed":
    case "rawResponseItem/completed":
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
    case "item/fileChange/patchUpdated":
    case "serverRequest/resolved":
    case "item/mcpToolCall/progress":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
    case "thread/compacted":
    case "model/rerouted":
    case "model/verification":
    case "warning":
    case "guardianWarning":
    case "thread/realtime/started":
    case "thread/realtime/itemAdded":
    case "thread/realtime/transcript/delta":
    case "thread/realtime/transcript/done":
    case "thread/realtime/outputAudio/delta":
    case "thread/realtime/sdp":
    case "thread/realtime/error":
    case "thread/realtime/closed":
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/tool/requestUserInput":
    case "mcpServer/elicitation/request":
    case "item/permissions/requestApproval":
    case "item/tool/call":
      return message.params.threadId ?? null;
    case "skills/changed":
    case "command/exec/outputDelta":
    case "process/outputDelta":
    case "process/exited":
    case "mcpServer/oauthLogin/completed":
    case "mcpServer/startupStatus/updated":
    case "account/updated":
    case "account/rateLimits/updated":
    case "app/list/updated":
    case "remoteControl/status/changed":
    case "externalAgentConfig/import/completed":
    case "fs/changed":
    case "deprecationNotice":
    case "configWarning":
    case "fuzzyFileSearch/sessionUpdated":
    case "fuzzyFileSearch/sessionCompleted":
    case "windows/worldWritableWarning":
    case "windowsSandbox/setupCompleted":
    case "account/login/completed":
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
    case "applyPatchApproval":
    case "execCommandApproval":
      return null;
  }
}

export function messageTurnId(message: ServerNotification | ServerRequest): string | null {
  switch (message.method) {
    case "turn/started":
    case "turn/completed":
      return message.params.turn.id;
    case "error":
    case "thread/goal/updated":
    case "thread/tokenUsage/updated":
    case "hook/started":
    case "hook/completed":
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "item/started":
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
    case "item/completed":
    case "rawResponseItem/completed":
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
    case "item/fileChange/patchUpdated":
    case "item/mcpToolCall/progress":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
    case "thread/compacted":
    case "model/rerouted":
    case "model/verification":
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/tool/requestUserInput":
    case "mcpServer/elicitation/request":
    case "item/permissions/requestApproval":
    case "item/tool/call":
      return message.params.turnId;
    case "thread/started":
    case "thread/status/changed":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/closed":
    case "skills/changed":
    case "thread/name/updated":
    case "thread/goal/cleared":
    case "thread/settings/updated":
    case "command/exec/outputDelta":
    case "process/outputDelta":
    case "process/exited":
    case "serverRequest/resolved":
    case "mcpServer/oauthLogin/completed":
    case "mcpServer/startupStatus/updated":
    case "account/updated":
    case "account/rateLimits/updated":
    case "app/list/updated":
    case "remoteControl/status/changed":
    case "externalAgentConfig/import/completed":
    case "fs/changed":
    case "warning":
    case "guardianWarning":
    case "deprecationNotice":
    case "configWarning":
    case "fuzzyFileSearch/sessionUpdated":
    case "fuzzyFileSearch/sessionCompleted":
    case "thread/realtime/started":
    case "thread/realtime/itemAdded":
    case "thread/realtime/transcript/delta":
    case "thread/realtime/transcript/done":
    case "thread/realtime/outputAudio/delta":
    case "thread/realtime/sdp":
    case "thread/realtime/error":
    case "thread/realtime/closed":
    case "windows/worldWritableWarning":
    case "windowsSandbox/setupCompleted":
    case "account/login/completed":
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
    case "applyPatchApproval":
    case "execCommandApproval":
      return null;
  }
}

function isGlobalThreadLifecycleNotification(notification: ServerNotification): boolean {
  switch (notification.method) {
    case "thread/archived":
    case "thread/unarchived":
    case "thread/name/updated":
      return true;
    default:
      return false;
  }
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
