// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { AppServerClientHandlers, ClientResponseByMethod, TypedClientRequestMethod } from "../../../src/app-server/connection/client";
import type { ClientRequestParams } from "../../../src/app-server/connection/rpc-messages";
import type { TurnItem, TurnRecord } from "../../../src/app-server/protocol/turn";
import { type EphemeralStructuredTurnClient, runEphemeralStructuredTurn } from "../../../src/app-server/services/ephemeral-structured-turn";
import type { AppServerStartEphemeralThreadOptions } from "../../../src/app-server/services/threads";
import type { AppServerStartStructuredTurnOptions } from "../../../src/app-server/services/turns";
import type { InitializeResponse } from "../../../src/generated/app-server/InitializeResponse";
import type { RequestId } from "../../../src/generated/app-server/RequestId";
import type { ServerNotification } from "../../../src/generated/app-server/ServerNotification";
import type { ServerRequest } from "../../../src/generated/app-server/ServerRequest";
import type { Thread as AppServerThread } from "../../../src/generated/app-server/v2/Thread";
import type { ThreadStartResponse } from "../../../src/generated/app-server/v2/ThreadStartResponse";

interface TurnStartResponse {
  turn: TurnRecord;
}

describe("runEphemeralStructuredTurn", () => {
  it("fills completed turn items from item completion notifications", async () => {
    const { clientFactory } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => {
        fake.emit(completedItemNotification("thread", "turn", agentMessage("answer", '{"ok":true}')));
        fake.emit(turnCompletedNotification("thread", turn([], { id: "turn", status: "completed" })));
        return { turn: turn([], { id: "turn", status: "inProgress" }) };
      };
    });

    const result = await runEphemeralStructuredTurn(runOptions(), { clientFactory });

    expect(result.items).toEqual([agentMessage("answer", '{"ok":true}')]);
    expect(result.itemsView).toBe("full");
  });

  it("reports matched structured turn progress without exposing raw notifications", async () => {
    const progress: unknown[] = [];
    const { clientFactory, client } = fakeStructuredTurnClientFactory();
    const running = runEphemeralStructuredTurn(
      {
        ...runOptions(),
        onProgress: (event) => {
          progress.push(event);
        },
      },
      { clientFactory },
    );

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

    const result = await runEphemeralStructuredTurn(runOptions(), { clientFactory });

    expect(result.items).toEqual([agentMessage("answer", '{"ok":true}')]);
  });

  it("cleans up abort listeners after an operation settles", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { clientFactory } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn({ ...runOptions(), signal: controller.signal }, { clientFactory });

    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  });

  it("deletes the ephemeral thread before disconnecting after a completed turn", async () => {
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn(runOptions(), { clientFactory });

    const fake = expectPresent(client.current);
    expect(fake.deleteThreadRequest).toHaveBeenCalledWith({ threadId: "thread" }, { timeoutMs: 5_000 });
    expect(expectPresent(fake.disconnect.mock.invocationCallOrder[0])).toBeGreaterThan(
      expectPresent(fake.deleteThreadRequest.mock.invocationCallOrder[0]),
    );
  });

  it("reports its client lifetime to the owning execution runtime", async () => {
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });
    const clientLifecycle = { created: vi.fn(), disposed: vi.fn() };

    await runEphemeralStructuredTurn(runOptions(), { clientFactory, clientLifecycle });

    expect(clientLifecycle.created).toHaveBeenCalledWith(client.current);
    expect(clientLifecycle.disposed).toHaveBeenCalledWith(client.current);
  });

  it("does not try to delete when no ephemeral thread was started", async () => {
    const timers = timerHarness();
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.connectImpl = () => new Promise<InitializeResponse>(() => undefined);
    });

    const running = runEphemeralStructuredTurn(runOptions(), { clientFactory, timers });
    await Promise.resolve();

    timers.fireTimeout();

    await expect(running).rejects.toThrow("Structured test timed out.");
    expect(expectPresent(client.current).deleteThreadRequest).not.toHaveBeenCalled();
  });

  it("keeps the completed turn result when deleting the ephemeral thread fails", async () => {
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.deleteThreadRequest.mockRejectedValueOnce(new Error("delete failed"));
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await expect(runEphemeralStructuredTurn(runOptions(), { clientFactory })).resolves.toMatchObject({
      items: [agentMessage("answer", '{"ok":true}')],
    });
    expect(expectPresent(client.current).disconnect).toHaveBeenCalledOnce();
  });

  it("rejects server requests with the configured message", async () => {
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.connectImpl = async () => {
        fake.emitServerRequest(serverRequest(123));
        return { codexHome: "/tmp/codex" } as InitializeResponse;
      };
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn(runOptions(), { clientFactory });

    expect(expectPresent(client.current).rejectServerRequest).toHaveBeenCalledWith(
      123,
      -32601,
      "Structured test does not handle server requests.",
    );
  });

  it("resolves runtime on the same client before starting the ephemeral thread", async () => {
    const callOrder: string[] = [];
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.modelListImpl = async () => {
        callOrder.push("model-list");
        return { data: [appServerModel("gpt-5.1", ["low"])], nextCursor: null };
      };
      fake.startEphemeralThreadImpl = async () => {
        callOrder.push("start-thread");
        return threadStartResponse("thread");
      };
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn(
      {
        ...runOptions(),
        runtimeSettings: { model: "gpt-5.1", effort: "low" },
      },
      { clientFactory },
    );

    expect(callOrder).toEqual(["model-list", "start-thread"]);
    expect(expectPresent(client.current).modelListRequests).toEqual([{ includeHidden: false, cursor: null, limit: 100 }]);
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

    await runEphemeralStructuredTurn(runOptions(), { clientFactory });

    expect(expectPresent(client.current).startEphemeralThreadOptions).toEqual({
      cwd: "/vault",
      serviceName: "structured-test",
      developerInstructions: "Return JSON.",
    });
  });

  it("rejects a known unsupported reasoning effort before creating the ephemeral thread", async () => {
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.modelListImpl = async () => ({ data: [appServerModel("gpt-5.4-mini", ["low", "medium"])], nextCursor: null });
    });

    await expect(
      runEphemeralStructuredTurn({ ...runOptions(), runtimeSettings: { model: "gpt-5.4-mini", effort: "ultra" } }, { clientFactory }),
    ).rejects.toThrow("Reasoning effort ultra is unavailable for gpt-5.4-mini. Supported: low, medium.");

    expect(expectPresent(client.current).startEphemeralThreadOptions).toBeNull();
  });

  it("defers explicit runtime intent to app-server when model metadata is unavailable", async () => {
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.modelListImpl = async () => {
        throw new Error("model catalog unavailable");
      };
      fake.startStructuredTurnImpl = async () => ({ turn: turn([agentMessage("answer", '{"ok":true}')]) });
    });

    await runEphemeralStructuredTurn(
      { ...runOptions(), runtimeSettings: { model: "custom-model", effort: "custom-effort" } },
      { clientFactory },
    );

    expect(expectPresent(client.current).startStructuredTurnOptions?.runtime).toEqual({
      model: "custom-model",
      effort: "custom-effort",
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
      configure: (fake: FakeStructuredTurnClient): void => {
        fake.modelListImpl = () => new Promise<ClientResponseByMethod["model/list"]>(() => undefined);
      },
      runtimeSettings: { model: "gpt-5.1", effort: "low" } as const,
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
  ])("times out during $stage and disconnects the client", async ({ configure, runtimeSettings }) => {
    const timers = timerHarness();
    const { clientFactory, client } = fakeStructuredTurnClientFactory(configure);

    const running = runEphemeralStructuredTurn(
      {
        ...runOptions(),
        ...(runtimeSettings ? { runtimeSettings } : {}),
      },
      { clientFactory, timers },
    );
    await Promise.resolve();

    timers.fireTimeout();

    await expect(running).rejects.toThrow("Structured test timed out.");
    expect(expectPresent(client.current).disconnect).toHaveBeenCalledOnce();
    expect(timers.clearTimeout).toHaveBeenCalledWith(123);
  });

  it("deletes a started ephemeral thread when structured turn startup times out", async () => {
    const timers = timerHarness();
    const { clientFactory, client } = fakeStructuredTurnClientFactory((fake) => {
      fake.startStructuredTurnImpl = () => new Promise<TurnStartResponse>(() => undefined);
    });

    const running = runEphemeralStructuredTurn(runOptions(), { clientFactory, timers });
    await expectPresent(client.current).structuredTurnStarted;

    timers.fireTimeout();

    await expect(running).rejects.toThrow("Structured test timed out.");
    expect(expectPresent(client.current).deleteThreadRequest).toHaveBeenCalledWith({ threadId: "thread" }, { timeoutMs: 5_000 });
  });
});

