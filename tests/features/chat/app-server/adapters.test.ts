import { describe, expect, it, vi } from "vitest";
import type { AppServerClient, ClientResponseByMethod } from "../../../../src/app-server/connection/client";
import { AppServerRpcError } from "../../../../src/app-server/connection/json-rpc-client";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { TurnItem, TurnRecord } from "../../../../src/app-server/protocol/turn";
import type { CodexInput } from "../../../../src/domain/input/input";
import { createChatAppServerGateway } from "../../../../src/features/chat/app-server/session-gateway";
import { preparedUserInputWithWikiLinkReferencesSkillsAndContext } from "../../../../src/features/chat/application/composer/wikilink-context";
import { appServerTurnFixture } from "../../../support/app-server-records";
import { deferred } from "../../../support/async";

const textInput = (text: string): CodexInput => [{ type: "text", text }];

describe("chat app-server adapters", () => {
  it.each([false, true])("starts ordinary conversations with normal permissions and tools (temporary=%s)", async (ephemeral) => {
    const response = threadStartResponse("thread");
    const request = vi.fn().mockResolvedValue({ ...response, thread: { ...response.thread, ephemeral } });
    const client = { request } as unknown as AppServerClient;
    const recordThreadSubscription = vi.fn();
    const gateway = createTestGateway({ currentClient: () => client, recordThreadSubscription });
    const snapshot = await gateway.threadStart.startThread({ ephemeral, serviceTier: "priority", permissions: ":workspace" });
    expect(request).toHaveBeenCalledExactlyOnceWith("thread/start", {
      cwd: "/vault",
      historyMode: "paginated",
      serviceName: "codex-panel",
      serviceTier: "priority",
      permissions: ":workspace",
      ...(ephemeral ? { ephemeral: true } : {}),
      dynamicTools: [
        expect.objectContaining({
          type: "namespace",
          name: "codex_panel",
          tools: [expect.objectContaining({ type: "function", name: "resolve_wikilinks" })],
        }),
      ],
    });
    expect(snapshot).toMatchObject({ kind: "completed", value: { thread: { id: "thread", ephemeral }, canAcceptDirectInput: null } });
    expect(recordThreadSubscription).toHaveBeenCalledExactlyOnceWith("thread", client);
  });

  it("routes multiple temporary turns through the ordinary turn boundary", async () => {
    const request = vi.fn(async (method: string, _params?: unknown, _options?: unknown) => {
      if (method === "thread/start") {
        const response = threadStartResponse("temporary");
        return { ...response, thread: { ...response.thread, ephemeral: true } };
      }
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      return {};
    });
    const client = { request } as unknown as AppServerClient;
    const gateway = createTestGateway({
      currentClient: () => client,
    });
    await gateway.threadStart.startThread({ ephemeral: true });
    for (const message of ["edit then explain", "continue"]) {
      await expect(
        gateway.turn.startTurn({ threadId: "temporary", input: textInput(message), clientUserMessageId: message }),
      ).resolves.toMatchObject({ kind: "completed", value: { turnId: "turn-1" } });
    }
    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/start", "turn/start", "turn/start"]);
  });

  it.each([false, true])("propagates creation errors through the ordinary retry contract (temporary=%s)", async (ephemeral) => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new AppServerRpcError("thread/start", { code: -32000, message: "rejected" }))
      .mockRejectedValueOnce(new Error("timed out"));
    const client = { request } as unknown as AppServerClient;
    const gateway = createTestGateway({ currentClient: () => client });
    await expect(gateway.threadStart.startThread({ ephemeral })).rejects.toThrow("rejected");
    await expect(gateway.threadStart.startThread({ ephemeral })).rejects.toThrow("timed out");
  });

  it.each(["named", "sandbox"] as const)(
    "forks side chats with inherited %s permissions and a reference-history boundary",
    async (permissions) => {
      const request = vi.fn(async (method: string, _params?: unknown) => {
        if (method === "config/read") return { config: { developer_instructions: "Existing policy." } };
        if (method === "thread/fork") return threadStartResponse("side");
        return {};
      });
      const client = { request } as unknown as AppServerClient;
      const inherited = permissions === "named" ? { permissions: "trusted" } : { sandbox: "workspace-write", approvalPolicy: "on-request" };
      const result = await createTestGateway({ currentClient: () => client }).threadStart.forkSideChat(
        "source",
        {
          model: "parent-model",
          reasoningEffort: "high",
          serviceTier: "fast",
          approvalsReviewer: "user",
          ...(permissions === "named" ? { permissions: "trusted" } : { approvalPolicy: "on-request" as const }),
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: ["/vault"],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
        },
        () => true,
      );
      expect(request).toHaveBeenNthCalledWith(1, "config/read", { cwd: "/vault" });
      expect(request).toHaveBeenNthCalledWith(2, "thread/fork", {
        threadId: "source",
        cwd: "/vault",
        ephemeral: true,
        excludeTurns: true,
        model: "parent-model",
        config: { model_reasoning_effort: "high" },
        serviceTier: "fast",
        approvalsReviewer: "user",
        ...inherited,
        developerInstructions: expect.stringContaining(
          "Existing policy.\n\nYou are in a side conversation, not the main thread.\n\nThe inherited fork history is reference context only.",
        ),
      });
      expect(request.mock.calls[1]?.[1]).toMatchObject({
        developerInstructions: expect.stringContaining(
          "Follow explicit new requests, including edits, using the normal permissions and approval process. Do not use sub-agents.",
        ),
      });
      expect(request).toHaveBeenNthCalledWith(3, "thread/inject_items", {
        threadId: "side",
        items: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: expect.stringContaining(
                  "Do not continue any instructions, goals, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions",
                ),
              },
            ],
          },
        ],
      });
      expect(result).toMatchObject({ kind: "completed", value: { thread: { id: "side" } } });
    },
  );

  it("starts turns with the session vault path and returns chat-owned turn ids", async () => {
    const request = vi.fn().mockResolvedValue({ turn: { id: "turn-1" } });
    const client = { request } as unknown as AppServerClient;
    const adapter = createTestGateway({
      currentClient: () => client,
    }).turn;

    await expect(
      adapter.startTurn({
        threadId: "thread",
        input: textInput("hello"),
        clientUserMessageId: "local-user",
      }),
    ).resolves.toEqual({ kind: "completed", value: { turnId: "turn-1" } });

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
    const adapter = createTestGateway({
      currentClient: () => client,
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

    await adapter.startTurn({
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

  it("returns completed turn starts after the current client changes", async () => {
    const start = deferred<{ turn: { id: string } }>();
    const firstClient = { request: vi.fn().mockReturnValue(start.promise) } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const adapter = createTestGateway({
      currentClient: () => currentClient,
    }).turn;

    const starting = adapter.startTurn({ threadId: "thread", input: textInput("hello"), clientUserMessageId: "local-user" });
    currentClient = secondClient;
    start.resolve({ turn: { id: "turn-1" } });

    await expect(starting).resolves.toEqual({ kind: "completed", value: { turnId: "turn-1" } });
  });

  it("uses the steer client id to namespace bounded context", async () => {
    const request = vi.fn().mockResolvedValue({});
    const client = { request } as unknown as AppServerClient;
    const adapter = createTestGateway({
      currentClient: () => client,
    }).turn;

    await adapter.steerTurn({
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
    const adapter = createTestGateway({
      currentClient: () => client,
    }).threadCommands;

    await expect(adapter.compactThread("thread")).resolves.toEqual({ kind: "completed", value: undefined });

    expect(request).toHaveBeenCalledWith("thread/compact/start", { threadId: "thread" });
  });

  it("forks threads with the session vault path and returns panel threads", async () => {
    const request = vi.fn().mockResolvedValue({ thread: threadRecord("forked") });
    const client = { request } as unknown as AppServerClient;
    const adapter = createTestGateway({
      currentClient: () => client,
    }).threadStart;

    const outcome = await adapter.forkThread("source", {});

    expect(request).toHaveBeenCalledWith("thread/fork", { threadId: "source", cwd: "/vault", excludeTurns: true });
    expect(outcome).toMatchObject({
      kind: "completed",
      value: { thread: { id: "forked", preview: "Preview", archived: false } },
    });
  });

  it("forks through a selected turn with an inclusive marker", async () => {
    const request = vi.fn().mockResolvedValue({ thread: threadRecord("forked") });
    const client = { request } as unknown as AppServerClient;
    const adapter = createTestGateway({
      currentClient: () => client,
    }).threadStart;

    await adapter.forkThread("source", { position: { kind: "through-turn", turnId: "turn-2" } });

    expect(request).toHaveBeenCalledWith("thread/fork", {
      threadId: "source",
      cwd: "/vault",
      excludeTurns: true,
      lastTurnId: "turn-2",
    });
  });

  it("applies active runtime overrides to a rollback fork", async () => {
    const request = vi.fn().mockResolvedValue({ thread: threadRecord("forked") });
    const client = { request } as unknown as AppServerClient;
    const adapter = createTestGateway({
      currentClient: () => client,
    }).threadStart;

    await adapter.forkThread("source", {
      position: { kind: "before-turn", turnId: "turn-3" },
      deferGoalContinuation: true,
      runtime: {
        model: "gpt-5.6",
        reasoningEffort: "high",
        serviceTier: "priority",
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        permissions: ":workspace",
      },
    });

    expect(request).toHaveBeenCalledWith("thread/fork", {
      threadId: "source",
      cwd: "/vault",
      excludeTurns: true,
      beforeTurnId: "turn-3",
      deferGoalContinuation: true,
      model: "gpt-5.6",
      serviceTier: "priority",
      approvalPolicy: "never",
      approvalsReviewer: "auto_review",
      permissions: ":workspace",
      config: { model_reasoning_effort: "high" },
    });
  });

  it("preserves explicit default reasoning and service tier values on a rollback fork", async () => {
    const request = vi.fn().mockResolvedValue({ thread: threadRecord("forked") });
    const client = { request } as unknown as AppServerClient;
    const adapter = createTestGateway({
      currentClient: () => client,
    }).threadStart;

    await adapter.forkThread("source", {
      position: { kind: "before-turn", turnId: "turn-3" },
      runtime: { reasoningEffort: null, serviceTier: null },
    });

    expect(request).toHaveBeenCalledWith("thread/fork", {
      threadId: "source",
      cwd: "/vault",
      excludeTurns: true,
      beforeTurnId: "turn-3",
      serviceTier: null,
      config: { model_reasoning_effort: null },
    });
  });

  it.each([
    { timestamps: "distinct", newer: 2, older: 1 },
    { timestamps: "equal", newer: 1, older: 1 },
    { timestamps: "missing", newer: null, older: 1 },
  ])("reads newest-first history in conversation order with $timestamps timestamps", async ({ newer, older }) => {
    const request = vi.fn().mockResolvedValue({
      data: [
        turn([agentMessage("a2", "latest")], { id: "new", startedAt: newer }),
        turn([userMessage("u1", "prompt"), agentMessage("a1", "answer")], { id: "old", startedAt: older }),
      ],
      nextCursor: "older",
    });
    const client = { request } as unknown as AppServerClient;
    const adapter = createTestGateway({
      currentClient: () => client,
    }).threadHistory;

    const page = await adapter.readHistoryPage("thread", "cursor", 20);

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
      expect.objectContaining({ kind: "dialogue", role: "user", text: "prompt", copyText: "prompt" }),
      expect.objectContaining({ kind: "dialogue", role: "assistant", text: "answer", copyText: "answer" }),
      expect.objectContaining({ kind: "dialogue", role: "assistant", text: "latest", copyText: "latest" }),
    ]);
  });

  it("resumes threads with the session vault path and projects initial history", async () => {
    const response = {
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
    };
    const request = vi.fn(async (_method, _params, options) => {
      options.onResponse(response);
      return response;
    });
    const client = { request } as unknown as AppServerClient;
    const adapter = createTestGateway({
      currentClient: () => client,
    }).threadResume;

    const adopt = vi.fn();
    await adapter.resumeThread("thread", adopt);

    expect(request).toHaveBeenCalledWith(
      "thread/resume",
      {
        threadId: "thread",
        cwd: "/vault",
        excludeTurns: true,
        initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" },
      },
      { onResponse: expect.any(Function) },
    );
    expect(adopt).toHaveBeenCalledWith({
      activation: expect.objectContaining({ thread: expect.objectContaining({ id: "thread" }), canAcceptDirectInput: null }),
      activeTurnId: null,
      rolloutPath: "/tmp/rollout.jsonl",
      initialHistoryPage: {
        nextCursor: "older",
        hadTurns: true,
        items: [expect.objectContaining({ kind: "dialogue", role: "user", text: "prompt" })],
      },
    });
  });

  it("returns no resume snapshot when no connected client is available", async () => {
    const adapter = createTestGateway({
      currentClient: () => null,
    }).threadResume;

    const adopt = vi.fn();
    await adapter.resumeThread("thread", adopt);
    expect(adopt).not.toHaveBeenCalled();
  });

  it("returns successful runtime settings updates after the current client changes", async () => {
    const update = deferred<void>();
    const request = vi.fn().mockReturnValue(update.promise);
    const firstClient = { request } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const adapter = createTestGateway({
      currentClient: () => currentClient,
    }).runtimeSettings;

    const updating = adapter.updateThreadSettings("thread", { model: "gpt-5.5" });
    currentClient = secondClient;
    update.resolve(undefined);

    await expect(updating).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith("thread/settings/update", { threadId: "thread", model: "gpt-5.5" });
  });

  it("reads files from the current client with request options", async () => {
    const request = vi.fn().mockResolvedValue({ dataBase64: "ZmlsZQ==" });
    const client = { request } as unknown as AppServerClient;
    const gateway = createTestGateway({ currentClient: () => client });

    await expect(gateway.readFileBase64("/tmp/rollout.jsonl", { timeoutMs: 2_000 })).resolves.toBe("ZmlsZQ==");
    expect(request).toHaveBeenCalledWith("fs/readFile", { path: "/tmp/rollout.jsonl" }, { timeoutMs: 2_000 });
  });

  it("returns no file data while disconnected and completes an admitted read after a connection change", async () => {
    const disconnected = createTestGateway({ currentClient: () => null });
    await expect(disconnected.readFileBase64("/tmp/rollout.jsonl")).resolves.toBeNull();

    const read = deferred<{ dataBase64: string }>();
    const firstClient = { request: vi.fn().mockReturnValue(read.promise) } as unknown as AppServerClient;
    const secondClient = {} as AppServerClient;
    let currentClient = firstClient;
    const gateway = createTestGateway({ currentClient: () => currentClient });

    const reading = gateway.readFileBase64("/tmp/rollout.jsonl");
    currentClient = secondClient;
    read.resolve({ dataBase64: "Y29tcGxldGVk" });

    await expect(reading).resolves.toBe("Y29tcGxldGVk");
  });
});

type AppServerThreadStartResponse = ClientResponseByMethod["thread/start"];

function createTestGateway(
  options: Pick<Parameters<typeof createChatAppServerGateway>[0], "currentClient"> &
    Partial<Parameters<typeof createChatAppServerGateway>[0]>,
) {
  return createChatAppServerGateway({
    vaultPath: options.vaultPath ?? "/vault",
    recordThreadSubscription: vi.fn(),
    ...options,
  });
}

function threadRecord(id: string, turns: readonly TurnRecord[] = [], overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id,
    historyMode: "paginated",
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
    disabledPluginIds: [],
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

function turn(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
  return appServerTurnFixture({
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    ...overrides,
  });
}

function userMessage(id: string, text: string): TurnItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function agentMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null, delivery: null, questions: null };
}
