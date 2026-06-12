import { describe, expect, it } from "vitest";

import type { AppServerClient, AppServerClientHandlers, AppServerStartStructuredTurnOptions } from "../../../src/app-server/client";
import { modelMetadataFromCatalogModels, type CatalogModel } from "../../../src/app-server/catalog";
import type { AppServerInitialization } from "../../../src/app-server/initialization";
import type { TurnItem, TurnRecord } from "../../../src/app-server/turn";
import type { RequestId, ServerNotification } from "../../../src/app-server/types";
import {
  generateThreadTitleWithCodex,
  threadTitleFromGenerationTurn,
  threadTitleRuntimeOverride,
  validatedThreadTitleRuntimeOverride,
  type ThreadTitleClient,
  type ThreadTitleClientFactory,
} from "../../../src/features/thread-title/generation";
import {
  findThreadTitleContext,
  normalizeGeneratedThreadTitle,
  threadTitleContextFromConversationSummary,
  threadTitleFromGeneratedText,
  threadTitlePrompt,
} from "../../../src/features/thread-title/model";

type InitializeResponse = AppServerInitialization;
type ModelListResponse = Awaited<ReturnType<AppServerClient["listModels"]>>;
type ThreadStartResponse = Awaited<ReturnType<AppServerClient["startEphemeralThread"]>>;
type Turn = TurnRecord;
type TurnStartResponse = Awaited<ReturnType<AppServerClient["startStructuredTurn"]>>;

describe("thread title", () => {
  it("builds title context from a conversation summary", () => {
    expect(
      threadTitleContextFromConversationSummary({
        userText: "Codex Panelに自動命名を付けたい",
        assistantText: "実装方針をまとめました。",
      }),
    ).toEqual({
      userRequest: "Codex Panelに自動命名を付けたい",
      assistantResponse: "実装方針をまとめました。",
    });
  });

  it("does not build title context for incomplete summaries", () => {
    expect(threadTitleContextFromConversationSummary({ userText: "hello", assistantText: null })).toBeNull();
  });

  it("scans older thread pages until it finds a usable title context", async () => {
    const calls: { cursor: string | null; limit: number; sortDirection: string }[] = [];
    const context = await findThreadTitleContext({
      threadId: "thread",
      pageLimit: 2,
      maxPages: 3,
      readTurns: async (_threadId, cursor, limit, sortDirection) => {
        calls.push({ cursor, limit, sortDirection });
        if (cursor === null) {
          return {
            data: [{ userText: "本文だけ", assistantText: null }],
            nextCursor: "cursor-2",
          };
        }
        return {
          data: [{ userText: "古い履歴から命名したい", assistantText: "古いturnを使って候補を作ります。" }],
          nextCursor: null,
        };
      },
    });

    expect(context).toEqual({
      userRequest: "古い履歴から命名したい",
      assistantResponse: "古いturnを使って候補を作ります。",
    });
    expect(calls).toEqual([
      { cursor: null, limit: 2, sortDirection: "asc" },
      { cursor: "cursor-2", limit: 2, sortDirection: "asc" },
    ]);
  });

  it("parses structured title responses", () => {
    expect(
      threadTitleFromGenerationTurn(
        turn([
          {
            type: "agentMessage",
            id: "a1",
            text: '```json\n{"title":"Codex Panelの自動命名"}\n```',
            phase: "final_answer",
            memoryCitation: null,
          },
        ]),
      ),
    ).toBe("Codex Panelの自動命名");
  });

  it("normalizes generated titles", () => {
    expect(normalizeGeneratedThreadTitle('  ## "Codex Panelの自動命名"\n')).toBe("Codex Panelの自動命名");
    expect(normalizeGeneratedThreadTitle("")).toBeNull();
    expect(normalizeGeneratedThreadTitle("x".repeat(80))).toHaveLength(40);
  });

  it("parses generated title text", () => {
    expect(threadTitleFromGeneratedText('```json\n{"title":"Codex Panelの自動命名"}\n```')).toBe("Codex Panelの自動命名");
  });

  it("asks the model to infer the title language from the initial request", () => {
    const prompt = threadTitlePrompt({
      userRequest: "Please fix the automatic thread naming behavior.",
      assistantResponse: "I found the prompt and adjusted it.",
    });

    expect(prompt).toContain("infer the main language of the user's initial request");
    expect(prompt).toContain("Write the title in the inferred language");
    expect(prompt).toContain("3-7 words for languages that use spaces");
    expect(prompt).toContain("12-28 characters for languages that usually do not");
    expect(prompt).not.toContain("日本語の短い名詞句");
    expect(prompt).not.toContain("Japanese characters");
    expect(prompt).not.toContain("English words");
  });

  it("uses explicit title runtime overrides", () => {
    expect(threadTitleRuntimeOverride({ threadNamingModel: "gpt-5.4-mini", threadNamingEffort: "minimal" })).toEqual({
      model: "gpt-5.4-mini",
      effort: "minimal",
    });
  });

  it("omits title runtime overrides that are set to Codex default", () => {
    expect(threadTitleRuntimeOverride({ threadNamingModel: null, threadNamingEffort: null })).toEqual({});
  });

  it("omits an explicit title effort when the selected model does not support it", () => {
    expect(
      validatedThreadTitleRuntimeOverride(
        { threadNamingModel: "gpt-5.4-mini", threadNamingEffort: "minimal" },
        modelMetadataFromCatalogModels([model("gpt-5.4-mini", ["low", "medium", "high", "xhigh"])]),
      ),
    ).toEqual({ model: "gpt-5.4-mini" });
  });

  it("keeps an explicit title effort when the selected model supports it", () => {
    expect(
      validatedThreadTitleRuntimeOverride(
        { threadNamingModel: "gpt-5.4-mini", threadNamingEffort: "low" },
        modelMetadataFromCatalogModels([model("gpt-5.4-mini", ["low", "medium", "high", "xhigh"])]),
      ),
    ).toEqual({ model: "gpt-5.4-mini", effort: "low" });
  });

  it("keeps pre-acknowledgement completion when title notifications arrive before turn/start resolves", async () => {
    const { clientFactory } = fakeThreadTitleClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => {
        fake.emit(completedItemNotification("thread", "turn", assistantMessage("answer", '{"title":"Early title"}')));
        fake.emit(turnCompletedNotification("thread", turn([], { id: "turn", status: "completed" })));
        return { turn: turn([], { id: "turn", status: "inProgress" }) };
      };
    });

    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), clientFactory)).resolves.toBe(
      "Early title",
    );
  });
});

