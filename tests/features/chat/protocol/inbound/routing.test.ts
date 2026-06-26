import { describe, expect, it } from "vitest";
import type { ServerNotification, ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { routeServerRequest } from "../../../../../src/app-server/server-requests";
import {
  PLANNED_SERVER_NOTIFICATION_METHODS_BY_ROUTE_KIND,
  planChatNotification,
} from "../../../../../src/features/chat/app-server/inbound/notification-plan";
import {
  ROUTED_SERVER_NOTIFICATION_METHODS_BY_ROUTE_KIND,
  routeServerNotification,
} from "../../../../../src/features/chat/app-server/inbound/notification-routing";
import { chatStateFixture, chatStateWith } from "../../support/state";

const activeScope = { activeThreadId: "thread-active", activeTurnId: "turn-active" };
type RouteScope = Parameters<typeof routeServerNotification>[1];
type NotificationRouteKind = ReturnType<typeof routeServerNotification>["kind"];
type RequestRouteKind = ReturnType<typeof routeServerRequest>["kind"];

describe("chat inbound routing", () => {
  it("keeps routed notification methods covered by matching planners", () => {
    expect(sortedMethods(PLANNED_SERVER_NOTIFICATION_METHODS_BY_ROUTE_KIND)).toEqual(
      sortedMethods(ROUTED_SERVER_NOTIFICATION_METHODS_BY_ROUTE_KIND),
    );
  });

  it("routes turn-scoped app-server messages for the active scope", () => {
    const notification = {
      method: "turn/completed",
      params: {
        threadId: "thread-active",
        turn: {
          id: "turn-active",
          status: "completed",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          itemsView: "full",
          items: [],
        },
      },
    } satisfies Extract<ServerNotification, { method: "turn/completed" }>;

    expectNotificationRouteKind(notification, "turnLifecycle");
    expectNotificationRouteKind(notification, "inactive", { activeThreadId: "thread-other", activeTurnId: "turn-active" });
    expectNotificationRouteKind(notification, "inactive", { activeThreadId: "thread-active", activeTurnId: "turn-other" });
  });

  it("routes thread-started notifications as global thread catalog events", () => {
    const notification = {
      method: "thread/started",
      params: { thread: threadSnapshot("thread-active") },
    } satisfies Extract<ServerNotification, { method: "thread/started" }>;

    expectNotificationRouteKind(notification, "threadLifecycle");
    expectNotificationRouteKind(notification, "threadLifecycle", { activeThreadId: "thread-other", activeTurnId: "turn-active" });
  });

  it.each([
    { name: "command approval", request: commandApprovalRequest(), kind: "approval" },
    { name: "file change approval", request: fileChangeApprovalRequest(), kind: "approval" },
    { name: "permissions approval", request: permissionsApprovalRequest(), kind: "approval" },
    { name: "user input", request: userInputRequest({ threadId: "thread-active" }), kind: "userInput" },
    { name: "MCP elicitation", request: mcpElicitationRequest(), kind: "mcpElicitation" },
    { name: "current time", request: currentTimeRequest("thread-active"), kind: "currentTime" },
    { name: "dynamic tool call", request: dynamicToolCallRequest(), kind: "unsupported" },
  ] as const)("classifies $name server requests and extracts scope", ({ request, kind }) => {
    expectRequestRouteKind(request, kind);
    if ("turnId" in request.params) {
      expectRequestRouteKind({ ...request, params: { ...request.params, turnId: "turn-other" } } as ServerRequest, "inactive");
    }
    expectRequestRouteKind({ ...request, params: { ...request.params, threadId: "thread-other" } } as ServerRequest, "inactive");
  });

  it("marks scoped messages inactive when the thread or turn does not match", () => {
    const otherThread = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-other", turnId: "turn-active", itemId: "item", delta: "ignored" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>;
    const otherTurn = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-active", turnId: "turn-other", itemId: "item", delta: "ignored" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>;

    expectNotificationRouteKind(otherThread, "inactive");
    expectNotificationRouteKind(otherTurn, "inactive");
  });

  it("marks delayed stream updates inactive after the active thread returns to idle", () => {
    const idleActiveThreadScope = { activeThreadId: "thread-active", activeTurnId: null };

    expectNotificationRouteKind(agentDeltaNotification(), "inactive", idleActiveThreadScope);
  });

  it("marks delayed turn-scoped requests inactive after the active thread returns to idle", () => {
    const idleActiveThreadScope = { activeThreadId: "thread-active", activeTurnId: null };
    const request = userInputRequest({ threadId: "thread-active" });

    expectRequestRouteKind(request, "inactive", idleActiveThreadScope);
  });

  it("routes thread catalog notifications even when another thread is active", () => {
    expectNotificationRouteKind({ method: "thread/archived", params: { threadId: "thread-other" } }, "threadLifecycle");
    expectNotificationRouteKind(
      { method: "thread/name/updated", params: { threadId: "thread-other", threadName: "Renamed" } },
      "threadLifecycle",
    );
    expectNotificationRouteKind({ method: "thread/unarchived", params: { threadId: "thread-other" } }, "threadLifecycle");
  });

  it("keeps active-thread, broadcast, and targeted-thread notification routing distinct", () => {
    expectNotificationRouteKind(threadSettingsUpdatedNotification(), "threadLifecycle");
    expectNotificationRouteKind(
      {
        method: "thread/settings/updated",
        params: { ...threadSettingsUpdatedNotification().params, threadId: "thread-other" },
      },
      "inactive",
    );

    expectNotificationRouteKind({ method: "skills/changed", params: {} }, "diagnosticStatus");
    expectNotificationRouteKind(threadArchivedNotification("thread-other"), "threadLifecycle");
  });

  it("keeps active-thread-only lifecycle notifications scoped to the active thread", () => {
    const notification = threadSettingsUpdatedNotification();
    expectNotificationRouteKind(
      {
        method: "thread/settings/updated",
        params: { ...notification.params, threadId: "thread-other" },
      },
      "inactive",
    );
  });

  it.each([
    { name: "command approval", request: commandApprovalRequest(), kind: "approval" },
    { name: "user input", request: userInputRequest(), kind: "userInput" },
    { name: "MCP elicitation", request: mcpElicitationRequest(), kind: "mcpElicitation" },
    { name: "current time", request: currentTimeRequest("thread-active"), kind: "currentTime" },
  ] as const)("classifies $name before unsupported requests", ({ request, kind }) => {
    expectRequestRouteKind(request, kind, { activeThreadId: null, activeTurnId: null });
  });

  it("classifies inactive requests before request-family handling", () => {
    const route = routeServerRequest(userInputRequest(), activeScope);

    expect(route.kind).toBe("inactive");
  });

  it.each(
    unscopedUnsupportedRequests().map((request) => ({
      name: request.method,
      request,
    })),
  )("keeps unscoped unsupported request $name out of active-turn routing", ({ request }) => {
    expectRequestRouteKind(request, "unsupported");
  });

  it("routes unknown runtime server requests to the unknown fallback", () => {
    const request = {
      id: 99,
      method: "future/request",
      params: { threadId: "thread-active", turnId: "turn-active" },
    } as unknown as ServerRequest;

    expectRequestRouteKind(request, "unknown");
    expectRequestRouteKind(
      {
        ...request,
        params: { threadId: "thread-other", turnId: "turn-active" },
      } as unknown as ServerRequest,
      "inactive",
    );
  });

  it.each([
    { name: "agent delta", notification: agentDeltaNotification(), kind: "streamUpdate" },
    { name: "turn started", notification: turnStartedNotification(), kind: "turnLifecycle" },
    { name: "thread archived", notification: threadArchivedNotification(), kind: "threadLifecycle" },
    { name: "thread settings updated", notification: threadSettingsUpdatedNotification(), kind: "threadLifecycle" },
    { name: "thread goal updated", notification: threadGoalUpdatedNotification(), kind: "threadLifecycle" },
    { name: "server request resolved", notification: serverRequestResolvedNotification(), kind: "requestResolved" },
    { name: "MCP startup status", notification: mcpStartupStatusNotification(), kind: "diagnosticStatus" },
    { name: "warning", notification: warningNotification(), kind: "userVisibleNotice" },
  ] as const)("classifies $name notifications without mutating state", ({ notification, kind }) => {
    expectNotificationRouteKind(notification, kind);
  });

  it("leaves unhandled app-server notifications explicit", () => {
    const route = routeServerNotification(
      {
        method: "account/updated",
        params: { authMode: null, planType: null },
      } satisfies Extract<ServerNotification, { method: "account/updated" }>,
      activeScope,
    );

    expect(route.kind).toBe("unhandled");
  });

  it("routes unknown runtime notifications to the unhandled fallback", () => {
    const notification = {
      method: "future/notification",
      params: { threadId: "thread-active", turnId: "turn-active" },
    } as unknown as ServerNotification;

    expectNotificationRouteKind(notification, "unhandled");
    expectNotificationRouteKind(
      {
        ...notification,
        params: { threadId: "thread-active", turnId: "turn-other" },
      } as unknown as ServerNotification,
      "inactive",
    );
  });

  it("safely ignores unknown runtime notifications in the planner", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-active" } });
    state = chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "turn-active" } } });
    const notification = {
      method: "future/notification",
      params: { threadId: "thread-active", turnId: "turn-active" },
    } as unknown as ServerNotification;

    expect(planChatNotification(state, notification, (prefix) => `${prefix}-1`)).toEqual({ actions: [], effects: [] });
  });

  it.each([
    { name: "raw response item completed", notification: rawResponseItemCompletedNotification },
    { name: "turn moderation metadata", notification: turnModerationMetadataNotification },
    { name: "terminal interaction", notification: terminalInteractionNotification },
    { name: "model verification", notification: modelVerificationNotification },
  ])("still scopes unhandled turn notification $name", ({ notification }) => {
    expectNotificationRouteKind(notification("thread-active", "turn-active"), "unhandled");
    expectNotificationRouteKind(notification("thread-other", "turn-active"), "inactive");
    expectNotificationRouteKind(notification("thread-active", "turn-other"), "inactive");
  });

  it.each([
    { name: "thread status changed", notification: threadStatusChangedNotification },
    { name: "thread closed", notification: threadClosedNotification },
  ])("still scopes unhandled thread lifecycle notification $name", ({ notification }) => {
    expectNotificationRouteKind(notification("thread-active"), "unhandled");
    expectNotificationRouteKind(notification("thread-other"), "inactive");
  });

  it("scopes MCP startup status notifications when app-server provides a thread id", () => {
    expectNotificationRouteKind(mcpStartupStatusNotificationForThread("thread-active"), "diagnosticStatus");
    expectNotificationRouteKind(mcpStartupStatusNotificationForThread("thread-other"), "inactive");
  });
});

