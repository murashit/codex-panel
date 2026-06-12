import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppServerClient } from "../../src/app-server/connection/client";
import type {
  AppServerRpcError,
  AppServerStartStructuredTurnOptions,
  AppServerStartTurnOptions,
} from "../../src/app-server/connection/client";
import type { AppServerTransport, AppServerTransportHandlers } from "../../src/app-server/connection/transport";
import type { RpcOutboundMessage } from "../../src/app-server/connection/rpc-messages";
import type { InitializeResponse } from "../../src/generated/app-server/InitializeResponse";
import type { ServerRequest } from "../../src/generated/app-server/ServerRequest";
import manifest from "../../manifest.json";

class FakeTransport implements AppServerTransport {
  readonly sent: RpcOutboundMessage[] = [];
  running = false;

  constructor(private readonly handlers: AppServerTransportHandlers) {}

  start(): void {
    this.running = true;
  }

  send(message: RpcOutboundMessage): void {
    this.sent.push(message);
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  emitLine(message: unknown): void {
    this.handlers.onLine(JSON.stringify(message));
  }

  emitExit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.running = false;
    this.handlers.onExit(code, signal);
  }
}

async function connectedClient(): Promise<{ client: AppServerClient; transport: FakeTransport }> {
  let transport!: FakeTransport;
  const client = new AppServerClient(
    "/bin/codex",
    "/vault",
    {
      onNotification: () => undefined,
      onServerRequest: () => undefined,
      onLog: () => undefined,
      onExit: () => undefined,
    },
    500,
    (handlers) => {
      transport = new FakeTransport(handlers);
      return transport;
    },
  );
  const connecting = client.connect();
  transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
  await connecting;
  return { client, transport };
}

function latestSent(transport: FakeTransport): RpcOutboundMessage {
  const message = transport.sent.at(-1);
  if (!message) throw new Error("Expected an outbound app-server message.");
  return message;
}

async function expectRequest(
  transport: FakeTransport,
  request: Promise<unknown>,
  expected: Partial<RpcOutboundMessage>,
  result: unknown,
): Promise<void> {
  const sent = latestSent(transport);
  expect(sent).toMatchObject(expected);
  if (!("id" in sent) || typeof sent.id !== "number") throw new Error("Expected an app-server request id.");
  transport.emitLine({ id: sent.id, result });
  await request;
}

