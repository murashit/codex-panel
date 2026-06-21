// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  runEphemeralStructuredTurn,
  type EphemeralStructuredTurnClient,
  type EphemeralStructuredTurnClientFactory,
} from "../../src/app-server/services/ephemeral-structured-turn";
import type {
  AppServerClientHandlers,
  AppServerStartEphemeralThreadOptions,
  AppServerStartStructuredTurnOptions,
} from "../../src/app-server/connection/client";
import type { InitializeResponse } from "../../src/generated/app-server/InitializeResponse";
import type { RequestId } from "../../src/generated/app-server/RequestId";
import type { ServerNotification } from "../../src/generated/app-server/ServerNotification";
import type { ServerRequest } from "../../src/generated/app-server/ServerRequest";
import type { ModelListResponse } from "../../src/generated/app-server/v2/ModelListResponse";
import type { Thread as ThreadRecord } from "../../src/generated/app-server/v2/Thread";
import type { ThreadStartResponse } from "../../src/generated/app-server/v2/ThreadStartResponse";
import type { TurnStartResponse } from "../../src/generated/app-server/v2/TurnStartResponse";
import type { TurnItem, TurnRecord } from "../../src/app-server/protocol/turn";

describe("runEphemeralStructuredTurn", () => {
  it("fills completed turn items from item completion notifications", async () => {
    const { clientFactory } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => {
        fake.emit(completedItemNotification("thread", "turn", agentMessage("answer", '{"ok":true}')));
        fake.emit(turnCompletedNotification("thread", turn([], { id: "turn", status: "completed" })));
        return { turn: turn([], { id: "turn", status: "inProgress" }) };
      };
    });

    const result = await runEphemeralStructuredTurn(runOptions(clientFactory));

    expect(result.items).toEqual([agentMessage("answer", '{"ok":true}')]);
    expect(result.itemsView).toBe("full");
  });

  it("reports matched structured turn progress without exposing raw notifications", async () => {
    const progress: unknown[] = [];
    const { clientFactory, client } = fakeStructuredTurnClientFactory();
    const running = runEphemeralStructuredTurn({
      ...runOptions(clientFactory),
      onProgress: (event) => {
        progress.push(event);
      },
    });

    await expectPresent(client.current).structuredTurnStarted;
    const fake = expectPresent(client.current);
    fake.emit(agentDeltaNotification("other-thread", "turn", "ignored"));
    fake.emit(reasoningNotification("thread", "turn"));
    fake.emit(agentDeltaNotification("thread", "turn", "draft"));
    fake.emit(completedItemNotification("thread", "turn", agentMessage("answer", '{"ok":true}')));
    fake.emit(turnCompletedNotification("thread", turn([], { id: "turn", status: "completed" })));

    await running;
    expect(progress).toEqual([{ type: "reasoning-activity" }, { type: "agent-message-delta", delta: "draft" }]);
  });

  it("keeps pre-acknowledgement completion when turn notifications arrive before turn/start resolves", async () => {
    const { clientFactory } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => {
        fake.emit(completedItemNotification("thread", "early-turn", agentMessage("answer", '{"ok":true}')));
        fake.emit(turnCompletedNotification("thread", turn([], { id: "early-turn", status: "completed" })));
        return { turn: turn([], { id: "early-turn", status: "inProgress" }) };
      };
    });

    const result = await runEphemeralStructuredTurn(runOptions(clientFactory));

    expect(result.items).toEqual([agentMessage("answer", '{"ok":true}')]);
  });

  it("cleans up abort listeners after an operation settles", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { clientFactory } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn({
      ...runOptions(clientFactory),
      signal: controller.signal,
    });

    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  });

  it("uses injected timers for structured turn timeout cleanup", async () => {
    const timers = {
      setTimeout: vi.fn((_callback: () => void, _delayMs: number) => 123),
      clearTimeout: vi.fn(),
    };
    const { clientFactory } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn({
      ...runOptions(clientFactory),
      timers,
    });

    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(timers.clearTimeout).toHaveBeenCalledWith(123);
  });

  it("rejects server requests with the configured message", async () => {
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.connectImpl = async () => {
        fake.request(serverRequest(123));
        return { codexHome: "/tmp/codex" } as InitializeResponse;
      };
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn(runOptions(clientFactory));

    expect(expectPresent(client.current).rejectServerRequest).toHaveBeenCalledWith(
      123,
      -32601,
      "Structured test does not handle server requests.",
    );
  });

  it("resolves runtime on the same client before starting the ephemeral thread", async () => {
    const callOrder: string[] = [];
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.startEphemeralThreadImpl = async () => {
        callOrder.push("start-thread");
        return threadStartResponse("thread");
      };
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn({
      ...runOptions(clientFactory),
      resolveRuntime: async (runtimeClient) => {
        callOrder.push("resolve-runtime");
        expect(runtimeClient).toBe(expectPresent(client.current));
        await runtimeClient.listModels(false);
        return { model: "gpt-5.1", effort: "low" };
      },
    });

    expect(callOrder).toEqual(["resolve-runtime", "start-thread"]);
    expect(expectPresent(client.current).listModels).toHaveBeenCalledWith(false);
    expect(expectPresent(client.current).startStructuredTurnOptions).toEqual({
      threadId: "thread",
      cwd: "/vault",
      text: "Run.",
      outputSchema: { type: "object" },
      runtime: { model: "gpt-5.1", effort: "low" },
    });
  });

  it("starts the ephemeral thread with named service options", async () => {
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn(runOptions(clientFactory));

    expect(expectPresent(client.current).startEphemeralThreadOptions).toEqual({
      cwd: "/vault",
      serviceName: "structured-test",
      developerInstructions: "Return JSON.",
    });
  });

  it.each([
    {
      stage: "connect",
      configure: (fake: FakeStructuredTurnClient): void => {
        fake.connectImpl = () => new Promise<InitializeResponse>(() => undefined);
      },
    },
    {
      stage: "runtime resolution",
      configure: (_fake: FakeStructuredTurnClient): void => undefined,
      resolveRuntime: (): Promise<NonNullable<AppServerStartStructuredTurnOptions["runtime"]>> =>
        new Promise<NonNullable<AppServerStartStructuredTurnOptions["runtime"]>>(() => undefined),
    },
    {
      stage: "ephemeral thread start",
      configure: (fake: FakeStructuredTurnClient): void => {
        fake.startEphemeralThreadImpl = () => new Promise<ThreadStartResponse>(() => undefined);
      },
    },
    {
      stage: "structured turn start",
      configure: (fake: FakeStructuredTurnClient): void => {
        fake.startStructuredTurnImpl = () => new Promise<TurnStartResponse>(() => undefined);
      },
    },
    { stage: "completion wait", configure: (_fake: FakeStructuredTurnClient): void => undefined },
  ])("times out during $stage and disconnects the client", async ({ configure, resolveRuntime }) => {
    const timers = timerHarness();
    const { clientFactory, client } = fakeStructuredTurnClientFactory(configure);

    const running = runEphemeralStructuredTurn({
      ...runOptions(clientFactory),
      ...(resolveRuntime ? { resolveRuntime } : {}),
      timers,
    });
    await Promise.resolve();

    timers.fireTimeout();

    await expect(running).rejects.toThrow("Structured test timed out.");
    expect(expectPresent(client.current).disconnect).toHaveBeenCalledOnce();
    expect(timers.clearTimeout).toHaveBeenCalledWith(123);
  });
});

