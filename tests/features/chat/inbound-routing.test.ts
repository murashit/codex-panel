import { describe, expect, it } from "vitest";

import {
  isMessageInActiveScope,
  messageThreadId,
  messageTurnId,
  routeServerNotification,
  routeServerRequest,
} from "../../../src/features/chat/inbound-routing";
import type { ServerNotification } from "../../../src/generated/app-server/ServerNotification";
import type { ServerRequest } from "../../../src/generated/app-server/ServerRequest";

const activeScope = { activeThreadId: "thread-active", activeTurnId: "turn-active" };

describe("chat inbound routing", () => {
  it("extracts thread and turn ids from app-server messages", () => {
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

    expect(messageThreadId(notification)).toBe("thread-active");
    expect(messageTurnId(notification)).toBe("turn-active");
    expect(isMessageInActiveScope(notification, activeScope)).toBe(true);
  });

  it("extracts the thread id from thread started notifications", () => {
    const notification = {
      method: "thread/started",
      params: { thread: threadSnapshot("thread-active") },
    } satisfies Extract<ServerNotification, { method: "thread/started" }>;

    expect(messageThreadId(notification)).toBe("thread-active");
    expect(messageTurnId(notification)).toBeNull();
    expect(isMessageInActiveScope(notification, activeScope)).toBe(true);
  });

  it("extracts thread and turn ids from approval and user input requests", () => {
    expect(messageThreadId(commandApprovalRequest())).toBe("thread-active");
    expect(messageTurnId(commandApprovalRequest())).toBe("turn-active");
    expect(messageThreadId(userInputRequest())).toBe("thread-other");
    expect(messageTurnId(userInputRequest())).toBe("turn-active");
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

  it("routes global thread lifecycle notifications even when another thread is active", () => {
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

function userInputRequest(): ServerRequest {
  return {
    id: 2,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-other",
      turnId: "turn-active",
      itemId: "input",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
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

function threadArchivedNotification(): ServerNotification {
  return {
    method: "thread/archived",
    params: { threadId: "thread-active" },
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
  return {
    method: "mcpServer/startupStatus/updated",
    params: { name: "github", status: "failed", error: "missing token" },
  };
}

function warningNotification(): ServerNotification {
  return {
    method: "warning",
    params: { threadId: null, message: "careful" },
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
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}