describe("AppServerClient", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("routes responses, notifications, and server requests", async () => {
    let transport: FakeTransport;
    const getTransport = () => transport;
    const notifications: string[] = [];
    const serverRequests: ServerRequest[] = [];
    const client = new AppServerClient(
      "/bin/codex",
      "/vault",
      {
        onNotification: (notification) => notifications.push(notification.method),
        onServerRequest: (request) => serverRequests.push(request),
        onLog: () => undefined,
        onExit: () => undefined,
      },
      500,
      (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    );

    const connecting = client.connect();
    expect(getTransport().sent[0]).toMatchObject({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "obsidian_codex_panel",
          title: "Codex Panel",
          version: manifest.version,
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    });
    getTransport().emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await expect(connecting).resolves.toMatchObject({ codexHome: "/tmp/codex" });
    expect(getTransport().sent[1]).toEqual({ method: "initialized" });

    getTransport().emitLine({ method: "warning", params: { message: "careful" } });
    expect(notifications).toEqual(["warning"]);

    getTransport().emitLine({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: {
        command: "npm run build",
        cwd: "/vault",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        startedAtMs: 1,
        reason: null,
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
      },
    });
    expect(serverRequests[0]?.method).toBe("item/commandExecution/requestApproval");
  });

  it("injects raw items into a thread", async () => {
    const { client, transport } = await connectedClient();

    const request = client.injectThreadItems("thread-1", [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Ship this" }],
      },
    ]);

    await expectRequest(
      transport,
      request,
      {
        method: "thread/inject_items",
        params: {
          threadId: "thread-1",
          items: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Ship this" }],
            },
          ],
        },
      },
      {},
    );
  });

  it("exposes initialized state through a single connection lifecycle", async () => {
    const { client, transport } = await connectedClient();

    expect(client.isConnected()).toBe(true);
    expect(client.initializeResponse).toMatchObject({ codexHome: "/tmp/codex" });

    transport.emitExit(0);

    expect(client.isConnected()).toBe(false);
    expect(() => client.initializeResponse).toThrow("Codex app-server has not initialized.");
  });

  it("clears initialized state and rejects pending requests on disconnect", async () => {
    const { client } = await connectedClient();
    const listing = client.listModels();

    client.disconnect();

    expect(client.isConnected()).toBe(false);
    expect(() => client.initializeResponse).toThrow("Codex app-server has not initialized.");
    await expect(listing).rejects.toThrow("Codex app-server disconnected.");
  });

  it("sends typed turn steering requests", async () => {
    let transport: FakeTransport;
    const getTransport = () => transport;
    const client = new AppServerClient(
      "/bin/codex",
      "/vault",
      {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: () => undefined,
        onExit: () => undefined,
      },
      500,
      (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    );

    const connecting = client.connect();
    getTransport().emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    const steering = client.steerTurn("thread-1", "turn-1", "Please adjust course.", "local-steer-1");
    expect(getTransport().sent[2]).toMatchObject({
      id: 2,
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        expectedTurnId: "turn-1",
        clientUserMessageId: "local-steer-1",
        input: [{ type: "text", text: "Please adjust course.", text_elements: [] }],
      },
    });
    getTransport().emitLine({ id: 2, result: { turnId: "turn-1" } });
    await expect(steering).resolves.toEqual({ turnId: "turn-1" });
  });

  it("reads files through app-server fs requests", async () => {
    const { client, transport } = await connectedClient();

    const reading = client.readFile("/tmp/rollout.jsonl");

    await expectRequest(
      transport,
      reading,
      { method: "fs/readFile", params: { path: "/tmp/rollout.jsonl" } },
      { dataBase64: btoa("hello") },
    );
    await expect(reading).resolves.toEqual({ dataBase64: btoa("hello") });
  });

  it("sends thread goal management requests", async () => {
    const { client, transport } = await connectedClient();

    const reading = client.getThreadGoal("thread");
    await expectRequest(transport, reading, { method: "thread/goal/get", params: { threadId: "thread" } }, { goal: null });
    await expect(reading).resolves.toEqual({ goal: null });

    const setting = client.setThreadGoal("thread", { objective: "Finish", status: "active", tokenBudget: 1000 });
    const goal = {
      threadId: "thread",
      objective: "Finish",
      status: "active",
      tokenBudget: 1000,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    await expectRequest(
      transport,
      setting,
      { method: "thread/goal/set", params: { threadId: "thread", objective: "Finish", status: "active", tokenBudget: 1000 } },
      { goal },
    );
    await expect(setting).resolves.toEqual({ goal });

    const clearing = client.clearThreadGoal("thread");
    await expectRequest(transport, clearing, { method: "thread/goal/clear", params: { threadId: "thread" } }, { cleared: true });
    await expect(clearing).resolves.toEqual({ cleared: true });
  });

  it("suppresses late responses after per-request timeouts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
    const logs: string[] = [];
    let transport!: FakeTransport;
    const client = new AppServerClient(
      "/bin/codex",
      "/vault",
      {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: (message) => logs.push(message),
        onExit: () => undefined,
      },
      500,
      (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    );
    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    const reading = client.readFile("/tmp/slow.jsonl", { timeoutMs: 10 });
    const rejection = expect(reading).rejects.toThrow("Codex app-server request timed out: fs/readFile");
    const sent = latestSent(transport);
    if (!("id" in sent) || typeof sent.id !== "number") throw new Error("Expected an app-server request id.");

    await vi.advanceTimersByTimeAsync(10);
    await rejection;

    transport.emitLine({ id: sent.id, result: { dataBase64: btoa("late") } });
    expect(logs).toEqual([]);
  });

  it("bounds timed-out response suppression when responses never arrive", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
    const logs: string[] = [];
    let transport!: FakeTransport;
    const client = new AppServerClient(
      "/bin/codex",
      "/vault",
      {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onLog: (message) => logs.push(message),
        onExit: () => undefined,
      },
      500,
      (handlers) => {
        transport = new FakeTransport(handlers);
        return transport;
      },
    );
    const connecting = client.connect();
    transport.emitLine({ id: 1, result: { codexHome: "/tmp/codex" } satisfies Partial<InitializeResponse> });
    await connecting;

    const timedOutRequests: { id: number; rejection: Promise<void> }[] = [];
    for (let index = 0; index < 257; index += 1) {
      const promise = client.readFile(`/tmp/slow-${String(index)}.jsonl`, { timeoutMs: 10 });
      const rejection = expect(promise).rejects.toThrow("Codex app-server request timed out");
      const sent = latestSent(transport);
      if (!("id" in sent) || typeof sent.id !== "number") throw new Error("Expected an app-server request id.");
      timedOutRequests.push({ id: sent.id, rejection });
    }

    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(timedOutRequests.map(({ rejection }) => rejection));

    const firstTimedOutRequest = timedOutRequests[0];
    const lastTimedOutRequest = timedOutRequests.at(-1);
    if (!firstTimedOutRequest || !lastTimedOutRequest) throw new Error("Expected timed-out requests.");

    transport.emitLine({ id: firstTimedOutRequest.id, result: { dataBase64: btoa("evicted") } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Orphan app-server response");

    transport.emitLine({ id: lastTimedOutRequest.id, result: { dataBase64: btoa("suppressed") } });
    expect(logs).toHaveLength(1);
  });

  it("sends golden thread and turn request payloads", async () => {
    const { client, transport } = await connectedClient();

    const startingThread = client.startThread({ cwd: "/vault", serviceTier: "fast" });
    expect(transport.sent[2]).toMatchObject({
      id: 2,
      method: "thread/start",
      params: {
        cwd: "/vault",
        serviceName: "codex-panel",
        serviceTier: "fast",
      },
    });
    transport.emitLine({ id: 2, result: { thread: { id: "thread-1", title: null }, serviceTier: "fast" } });
    await startingThread;

    const startingTurn = client.startTurn({
      threadId: "thread-1",
      cwd: "/vault",
      input: "hello",
      clientUserMessageId: "local-user-1",
      runtime: { serviceTier: null },
    });
    expect(transport.sent[3]).toMatchObject({
      id: 3,
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        clientUserMessageId: "local-user-1",
        serviceTier: null,
        input: [{ type: "text", text: "hello", text_elements: [] }],
      },
    });
    transport.emitLine({ id: 3, result: { turn: { id: "turn-1" } } });
    await startingTurn;
  });

  it("sends structured user input for turns and steering", async () => {
    const { client, transport } = await connectedClient();
    const input = [
      { type: "text" as const, text: "Read [[Alpha]].", text_elements: [] },
      { type: "mention" as const, name: "Alpha", path: "thoughts/Alpha.md" },
    ];

    const startingTurn = client.startTurn({ threadId: "thread-1", cwd: "/vault", input });
    expect(transport.sent[2]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        input,
      },
    });
    transport.emitLine({ id: 2, result: { turn: { id: "turn-1" } } });
    await startingTurn;

    const steering = client.steerTurn("thread-1", "turn-1", input);
    expect(transport.sent[3]).toMatchObject({
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        expectedTurnId: "turn-1",
        input,
      },
    });
    transport.emitLine({ id: 3, result: { turnId: "turn-1" } });
    await steering;
  });

  it("sends explicit null service tier when fast mode is disabled", async () => {
    const { client, transport } = await connectedClient();

    const startingThread = client.startThread({ cwd: "/vault", serviceTier: null });
    expect(transport.sent[2]).toMatchObject({
      id: 2,
      method: "thread/start",
      params: { cwd: "/vault", serviceTier: null },
    });
    transport.emitLine({ id: 2, result: { thread: { id: "thread-1", title: null }, serviceTier: null } });
    await startingThread;
  });

  it("sends collaboration mode only for Plan turns", async () => {
    const { client, transport } = await connectedClient();

    const defaultTurn = client.startTurn({
      threadId: "thread-1",
      cwd: "/vault",
      input: "default",
      runtime: { serviceTier: null },
    });
    expect(transport.sent[2]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        input: [{ type: "text", text: "default", text_elements: [] }],
      },
    });
    expect((transport.sent[2] as { params?: Record<string, unknown> }).params?.["collaborationMode"]).toBeUndefined();
    transport.emitLine({ id: 2, result: { turn: { id: "turn-default" } } });
    await defaultTurn;

    const planTurn = client.startTurn({
      threadId: "thread-1",
      cwd: "/vault",
      input: "plan",
      runtime: {
        serviceTier: null,
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.5",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
      },
    });
    expect(transport.sent[3]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        input: [{ type: "text", text: "plan", text_elements: [] }],
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.5",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
      },
    });
    transport.emitLine({ id: 3, result: { turn: { id: "turn-plan" } } });
    await planTurn;
  });

  it("sends model and effort turn overrides when provided", async () => {
    const { client, transport } = await connectedClient();

    const startingTurn = client.startTurn({
      threadId: "thread-1",
      cwd: "/vault",
      input: "override",
      runtime: { serviceTier: null, model: "gpt-5.5", effort: "high" },
    });
    expect(transport.sent[2]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        model: "gpt-5.5",
        effort: "high",
        input: [{ type: "text", text: "override", text_elements: [] }],
      },
    });
    transport.emitLine({ id: 2, result: { turn: { id: "turn-override" } } });
    await startingTurn;

    const resetTurn = client.startTurn({
      threadId: "thread-1",
      cwd: "/vault",
      input: "reset",
      runtime: { serviceTier: null, model: null, effort: null, approvalsReviewer: null },
    });
    expect(transport.sent[3]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        model: null,
        effort: null,
        approvalsReviewer: null,
        input: [{ type: "text", text: "reset", text_elements: [] }],
      },
    });
    transport.emitLine({ id: 3, result: { turn: { id: "turn-reset" } } });
    await resetTurn;
  });

  it("omits undefined runtime turn overrides while preserving explicit null resets", async () => {
    const { client, transport } = await connectedClient();

    const runtimeWithUndefined = {
      serviceTier: null,
      collaborationMode: undefined,
      model: undefined,
      effort: undefined,
      approvalsReviewer: undefined,
    } as unknown as NonNullable<AppServerStartTurnOptions["runtime"]>;
    const turn = client.startTurn({
      threadId: "thread-1",
      cwd: "/vault",
      input: "runtime boundary",
      runtime: runtimeWithUndefined,
    });
    const params = (transport.sent[2] as { params?: Record<string, unknown> }).params ?? {};
    expect(params).toMatchObject({
      threadId: "thread-1",
      cwd: "/vault",
      serviceTier: null,
      input: [{ type: "text", text: "runtime boundary", text_elements: [] }],
    });
    expect(params).not.toHaveProperty("collaborationMode");
    expect(params).not.toHaveProperty("model");
    expect(params).not.toHaveProperty("effort");
    expect(params).not.toHaveProperty("approvalsReviewer");
    transport.emitLine({ id: 2, result: { turn: { id: "turn-runtime-boundary" } } });
    await turn;

    const structuredRuntimeWithUndefined = {
      serviceTier: undefined,
      collaborationMode: undefined,
      model: undefined,
      effort: undefined,
      approvalsReviewer: undefined,
    } as unknown as NonNullable<AppServerStartStructuredTurnOptions["runtime"]>;
    const structuredTurn = client.startStructuredTurn({
      threadId: "structured-thread",
      cwd: "/vault",
      text: "structured runtime boundary",
      outputSchema: { type: "object", properties: {}, additionalProperties: false },
      runtime: structuredRuntimeWithUndefined,
    });
    const structuredParams = (transport.sent[3] as { params?: Record<string, unknown> }).params ?? {};
    expect(structuredParams).toMatchObject({
      threadId: "structured-thread",
      cwd: "/vault",
      input: [{ type: "text", text: "structured runtime boundary", text_elements: [] }],
      outputSchema: { type: "object", properties: {}, additionalProperties: false },
    });
    expect(structuredParams).not.toHaveProperty("serviceTier");
    expect(structuredParams).not.toHaveProperty("collaborationMode");
    expect(structuredParams).not.toHaveProperty("model");
    expect(structuredParams).not.toHaveProperty("effort");
    expect(structuredParams).not.toHaveProperty("approvalsReviewer");
    transport.emitLine({ id: 3, result: { turn: { id: "turn-structured-runtime-boundary" } } });
    await structuredTurn;
  });

  it("sends approval reviewer turn overrides when provided", async () => {
    const { client, transport } = await connectedClient();

    const autoReviewTurn = client.startTurn({
      threadId: "thread-1",
      cwd: "/vault",
      input: "review this",
      runtime: { serviceTier: null, approvalsReviewer: "auto_review" },
    });
    expect(transport.sent[2]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        approvalsReviewer: "auto_review",
        input: [{ type: "text", text: "review this", text_elements: [] }],
      },
    });
    transport.emitLine({ id: 2, result: { turn: { id: "turn-auto-review" } } });
    await autoReviewTurn;

    const userReviewTurn = client.startTurn({
      threadId: "thread-1",
      cwd: "/vault",
      input: "ask me",
      runtime: { serviceTier: null, approvalsReviewer: "user" },
    });
    expect(transport.sent[3]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        approvalsReviewer: "user",
        input: [{ type: "text", text: "ask me", text_elements: [] }],
      },
    });
    transport.emitLine({ id: 3, result: { turn: { id: "turn-user-review" } } });
    await userReviewTurn;
  });

  it("sends thread settings updates for subsequent turns", async () => {
    const { client, transport } = await connectedClient();

    const update = client.updateThreadSettings("thread-1", {
      model: "gpt-5.5",
      effort: "high",
      serviceTier: "fast",
      approvalsReviewer: "auto_review",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoningEffort: "high",
          developerInstructions: null,
        },
      },
    });
    expect(transport.sent[2]).toMatchObject({
      method: "thread/settings/update",
      params: {
        threadId: "thread-1",
        model: "gpt-5.5",
        effort: "high",
        serviceTier: "fast",
        approvalsReviewer: "auto_review",
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.5",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        },
      },
    });
    transport.emitLine({ id: 2, result: {} });
    await update;
  });

  it("sends inventory and diagnostic requests with panel-specific query bounds", async () => {
    const { client, transport } = await connectedClient();

    await expectRequest(
      transport,
      client.readEffectiveConfig("/vault"),
      { method: "config/read", params: { cwd: "/vault", includeLayers: true } },
      { config: {}, origins: {}, layers: [] },
    );
    await expectRequest(
      transport,
      client.listModels(),
      { method: "model/list", params: { includeHidden: false, limit: 100 } },
      { data: [], nextCursor: null },
    );
    await expectRequest(
      transport,
      client.listThreads("/vault", { archived: true }),
      { method: "thread/list", params: { cwd: "/vault", archived: true, sortKey: "updated_at", sortDirection: "desc" } },
      { data: [], nextCursor: null },
    );
    await expectRequest(
      transport,
      client.listThreads("/vault", { archived: false, cursor: "cursor-1", limit: 100 }),
      {
        method: "thread/list",
        params: { cwd: "/vault", cursor: "cursor-1", limit: 100, archived: false, sortKey: "updated_at", sortDirection: "desc" },
      },
      { data: [], nextCursor: null },
    );
    await expectRequest(
      transport,
      client.listSkills("/vault"),
      { method: "skills/list", params: { cwds: ["/vault"], forceReload: false } },
      { data: [] },
    );
    expect((latestSent(transport) as { params?: Record<string, unknown> }).params?.["perCwdExtraUserRoots"]).toBeUndefined();
    await expectRequest(
      transport,
      client.listSkills("/vault", true),
      { method: "skills/list", params: { cwds: ["/vault"], forceReload: true } },
      { data: [] },
    );
    await expectRequest(
      transport,
      client.listMcpServerStatus(),
      { method: "mcpServerStatus/list", params: { detail: "toolsAndAuthOnly", limit: 100 } },
      { data: [], nextCursor: null },
    );
    await expectRequest(transport, client.listCollaborationModes(), { method: "collaborationMode/list", params: {} }, { data: [] });
    await expectRequest(
      transport,
      client.readModelProviderCapabilities(),
      { method: "modelProvider/capabilities/read", params: {} },
      { namespaceTools: true, imageGeneration: false, webSearch: true },
    );
  });

  it("preserves app-server RPC error codes", async () => {
    const { client, transport } = await connectedClient();

    const listing = client.listModels();
    transport.emitLine({ id: 2, error: { code: -32601, message: "Method not found" } });

    await expect(listing).rejects.toMatchObject({
      name: "AppServerRpcError",
      code: -32601,
      method: "model/list",
      message: "Method not found",
    } satisfies Partial<AppServerRpcError>);
  });

  it("resumes and forks threads without loading full turn history", async () => {
    const { client, transport } = await connectedClient();

    const resuming = client.resumeThread("thread-1", "/vault");
    expect(transport.sent[2]).toMatchObject({
      id: 2,
      method: "thread/resume",
      params: {
        threadId: "thread-1",
        cwd: "/vault",
        excludeTurns: true,
        initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" },
      },
    });
    transport.emitLine({ id: 2, result: { thread: { id: "thread-1", title: null }, cwd: "/vault" } });
    await resuming;

    const forking = client.forkThread("thread-1", "/vault");
    expect(transport.sent[3]).toMatchObject({
      id: 3,
      method: "thread/fork",
      params: { threadId: "thread-1", cwd: "/vault", excludeTurns: true },
    });
    transport.emitLine({ id: 3, result: { thread: { id: "thread-2", title: null }, cwd: "/vault" } });
    await forking;
  });

  it("loads turn history pages in the requested direction with full items", async () => {
    const { client, transport } = await connectedClient();

    const turns = client.threadTurnsList("thread-1", "cursor-1", 10);
    expect(transport.sent[2]).toMatchObject({
      id: 2,
      method: "thread/turns/list",
      params: { threadId: "thread-1", cursor: "cursor-1", limit: 10, sortDirection: "desc", itemsView: "full" },
    });
    transport.emitLine({ id: 2, result: { data: [], nextCursor: null } });
    await turns;

    const firstTurn = client.threadTurnsList("thread-1", null, 1, "asc");
    expect(transport.sent[3]).toMatchObject({
      id: 3,
      method: "thread/turns/list",
      params: { threadId: "thread-1", cursor: null, limit: 1, sortDirection: "asc", itemsView: "full" },
    });
    transport.emitLine({ id: 3, result: { data: [], nextCursor: null } });
    await firstTurn;
  });

  it("rolls back exactly one latest turn in thread history", async () => {
    const { client, transport } = await connectedClient();

    const rollback = client.rollbackThread("thread-1");
    expect(transport.sent[2]).toMatchObject({
      id: 2,
      method: "thread/rollback",
      params: { threadId: "thread-1", numTurns: 1 },
    });
    transport.emitLine({ id: 2, result: { thread: { id: "thread-1", turns: [] } } });
    await rollback;
  });

  it("starts title generation in a read-only ephemeral thread", async () => {
    const { client, transport } = await connectedClient();

    const namingThread = client.startEphemeralThread({
      cwd: "/vault",
      serviceName: "naming",
      developerInstructions: "Return a title.",
    });
    expect(transport.sent[2]).toMatchObject({
      id: 2,
      method: "thread/start",
      params: {
        cwd: "/vault",
        serviceName: "naming",
        developerInstructions: "Return a title.",
        ephemeral: true,
        sandbox: "read-only",
        approvalPolicy: "never",
        environments: [],
      },
    });
    transport.emitLine({ id: 2, result: { thread: { id: "naming-thread" } } });
    await namingThread;
  });

  it("requests structured title output with optional naming runtime overrides", async () => {
    const { client, transport } = await connectedClient();

    const structuredTurn = client.startStructuredTurn({
      threadId: "naming-thread",
      cwd: "/vault",
      text: "title please",
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      runtime: {
        serviceTier: null,
        collaborationMode: {
          mode: "plan",
          settings: { model: "gpt-5.4-mini", reasoning_effort: "minimal", developer_instructions: null },
        },
        model: "gpt-5.4-mini",
        effort: "minimal",
        approvalsReviewer: null,
      },
    });
    expect(transport.sent[2]).toMatchObject({
      id: 2,
      method: "turn/start",
      params: {
        threadId: "naming-thread",
        cwd: "/vault",
        serviceTier: null,
        collaborationMode: {
          mode: "plan",
          settings: { model: "gpt-5.4-mini", reasoning_effort: "minimal", developer_instructions: null },
        },
        model: "gpt-5.4-mini",
        effort: "minimal",
        approvalsReviewer: null,
        input: [{ type: "text", text: "title please", text_elements: [] }],
        outputSchema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
    });
    transport.emitLine({ id: 2, result: { turn: { id: "naming-turn" } } });
    await structuredTurn;
  });

  it("saves the user-confirmed thread title through app-server metadata", async () => {
    const { client, transport } = await connectedClient();

    await expectRequest(
      transport,
      client.setThreadName("thread-1", "Codex Panel自動命名"),
      { method: "thread/name/set", params: { threadId: "thread-1", name: "Codex Panel自動命名" } },
      {},
    );
  });
});