function runOptions(): Parameters<typeof runEphemeralStructuredTurn>[0] {
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
  };
}

function appServerModel(model: string, efforts: readonly string[]): ClientResponseByMethod["model/list"]["data"][number] {
  return {
    id: model,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model,
    description: "",
    modelSpecialty: null,
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort: reasoningEffort as never,
      label: reasoningEffort,
      description: "",
    })),
    defaultReasoningEffort: (efforts[0] ?? "medium") as never,
    inputModalities: ["text"],
    supportsPersonality: false,
    multiAgentVersion: null,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

type EphemeralStructuredTurnClientFactory = NonNullable<Parameters<typeof runEphemeralStructuredTurn>[1]>["clientFactory"];

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
  modelListImpl: (() => Promise<ClientResponseByMethod["model/list"]>) | null = null;
  startEphemeralThreadImpl: (() => Promise<ThreadStartResponse>) | null = null;
  startStructuredTurnImpl: (() => Promise<TurnStartResponse>) | null = null;
  startEphemeralThreadOptions: AppServerStartEphemeralThreadOptions | null = null;
  startStructuredTurnOptions: AppServerStartStructuredTurnOptions | null = null;
  readonly modelListRequests: ClientRequestParams<"model/list">[] = [];
  readonly rejectServerRequest = vi.fn();
  readonly deleteThreadRequest = vi.fn(
    async (_params: ClientRequestParams<"thread/delete">, _options?: { timeoutMs?: number }) => undefined,
  );
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

  async request<M extends TypedClientRequestMethod>(
    method: M,
    params: ClientRequestParams<M>,
    options: { timeoutMs?: number } = {},
  ): Promise<ClientResponseByMethod[M]> {
    switch (method) {
      case "model/list":
        this.modelListRequests.push(params as ClientRequestParams<"model/list">);
        return (this.modelListImpl ? await this.modelListImpl() : { data: [], nextCursor: null }) as ClientResponseByMethod[M];
      case "thread/start":
        this.startEphemeralThreadOptions = ephemeralThreadOptionsFromParams(params as ClientRequestParams<"thread/start">);
        return (this.startEphemeralThreadImpl
          ? await this.startEphemeralThreadImpl()
          : threadStartResponse("thread")) as unknown as ClientResponseByMethod[M];
      case "turn/start":
        this.startStructuredTurnOptions = structuredTurnOptionsFromParams(params as ClientRequestParams<"turn/start">);
        this.resolveStructuredTurnStarted();
        return (this.startStructuredTurnImpl
          ? await this.startStructuredTurnImpl()
          : { turn: turn([], { id: "turn", status: "inProgress" }) }) as unknown as ClientResponseByMethod[M];
      case "thread/delete":
        await this.deleteThreadRequest(params as ClientRequestParams<"thread/delete">, options);
        return {} as unknown as ClientResponseByMethod[M];
      default:
        throw new Error(`Unexpected app-server request: ${method}`);
    }
  }

  emit(notification: ServerNotification): void {
    this.handlers.onNotification(notification);
  }

  emitServerRequest(request: ServerRequest): void {
    this.handlers.onServerRequest(request, {
      respond: () => undefined,
      reject: (code, message) => {
        this.rejectServerRequest(request.id, code, message);
      },
    });
  }
}