function titleContext() {
  return {
    userRequest: "Please name this.",
    assistantResponse: "Done.",
  };
}

function runtimeSettings() {
  return {
    threadNamingModel: null,
    threadNamingEffort: null,
  };
}

function fakeThreadTitleClientFactory(configure?: (client: FakeThreadTitleClient) => void): {
  clientFactory: ThreadTitleClientFactory;
  client: { current: FakeThreadTitleClient | null };
} {
  const client: { current: FakeThreadTitleClient | null } = { current: null };
  return {
    client,
    clientFactory: (_codexPath, _cwd, handlers) => {
      client.current = new FakeThreadTitleClient(handlers);
      configure?.(client.current);
      return client.current;
    },
  };
}

class FakeThreadTitleClient implements ThreadTitleClient {
  startStructuredTurnImpl: (() => Promise<TurnStartResponse>) | null = null;

  constructor(private readonly handlers: AppServerClientHandlers) {}

  async connect(): Promise<InitializeResponse> {
    return { codexHome: "/tmp/codex" } as InitializeResponse;
  }

  disconnect(): void {
    return undefined;
  }

  async listModels(): Promise<ModelListResponse> {
    return { data: [], nextCursor: null };
  }

  rejectServerRequest(_requestId: RequestId, _code: number, _message: string): void {
    return undefined;
  }

  async startEphemeralThread(): Promise<ThreadStartResponse> {
    return threadStartResponse("thread");
  }

  async startStructuredTurn(_options: AppServerStartStructuredTurnOptions): Promise<TurnStartResponse> {
    return this.startStructuredTurnImpl ? this.startStructuredTurnImpl() : { turn: turn([], { id: "turn", status: "inProgress" }) };
  }

  emit(notification: ServerNotification): void {
    this.handlers.onNotification(notification);
  }
}

function threadStartResponse(threadId: string): ThreadStartResponse {
  return {
    thread: threadFixture(threadId),
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

function threadFixture(id: string): ThreadStartResponse["thread"] {
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

function turn(items: Turn["items"], overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    ...overrides,
  };
}

function assistantMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

function completedItemNotification(threadId: string, turnId: string, item: TurnItem): ServerNotification {
  return {
    method: "item/completed",
    params: { threadId, turnId, item, completedAtMs: 1 },
  };
}

function turnCompletedNotification(threadId: string, completedTurn: Turn): ServerNotification {
  return {
    method: "turn/completed",
    params: { threadId, turn: completedTurn },
  };
}

function model(name: string, efforts: CatalogModel["supportedReasoningEfforts"][number]["reasoningEffort"][]): CatalogModel {
  return {
    id: name,
    model: name,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: name,
    description: "",
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: "" })),
    defaultReasoningEffort: efforts[0] ?? "low",
    inputModalities: ["text"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}