function runOptions(clientFactory: EphemeralStructuredTurnClientFactory): Parameters<typeof runEphemeralStructuredTurn>[0] {
  return {
    codexPath: "/bin/codex",
    cwd: "/vault",
    serviceName: "structured-test",
    developerInstructions: "Return JSON.",
    prompt: "Run.",
    outputSchema: { type: "object" },
    timeoutMs: 10_000,
    serverRequests: { kind: "reject", message: "Structured test does not handle server requests." },
    exitedMessage: "Structured test app-server exited.",
    timedOutMessage: "Structured test timed out.",
    clientFactory,
  };
}

function fakeStructuredTurnClientFactory(configure?: (client: FakeStructuredTurnClient) => void): {
  clientFactory: EphemeralStructuredTurnClientFactory;
  client: { current: FakeStructuredTurnClient | null };
} {
  const client: { current: FakeStructuredTurnClient | null } = { current: null };
  return {
    client,
    clientFactory: (_codexPath, _cwd, handlers) => {
      client.current = new FakeStructuredTurnClient(handlers);
      configure?.(client.current);
      return client.current;
    },
  };
}

class FakeStructuredTurnClient implements EphemeralStructuredTurnClient {
  connectImpl: (() => Promise<InitializeResponse>) | null = null;
  startEphemeralThreadImpl: (() => Promise<ThreadStartResponse>) | null = null;
  startStructuredTurnImpl: (() => Promise<TurnStartResponse>) | null = null;
  startEphemeralThreadOptions: AppServerStartEphemeralThreadOptions | null = null;
  startStructuredTurnOptions: AppServerStartStructuredTurnOptions | null = null;
  readonly listModels = vi.fn(async (): Promise<ModelListResponse> => ({ data: [], nextCursor: null }));
  readonly rejectServerRequest = vi.fn();
  readonly disconnect = vi.fn();
  readonly structuredTurnStarted: Promise<void>;
  private resolveStructuredTurnStarted!: () => void;

