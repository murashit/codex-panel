import { describe, expect, it } from "vitest";

import {
  ROUTED_SERVER_NOTIFICATION_METHODS_BY_ROUTE_KIND,
  routeServerNotification,
  routeServerRequest,
} from "../../../../../src/features/chat/app-server/inbound/routing";
import {
  PLANNED_SERVER_NOTIFICATION_METHODS_BY_ROUTE_KIND,
  planChatNotification,
} from "../../../../../src/features/chat/app-server/inbound/notification-plan";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import type { ServerNotification, ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";

const activeScope = { activeThreadId: "thread-active", activeTurnId: "turn-active" };

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

    expect(routeServerNotification(notification, activeScope).kind).toBe("turnLifecycle");
    expect(routeServerNotification(notification, { activeThreadId: "thread-other", activeTurnId: "turn-active" }).kind).toBe("inactive");
    expect(routeServerNotification(notification, { activeThreadId: "thread-active", activeTurnId: "turn-other" }).kind).toBe("inactive");
  });

  it("routes thread-started notifications for the active thread", () => {
    const notification = {
      method: "thread/started",
      params: { thread: threadSnapshot("thread-active") },
    } satisfies Extract<ServerNotification, { method: "thread/started" }>;

    expect(routeServerNotification(notification, activeScope).kind).toBe("threadLifecycle");
    expect(routeServerNotification(notification, { activeThreadId: "thread-other", activeTurnId: "turn-active" }).kind).toBe("inactive");
  });

  it("classifies every active-thread server request method and extracts its scope", () => {
    const requests = [
      { request: commandApprovalRequest(), kind: "approval" },
      { request: fileChangeApprovalRequest(), kind: "approval" },
      { request: permissionsApprovalRequest(), kind: "approval" },
      { request: userInputRequest({ threadId: "thread-active" }), kind: "userInput" },
      { request: mcpElicitationRequest(), kind: "unsupported" },
      { request: dynamicToolCallRequest(), kind: "unsupported" },
    ] as const;

    for (const { request, kind } of requests) {
      expect(routeServerRequest(request, activeScope).kind).toBe(kind);
      expect(
        routeServerRequest({ ...request, params: { ...request.params, turnId: "turn-other" } } as ServerRequest, activeScope).kind,
      ).toBe("inactive");
    }
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

    expect(routeServerNotification(otherThread, activeScope).kind).toBe("inactive");
    expect(routeServerNotification(otherTurn, activeScope).kind).toBe("inactive");
  });

  it("marks delayed stream updates inactive after the active thread returns to idle", () => {
    const idleActiveThreadScope = { activeThreadId: "thread-active", activeTurnId: null };

    expect(routeServerNotification(agentDeltaNotification(), idleActiveThreadScope).kind).toBe("inactive");
  });

  it("marks delayed turn-scoped requests inactive after the active thread returns to idle", () => {
    const idleActiveThreadScope = { activeThreadId: "thread-active", activeTurnId: null };
    const request = userInputRequest({ threadId: "thread-active" });

    expect(routeServerRequest(request, idleActiveThreadScope).kind).toBe("inactive");
  });

  it("routes thread catalog notifications even when another thread is active", () => {
    expect(routeServerNotification({ method: "thread/archived", params: { threadId: "thread-other" } }, activeScope).kind).toBe(
      "threadLifecycle",
    );
    expect(
      routeServerNotification({ method: "thread/name/updated", params: { threadId: "thread-other", threadName: "Renamed" } }, activeScope)
        .kind,
    ).toBe("threadLifecycle");
    expect(routeServerNotification({ method: "thread/unarchived", params: { threadId: "thread-other" } }, activeScope).kind).toBe(
      "threadLifecycle",
    );
  });

  it("keeps active-thread, broadcast, and targeted-thread notification routing distinct", () => {
    expect(routeServerNotification(threadSettingsUpdatedNotification(), activeScope).kind).toBe("threadLifecycle");
    expect(
      routeServerNotification(
        {
          method: "thread/settings/updated",
          params: { ...threadSettingsUpdatedNotification().params, threadId: "thread-other" },
        },
        activeScope,
      ).kind,
    ).toBe("inactive");

    expect(routeServerNotification({ method: "skills/changed", params: {} }, activeScope).kind).toBe("diagnosticStatus");
    expect(routeServerNotification(threadArchivedNotification("thread-other"), activeScope).kind).toBe("threadLifecycle");
  });

  it("keeps active-thread-only lifecycle notifications scoped to the active thread", () => {
    const notification = threadSettingsUpdatedNotification();
    expect(
      routeServerNotification(
        {
          method: "thread/settings/updated",
          params: { ...notification.params, threadId: "thread-other" },
        },
        activeScope,
      ).kind,
    ).toBe("inactive");
  });

  it("classifies supported server request families before unsupported requests", () => {
    expect(routeServerRequest(commandApprovalRequest(), { activeThreadId: null, activeTurnId: null }).kind).toBe("approval");
    expect(routeServerRequest(userInputRequest(), { activeThreadId: null, activeTurnId: null }).kind).toBe("userInput");
    expect(routeServerRequest(mcpElicitationRequest(), { activeThreadId: null, activeTurnId: null }).kind).toBe("unsupported");
  });

  it("classifies inactive requests before request-family handling", () => {
    const route = routeServerRequest(userInputRequest(), activeScope);

    expect(route.kind).toBe("inactive");
  });

  it("keeps unscoped unsupported requests out of active-turn routing", () => {
    for (const request of unscopedUnsupportedRequests()) {
      expect(routeServerRequest(request, activeScope).kind).toBe("unsupported");
    }
  });

  it("routes unknown runtime server requests to the unknown fallback", () => {
    const request = {
      id: 99,
      method: "future/request",
      params: { threadId: "thread-active", turnId: "turn-active" },
    } as unknown as ServerRequest;

    expect(routeServerRequest(request, activeScope).kind).toBe("unknown");
    expect(
      routeServerRequest(
        {
          ...request,
          params: { threadId: "thread-other", turnId: "turn-active" },
        } as unknown as ServerRequest,
        activeScope,
      ).kind,
    ).toBe("inactive");
  });

  it("classifies notification categories without mutating state", () => {
    expect(routeServerNotification(agentDeltaNotification(), activeScope).kind).toBe("streamUpdate");
    expect(routeServerNotification(turnStartedNotification(), activeScope).kind).toBe("turnLifecycle");
    expect(routeServerNotification(threadArchivedNotification(), activeScope).kind).toBe("threadLifecycle");
    expect(routeServerNotification(threadSettingsUpdatedNotification(), activeScope).kind).toBe("threadLifecycle");
    expect(routeServerNotification(threadGoalUpdatedNotification(), activeScope).kind).toBe("threadLifecycle");
    expect(routeServerNotification(serverRequestResolvedNotification(), activeScope).kind).toBe("requestResolved");
    expect(routeServerNotification(mcpStartupStatusNotification(), activeScope).kind).toBe("diagnosticStatus");
    expect(routeServerNotification(warningNotification(), activeScope).kind).toBe("userVisibleNotice");
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

    expect(routeServerNotification(notification, activeScope).kind).toBe("unhandled");
    expect(
      routeServerNotification(
        {
          ...notification,
          params: { threadId: "thread-active", turnId: "turn-other" },
        } as unknown as ServerNotification,
        activeScope,
      ).kind,
    ).toBe("inactive");
  });

  it("safely ignores unknown runtime notifications in the planner", () => {
    const state = createChatState();
    state.activeThread.id = "thread-active";
    state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
    const notification = {
      method: "future/notification",
      params: { threadId: "thread-active", turnId: "turn-active" },
    } as unknown as ServerNotification;

    expect(planChatNotification(state, notification, (prefix) => `${prefix}-1`)).toEqual({ actions: [], effects: [] });
  });

  it("still scopes app-server notifications that Codex Panel does not handle", () => {
    expect(routeServerNotification(rawResponseItemCompletedNotification("thread-active", "turn-active"), activeScope).kind).toBe(
      "unhandled",
    );
    expect(routeServerNotification(rawResponseItemCompletedNotification("thread-other", "turn-active"), activeScope).kind).toBe("inactive");
    expect(routeServerNotification(rawResponseItemCompletedNotification("thread-active", "turn-other"), activeScope).kind).toBe("inactive");

    expect(routeServerNotification(turnModerationMetadataNotification("thread-active", "turn-active"), activeScope).kind).toBe("unhandled");
    expect(routeServerNotification(turnModerationMetadataNotification("thread-other", "turn-active"), activeScope).kind).toBe("inactive");
    expect(routeServerNotification(turnModerationMetadataNotification("thread-active", "turn-other"), activeScope).kind).toBe("inactive");

    expect(routeServerNotification(terminalInteractionNotification("thread-active", "turn-active"), activeScope).kind).toBe("unhandled");
    expect(routeServerNotification(terminalInteractionNotification("thread-other", "turn-active"), activeScope).kind).toBe("inactive");
    expect(routeServerNotification(terminalInteractionNotification("thread-active", "turn-other"), activeScope).kind).toBe("inactive");

    expect(routeServerNotification(modelVerificationNotification("thread-active", "turn-active"), activeScope).kind).toBe("unhandled");
    expect(routeServerNotification(modelVerificationNotification("thread-other", "turn-active"), activeScope).kind).toBe("inactive");
    expect(routeServerNotification(modelVerificationNotification("thread-active", "turn-other"), activeScope).kind).toBe("inactive");
  });

  it("still scopes unhandled thread lifecycle notifications", () => {
    expect(routeServerNotification(threadStatusChangedNotification("thread-active"), activeScope).kind).toBe("unhandled");
    expect(routeServerNotification(threadStatusChangedNotification("thread-other"), activeScope).kind).toBe("inactive");
    expect(routeServerNotification(threadClosedNotification("thread-active"), activeScope).kind).toBe("unhandled");
    expect(routeServerNotification(threadClosedNotification("thread-other"), activeScope).kind).toBe("inactive");
  });

  it("scopes MCP startup status notifications when app-server provides a thread id", () => {
    expect(routeServerNotification(mcpStartupStatusNotificationForThread("thread-active"), activeScope).kind).toBe("diagnosticStatus");
    expect(routeServerNotification(mcpStartupStatusNotificationForThread("thread-other"), activeScope).kind).toBe("inactive");
  });
});

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
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        activePermissionProfile: null,
        model: "gpt-5.5",
        modelProvider: "openai",
        serviceTier: null,
        effort: "medium",
        summary: null,
        collaborationMode: { mode: "default", settings: { model: "gpt-5.5", reasoning_effort: "medium", developer_instructions: null } },
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
