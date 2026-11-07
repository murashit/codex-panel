import { describe, expect, it, vi } from "vitest";

import type { SelectionRewritePort } from "../../../src/features/selection-rewrite/port";
import { SelectionRewriteSession, type SelectionRewriteSessionRenderHooks } from "../../../src/features/selection-rewrite/session";
import { deferred } from "../../support/async";

describe("SelectionRewriteSession", () => {
  it("rejects a blank instruction without starting generation", async () => {
    const generate = vi.fn<SelectionRewritePort["generate"]>();
    const session = createSession(generate, "  \n");

    await expect(session.generate(hooks())).resolves.toBe("missing-instruction");
    expect(generate).not.toHaveBeenCalled();
    expect(session.hasInstruction).toBe(false);
  });

  it("admits one generation, publishes progress, and commits its final replacement", async () => {
    const result = deferred<{ replacementText: string }>();
    const generate = vi.fn<SelectionRewritePort["generate"]>((request) => {
      request.onActivity("reasoning");
      request.onPreview("partial");
      return result.promise;
    });
    const session = createSession(generate);
    const renders: Array<{ status: string; active: boolean; streamText: string }> = [];
    const renderHooks: SelectionRewriteSessionRenderHooks = {
      render: () => renders.push({ status: session.status.text, active: session.status.active, streamText: session.state.streamText }),
      position: vi.fn(),
      focusApplyButton: vi.fn(),
    };

    const generation = session.generate(renderHooks);
    await expect(session.generate(renderHooks)).resolves.toBe("already-running");
    expect(generate).toHaveBeenCalledOnce();
    expect(session.isGenerating).toBe(true);
    expect(renders).toContainEqual({ status: "Reasoning", active: true, streamText: "" });
    expect(renders).toContainEqual({ status: "Writing replacement", active: true, streamText: "partial" });

    result.resolve({ replacementText: "final" });
    await expect(generation).resolves.toBe("started");

    expect(session.state).toMatchObject({ status: "preview", replacementText: "final" });
    expect(session.status).toEqual({ text: "", active: false });
    expect(renderHooks.position).toHaveBeenCalled();
    expect(renderHooks.focusApplyButton).toHaveBeenCalledOnce();
  });
});

function createSession(generate: SelectionRewritePort["generate"], instruction = "Make it concise."): SelectionRewriteSession {
  const session = new SelectionRewriteSession({
    runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
    input: {
      filePath: "Note.md",
      targetRange: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 8 } },
      originalText: "Original",
      noteText: "Original",
      selectionOffsets: { from: 0, to: 8 },
    },
    port: { generate },
  });
  session.setInstructionDraft(instruction);
  return session;
}

function hooks(): SelectionRewriteSessionRenderHooks {
  return { render: vi.fn(), position: vi.fn(), focusApplyButton: vi.fn() };
}
