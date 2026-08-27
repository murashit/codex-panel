import { describe, expect, it, vi } from "vitest";
import type { ConnectionManagerHandlers } from "../../../../../src/app-server/connection/connection-manager";
import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createSessionConnection } from "../../../../../src/features/chat/host/session/connection";
import { chatStateFixture } from "../../support/state";

type SessionConnectionHost = Parameters<typeof createSessionConnection>[0];
type SessionConnectionInput = Parameters<typeof createSessionConnection>[1];

describe("session connection", () => {
  it("responds through the responder that delivered the request", async () => {
    const fixture = sessionConnectionFixture();
    await fixture.connect();
    const responder = { respond: vi.fn(), reject: vi.fn() };

    fixture.deliver(userInputRequest(1), responder);
    fixture.resolveUserInput(1, { note: "Continue" });

    expect(responder.respond).toHaveBeenCalledWith({ answers: { note: { answers: ["Continue"] } } });
  });

  it("rejects each pending root and child responder once when its panel connection scope is invalidated", async () => {
    const fixture = sessionConnectionFixture();
    await fixture.connect();
    const rootResponder = { respond: vi.fn(), reject: vi.fn() };
    const childResponder = { respond: vi.fn(), reject: vi.fn() };

    fixture.deliver(userInputRequest(1), rootResponder);
    fixture.stateStore.dispatch({ type: "subagent-activity/tracked", threadId: "child", parentTurnId: "turn-active" });
    fixture.stateStore.dispatch({ type: "subagent-activity/turn-started", threadId: "child", childTurnId: "child-turn" });
    fixture.deliver(commandApprovalRequest(2, "child", "child-turn"), childResponder);
    expect(fixture.stateStore.getState().requests.pendingUserInputs).toHaveLength(1);
    expect(fixture.stateStore.getState().requests.approvals).toHaveLength(1);
    fixture.invalidate();
    fixture.invalidate();
    fixture.resolveUserInput(1, { note: "Continue" });
    fixture.resolveApproval(2, "accept");

    for (const responder of [rootResponder, childResponder]) {
      expect(responder.respond).not.toHaveBeenCalled();
      expect(responder.reject).toHaveBeenCalledOnce();
      expect(responder.reject).toHaveBeenCalledWith(-32000, "Codex Panel disconnected before the request was answered.");
    }
  });

  it("retains a responder when synchronous delivery throws", async () => {
    const fixture = sessionConnectionFixture();
    await fixture.connect();
    const responder = {
      respond: vi.fn().mockImplementationOnce(() => {
        throw new Error("transport busy");
      }),
      reject: vi.fn(),
    };

    fixture.deliver(userInputRequest(1), responder);
    fixture.resolveUserInput(1, { note: "Continue" });
    fixture.resolveUserInput(1, { note: "Continue" });

    expect(responder.respond).toHaveBeenCalledTimes(2);
    expect(fixture.stateStore.getState().requests.pendingUserInputs).toEqual([]);
  });

  it("does not carry a completed approval decision across connection invalidation", async () => {
    const fixture = sessionConnectionFixture();
    await fixture.connect();
    const parentResponder = { respond: vi.fn(), reject: vi.fn() };
    fixture.deliver(commandApprovalRequest(1, "thread-active", "turn-active"), parentResponder);
    fixture.resolveApproval(1, "accept");

    fixture.invalidate();
    fixture.stateStore.dispatch({ type: "subagent-activity/tracked", threadId: "child", parentTurnId: "turn-active" });
    fixture.stateStore.dispatch({ type: "subagent-activity/turn-started", threadId: "child", childTurnId: "child-turn" });
    const childResponder = { respond: vi.fn(), reject: vi.fn() };
    fixture.deliver(commandApprovalRequest(2, "child", "child-turn"), childResponder);

    expect(childResponder.respond).not.toHaveBeenCalled();
    expect(fixture.stateStore.getState().requests.approvals).toHaveLength(1);
  });

  it("reports deferred diagnostics failures as system messages", async () => {
    const error = new Error("diagnostics failed");
    const fixture = sessionConnectionFixture({
      readServerDiagnostics: vi.fn().mockRejectedValue(error),
    });
    await fixture.hydrate();

    fixture.runScheduledDiagnostics();
    await vi.waitFor(() => {
      expect(fixture.addSystemMessage).toHaveBeenCalledWith("diagnostics failed");
    });
  });

  it("does not run deferred diagnostics after disconnect", async () => {
    const readServerDiagnostics = vi.fn().mockResolvedValue(null);
    const fixture = sessionConnectionFixture({ readServerDiagnostics });
    await fixture.hydrate();
    fixture.setConnected(false);

    fixture.runScheduledDiagnostics();

    expect(readServerDiagnostics).not.toHaveBeenCalled();
  });
});