function expectNotificationRouteKind(
  notification: ServerNotification,
  expectedKind: NotificationRouteKind,
  scope: RouteScope = activeScope,
): void {
  expect(routeServerNotification(notification, scope).kind).toBe(expectedKind);
}

function expectRequestRouteKind(request: ServerRequest, expectedKind: RequestRouteKind, scope: RouteScope = activeScope): void {
  expect(routeServerRequest(request, scope).kind).toBe(expectedKind);
}

function commandApprovalRequest(): ServerRequest {
  return {
    id: 1,
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm test",
      cwd: "/tmp/project",
      threadId: "thread-active",
      turnId: "turn-active",
      itemId: "command",
      environmentId: null,
      startedAtMs: 1,
      reason: null,
      commandActions: [],
      proposedExecpolicyAmendment: null,
      proposedNetworkPolicyAmendments: [],
    },
  };
}

function userInputRequest(
  overrides: Partial<Extract<ServerRequest, { method: "item/tool/requestUserInput" }>["params"]> = {},
): ServerRequest {
  return {
    id: 2,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-other",
      turnId: "turn-active",
      itemId: "input",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
      autoResolutionMs: null,
      ...overrides,
    },
  };
}

function fileChangeApprovalRequest(): ServerRequest {
  return {
    id: 8,
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      itemId: "file-change",
      startedAtMs: 1,
      reason: "Need write access",
      grantRoot: "/tmp/project",
    },
  };
}

