import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerNotification, ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { planChatInboundNotification } from "../../../../../src/features/chat/app-server/inbound/notification-plan";
import { routeServerNotification } from "../../../../../src/features/chat/app-server/inbound/notification-routing";
import { routeServerRequest } from "../../../../../src/features/chat/app-server/inbound/server-request-routing";
import { chatReducer } from "../../../../../src/features/chat/application/state/reducer";
import { chatStateFixture, chatStateWith } from "../../support/state";

const activeScope = { activeThreadId: "thread-active", activeTurnId: "turn-active" };
type RouteScope = Parameters<typeof routeServerNotification>[1];
type NotificationRouteKind = ReturnType<typeof routeServerNotification>["kind"];
type RequestRouteKind = ReturnType<typeof routeServerRequest>["kind"];

describe("chat inbound routing", () => {
  it("leaves context-owned lifecycle and deprecated notifications outside panel routing", () => {
    const unhandled = generatedServerNotificationMethods().filter(
      (method) => routeServerNotification(notificationFixture(method), activeScope).kind === "unhandled",
    );

    expect(unhandled).toEqual([
      "account/rateLimits/updated",
      "item/fileChange/outputDelta",
      "mcpServer/event/stream/notification",
      "project/changed",
      "skills/changed",
      "thread/archived",
      "thread/compacted",
      "thread/deleted",
      "thread/name/updated",
      "thread/project/updated",
      "thread/queue/changed",
      "thread/realtime/item/completed",
      "thread/realtime/item/started",
      "thread/realtime/item/transcript/delta",
      "thread/reverted",
      "thread/unarchived",
    ]);
  });

  it("keeps routed notification methods covered by matching planners", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-active" } });
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } } });
    const plannedMethods = generatedServerNotificationMethods().filter((method) => {
      const kind = routeServerNotification(notificationFixture(method), activeScope).kind;
      return kind !== "inactive" && kind !== "ignored" && kind !== "unhandled";
    });

    expect(() => {
      for (const method of plannedMethods) {
        planChatInboundNotification(state, notificationFixture(method), (prefix) => `${prefix}-1`);
      }
    }).not.toThrow();
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

  it("routes auth recovery only to the matching active turn", () => {
    const notification = authRecoveryNotification("modelProvider/authRecoveryStarted");

    expectNotificationRouteKind(notification, "streamUpdate");
    expectNotificationRouteKind(notification, "inactive", { activeThreadId: "thread-active", activeTurnId: "turn-other" });
    expectNotificationRouteKind(notification, "inactive", { activeThreadId: "thread-active", activeTurnId: null });
  });

  it("projects tracked child auth recovery into its temporary activity preview", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-active" } });
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } } });
    state = chatReducer(state, { type: "subagent-activity/tracked", threadId: "thread-child", parentTurnId: "turn-active" });
    state = chatReducer(state, { type: "subagent-activity/turn-started", threadId: "thread-child", childTurnId: "turn-child" });

    const plan = planChatInboundNotification(
      state,
      {
        method: "modelProvider/authRecoveryCompleted",
        params: {
          threadId: "thread-child",
          turnId: "turn-child",
          provider: "aws",
          message: "Authentication refreshed.",
        },
      },
      () => "unused",
    );

    expect(plan.actions).toEqual([
      {
        type: "subagent-activity/auth-recovery-updated",
        threadId: "thread-child",
        childTurnId: "turn-child",
        message: "Authentication refreshed.",
      },
    ]);
  });

  it("does not turn live turn-start state into thread catalog work", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-active" } });
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } } });

    const plan = planChatInboundNotification(state, turnStartedNotification(), (prefix) => `${prefix}-1`);

    expect(plan.effects).toEqual([]);
  });

  it("translates turn-completed runtime outcomes to thread follow-up effects at the inbound boundary", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-active" } });
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } } });

    const plan = planChatInboundNotification(state, turnCompletedNotification(), (prefix) => `${prefix}-1`);

    expect(plan.effects).toEqual([
      {
        type: "maybe-name-thread",
        threadId: "thread-active",
        turnId: "turn-active",
        completedTurnTranscriptSummary: { userText: "hello", assistantText: "done" },
      },
    ]);
  });

  it.each([
    { name: "command approval", request: commandApprovalRequest(), kind: "approval" },
    { name: "file change approval", request: fileChangeApprovalRequest(), kind: "approval" },
    { name: "permissions approval", request: permissionsApprovalRequest(), kind: "approval" },
    { name: "user input", request: userInputRequest({ threadId: "thread-active" }), kind: "userInput" },
    { name: "MCP elicitation", request: mcpElicitationRequest(), kind: "mcpElicitation" },
    { name: "current time", request: currentTimeRequest("thread-active"), kind: "currentTime" },
    { name: "dynamic tool call", request: dynamicToolCallRequest(), kind: "dynamicTool" },
  ] as const)("classifies $name server requests and extracts scope", ({ request, kind }) => {
    expectRequestRouteKind(request, kind);
    expectRequestRouteKind(request, "inactive", { activeThreadId: null, activeTurnId: null });
    if ("turnId" in request.params) {
      expectRequestRouteKind({ ...request, params: { ...request.params, turnId: "turn-other" } } as ServerRequest, "inactive");
    }
    expectRequestRouteKind({ ...request, params: { ...request.params, threadId: "thread-other" } } as ServerRequest, "inactive");
  });

  it("routes MCP forms with unsupported fields to diagnostic rejection", () => {
    const request = mcpElicitationRequest();
    const unsupported = {
      ...request,
      params: {
        ...request.params,
        requestedSchema: {
          type: "object",
          required: ["nested"],
          properties: { nested: { type: "object" } },
        },
      },
    } as ServerRequest;

    expectRequestRouteKind(unsupported, "unsupported");
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

  it("keeps scoped running-turn content out of an empty panel", () => {
    const emptyState = chatStateFixture();
    const notification = {
      method: "turn/plan/updated",
      params: {
        threadId: "thread-active",
        turnId: "turn-active",
        explanation: "Private running turn content",
        plan: [{ step: "Leaked step", status: "inProgress" }],
      },
    } satisfies Extract<ServerNotification, { method: "turn/plan/updated" }>;

    expectNotificationRouteKind(notification, "inactive", { activeThreadId: null, activeTurnId: null });
    expect(planChatInboundNotification(emptyState, notification, (prefix) => `${prefix}-1`)).toEqual({ actions: [], effects: [] });
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

  it("delivers thread starts outside the active scope", () => {
    expectNotificationRouteKind({ method: "thread/started", params: { thread: threadSnapshot("thread-other") } }, "threadLifecycle");
  });

  it("preserves thread catalog routing for malformed thread-started payloads", () => {
    // This deliberately crosses the runtime boundary: the app-server payload is malformed, but catalog routing does not need its scope.
    const malformedNotification = {
      method: "thread/started",
      params: {},
    } as unknown as ServerNotification;

    expect(routeServerNotification(malformedNotification, activeScope)).toEqual({
      kind: "threadLifecycle",
      notification: malformedNotification,
    });
  });

  it("keeps active-thread and targeted-thread notification routing distinct", () => {
    expectNotificationRouteKind(threadSettingsUpdatedNotification(), "threadLifecycle");
    expectNotificationRouteKind(
      {
        method: "thread/settings/updated",
        params: { ...threadSettingsUpdatedNotification().params, threadId: "thread-other" },
      },
      "inactive",
    );
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
    { name: "thread settings updated", notification: threadSettingsUpdatedNotification(), kind: "threadLifecycle" },
    { name: "thread goal updated", notification: threadGoalUpdatedNotification(), kind: "ignored" },
    { name: "server request resolved", notification: serverRequestResolvedNotification(), kind: "requestResolved" },
    { name: "MCP startup status", notification: mcpStartupStatusNotification(), kind: "diagnosticStatus" },
    { name: "warning", notification: warningNotification(), kind: "userVisibleNotice" },
  ] as const)("classifies $name notifications without mutating state", ({ notification, kind }) => {
    expectNotificationRouteKind(notification, kind);
  });

  it("keeps ignored app-server notifications explicit", () => {
    const route = routeServerNotification(
      {
        method: "account/updated",
        params: { authMode: null, planType: null },
      } satisfies Extract<ServerNotification, { method: "account/updated" }>,
      activeScope,
    );

    expect(route.kind).toBe("ignored");
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
    state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } } });
    const notification = {
      method: "future/notification",
      params: { threadId: "thread-active", turnId: "turn-active" },
    } as unknown as ServerNotification;

    expect(planChatInboundNotification(state, notification, (prefix) => `${prefix}-1`)).toEqual({ actions: [], effects: [] });
  });

  it.each([
    { name: "raw response item completed", notification: rawResponseItemCompletedNotification },
    { name: "raw response completed", notification: rawResponseCompletedNotification },
    { name: "turn moderation metadata", notification: turnModerationMetadataNotification },
    { name: "terminal interaction", notification: terminalInteractionNotification },
    { name: "model verification", notification: modelVerificationNotification },
    { name: "strict review required", notification: strictReviewRequiredNotification },
  ])("still scopes ignored turn notification $name", ({ notification }) => {
    expectNotificationRouteKind(notification("thread-active", "turn-active"), "ignored");
    expectNotificationRouteKind(notification("thread-other", "turn-active"), "inactive");
    expectNotificationRouteKind(notification("thread-active", "turn-other"), "inactive");
  });

  it.each([
    { name: "thread status changed", notification: threadStatusChangedNotification },
    { name: "thread closed", notification: threadClosedNotification },
    { name: "environment connected", notification: environmentConnectedNotification },
    { name: "environment disconnected", notification: environmentDisconnectedNotification },
  ])("still scopes ignored thread lifecycle notification $name", ({ notification }) => {
    expectNotificationRouteKind(notification("thread-active"), "ignored");
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
      kind: "command",
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
      isBlocking: true,
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

function turnCompletedNotification(): ServerNotification {
  return {
    method: "turn/completed",
    params: {
      threadId: "thread-active",
      turn: {
        id: "turn-active",
        status: "completed",
        error: null,
        startedAt: null,
        completedAt: 2,
        durationMs: 1,
        itemsView: "full",
        items: [
          { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "hello", text_elements: [] }] },
          { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null, delivery: null, questions: null },
        ],
      },
    },
  };
}