function ephemeralThreadOptionsFromParams(params: ClientRequestParams<"thread/start">): AppServerStartEphemeralThreadOptions {
  if (!params.cwd || !params.serviceName || !params.developerInstructions) throw new Error("Expected ephemeral thread params.");
  return {
    cwd: params.cwd,
    serviceName: params.serviceName,
    developerInstructions: params.developerInstructions,
  };
}

function structuredTurnOptionsFromParams(params: ClientRequestParams<"turn/start">): AppServerStartStructuredTurnOptions {
  const textItem = params.input[0];
  if (!params.cwd || !textItem || textItem.type !== "text" || !params.outputSchema) throw new Error("Expected structured turn params.");
  const runtime = structuredTurnRuntimeFromParams(params);
  return {
    threadId: params.threadId,
    cwd: params.cwd,
    text: textItem.text,
    outputSchema: params.outputSchema,
    ...(runtime !== undefined ? { runtime } : {}),
  };
}

function structuredTurnRuntimeFromParams(params: ClientRequestParams<"turn/start">): AppServerStartStructuredTurnOptions["runtime"] {
  const runtime = {
    ...(params.serviceTier !== undefined ? { serviceTier: params.serviceTier } : {}),
    ...(params.collaborationMode !== undefined && params.collaborationMode !== null ? { collaborationMode: params.collaborationMode } : {}),
    ...(params.model !== undefined ? { model: params.model } : {}),
    ...(params.effort !== undefined ? { effort: params.effort } : {}),
    ...(params.approvalsReviewer !== undefined ? { approvalsReviewer: params.approvalsReviewer } : {}),
  };
  return Object.keys(runtime).length > 0 ? runtime : undefined;
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
    approvalPolicy: "never",
    cwd: "/vault",
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalsReviewer: "auto_review",
    activePermissionProfile: null,
    sandbox: { type: "readOnly", networkAccess: false },
    reasoningEffort: null,
    multiAgentMode: "explicitRequestOnly",
  };
}

function thread(id: string): AppServerThread {
  return {
    id,
    extra: null,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: true,
    historyMode: "paginated",
    projectId: null,
    modelProvider: "openai",
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
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null, delivery: null };
}

function completedItemNotification(threadId: string, turnId: string, item: TurnItem): ServerNotification {
  type ItemCompletedNotification = Extract<ServerNotification, { method: "item/completed" }>;
  return {
    method: "item/completed",
    params: { threadId, turnId, item, completedAtMs: 1 } as unknown as ItemCompletedNotification["params"],
  };
}

function turnCompletedNotification(threadId: string, completedTurn: TurnRecord): ServerNotification {
  type TurnCompletedNotification = Extract<ServerNotification, { method: "turn/completed" }>;
  return {
    method: "turn/completed",
    params: { threadId, turn: completedTurn } as unknown as TurnCompletedNotification["params"],
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
