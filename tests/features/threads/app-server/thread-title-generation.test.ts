// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { TurnRecord } from "../../../../src/app-server/protocol/turn";
import type { EphemeralStructuredTurnRunner } from "../../../../src/app-server/services/ephemeral-structured-turn";
import {
  findThreadTitleContext,
  THREAD_TITLE_MAX_CHARS,
  threadTitleContextFromTurnTranscriptSummary,
  threadTitleFromGeneratedText,
  threadTitlePrompt,
} from "../../../../src/domain/threads/title-generation-model";
import { generateThreadTitleWithCodex } from "../../../../src/features/threads/app-server/thread-title-generation";

describe("thread title", () => {
  it("builds title context from a turn transcript summary", () => {
    expect(
      threadTitleContextFromTurnTranscriptSummary({
        userText: "Codex Panelに自動命名を付けたい",
        assistantText: "実装方針をまとめました。",
      }),
    ).toEqual({
      userRequest: "Codex Panelに自動命名を付けたい",
      assistantResponse: "実装方針をまとめました。",
    });
  });

  it("does not build title context for incomplete turn transcript summaries", () => {
    expect(threadTitleContextFromTurnTranscriptSummary({ userText: "hello", assistantText: null })).toBeNull();
  });

  it("scans older thread pages until it finds a usable title context", async () => {
    const calls: { cursor: string | null; limit: number; sortDirection: string }[] = [];
    const context = await findThreadTitleContext({
      threadId: "thread",
      readTurns: async (_threadId, cursor, limit, sortDirection) => {
        calls.push({ cursor, limit, sortDirection });
        if (cursor === null) {
          return {
            summaries: [{ userText: "本文だけ", assistantText: null }],
            nextCursor: "cursor-2",
          };
        }
        return {
          summaries: [{ userText: "古い履歴から命名したい", assistantText: "古いturnを使って候補を作ります。" }],
          nextCursor: null,
        };
      },
    });

    expect(context).toEqual({
      userRequest: "古い履歴から命名したい",
      assistantResponse: "古いturnを使って候補を作ります。",
    });
    expect(calls).toEqual([
      { cursor: null, limit: 20, sortDirection: "asc" },
      { cursor: "cursor-2", limit: 20, sortDirection: "asc" },
    ]);
  });

  it("runs a structured title request and parses its assistant transcript", async () => {
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async () =>
      turn([
        {
          type: "agentMessage",
          id: "a1",
          text: '```json\n{"title":"Codex Panelの自動命名"}\n```',
          phase: "final_answer",
          memoryCitation: null,
        },
      ]),
    );

    const signal = new AbortController().signal;
    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), { runner, signal })).resolves.toBe(
      "Codex Panelの自動命名",
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        codexPath: "/bin/codex",
        cwd: "/vault",
        serviceName: "codex-panel-naming",
        developerInstructions: expect.stringContaining("Return only a JSON object"),
        prompt: threadTitlePrompt(titleContext()),
        outputSchema: expect.objectContaining({ required: ["title"], additionalProperties: false }),
        timeoutMs: 60_000,
        serverRequests: { kind: "reject", message: "Thread title generation does not handle server requests." },
        abortMessage: "Thread title generation cancelled.",
        runtimeSettings: { model: null, effort: null },
        signal,
      }),
    );
  });

  it("preserves a title returned as a plan transcript item", async () => {
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async () =>
      turn([
        {
          type: "plan",
          id: "plan",
          text: '{"title":"Planからのタイトル"}',
        },
      ]),
    );

    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), { runner })).resolves.toBe(
      "Planからのタイトル",
    );
  });

  it("parses and normalizes generated titles", () => {
    expect(threadTitleFromGeneratedText('  ## "Codex Panelの自動命名"\n')).toBe("Codex Panelの自動命名");
    expect(threadTitleFromGeneratedText('```json\n{"title":"Codex Panelの自動命名"}\n```')).toBe("Codex Panelの自動命名");
    expect(threadTitleFromGeneratedText("")).toBeNull();
    expect(threadTitleFromGeneratedText("x".repeat(80))).toHaveLength(THREAD_TITLE_MAX_CHARS);
  });

  it("uses explicit title runtime overrides", async () => {
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async () => turn([]));

    await generateThreadTitleWithCodex(
      "/bin/codex",
      "/vault",
      titleContext(),
      { threadNamingModel: "gpt-5.4-mini", threadNamingEffort: "minimal" },
      { runner },
    );

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSettings: {
          model: "gpt-5.4-mini",
          effort: "minimal",
        },
      }),
    );
  });

  it("omits title runtime overrides that are set to Codex default", async () => {
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async () => turn([]));

    await generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), { runner });

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ runtimeSettings: { model: null, effort: null } }));
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

function turn(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
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
