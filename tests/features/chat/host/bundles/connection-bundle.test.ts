import { describe, expect, it, vi } from "vitest";
import type { ConnectionManagerHandlers } from "../../../../../src/app-server/connection/connection-manager";
import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createConnectionBundle } from "../../../../../src/features/chat/host/bundles/connection-bundle";
import { chatStateFixture } from "../../support/state";

type ConnectionBundleHost = Parameters<typeof createConnectionBundle>[0];
type ConnectionBundleInput = Parameters<typeof createConnectionBundle>[1];

describe("connection bundle", () => {
  it("responds through the responder that delivered the request", async () => {
    const fixture = connectionBundleFixture();
    await fixture.bundle.connection.coordinator.ensureConnected();
    const responder = { respond: vi.fn(), reject: vi.fn() };

    fixture.connectionHandlers().onServerRequest(userInputRequest(1), responder);
    fixture.bundle.inboundHandler.resolveUserInput(1, { note: "Continue" });

    expect(responder.respond).toHaveBeenCalledWith({ answers: { note: { answers: ["Continue"] } } });
  });

  it("cannot reuse a responder after its connection scope is invalidated", async () => {
    const fixture = connectionBundleFixture();
    await fixture.bundle.connection.coordinator.ensureConnected();
    const responder = { respond: vi.fn(), reject: vi.fn() };

    fixture.connectionHandlers().onServerRequest(userInputRequest(1), responder);
    fixture.bundle.invalidateConnectionScope();
    fixture.bundle.inboundHandler.resolveUserInput(1, { note: "Continue" });

    expect(responder.respond).not.toHaveBeenCalled();
    expect(responder.reject).not.toHaveBeenCalled();
  });

  it("reports deferred diagnostics failures as system messages", async () => {
    const error = new Error("diagnostics failed");
    const fixture = connectionBundleFixture({
      readServerDiagnostics: vi.fn().mockRejectedValue(error),
    });
    await fixture.bundle.connection.coordinator.ensureHydrated();

    fixture.runScheduledDiagnostics();
    await vi.waitFor(() => {
      expect(fixture.addSystemMessage).toHaveBeenCalledWith("diagnostics failed");
    });
  });

  it("does not run deferred diagnostics after disconnect", async () => {
    const readServerDiagnostics = vi.fn().mockResolvedValue(null);
    const fixture = connectionBundleFixture({ readServerDiagnostics });
    await fixture.bundle.connection.coordinator.ensureHydrated();
    fixture.setConnected(false);

    fixture.runScheduledDiagnostics();

    expect(readServerDiagnostics).not.toHaveBeenCalled();
  });
});

function connectionBundleFixture(overrides: { readServerDiagnostics?: ReturnType<typeof vi.fn> } = {}) {
  let connected = false;
  let handlers: ConnectionManagerHandlers | null = null;
  let scheduledDiagnostics: (() => void) | null = null;
  const addSystemMessage = vi.fn();
  const stateStore = createChatStateStore(
    chatStateFixture({
      activeThread: { id: "thread-active" },
      turn: { lifecycle: { kind: "running", turnId: "turn-active" } },
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
  } as unknown as ConnectionBundleHost;
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
  } as unknown as ConnectionBundleInput;
  return {
    addSystemMessage,
    bundle: createConnectionBundle(host, input),
    connectionHandlers: () => {
      if (!handlers) throw new Error("Expected connection handlers.");
      return handlers;
    },
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
      autoResolutionMs: null,
    },
  };
}
