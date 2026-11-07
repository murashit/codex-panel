// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { EphemeralStructuredTurnRunner } from "../../../../src/app-server/services/ephemeral-structured-turn";

import { generateThreadTitleWithCodex } from "../../../../src/features/threads/app-server/thread-title-generation";
import { appServerAgentMessageFixture as agentMessage, appServerCompletedTurnFixture as turn } from "../../../support/app-server-records";

describe("thread title", () => {
  it("runs a structured title request and preserves its Japanese agent response", async () => {
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async () =>
      turn([
        agentMessage("answer", '{"title":"Codex Panelの自動命名"}', { phase: null }),
        { type: "plan", id: "plan", text: "A plan is not the structured response." },
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
        prompt: expect.stringContaining(titleContext().userRequest),
        outputSchema: expect.objectContaining({ required: ["title"], additionalProperties: false }),
        timeoutMs: 60_000,
        runtimeSettings: { model: null, effort: null },
        signal,
      }),
    );
    expect(runner.mock.calls[0]?.[0].prompt).toContain(titleContext().assistantResponse);
  });

  it.each([
    ["normalizes whitespace", JSON.stringify({ title: "  Codex\n Panel\tnaming  " }), "Codex Panel naming"],
    ["bounds long titles", JSON.stringify({ title: "x".repeat(80) }), "x".repeat(40)],
    ["rejects empty titles", JSON.stringify({ title: "   " }), null],
    ["rejects non-string titles", JSON.stringify({ title: 42 }), null],
    ["rejects missing titles", "{}", null],
    ["rejects raw text", "Automatic Codex Panel naming", null],
    ["rejects fenced JSON", '```json\n{"title":"Naming"}\n```', null],
    ["rejects embedded JSON", 'Title: {"title":"Naming"}', null],
  ])("%s", async (_label, text, expected) => {
    const runner: EphemeralStructuredTurnRunner = async () => turn([agentMessage("answer", text)]);
    await expect(generateThreadTitleWithCodex("/bin/codex", "/vault", titleContext(), runtimeSettings(), { runner })).resolves.toBe(
      expected,
    );
  });

  it("uses the selected runtime and returns no title without an agent response", async () => {
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async () => turn([{ type: "plan", id: "plan", text: '{"title":"Plan"}' }]));
    await expect(
      generateThreadTitleWithCodex(
        "/bin/codex",
        "/vault",
        titleContext(),
        { threadNamingModel: "gpt-5.4-mini", threadNamingEffort: "minimal" },
        { runner },
      ),
    ).resolves.toBeNull();
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ runtimeSettings: { model: "gpt-5.4-mini", effort: "minimal" } }));
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
