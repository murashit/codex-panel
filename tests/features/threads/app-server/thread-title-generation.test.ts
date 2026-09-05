// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { TurnRecord } from "../../../../src/app-server/protocol/turn";
import type { EphemeralStructuredTurnRunner } from "../../../../src/app-server/services/ephemeral-structured-turn";

import { generateThreadTitleWithCodex } from "../../../../src/features/threads/app-server/thread-title-generation";

describe("thread title", () => {
  it("runs a structured title request and parses its assistant transcript", async () => {
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async () =>
      turn([
        {
          type: "agentMessage",
          id: "a1",
          text: '```json\n{"title":"Codex Panelの自動命名"}\n```',
          phase: "final_answer",
          memoryCitation: null,
          delivery: null,
          questions: null,
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
        prompt: expect.stringContaining(titleContext().userRequest),
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

  it.each([
    ['  ## "Codex Panelの自動命名"\n', "Codex Panelの自動命名"],
    ['```json\n{"title":"Codex Panelの自動命名"}\n```', "Codex Panelの自動命名"],
    ["", null],
    ["x".repeat(80), "x".repeat(40)],
  ])("normalizes generated title %s", async (text, expected) => {
    const runner: EphemeralStructuredTurnRunner = async () => turn([{ type: "plan", id: "plan", text }]);
    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), { runner })).resolves.toBe(
      expected,
    );
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