function permissionsApprovalRequest(): ServerRequest {
  return {
    id: 9,
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      itemId: "permissions",
      startedAtMs: 1,
      cwd: "/tmp/project",
      reason: "Need network",
      environmentId: null,
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  };
}

function mcpElicitationRequest(): ServerRequest {
  return {
    id: 3,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      serverName: "github",
      mode: "form",
      _meta: null,
      message: "Need input",
      requestedSchema: { type: "object", properties: {} },
    },
  };
}

function dynamicToolCallRequest(): ServerRequest {
  return {
    id: 10,
    method: "item/tool/call",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      callId: "call",
      namespace: null,
      tool: "example",
      arguments: {},
    },
  };
}

function currentTimeRequest(threadId: string): ServerRequest {
  return {
    id: 11,
    method: "currentTime/read",
    params: { threadId },
  };
}

function unscopedUnsupportedRequests(): ServerRequest[] {
  return [
    {
      id: 4,
      method: "account/chatgptAuthTokens/refresh",
      params: { reason: "unauthorized", previousAccountId: null },
    },
    {
      id: 5,
      method: "attestation/generate",
      params: {},
    },
    {
      id: 6,
      method: "applyPatchApproval",
      params: { conversationId: "thread-active", callId: "patch-1", fileChanges: {}, reason: "Patch requested", grantRoot: null },
    },
    {
      id: 7,
      method: "execCommandApproval",
      params: {
        conversationId: "thread-active",
        callId: "exec-1",
        approvalId: null,
        command: ["npm", "test"],
        cwd: "/tmp/project",
        reason: "Run tests",
        parsedCmd: [],
      },
    },
  ];
}