function generatedServerNotificationMethods(): string[] {
  const generated = readFileSync(path.join(process.cwd(), "src/generated/app-server/ServerNotification.ts"), "utf8");
  return [...generated.matchAll(/"method": "([^"]+)"/g)]
    .map((match) => {
      const method = match[1];
      if (!method) throw new Error("Expected generated notification method match.");
      return method;
    })
    .sort();
}

function notificationFixture(method: string): ServerNotification {
  return {
    method,
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      thread: threadSnapshot("thread-active"),
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
      item: { type: "agentMessage", id: "item", text: "hello" },
      itemId: "item",
      requestId: 1,
      delta: "delta",
      diff: "",
      changes: [],
      explanation: null,
      plan: [],
      run: {
        id: "run",
        eventName: "userPromptSubmit",
        status: "completed",
        statusMessage: null,
        startedAt: 1,
        durationMs: null,
        entries: [],
      },
      name: "github",
      status: "ready",
      error: null,
      message: "notice",
      success: true,
      tokenUsage: {
        total: tokenBreakdownFixture(),
        last: tokenBreakdownFixture(),
        modelContextWindow: null,
      },
      threadSettings: {
        cwd: "/vault",
        model: "gpt-5.5",
        effort: "medium",
        collaborationMode: { mode: "default" },
        serviceTier: null,
        approvalsReviewer: "user",
      },
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
      startedAtMs: 1,
      reviewId: "review",
      targetItemId: null,
      review: { status: "approved", riskLevel: null, userAuthorization: null, rationale: null },
      action: { type: "command", source: "user", command: "npm test", cwd: "/vault" },
      completedAtMs: 2,
      decisionSource: "auto",
    },
  } as unknown as ServerNotification;
}

