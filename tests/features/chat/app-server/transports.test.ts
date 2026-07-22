import { describe, expect, it, vi } from "vitest";

import type { AppServerClient, ClientResponseByMethod } from "../../../../src/app-server/connection/client";
import * as shortLivedClient from "../../../../src/app-server/connection/short-lived-client";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { TurnItem, TurnRecord } from "../../../../src/app-server/protocol/turn";
import type { CodexInput } from "../../../../src/domain/chat/input";
import { createServerDiagnostics, diagnosticProbeOk } from "../../../../src/domain/server/diagnostics";
import { createChatAppServerGateway, createChatCurrentAppServerGateway } from "../../../../src/features/chat/app-server/session-gateway";
import { preparedUserInputWithWikiLinkReferencesSkillsAndContext } from "../../../../src/features/chat/application/composer/wikilink-context";
import { deferred } from "../../../support/async";

const textInput = (text: string): CodexInput => [{ type: "text", text }];

describe("chat app-server transports", () => {
  it("adds connection-requiring capabilities only after the connected client host exists", async () => {
    const client = { request: vi.fn() } as unknown as AppServerClient;
    const currentGateway = createChatCurrentAppServerGateway({
      fallbackClientAccess: {
        withClient: (operation) => operation(client),
      },
      vaultPath: "/vault",
      currentClient: () => client,
    });
    const connectedClient = vi.fn().mockResolvedValue(client);

    expect(currentGateway.connectionAvailable()).toBe(true);
    expect(currentGateway).not.toHaveProperty("turn");

    const gateway = createChatAppServerGateway(currentGateway, {
      vaultPath: "/vault",
      currentClient: () => client,
      connectedClient,
    });

    await expect(gateway.turn.ensureConnected()).resolves.toBe(true);
    expect(connectedClient).toHaveBeenCalledOnce();
  });

  it("starts threads with the session vault path and projects activation snapshots", async () => {
    const request = vi.fn().mockResolvedValue(threadStartResponse("thread"));
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadStart;

    const snapshot = await transport.startThread({ serviceTier: "priority", permissions: ":workspace" });

    expect(request).toHaveBeenCalledWith("thread/start", {
      cwd: "/vault",
      serviceName: "codex-panel",
      serviceTier: "priority",
      permissions: ":workspace",
    });
    expect(snapshot).toMatchObject({
      kind: "completed-current",
      value: { thread: { id: "thread" } },
    });
  });

  it("drops stale thread start responses after the current client changes", async () => {
    const start = deferred<AppServerThreadStartResponse>();
    const firstClient = { request: vi.fn().mockReturnValue(start.promise) } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const transport = createTestGateway({
      currentClient: () => currentClient,
      connectedClient: vi.fn().mockResolvedValue(firstClient),
    }).threadStart;

    const starting = transport.startThread({});
    currentClient = secondClient;
    start.resolve(threadStartResponse("thread"));

    await expect(starting).resolves.toMatchObject({
      kind: "completed-stale",
      value: { thread: { id: "thread" } },
    });
  });

  it("starts turns with the session vault path and returns chat-owned turn ids", async () => {
    const request = vi.fn().mockResolvedValue({ turn: { id: "turn-1" } });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).turn;

    await expect(
      transport.startTurn({
        threadId: "thread",
        input: textInput("hello"),
        clientUserMessageId: "local-user",
      }),
    ).resolves.toEqual({ kind: "completed-current", value: { turnId: "turn-1" } });

    expect(request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread",
      cwd: "/vault",
      input: [{ type: "text", text: "hello", text_elements: [] }],
      clientUserMessageId: "local-user",
    });
  });

  it("starts turns with wikilink and active file context in one app-server payload", async () => {
    const request = vi.fn().mockResolvedValue({ turn: { id: "turn-1" } });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).turn;
    const text = "Compare [[Alpha]] with the active file.";
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      (target) => (target === "Alpha" ? { name: "Alpha", path: "notes/Alpha.md" } : null),
      [],
      {
        activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
        selection: null,
      },
      { referenceActiveNoteOnSend: true },
    );

    await transport.startTurn({
      threadId: "thread",
      input: prepared.input,
      clientUserMessageId: "local-user-1-seed-1-1",
    });

    const [, params] = request.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      threadId: "thread",
      cwd: "/vault",
      clientUserMessageId: "local-user-1-seed-1-1",
    });
    expect(params?.input).toEqual([{ type: "text", text, text_elements: [] }]);
    expect(params?.additionalContext).toEqual({
      "codex_panel.local-user-1-seed-1-1.00.codex_panel_obsidian_context.part_01_of_01": {
        kind: "untrusted",
        value:
          "Codex Panel context part 1/1.\nSource: codex_panel_obsidian_context\n\nObsidian references for the current user input:\n- [[Alpha]] -> notes/Alpha.md\n- <active> -> notes/Alpha.md",
      },
    });
  });

  it("drops stale turn transport responses after the current client changes", async () => {
    const start = deferred<{ turn: { id: string } }>();
    const firstClient = { request: vi.fn().mockReturnValue(start.promise) } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const transport = createTestGateway({
      currentClient: () => currentClient,
      connectedClient: vi.fn().mockResolvedValue(firstClient),
    }).turn;

    const starting = transport.startTurn({ threadId: "thread", input: textInput("hello"), clientUserMessageId: "local-user" });
    currentClient = secondClient;
    start.resolve({ turn: { id: "turn-1" } });

    await expect(starting).resolves.toEqual({ kind: "completed-stale", value: { turnId: "turn-1" } });
  });

  it("preserves a completed stale steer as an external effect fact", async () => {
    const steer = deferred<unknown>();
    const firstClient = { request: vi.fn().mockReturnValue(steer.promise) } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const transport = createTestGateway({
      currentClient: () => currentClient,
      connectedClient: vi.fn().mockResolvedValue(firstClient),
    }).turn;

    const steering = transport.steerTurn({
      threadId: "thread",
      turnId: "turn",
      input: textInput("follow up"),
      clientUserMessageId: "local-user",
    });
    currentClient = secondClient;
    steer.resolve({});

    await expect(steering).resolves.toEqual({ kind: "completed-stale", value: undefined });
  });

  it("uses the steer client id to namespace bounded context", async () => {
    const request = vi.fn().mockResolvedValue({});
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).turn;

    await transport.steerTurn({
      threadId: "thread",
      turnId: "turn",
      input: [
        { type: "text", text: "follow up" },
        { type: "additionalContext", key: "codex_panel_web_context", kind: "untrusted", value: "page" },
      ],
      clientUserMessageId: "local-steer",
    });

    const [, params] = request.mock.calls[0] ?? [];
    expect(params?.additionalContext).toEqual({
      "codex_panel.local-steer.00.codex_panel_web_context.part_01_of_01": {
        kind: "untrusted",
        value: "Codex Panel context part 1/1.\nSource: codex_panel_web_context\n\npage",
      },
    });
    expect(params?.input).toEqual([{ type: "text", text: "follow up", text_elements: [] }]);
  });

  it("compacts threads through a connected app-server client", async () => {
    const request = vi.fn().mockResolvedValue({});
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadMutation;

    await expect(transport.compactThread("thread")).resolves.toEqual({ kind: "completed-current", value: undefined });

    expect(request).toHaveBeenCalledWith("thread/compact/start", { threadId: "thread" });
  });

  it("forks threads with the session vault path and returns panel threads", async () => {
    const request = vi.fn().mockResolvedValue({ thread: threadRecord("forked") });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadMutation;

    const outcome = await transport.forkThread("source");

    expect(request).toHaveBeenCalledWith("thread/fork", { threadId: "source", cwd: "/vault", excludeTurns: true });
    expect(outcome).toMatchObject({
      kind: "completed-current",
      value: { id: "forked", preview: "Preview", archived: false },
    });
  });

  it("drops stale fork transport responses after the current client changes", async () => {
    const fork = deferred<{ thread: ThreadRecord }>();
    const firstClient = { request: vi.fn().mockReturnValue(fork.promise) } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const transport = createTestGateway({
      currentClient: () => currentClient,
      connectedClient: vi.fn().mockResolvedValue(firstClient),
    }).threadMutation;

    const forking = transport.forkThread("source");
    currentClient = secondClient;
    fork.resolve({ thread: threadRecord("forked") });

    await expect(forking).resolves.toMatchObject({
      kind: "completed-stale",
      value: { id: "forked" },
    });
  });

  it("projects rollback turns into thread stream items", async () => {
    const request = vi.fn().mockResolvedValue({ thread: threadRecord("thread", [turn([userMessage("u1", "prompt")])]) });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadMutation;

    const snapshot = await transport.rollbackThread("thread");

    expect(request).toHaveBeenCalledWith("thread/rollback", { threadId: "thread", numTurns: 1 });
    expect(snapshot).toMatchObject({
      kind: "completed-current",
      value: {
        thread: { id: "thread" },
        items: [expect.objectContaining({ kind: "dialogue", role: "user", text: "prompt" })],
      },
    });
  });

  it("reads thread history pages as thread stream items", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [turn([userMessage("u1", "prompt"), agentMessage("a1", "answer")])],
      nextCursor: "older",
    });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadHistory;

    const page = await transport.readHistoryPage("thread", "cursor", 20);

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "thread",
      cursor: "cursor",
      limit: 20,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(page?.nextCursor).toBe("older");
    expect(page?.hadTurns).toBe(true);
    expect(page?.items).toEqual([
      expect.objectContaining({ kind: "dialogue", role: "user", text: "prompt" }),
      expect.objectContaining({ kind: "dialogue", role: "assistant", text: "answer" }),
    ]);
  });

  it("drops stale history transport responses after the current client changes", async () => {
    const history = deferred<{ data: TurnRecord[]; nextCursor: string | null }>();
    const firstClient = { request: vi.fn().mockReturnValue(history.promise) } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const transport = createTestGateway({
      currentClient: () => currentClient,
      connectedClient: vi.fn().mockResolvedValue(firstClient),
    }).threadHistory;

    const loading = transport.readHistoryPage("thread", "cursor", 20);
    currentClient = secondClient;
    history.resolve({ data: [turn([userMessage("u1", "prompt")])], nextCursor: "older" });

    await expect(loading).resolves.toBeNull();
  });

  it("resumes threads with the session vault path and projects initial history", async () => {
    const request = vi.fn().mockResolvedValue({
      thread: { ...threadRecord("thread"), path: "/tmp/rollout.jsonl" },
      cwd: "/vault",
      model: "gpt-test",
      serviceTier: null,
      approvalsReviewer: "user",
      reasoningEffort: null,
      initialTurnsPage: {
        data: [turn([userMessage("u1", "prompt")])],
        nextCursor: "older",
      },
    });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadResume;

    const snapshot = await transport.resumeThread("thread");

    expect(request).toHaveBeenCalledWith("thread/resume", {
      threadId: "thread",
      cwd: "/vault",
      excludeTurns: true,
      initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" },
    });
    expect(snapshot).toMatchObject({
      kind: "completed-current",
      value: {
        activation: { thread: { id: "thread" } },
        rolloutPath: "/tmp/rollout.jsonl",
        initialHistoryPage: {
          nextCursor: "older",
          hadTurns: true,
          items: [expect.objectContaining({ kind: "dialogue", role: "user", text: "prompt" })],
        },
      },
    });
  });

  it("drops stale resume transport responses after the current client changes", async () => {
    const resume = deferred<AppServerThreadResumeResponse>();
    const firstClient = { request: vi.fn().mockReturnValue(resume.promise) } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const transport = createTestGateway({
      currentClient: () => currentClient,
      connectedClient: vi.fn().mockResolvedValue(firstClient),
    }).threadResume;

    const resuming = transport.resumeThread("thread");
    currentClient = secondClient;
    resume.resolve(threadResumeResponse("thread"));

    await expect(resuming).resolves.toMatchObject({
      kind: "completed-stale",
      value: { activation: { thread: { id: "thread" } } },
    });
  });

  it("returns no resume snapshot when no connected client is available", async () => {
    const transport = createTestGateway({
      currentClient: () => null,
      connectedClient: vi.fn().mockResolvedValue(null),
    }).threadResume;

    await expect(transport.resumeThread("thread")).resolves.toEqual({ kind: "not-started" });
  });

  it("cleans up a stale ephemeral fork through the client that created it", async () => {
    const injected = deferred<unknown>();
    const firstRequest = vi.fn((method: string) => {
      switch (method) {
        case "thread/read":
          return Promise.resolve({ thread: threadRecord("source") });
        case "config/read":
          return Promise.resolve({ config: { developer_instructions: null } });
        case "thread/fork":
          return Promise.resolve(
            threadStartResponse("side", {
              thread: threadRecord("side", [], { ephemeral: true }) as AppServerThreadStartResponse["thread"],
            }),
          );
        case "thread/inject_items":
          return injected.promise;
        case "thread/unsubscribe":
          return Promise.resolve({ status: "unsubscribed" });
        default:
          throw new Error(`Unexpected request: ${method}`);
      }
    });
    const firstClient = { request: firstRequest } as unknown as AppServerClient;
    const secondRequest = vi.fn();
    const secondClient = { request: secondRequest } as unknown as AppServerClient;
    let currentClient = firstClient;
    const transport = createTestGateway({
      currentClient: () => currentClient,
      connectedClient: vi.fn().mockResolvedValue(firstClient),
    }).threadEphemeral;

    const forking = transport.forkEphemeralThread("source");
    await vi.waitFor(() => expect(firstRequest).toHaveBeenCalledWith("thread/inject_items", expect.anything()));
    currentClient = secondClient;
    injected.resolve({});

    await expect(forking).resolves.toMatchObject({
      kind: "completed-stale",
      value: { kind: "ready", activation: { thread: { id: "side" } } },
    });
    expect(firstRequest).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 });
    expect(secondRequest).not.toHaveBeenCalled();
  });

  it("unsubscribes a panel from a persistent thread without interrupting its turn", async () => {
    const request = vi.fn().mockResolvedValue({ status: "unsubscribed" });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadSubscription;

    await expect(transport.unsubscribeThread("child")).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "child" }, { timeoutMs: 5_000 });
    expect(request).not.toHaveBeenCalledWith("turn/interrupt", expect.anything());
  });

  it("distinguishes absent goals from unavailable goal clients", async () => {
    const client = { request: vi.fn().mockResolvedValue({ goal: null }) } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadGoal;
    const unavailable = createTestGateway({
      currentClient: () => null,
      connectedClient: vi.fn().mockResolvedValue(null),
    }).threadGoal;
    const readOnlyUnavailable = createTestGateway({
      currentClient: () => null,
      connectedClient: vi.fn().mockResolvedValue(null),
    }).threadGoalRead;

    await expect(transport.readThreadGoal("thread")).resolves.toBeNull();
    await expect(unavailable.readThreadGoal("thread")).resolves.toBeUndefined();
    await expect(readOnlyUnavailable.readThreadGoal("thread")).resolves.toBeUndefined();
  });

  it("drops stale runtime settings updates after the current client changes", async () => {
    const update = deferred<void>();
    const request = vi.fn().mockReturnValue(update.promise);
    const firstClient = { request } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const transport = createTestGateway({
      currentClient: () => currentClient,
      connectedClient: vi.fn().mockResolvedValue(firstClient),
    }).runtimeSettings;

    const updating = transport.updateThreadSettings("thread", { model: "gpt-5.5" });
    currentClient = secondClient;
    update.resolve(undefined);

    await expect(updating).resolves.toBe(false);
    expect(request).toHaveBeenCalledWith("thread/settings/update", { threadId: "thread", model: "gpt-5.5" });
  });

  it("reads diagnostics probes and tool inventory at the app-server boundary", async () => {
    const request = vi.fn((method: string) => {
      switch (method) {
        case "model/list":
          return Promise.resolve({ data: [] });
        case "account/rateLimits/read":
          return Promise.resolve({ rateLimits: null, rateLimitsByLimitId: null });
        case "plugin/installed":
          return Promise.resolve({ marketplaces: [], marketplaceLoadErrors: [] });
        case "mcpServerStatus/list":
          return Promise.resolve({ data: [] });
        case "skills/list":
          return Promise.resolve({ data: [{ cwd: "/vault", skills: [] }] });
        default:
          throw new Error(`Unexpected request: ${method}`);
      }
    });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
    }).serverDiagnostics;

    const snapshot = await transport.readServerDiagnostics({
      threadId: "thread",
      initialDiagnostics: createServerDiagnostics(),
      cachedSkills: [],
      cachedSkillsProbe: diagnosticProbeOk("skills", "0 skills", 1),
      forceResourceProbes: true,
      appServerMetadataSnapshot: false,
    });

    expect(snapshot?.resourceProbes.map((probe) => probe.id)).toEqual(["models", "rateLimits"]);
    expect(request).toHaveBeenCalledWith("model/list", { includeHidden: false, cursor: null, limit: 100 });
    expect(request).toHaveBeenCalledWith("account/rateLimits/read", undefined);
    expect(request).toHaveBeenCalledWith("mcpServerStatus/list", {
      detail: "toolsAndAuthOnly",
      cursor: null,
      limit: 100,
      threadId: "thread",
    });
    expect(request).not.toHaveBeenCalledWith("skills/list", expect.anything());
  });

  it("reads skills for diagnostics tool inventory when no cached skills are provided", async () => {
    const request = vi.fn((method: string) => {
      switch (method) {
        case "plugin/installed":
          return Promise.resolve({ marketplaces: [], marketplaceLoadErrors: [] });
        case "mcpServerStatus/list":
          return Promise.resolve({ data: [] });
        case "skills/list":
          return Promise.resolve({ data: [{ cwd: "/vault", skills: [] }] });
        default:
          throw new Error(`Unexpected request: ${method}`);
      }
    });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
    }).serverDiagnostics;

    await transport.readServerDiagnostics({
      threadId: null,
      initialDiagnostics: createServerDiagnostics(),
      forceResourceProbes: false,
      appServerMetadataSnapshot: true,
    });

    expect(request).toHaveBeenCalledWith("skills/list", { cwds: ["/vault"], forceReload: false });
  });

  it("uses a short-lived client for clientAccess operations that reject server requests", async () => {
    const currentRequest = vi.fn();
    const currentClient = { request: currentRequest } as unknown as AppServerClient;
    const shortClient = { request: vi.fn().mockResolvedValue("short-lived") } as unknown as AppServerClient;
    const withShortLived = vi
      .spyOn(shortLivedClient, "withShortLivedAppServerClient")
      .mockImplementation(async (_codexPath, _cwd, operation) => {
        return operation(shortClient);
      });
    const gateway = createTestGateway({
      codexPath: "/usr/local/bin/codex",
      currentClient: () => currentClient,
    });

    await expect(
      gateway.clientAccess.withClient((client) => client.request("thread/list", {}), {
        serverRequests: { kind: "reject", message: "Background operation cannot answer server requests." },
      }),
    ).resolves.toBe("short-lived");

    expect(withShortLived).toHaveBeenCalledWith("/usr/local/bin/codex", "/vault", expect.any(Function), {
      serverRequests: { kind: "reject", message: "Background operation cannot answer server requests." },
    });
    expect(currentRequest).not.toHaveBeenCalled();
    withShortLived.mockRestore();
  });

  it("rejects current-client operations while disconnected", async () => {
    const operation = vi.fn();
    const gateway = createTestGateway({ currentClient: () => null });

    await expect(gateway.clientAccess.withClient(operation)).rejects.toThrow("Codex app-server is not connected.");
    expect(operation).not.toHaveBeenCalled();
    expect(gateway.connectionAvailable()).toBe(false);
  });

  it("rejects current-client results when the connection changes during the operation", async () => {
    const result = deferred<string>();
    const firstClient = {} as AppServerClient;
    const secondClient = {} as AppServerClient;
    let currentClient = firstClient;
    const gateway = createTestGateway({ currentClient: () => currentClient });

    const running = gateway.clientAccess.withClient(() => result.promise);
    currentClient = secondClient;
    result.resolve("stale");

    await expect(running).rejects.toThrow("Codex app-server connection changed while running the operation.");
  });

  it("reads files from the current client with request options", async () => {
    const request = vi.fn().mockResolvedValue({ dataBase64: "ZmlsZQ==" });
    const client = { request } as unknown as AppServerClient;
    const gateway = createTestGateway({ currentClient: () => client });

    await expect(gateway.readFileBase64("/tmp/rollout.jsonl", { timeoutMs: 2_000 })).resolves.toBe("ZmlsZQ==");
    expect(request).toHaveBeenCalledWith("fs/readFile", { path: "/tmp/rollout.jsonl" }, { timeoutMs: 2_000 });
  });

  it("returns no file data while disconnected or when the connection changes during the read", async () => {
    const disconnected = createTestGateway({ currentClient: () => null });
    await expect(disconnected.readFileBase64("/tmp/rollout.jsonl")).resolves.toBeNull();

    const read = deferred<{ dataBase64: string }>();
    const firstClient = { request: vi.fn().mockReturnValue(read.promise) } as unknown as AppServerClient;
    const secondClient = {} as AppServerClient;
    let currentClient = firstClient;
    const gateway = createTestGateway({ currentClient: () => currentClient });

    const reading = gateway.readFileBase64("/tmp/rollout.jsonl");
    currentClient = secondClient;
    read.resolve({ dataBase64: "c3RhbGU=" });

    await expect(reading).resolves.toBeNull();
  });
});

