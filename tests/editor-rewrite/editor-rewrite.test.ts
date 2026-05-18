import { describe, expect, it } from "vitest";

import { buildSelectionUnifiedDiff } from "../../src/editor-rewrite/diff";
import { canApplyRewrite, type RewriteSession } from "../../src/editor-rewrite/model";
import { parseRewriteOutput, rewriteOutputFromTurn } from "../../src/editor-rewrite/output";
import { buildRewritePrompt } from "../../src/editor-rewrite/prompt";
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
