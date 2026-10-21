import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { ConnectionManagerHandlers } from "../../../../../src/app-server/connection/connection-manager";
import {
  AppServerContextConnection,
  type AppServerContextConnectionLease,
  type AppServerContextConnectionLeaseHandlers,
} from "../../../../../src/app-server/connection/context-connection";
import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createSessionConnection } from "../../../../../src/features/chat/host/session/connection";
import { waitForAsyncWork } from "../../../../support/async";
import { userInputRequestFixture } from "../../../../support/server-requests";
import { chatStateFixture } from "../../support/state";

type SessionConnectionHost = Parameters<typeof createSessionConnection>[0];
type SessionConnectionInput = Parameters<typeof createSessionConnection>[1];

describe("session connection", () => {
  it.each([
    { boundary: "reset", lifetime: false },
    { boundary: "exit", lifetime: false },
    { boundary: "close", lifetime: false },
    { boundary: "close", lifetime: "normal" as const },
    { boundary: "close", lifetime: true },
  ])("settles input but preserves approvals on presentation close ($boundary, $lifetime)", async ({ boundary, lifetime }) => {
    const fixture = sessionConnectionFixture(undefined, lifetime);
    await fixture.connect();
    const input = { respond: vi.fn(), reject: vi.fn() };
    const approval = { respond: vi.fn(), reject: vi.fn() };
    fixture.deliver(userInputRequest(1), input);
    fixture.deliver(commandApprovalRequest(2, "thread-active", "turn-active"), approval);
    // The approval may outlive presentation of its thread.
    fixture.stateStore.dispatch({ type: "panel/view-state-cleared" });
    const close = boundary === "exit" ? fixture.exit : boundary === "close" ? fixture.deactivate : fixture.invalidate;
    close();
    close();
    fixture.resolveUserInput(1, { note: "Continue" });
    fixture.resolveApproval(2, "accept");
    expect(input.respond).not.toHaveBeenCalled();
    expect(input.reject).toHaveBeenCalledExactlyOnceWith(-32000, "Codex Panel disconnected before the request was answered.");
    expect(approval.respond).not.toHaveBeenCalled();
    expect(approval.reject.mock.calls).toEqual(
      boundary === "close" ? [] : [[-32000, "Codex Panel disconnected before the request was answered."]],
    );
  });

  it("leaves approvals with Codex across unsubscribe and answers only after resume replay and user choice", async () => {
    let handlers: ConnectionManagerHandlers | undefined;
    const approval = commandApprovalRequest(7, "thread-active", "turn-active");
    const original = { respond: vi.fn(), reject: vi.fn() };
    const late = { respond: vi.fn(), reject: vi.fn() };
    const replayed = { respond: vi.fn(), reject: vi.fn() };
    const request = vi.fn(async (method: string) => {
      if (method === "thread/resume") handlers?.onServerRequest(approval, replayed);
      return {};
    });
    const client = { request } as unknown as AppServerClient;
    const disconnect = vi.fn();
    const shared = new AppServerContextConnection(
      "codex",
      "/vault",
      { clientInfo: { name: "test", title: "Test", version: "0" }, capabilities: { experimentalApi: true, requestAttestation: false } },
      { onNotification: () => false, onSubscriptionError: vi.fn(), onExit: vi.fn() },
      {
        connect: async (next) => {
          handlers = next;
          return { codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };
        },
        currentClient: () => client,
        disconnect,
      },
    );
    const lease = shared.createLease();
    lease.recordThreadSubscription("thread-active", client);
    const first = sessionConnectionFixture(lease);
    await first.connect();
    handlers?.onServerRequest(approval, original);
    expect(first.stateStore.getState().requests.approvals).toHaveLength(1);
    first.stateStore.dispatch({ type: "panel/disposed" });
    first.deactivate();
    lease.disconnect();
    await waitForAsyncWork(() =>
      expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread-active" }, expect.anything()),
    );
    handlers?.onServerRequest(approval, late);
    first.resolveApproval(7, "cancel");
    for (const responder of [original, late]) {
      expect(responder.respond).not.toHaveBeenCalled();
      expect(responder.reject).not.toHaveBeenCalled();
    }
    expect(disconnect).not.toHaveBeenCalled();

    const second = sessionConnectionFixture(shared.createLease());
    await second.connect();
    await waitForAsyncWork(() => expect(second.stateStore.getState().requests.approvals).toHaveLength(1));
    expect(request).toHaveBeenCalledWith("thread/resume", { threadId: "thread-active", excludeTurns: true });
    expect(replayed.respond).not.toHaveBeenCalled();
    expect(replayed.reject).not.toHaveBeenCalled();
    const action = second.stateStore
      .getState()
      .requests.approvals[0]?.actionOptions?.find((option) => option.action.intent === "cancel")?.action;
    if (!action) throw new Error("Expected an offered cancellation action");
    second.resolveApproval(7, action);
    expect(replayed.respond).toHaveBeenCalledExactlyOnceWith({ decision: "cancel" });
    shared.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
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
    const action = fixture.stateStore.getState().requests.approvals[0]?.actionOptions?.[0]?.action;
    if (!action) throw new Error("Expected an offered approval action");
    fixture.resolveApproval(1, action);

    fixture.invalidate();
    fixture.stateStore.dispatch({ type: "subagent-activity/tracked", threadId: "child", parentTurnId: "turn-active" });
    fixture.stateStore.dispatch({
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: { type: "turnStarted", threadId: "child", turnId: "child-turn" },
    });
    const childResponder = { respond: vi.fn(), reject: vi.fn() };
    fixture.deliver(commandApprovalRequest(2, "child", "child-turn"), childResponder);

    expect(childResponder.respond).not.toHaveBeenCalled();
    expect(fixture.stateStore.getState().requests.approvals).toHaveLength(1);
  });
});