type AppServerThreadStartResponse = ClientResponseByMethod["thread/start"];
type AppServerThreadResumeResponse = ClientResponseByMethod["thread/resume"];

function createTestGateway(options: {
  codexPath?: string;
  vaultPath?: string;
  currentClient: () => AppServerClient | null;
  connectedClient?: () => Promise<AppServerClient | null>;
}) {
  const codexPath = options.codexPath ?? "codex";
  const vaultPath = options.vaultPath ?? "/vault";
  const currentGateway = createChatCurrentAppServerGateway({
    fallbackClientAccess: {
      withClient: (operation, clientOptions) =>
        shortLivedClient.withShortLivedAppServerClient(codexPath, vaultPath, operation, clientOptions),
    },
    vaultPath,
    currentClient: options.currentClient,
  });
  return createChatAppServerGateway(currentGateway, {
    vaultPath: options.vaultPath ?? "/vault",
    currentClient: options.currentClient,
    connectedClient: options.connectedClient ?? (async () => options.currentClient()),
  });
}

function threadRecord(id: string, turns: readonly TurnRecord[] = [], overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id,
    sessionId: id,
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
    cliVersion: "codex-cli 0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns,
    ...overrides,
  };
}

function threadStartResponse(threadId: string, overrides: Partial<AppServerThreadStartResponse> = {}): AppServerThreadStartResponse {
  return {
    thread: threadRecord(threadId) as AppServerThreadStartResponse["thread"],
    cwd: "/vault",
    model: "gpt-test",
    modelProvider: "openai",
    serviceTier: null,
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
    reasoningEffort: null,
    multiAgentMode: "explicitRequestOnly",
    ...overrides,
  };
}

function threadResumeResponse(threadId: string, overrides: Partial<AppServerThreadResumeResponse> = {}): AppServerThreadResumeResponse {
  return {
    thread: threadRecord(threadId) as AppServerThreadResumeResponse["thread"],
    cwd: "/vault",
    model: "gpt-test",
    modelProvider: "openai",
    serviceTier: null,
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
    reasoningEffort: null,
    multiAgentMode: "explicitRequestOnly",
    initialTurnsPage: null,
    turnsBackwardsCursor: null,
    itemsBackwardsCursor: null,
    ...overrides,
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

function userMessage(id: string, text: string): TurnItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function agentMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}
