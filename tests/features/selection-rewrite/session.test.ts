import { describe, expect, it, vi } from "vitest";

import type { SelectionRewriteState } from "../../../src/features/selection-rewrite/model";
import type { SelectionRewritePort, SelectionRewritePortRequest } from "../../../src/features/selection-rewrite/port";
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

  it("admits only one generation and ignores callbacks and results after cancellation", async () => {
    const result = deferred<{ replacementText: string }>();
    let request: SelectionRewritePortRequest | null = null;
    const generate = vi.fn<SelectionRewritePort["generate"]>((input) => {
      request = input;
      return result.promise;
    });
    const session = createSession(generate);
    const renderHooks = hooks();

    const first = session.generate(renderHooks);
    await expect(session.generate(renderHooks)).resolves.toBe("already-running");
    expect(generate).toHaveBeenCalledOnce();
    expect(session.isGenerating).toBe(true);

    session.cancel();
    const activeRequest = expectPresent<SelectionRewritePortRequest>(request);
    expect(activeRequest.signal.aborted).toBe(true);
    activeRequest.onActivity("reasoning");
    activeRequest.onPreview("late preview");
    result.resolve({ replacementText: "late result" });

    await expect(first).resolves.toBe("started");
    expect(session.state).toMatchObject({ status: "generating", streamText: "", replacementText: null });
  });

  it("publishes activity and streaming preview before committing the final replacement", async () => {
    const generate = vi.fn<SelectionRewritePort["generate"]>(async (request) => {
      request.onActivity("reasoning");
      request.onPreview("partial");
      return { replacementText: "final" };
    });
    const session = createSession(generate);
    const renders: Array<{ status: string; active: boolean; streamText: string }> = [];
    const renderHooks: SelectionRewriteSessionRenderHooks = {
      render: () => renders.push({ status: session.status.text, active: session.status.active, streamText: session.state.streamText }),
      position: vi.fn(),
      focusApplyButton: vi.fn(),
    };

    await expect(session.generate(renderHooks)).resolves.toBe("started");

    expect(session.state).toMatchObject({ status: "preview", streamText: "", replacementText: "final" });
    expect(session.status).toEqual({ text: "", active: false });
    expect(renders).toContainEqual({ status: "Reasoning", active: true, streamText: "" });
    expect(renders).toContainEqual({ status: "Writing replacement", active: true, streamText: "partial" });
    expect(renderHooks.position).toHaveBeenCalled();
    expect(renderHooks.focusApplyButton).toHaveBeenCalledOnce();
  });
});

function createSession(generate: SelectionRewritePort["generate"], instruction = "Make it concise."): SelectionRewriteSession {
  return new SelectionRewriteSession({
    runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
    state: stateFixture(instruction),
    port: { generate },
  });
}

function stateFixture(instruction: string): SelectionRewriteState {
  return {
    filePath: "Note.md",
    targetRange: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 8 } },
    originalText: "Original",
    noteText: "Original",
    instruction,
    status: "editing",
    streamText: "",
    replacementText: null,
    debugText: null,
  };
}

function hooks(): SelectionRewriteSessionRenderHooks {
  return { render: vi.fn(), position: vi.fn(), focusApplyButton: vi.fn() };
}

function expectPresent<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}