function sessionConnectionFixture(lease?: AppServerContextConnectionLease, ephemeral: boolean | "normal" = false) {
  let connected = false;
  let handlers: AppServerContextConnectionLeaseHandlers | null = null;
  const addSystemMessage = vi.fn();
  const stateStore = createChatStateStore(
    chatStateFixture({
      activeThread: {
        id: "thread-active",
        ...(ephemeral
          ? {
              lifetime:
                ephemeral === "normal"
                  ? { kind: "ephemeral" as const, mode: "ordinary" as const }
                  : ({ kind: "ephemeral", mode: "side-chat", sourceThreadId: "source", sourceThreadTitle: null } as const),
            }
          : {}),
      },
      activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } },
    }),
  );
  const host: SessionConnectionHost = {
    environment: {
      obsidian: { app: {} as App },
      plugin: {
        appServerQueries: {
          ensureAppServerMetadata: vi.fn().mockResolvedValue(undefined),
          refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
        },
        toolInventoryQueries: {
          refresh: async () => ({
            plugins: [],
            pluginsError: null,
            mcpServers: [],
            mcpDiagnostics: [],
            mcpError: null,
          }),
        },
        threadCatalog: {
          fetchActiveThreads: async () => [],
          refreshActiveThreads: vi.fn().mockResolvedValue(undefined),
        },
        appServerContext: { codexPath: "codex", vaultPath: "/vault" },
      },
    },
    stateStore,
    canConnect: () => true,
    invalidateThreadWork: vi.fn(),
    refreshTabHeader: vi.fn(),
  };
  const input: SessionConnectionInput = {
    threadReadState: { receive: vi.fn() },
    connection: lease ?? {
      connect: async (nextHandlers: AppServerContextConnectionLeaseHandlers) => {
        handlers = nextHandlers;
        connected = true;
        return { codexHome: "/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };
      },
      isConnected: () => connected,
      currentClient: () => null,
      updateThreadSubscriptions: vi.fn(),
      recordThreadSubscription: vi.fn(),
      withThreadActivation: async (_threadId, operation) => operation(),
      disconnect: () => {
        connected = false;
      },
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
  };
  const connection = createSessionConnection(host, input);
  return {
    addSystemMessage,
    stateStore,
    connect: () => connection.coordinator.ensureConnected(),
    deliver: (request: ServerRequest, responder: Parameters<AppServerContextConnectionLeaseHandlers["onServerRequest"]>[1]) => {
      if (!handlers) throw new Error("Expected connection handlers.");
      handlers.onServerRequest(request, responder);
    },
    resolveUserInput: connection.inboundHandler.resolveUserInput,
    resolveApproval: connection.inboundHandler.resolveApproval,
    invalidate: connection.invalidateConnectionScope,
    deactivate: connection.deactivate,
    exit: () => handlers?.onExit(),
  };
}

function userInputRequest(id: number) {
  return userInputRequestFixture(id, { isBlocking: true });
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
