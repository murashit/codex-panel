// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  findThreadNamingContext,
  namingPrompt,
  namingContextFromTurn,
  normalizeGeneratedTitle,
  titleFromNamingTurn,
} from "../../../../src/domain/threads/naming";
import {
  generateThreadTitleWithCodex,
  threadNamingRuntimeOverride,
  validatedThreadNamingRuntimeOverride,
  type ThreadNamingClient,
  type ThreadNamingClientFactory,
} from "../../../../src/app-server/thread-naming";
import { firstNamingContextFromDisplayItems, namingContextFromDisplayItems } from "../../../../src/features/chat/threads/thread-naming";
import type { AppServerClientHandlers } from "../../../../src/app-server/client";
import type { InitializeResponse } from "../../../../src/generated/app-server/InitializeResponse";
import type { JsonValue } from "../../../../src/generated/app-server/serde_json/JsonValue";
import type { RequestId } from "../../../../src/generated/app-server/RequestId";
import type { ReasoningEffort } from "../../../../src/generated/app-server/ReasoningEffort";
import type { Model } from "../../../../src/generated/app-server/v2/Model";
import type { ModelListResponse } from "../../../../src/generated/app-server/v2/ModelListResponse";
import type { ServerNotification } from "../../../../src/generated/app-server/ServerNotification";
import type { Thread } from "../../../../src/generated/app-server/v2/Thread";
import type { ThreadItem } from "../../../../src/generated/app-server/v2/ThreadItem";
import type { ThreadStartResponse } from "../../../../src/generated/app-server/v2/ThreadStartResponse";
import type { Turn } from "../../../../src/generated/app-server/v2/Turn";
import type { TurnStartResponse } from "../../../../src/generated/app-server/v2/TurnStartResponse";

