import { describe, expect, it } from "vitest";

import { buildSelectionUnifiedDiff } from "../../src/editor-rewrite/diff";
import { canApplyRewrite, type RewriteSession } from "../../src/editor-rewrite/model";
import { parseRewriteOutput, rewriteOutputFromTurn, rewriteOutputParseResultFromTurn } from "../../src/editor-rewrite/output";
import { buildRewritePrompt } from "../../src/editor-rewrite/prompt";
import { rewriteRuntime, validatedRewriteRuntime } from "../../src/editor-rewrite/runner";
import type { Model } from "../../src/generated/app-server/v2/Model";
import type { Turn } from "../../src/generated/app-server/v2/Turn";

describe("editor rewrite output", () => {
  it("parses valid rewrite JSON", () => {
    expect(parseRewriteOutput('{"replacementText":"rewritten"}')).toEqual({ replacementText: "rewritten" });
  });

  it("rejects invalid rewrite JSON", () => {
    expect(parseRewriteOutput("replacementText: rewritten")).toBeNull();
    expect(parseRewriteOutput('{"replacementText":42}')).toBeNull();
    expect(parseRewriteOutput('{"text":"rewritten"}')).toBeNull();
  });

  it("extracts the final rewrite JSON from a completed turn", () => {
    expect(
      rewriteOutputFromTurn(
        turn([
          { type: "agentMessage", id: "a1", text: '{"replacementText":"first"}', phase: "final_answer", memoryCitation: null },
          { type: "agentMessage", id: "a2", text: '{"replacementText":"final"}', phase: "final_answer", memoryCitation: null },
        ]),
      ),
    ).toEqual({ replacementText: "final" });
  });

  it("keeps raw model text when rewrite output parsing fails", () => {
    expect(
      rewriteOutputParseResultFromTurn(
        turn([{ type: "agentMessage", id: "a1", text: "replacementText: final", phase: "final_answer", memoryCitation: null }]),
      ),
    ).toEqual({ output: null, rawText: "replacementText: final" });
  });
});

describe("editor rewrite prompt", () => {
  it("always includes note context with the selected text", () => {
    const prompt = buildRewritePrompt(session());

    expect(prompt).toContain("Context mode: Selection + note context");
    expect(prompt).toContain("Current note context:");
    expect(prompt).toContain("# Heading");
  });
});

describe("editor rewrite diff", () => {
  it("renders replacements in a selection-scoped unified diff", () => {
    const diff = buildSelectionUnifiedDiff("Note.md", "alpha\nbeta", "alpha\ngamma");

    expect(diff).toContain("diff --git a/Note.md b/Note.md");
    expect(diff).toContain("@@ -1,2 +1,2 @@");
    expect(diff).toContain(" alpha");
    expect(diff).toContain("-beta");
    expect(diff).toContain("+gamma");
  });

  it("renders additions and deletions", () => {
    expect(buildSelectionUnifiedDiff("Note.md", "", "added")).toContain("+added");
    expect(buildSelectionUnifiedDiff("Note.md", "removed", "")).toContain("-removed");
  });

  it("renders unchanged text as context", () => {
    expect(buildSelectionUnifiedDiff("Note.md", "same", "same")).toContain(" same");
  });
});

describe("editor rewrite apply guard", () => {
  it("allows apply only when the current range still matches the original text", () => {
    expect(canApplyRewrite("original", "original")).toBe(true);
    expect(canApplyRewrite("changed", "original")).toBe(false);
  });
});

describe("editor rewrite runtime", () => {
  it("uses explicit rewrite runtime settings", () => {
    expect(rewriteRuntime({ rewriteSelectionModel: "gpt-5.4-mini", rewriteSelectionEffort: "minimal" })).toEqual({
      model: "gpt-5.4-mini",
      effort: "minimal",
    });
  });

  it("omits rewrite runtime overrides that are set to Codex default", () => {
    expect(rewriteRuntime({ rewriteSelectionModel: null, rewriteSelectionEffort: null })).toEqual({});
  });

  it("omits an explicit rewrite effort when the selected model does not support it", () => {
    expect(
      validatedRewriteRuntime({ rewriteSelectionModel: "gpt-5.4-mini", rewriteSelectionEffort: "minimal" }, [
        model("gpt-5.4-mini", ["low", "medium", "high", "xhigh"]),
      ]),
    ).toEqual({ model: "gpt-5.4-mini" });
  });
});

function session(overrides: Partial<RewriteSession> = {}): RewriteSession {
  return {
    filePath: "Note.md",
    targetRange: {
      from: { line: 1, ch: 0 },
      to: { line: 1, ch: 22 },
    },
    originalText: "Rewrite this sentence.",
    noteText: "# Heading\n\nRewrite this sentence.\n\nNext paragraph.",
    instruction: "Make it clearer.",
    status: "editing-prompt",
    streamText: "",
    replacementText: null,
    debugText: null,
    ...overrides,
  };
}

function turn(items: Turn["items"], overrides: Partial<Turn> = {}): Turn {
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
    isDefault: false,
  };
}