function sessionConnectionFixture(overrides: { readServerDiagnostics?: ReturnType<typeof vi.fn> } = {}) {
  let connected = false;
  let handlers: ConnectionManagerHandlers | null = null;
  let scheduledDiagnostics: (() => void) | null = null;
  const addSystemMessage = vi.fn();
  const stateStore = createChatStateStore(
    chatStateFixture({
      activeThread: { id: "thread-active" },
      activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } },
    }),
  );
  const host = {
    environment: {
      plugin: {
        appServerQueries: {
          runtimeConfigSnapshot: () => null,
          skillsSnapshot: () => null,
          refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
          refreshSkills: vi.fn().mockResolvedValue(undefined),
          refreshRateLimits: vi.fn().mockResolvedValue(undefined),
        },
        threadCatalog: {
          refreshActiveThreads: vi.fn().mockResolvedValue(undefined),
          apply: vi.fn(),
        },
        appServerContext: { codexPath: "codex", vaultPath: "/vault" },
      },
    },
    stateStore,
    canConnect: () => true,
    deferredTasks: {
      scheduleDiagnostics: (callback: () => void) => {
        scheduledDiagnostics = callback;
      },
      clearDiagnostics: vi.fn(),
    },
    invalidateThreadWork: vi.fn(),
    refreshTabHeader: vi.fn(),
  } as unknown as SessionConnectionHost;
  const input = {
    connection: {
      connect: async (nextHandlers: ConnectionManagerHandlers) => {
        handlers = nextHandlers;
        connected = true;
        return { codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };
      },
      isConnected: () => connected,
    },
    diagnosticsPort: {
      readServerDiagnostics: overrides.readServerDiagnostics ?? vi.fn().mockResolvedValue(null),
    },
    localItemIds: {
      next: (prefix: string) => `${prefix}-1`,
    },
    status: {
      set: vi.fn(),
      addSystemMessage,
    },
    autoTitleCoordinator: {
      maybeAutoTitleThread: vi.fn(),
      resetThreadTurnPresence: vi.fn(),
    },
  } as unknown as SessionConnectionInput;
  const connection = createSessionConnection(host, input);
  return {
    addSystemMessage,
    stateStore,
    connect: () => connection.coordinator.ensureConnected(),
    hydrate: () => connection.coordinator.ensureHydrated(),
    deliver: (request: ServerRequest, responder: Parameters<ConnectionManagerHandlers["onServerRequest"]>[1]) => {
      if (!handlers) throw new Error("Expected connection handlers.");
      handlers.onServerRequest(request, responder);
    },
    resolveUserInput: connection.inboundHandler.resolveUserInput,
    resolveApproval: connection.inboundHandler.resolveApproval,
    invalidate: connection.invalidateConnectionScope,
    runScheduledDiagnostics: () => {
      if (!scheduledDiagnostics) throw new Error("Expected deferred diagnostics callback.");
      scheduledDiagnostics();
    },
    setConnected: (value: boolean) => {
      connected = value;
    },
  };
}

function userInputRequest(id: number): Extract<ServerRequest, { method: "item/tool/requestUserInput" }> {
  return {
    id,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      itemId: "input-1",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
      isBlocking: true,
      autoResolutionMs: null,
    },
  };
}

function commandApprovalRequest(
  id: number,
  threadId: string,
  turnId: string,
): Extract<ServerRequest, { method: "item/commandExecution/requestApproval" }> {
  return {
    id,
    method: "item/commandExecution/requestApproval",
    params: {
      kind: "command",
      command: "npm test",
      cwd: "/vault",
      threadId,
      turnId,
      itemId: "shared-command",
      approvalId: null,
      environmentId: null,
      startedAtMs: 1,
      reason: null,
      commandActions: [],
      proposedExecpolicyAmendment: null,
      proposedNetworkPolicyAmendments: [],
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    },
  };
}