describe("thread naming", () => {
  it("extracts the first user request and final assistant response from a completed turn", () => {
    expect(
      namingContextFromTurn(
        turn([
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [{ type: "text", text: "Codex Panelに自動命名を付けたい", text_elements: [] }],
          },
          { type: "agentMessage", id: "a1", text: "実装方針をまとめました。", phase: "final_answer", memoryCitation: null },
        ]),
      ),
    ).toEqual({
      userRequest: "Codex Panelに自動命名を付けたい",
      assistantResponse: "実装方針をまとめました。",
    });
  });

  it("does not build naming context for failed or incomplete turns", () => {
    expect(
      namingContextFromTurn(
        turn([{ type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "hello", text_elements: [] }] }], {
          status: "failed",
        }),
      ),
    ).toBeNull();
  });

  it("extracts naming context from streamed display items when completed turn items are not loaded", () => {
    expect(
      namingContextFromDisplayItems("turn", [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "自動命名を直したい", turnId: "turn" },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "原因を直しました。",
          turnId: "turn",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "自動命名を直したい",
      assistantResponse: "原因を直しました。",
    });
  });

  it("uses the first usable displayed turn as a resumed-history fallback", () => {
    expect(
      firstNamingContextFromDisplayItems([
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "本文だけのturn", turnId: "turn-1" },
        { id: "u2", kind: "message", messageKind: "user", role: "user", text: "履歴から命名したい", turnId: "turn-2" },
        {
          id: "a2",
          kind: "message",
          role: "assistant",
          text: "表示済み履歴から候補を作ります。",
          turnId: "turn-2",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
        { id: "u3", kind: "message", messageKind: "user", role: "user", text: "後続turn", turnId: "turn-3" },
        {
          id: "a3",
          kind: "message",
          role: "assistant",
          text: "後続応答",
          turnId: "turn-3",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "履歴から命名したい",
      assistantResponse: "表示済み履歴から候補を作ります。",
    });
  });

  it("uses a preceding goal event objective when the first completed turn has no user item", () => {
    expect(
      namingContextFromDisplayItems("turn", [
        {
          id: "goal",
          kind: "goal",
          role: "tool",
          text: "Goal set.",
          objective: "ゴールから始めたスレッドを命名したい",
        },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "ゴール内容に基づいて実装しました。",
          turnId: "turn",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "ゴールから始めたスレッドを命名したい",
      assistantResponse: "ゴール内容に基づいて実装しました。",
    });
  });

  it("scans older thread pages until it finds a usable naming context", async () => {
    const calls: { cursor: string | null; limit: number; sortDirection: string }[] = [];
    const context = await findThreadNamingContext({
      threadId: "thread",
      pageLimit: 2,
      maxPages: 3,
      readTurns: async (_threadId, cursor, limit, sortDirection) => {
        calls.push({ cursor, limit, sortDirection });
        if (cursor === null) {
          return {
            data: [
              turn([{ type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "本文だけ", text_elements: [] }] }], {
                id: "turn-1",
              }),
            ],
            nextCursor: "cursor-2",
          };
        }
        return {
          data: [
            turn(
              [
                {
                  type: "userMessage",
                  id: "u2",
                  clientId: null,
                  content: [{ type: "text", text: "古い履歴から命名したい", text_elements: [] }],
                },
                { type: "agentMessage", id: "a2", text: "古いturnを使って候補を作ります。", phase: "final_answer", memoryCitation: null },
              ],
              { id: "turn-2" },
            ),
          ],
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

  it("finds the first visible display item naming context", () => {
    expect(
      firstNamingContextFromDisplayItems([
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "表示済み履歴から命名したい", turnId: "visible" },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "表示済み履歴を使います。",
          turnId: "visible",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "表示済み履歴から命名したい",
      assistantResponse: "表示済み履歴を使います。",
    });
  });

  it("parses structured title responses", () => {
    expect(
      titleFromNamingTurn(
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
    expect(normalizeGeneratedTitle('  ## "Codex Panelの自動命名"\n')).toBe("Codex Panelの自動命名");
    expect(normalizeGeneratedTitle("")).toBeNull();
    expect(normalizeGeneratedTitle("x".repeat(80))).toHaveLength(40);
  });

  it("asks the model to infer the title language from the initial request", () => {
    const prompt = namingPrompt({
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

  it("uses explicit naming runtime overrides", () => {
    expect(threadNamingRuntimeOverride({ threadNamingModel: "gpt-5.4-mini", threadNamingEffort: "minimal" })).toEqual({
      model: "gpt-5.4-mini",
      effort: "minimal",
    });
  });

  it("omits naming runtime overrides that are set to Codex default", () => {
    expect(threadNamingRuntimeOverride({ threadNamingModel: null, threadNamingEffort: null })).toEqual({});
  });

  it("omits an explicit naming effort when the selected model does not support it", () => {
    expect(
      validatedThreadNamingRuntimeOverride({ threadNamingModel: "gpt-5.4-mini", threadNamingEffort: "minimal" }, [
        model("gpt-5.4-mini", ["low", "medium", "high", "xhigh"]),
      ]),
    ).toEqual({ model: "gpt-5.4-mini" });
  });

  it("keeps an explicit naming effort when the selected model supports it", () => {
    expect(
      validatedThreadNamingRuntimeOverride({ threadNamingModel: "gpt-5.4-mini", threadNamingEffort: "low" }, [
        model("gpt-5.4-mini", ["low", "medium", "high", "xhigh"]),
      ]),
    ).toEqual({ model: "gpt-5.4-mini", effort: "low" });
  });

  it("keeps pre-acknowledgement completion when title notifications arrive before turn/start resolves", async () => {
    const { clientFactory } = fakeThreadNamingClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => {
        fake.emit(completedItemNotification("thread", "turn", assistantMessage("answer", '{"title":"Early title"}')));
        fake.emit(turnCompletedNotification("thread", turn([], { id: "turn", status: "completed" })));
        return { turn: turn([], { id: "turn", status: "inProgress" }) };
      };
    });

    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", namingContext(), runtimeSettings(), clientFactory)).resolves.toBe(
      "Early title",
    );
  });
});

function namingContext() {
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

function fakeThreadNamingClientFactory(configure?: (client: FakeThreadNamingClient) => void): {
  clientFactory: ThreadNamingClientFactory;
  client: { current: FakeThreadNamingClient | null };
} {
  const client: { current: FakeThreadNamingClient | null } = { current: null };
  return {
    client,
    clientFactory: (_codexPath, _cwd, handlers) => {
      client.current = new FakeThreadNamingClient(handlers);
      configure?.(client.current);
      return client.current;
    },
  };
}

class FakeThreadNamingClient implements ThreadNamingClient {
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

  async startStructuredTurn(
    _threadId: string,
    _cwd: string,
    _text: string,
    _outputSchema: JsonValue,
    _model?: string,
    _effort?: ReasoningEffort,
  ): Promise<TurnStartResponse> {
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

function threadFixture(id: string): Thread {
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
    source: "appServer",
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

function assistantMessage(id: string, text: string): ThreadItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

function completedItemNotification(threadId: string, turnId: string, item: ThreadItem): ServerNotification {
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

function model(name: string, efforts: Model["supportedReasoningEfforts"][number]["reasoningEffort"][]): Model {
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