  constructor(private readonly handlers: AppServerClientHandlers) {
    this.structuredTurnStarted = new Promise((resolve) => {
      this.resolveStructuredTurnStarted = resolve;
    });
  }

  async connect(): Promise<InitializeResponse> {
    return this.connectImpl ? this.connectImpl() : ({ codexHome: "/tmp/codex" } as InitializeResponse);
  }

  async startEphemeralThread(options: AppServerStartEphemeralThreadOptions): Promise<ThreadStartResponse> {
    this.startEphemeralThreadOptions = options;
    return this.startEphemeralThreadImpl ? this.startEphemeralThreadImpl() : threadStartResponse("thread");
  }

  async startStructuredTurn(options: AppServerStartStructuredTurnOptions): Promise<TurnStartResponse> {
    this.startStructuredTurnOptions = options;
    this.resolveStructuredTurnStarted();
    return this.startStructuredTurnImpl ? this.startStructuredTurnImpl() : { turn: turn([], { id: "turn", status: "inProgress" }) };
  }

  emit(notification: ServerNotification): void {
    this.handlers.onNotification(notification);
  }

  request(request: ServerRequest): void {
    this.handlers.onServerRequest(request);
  }
}

function timerHarness(): {
  setTimeout: ReturnType<typeof vi.fn<(callback: () => void, delayMs: number) => number>>;
  clearTimeout: ReturnType<typeof vi.fn<(timer: number) => void>>;
  fireTimeout(): void;
} {
  let timeoutCallback: (() => void) | null = null;
  return {
    setTimeout: vi.fn((callback: () => void, _delayMs: number) => {
      timeoutCallback = callback;
      return 123;
    }),
    clearTimeout: vi.fn(),
    fireTimeout: () => {
      if (!timeoutCallback) throw new Error("Expected timeout to be scheduled.");
      timeoutCallback();
    },
  };
}

function threadStartResponse(threadId: string): ThreadStartResponse {
  return {
    thread: thread(threadId),
    model: "gpt-5.1",
    modelProvider: "openai",
    serviceTier: null,
    cwd: "/vault",
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: "never",
    approvalsReviewer: "auto_review",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
    reasoningEffort: null,
  };
}

function thread(id: string): ThreadRecord {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: true,
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

function turn(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    ...overrides,
  };
}

function agentMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

function completedItemNotification(threadId: string, turnId: string, item: TurnItem): ServerNotification {
  return {
    method: "item/completed",
    params: { threadId, turnId, item, completedAtMs: 1 },
  };
}

function turnCompletedNotification(threadId: string, completedTurn: TurnRecord): ServerNotification {
  return {
    method: "turn/completed",
    params: { threadId, turn: completedTurn },
  };
}

function agentDeltaNotification(threadId: string, turnId: string, delta: string): ServerNotification {
  return {
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: "agent", delta },
  };
}

function reasoningNotification(threadId: string, turnId: string): ServerNotification {
  return {
    method: "item/reasoning/textDelta",
    params: { threadId, turnId, itemId: "reasoning", contentIndex: 0, delta: "thinking" },
  };
}

function serverRequest(id: RequestId): ServerRequest {
  return {
    id,
    method: "item/tool/requestUserInput",
    params: {},
  } as ServerRequest;
}

function expectPresent<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected value to be present.");
  return value;
}