function tokenBreakdownFixture(): {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
} {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
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
    params: { threadId, name: "github", status: "failed", error: "missing token", failureReason: null },
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

function strictReviewRequiredNotification(
  threadId: string,
  turnId: string,
): Extract<ServerNotification, { method: "autoApprovalReview/strictReviewRequired" }> {
  return {
    method: "autoApprovalReview/strictReviewRequired",
    params: { threadId, turnId, startedAtMs: 1 },
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

function authRecoveryNotification(
  method: "modelProvider/authRecoveryStarted" | "modelProvider/authRecoveryCompleted",
): Extract<ServerNotification, { method: typeof method }> {
  return {
    method,
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      provider: "aws",
      message: "Refreshing AWS authentication.",
    },
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

function rawResponseCompletedNotification(
  threadId: string,
  turnId: string,
): Extract<ServerNotification, { method: "rawResponse/completed" }> {
  return {
    method: "rawResponse/completed",
    params: { threadId, turnId, responseId: "response", usage: null, usageMetadata: null },
  };
}

function environmentConnectedNotification(threadId: string): Extract<ServerNotification, { method: "thread/environment/connected" }> {
  return { method: "thread/environment/connected", params: { threadId, environmentId: "environment" } };
}

function environmentDisconnectedNotification(threadId: string): Extract<ServerNotification, { method: "thread/environment/disconnected" }> {
  return { method: "thread/environment/disconnected", params: { threadId, environmentId: "environment" } };
}

function threadSnapshot(id: string): Extract<ServerNotification, { method: "thread/started" }>["params"]["thread"] {
  return {
    id,
    extra: null,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Preview",
    ephemeral: false,
    historyMode: "paginated",
    projectId: null,
    modelProvider: "openai",
    model: null,
    reasoningEffort: null,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: null,
    section: null,
    sectionEnteredAt: null,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "unknown",
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}