function agentDeltaNotification(): ServerNotification {
  return {
    method: "item/agentMessage/delta",
    params: { threadId: "thread-active", turnId: "turn-active", itemId: "agent", delta: "hello" },
  };
}

function turnStartedNotification(): ServerNotification {
  return {
    method: "turn/started",
    params: {
      threadId: "thread-active",
      turn: {
        id: "turn-active",
        status: "inProgress",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        itemsView: "full",
        items: [],
      },
    },
  };
}

function sortedMethods(methodsByRouteKind: Record<string, readonly string[]>): Record<string, readonly string[]> {
  return Object.fromEntries(Object.entries(methodsByRouteKind).map(([kind, methods]) => [kind, [...methods].sort()]));
}

function threadArchivedNotification(threadId = "thread-active"): ServerNotification {
  return {
    method: "thread/archived",
    params: { threadId },
  };
}

function threadSettingsUpdatedNotification(): Extract<ServerNotification, { method: "thread/settings/updated" }> {
  return {
    method: "thread/settings/updated",
    params: {
      threadId: "thread-active",
      threadSettings: {
        cwd: "/vault",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        model: "gpt-5.5",
        modelProvider: "openai",
        serviceTier: null,
        approvalPolicy: "on-request",
        effort: "medium",
        summary: null,
        collaborationMode: { mode: "default", settings: { model: "gpt-5.5", reasoning_effort: "medium", developer_instructions: null } },
        activePermissionProfile: null,
        multiAgentMode: "explicitRequestOnly",
        personality: null,
      },
    },
  };
}

function threadGoalUpdatedNotification(): ServerNotification {
  return {
    method: "thread/goal/updated",
    params: {
      threadId: "thread-active",
      turnId: null,
      goal: {
        threadId: "thread-active",
        objective: "Finish",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  };
}

function serverRequestResolvedNotification(): ServerNotification {
  return {
    method: "serverRequest/resolved",
    params: { threadId: "thread-active", requestId: 2 },
  };
}

function mcpStartupStatusNotification(): ServerNotification {
  return mcpStartupStatusNotificationForThread(null);
}

function mcpStartupStatusNotificationForThread(threadId: string | null): ServerNotification {
  return {
    method: "mcpServer/startupStatus/updated",
    params: { threadId, name: "github", status: "failed", error: "missing token" },
  };
}

function turnModerationMetadataNotification(
  threadId: string,
  turnId: string,
): Extract<ServerNotification, { method: "turn/moderationMetadata" }> {
  return {
    method: "turn/moderationMetadata",
    params: { threadId, turnId, metadata: { blocked: false } },
  };
}

function terminalInteractionNotification(
  threadId: string,
  turnId: string,
): Extract<ServerNotification, { method: "item/commandExecution/terminalInteraction" }> {
  return {
    method: "item/commandExecution/terminalInteraction",
    params: { threadId, turnId, itemId: "command", processId: "process", stdin: "q" },
  };
}

function modelVerificationNotification(threadId: string, turnId: string): Extract<ServerNotification, { method: "model/verification" }> {
  return {
    method: "model/verification",
    params: { threadId, turnId, verifications: ["trustedAccessForCyber"] },
  };
}

function threadStatusChangedNotification(threadId: string): Extract<ServerNotification, { method: "thread/status/changed" }> {
  return {
    method: "thread/status/changed",
    params: { threadId, status: { type: "idle" } },
  };
}

function threadClosedNotification(threadId: string): Extract<ServerNotification, { method: "thread/closed" }> {
  return {
    method: "thread/closed",
    params: { threadId },
  };
}

function warningNotification(): ServerNotification {
  return {
    method: "warning",
    params: { threadId: null, message: "careful" },
  };
}

function rawResponseItemCompletedNotification(
  threadId: string,
  turnId: string,
): Extract<ServerNotification, { method: "rawResponseItem/completed" }> {
  return {
    method: "rawResponseItem/completed",
    params: {
      threadId,
      turnId,
      item: {
        type: "message",
        role: "assistant",
        content: [],
      },
    },
  };
}

function threadSnapshot(id: string): Extract<ServerNotification, { method: "thread/started" }>["params"]["thread"] {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: null,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}
