// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { TurnRecord } from "../../../../src/app-server/protocol/turn";
import type { EphemeralStructuredTurnRunner } from "../../../../src/app-server/services/ephemeral-structured-turn";

import { generateThreadTitleWithCodex } from "../../../../src/features/threads/app-server/thread-title-generation";

describe("thread title", () => {
  it("runs a structured title request and parses its agent response", async () => {
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async () =>
      turn([
        {
          type: "agentMessage",
          id: "a1",
          text: '{"title":"Codex Panelの自動命名"}',
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
    expect(runner.mock.calls[0]?.[0].prompt).toContain(titleContext().assistantResponse);
  });

  it.each([
    ["normalizes whitespace", JSON.stringify({ title: "  Codex\n Panel\t命名  " }), "Codex Panel 命名"],
    ["bounds long titles", JSON.stringify({ title: "x".repeat(80) }), "x".repeat(40)],
    ["rejects empty titles", JSON.stringify({ title: "   " }), null],
    ["rejects non-string titles", JSON.stringify({ title: 42 }), null],
    ["rejects missing titles", "{}", null],
    ["rejects raw text", "Codex Panelの自動命名", null],
    ["rejects fenced JSON", '```json\n{"title":"命名"}\n```', null],
    ["rejects embedded JSON", 'Title: {"title":"命名"}', null],
  ])("%s", async (_label, text, expected) => {
    const runner: EphemeralStructuredTurnRunner = async () => turn([agentMessage(text)]);
    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), { runner })).resolves.toBe(
      expected,
    );
  });

  it("reads an agent response with unknown phase and ignores plan items", async () => {
    const runner: EphemeralStructuredTurnRunner = async () =>
      turn([agentMessage('{"title":"命名"}'), { type: "plan", id: "plan", text: "A plan is not the structured response." }]);
    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), { runner })).resolves.toBe("命名");
  });

  it("returns no title without an agent response", async () => {
    const runner: EphemeralStructuredTurnRunner = async () => turn([{ type: "plan", id: "plan", text: '{"title":"計画"}' }]);
    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), { runner })).resolves.toBeNull();
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

function turn(items: TurnRecord["items"]): TurnRecord {
  return {
    rootTurnId: null,
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
  };
}

function agentMessage(text: string): TurnRecord["items"][number] {
  return {
    type: "agentMessage",
    id: "agent",
    text,
    phase: null,
    memoryCitation: null,
    delivery: null,
    questions: null,
  };
}
