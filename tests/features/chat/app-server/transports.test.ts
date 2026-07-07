import { describe, expect, it, vi } from "vitest";

import type { AppServerClient, ClientResponseByMethod } from "../../../../src/app-server/connection/client";
import * as shortLivedClient from "../../../../src/app-server/connection/short-lived-client";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { TurnItem, TurnRecord } from "../../../../src/app-server/protocol/turn";
import type { CodexInput } from "../../../../src/domain/chat/input";
import { createChatAppServerGateway } from "../../../../src/features/chat/app-server/session-gateway";
import { createThreadReferenceResolver } from "../../../../src/features/chat/app-server/thread-reference-resolver";
import { preparedUserInputWithWikiLinkMentionsSkillsAndContext } from "../../../../src/features/chat/application/composer/wikilink-context";
import { deferred } from "../../../support/async";

const textInput = (text: string): CodexInput => [{ type: "text", text }];

describe("chat app-server transports", () => {
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
    ).resolves.toEqual({ turnId: "turn-1" });

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
    const prepared = preparedUserInputWithWikiLinkMentionsSkillsAndContext(
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
      clientUserMessageId: "local-user",
    });

    expect(request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread",
      cwd: "/vault",
      input: [
        { type: "text", text, text_elements: [] },
        { type: "mention", name: "Alpha", path: "notes/Alpha.md" },
        { type: "mention", name: "<active>", path: "notes/Alpha.md" },
      ],
      additionalContext: {
        codex_panel_obsidian_context: {
          kind: "untrusted",
          value:
            "Obsidian context for the current user input:\nResolved wikilinks:\n- [[Alpha]] -> notes/Alpha.md\n\nReferenced active file:\n- <active> -> notes/Alpha.md",
        },
      },
      clientUserMessageId: "local-user",
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

    await expect(starting).resolves.toBeNull();
  });

  it("compacts threads through a connected app-server client", async () => {
    const request = vi.fn().mockResolvedValue({});
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadMutation;

    await expect(transport.compactThread("thread")).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith("thread/compact/start", { threadId: "thread" });
  });

  it("forks threads with the session vault path and returns panel threads", async () => {
    const request = vi.fn().mockResolvedValue({ thread: threadRecord("forked") });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadMutation;

    const thread = await transport.forkThread("source");

    expect(request).toHaveBeenCalledWith("thread/fork", { threadId: "source", cwd: "/vault", excludeTurns: true });
    expect(thread).toMatchObject({ id: "forked", preview: "Preview", archived: false });
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

    await expect(forking).resolves.toBeNull();
  });

  it("projects rollback turns into message stream items", async () => {
    const request = vi.fn().mockResolvedValue({ thread: threadRecord("thread", [turn([userMessage("u1", "prompt")])]) });
    const client = { request } as unknown as AppServerClient;
    const transport = createTestGateway({
      currentClient: () => client,
      connectedClient: vi.fn().mockResolvedValue(client),
    }).threadMutation;

    const snapshot = await transport.rollbackThread("thread");

    expect(request).toHaveBeenCalledWith("thread/rollback", { threadId: "thread", numTurns: 1 });
    expect(snapshot?.thread.id).toBe("thread");
    expect(snapshot?.cwd).toBe("/vault");
    expect(snapshot?.items).toEqual([expect.objectContaining({ kind: "message", role: "user", text: "prompt" })]);
  });

  it("reads thread history pages as message stream items", async () => {
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
      expect.objectContaining({ kind: "message", role: "user", text: "prompt" }),
      expect.objectContaining({ kind: "message", role: "assistant", text: "answer" }),
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
    expect(snapshot?.activation.thread.id).toBe("thread");
    expect(snapshot?.activation.cwd).toBe("/vault");
    expect(snapshot?.rolloutPath).toBe("/tmp/rollout.jsonl");
    expect(snapshot?.initialHistoryPage).toMatchObject({
      nextCursor: "older",
      hadTurns: true,
      items: [expect.objectContaining({ kind: "message", role: "user", text: "prompt" })],
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

    await expect(resuming).resolves.toBeNull();
  });

  it("returns no resume snapshot when no connected client is available", async () => {
    const transport = createTestGateway({
      currentClient: () => null,
      connectedClient: vi.fn().mockResolvedValue(null),
    }).threadResume;

    await expect(transport.resumeThread("thread")).resolves.toBeNull();
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

  it("resolves referenced thread input at the app-server boundary", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [turn([userMessage("u1", "元の依頼"), agentMessage("a1", "回答")])],
      nextCursor: null,
    });
    const client = { request } as unknown as AppServerClient;
    const setStatus = vi.fn();
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const prepareInput = vi.fn((text: string) => ({ text, input: textInput(text) }));
    const resolver = createThreadReferenceResolver({
      currentClient: () => client,
      prepareInput,
      addSystemMessage: vi.fn(),
      setStatus,
    });

    const result = await resolver.referThread(
      { id: "019abcde-0000-7000-8000-000000000001", preview: "", name: "Other", createdAt: 1, updatedAt: 1, archived: false },
      "summarize",
      inputSnapshot,
    );

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "019abcde-0000-7000-8000-000000000001",
      cursor: null,
      limit: 20,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result?.input[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Reference thread history:"),
    });
    expect(result?.text).toBe("summarize");
    expect(prepareInput).toHaveBeenCalledWith("summarize", inputSnapshot);
    expect(result?.referencedThread).toMatchObject({ title: "Other", includedTurns: 1, turnLimit: 20 });
    expect(setStatus).toHaveBeenCalledWith("Referencing 019abcde (1/20 turns).");
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

  it("reads the current Codex command when creating short-lived clientAccess clients", async () => {
    let codexPath = "/first/codex";
    const shortClient = { request: vi.fn().mockResolvedValue("short-lived") } as unknown as AppServerClient;
    const withShortLived = vi
      .spyOn(shortLivedClient, "withShortLivedAppServerClient")
      .mockImplementation(async (_codexPath, _cwd, operation) => {
        return operation(shortClient);
      });
    const gateway = createTestGateway({
      codexPath: () => codexPath,
      currentClient: () => ({ request: vi.fn() }) as unknown as AppServerClient,
    });

    codexPath = "/second/codex";
    await gateway.clientAccess.withClient((client) => client.request("thread/list", {}), {
      serverRequests: { kind: "reject", message: "Background operation cannot answer server requests." },
    });

    expect(withShortLived).toHaveBeenCalledWith("/second/codex", "/vault", expect.any(Function), expect.any(Object));
    withShortLived.mockRestore();
  });
});

type AppServerThreadResumeResponse = ClientResponseByMethod["thread/resume"];

function createTestGateway(options: {
  codexPath?: string | (() => string);
  vaultPath?: string;
  currentClient: () => AppServerClient | null;
  connectedClient?: () => Promise<AppServerClient | null>;
}) {
  const codexPath = options.codexPath;
  return createChatAppServerGateway({
    codexPath: typeof codexPath === "function" ? codexPath : () => codexPath ?? "codex",
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
    multiAgentMode: "none",
    initialTurnsPage: null,
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
