import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { Thread } from "../../../../../src/domain/threads/model";
import { createThreadReferenceResolver } from "../../../../../src/features/chat/app-server/adapters/thread-reference-resolver";
import { panelThreadFixture } from "../../../../support/panel-thread";

import { emptyComposerInputSnapshot } from "../../support/composer-input";

describe("thread reference resolver", () => {
  it("reads referenced history and prepares one bundled input", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        {
          rootTurnId: null,
          id: "turn",
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          items: [
            { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "Original request", text_elements: [] }] },
            { type: "agentMessage", id: "a1", text: "Intermediate response", phase: "commentary", memoryCitation: null },
            {
              type: "userMessage",
              id: "u2",
              clientId: null,
              content: [{ type: "text", text: "Additional requirement", text_elements: [] }],
            },
            { type: "agentMessage", id: "a2", text: "Response", phase: "final_answer", memoryCitation: null },
          ],
        },
      ],
      nextCursor: "older-turns",
    });
    const client = { request } as unknown as AppServerClient;
    const setStatus = vi.fn();
    const inputSnapshot = { ...emptyComposerInputSnapshot(), sourcePath: "snapshot.md" };
    const resolveFileReference = vi.fn((target: string) => (target === "Alpha" ? { name: "Alpha", path: "notes/Alpha.md" } : null));
    const resolver = createThreadReferenceResolver({
      currentClient: () => client,
      resolveFileReference,
      setStatus,
    });

    const result = await resolver(threadFixture(), "summarize [[Alpha]]", inputSnapshot);

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "019abcde-0000-7000-8000-000000000001",
      cursor: null,
      limit: 20,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result?.input[0]).toEqual({
      type: "text",
      text: "[Other](codex://threads/019abcde-0000-7000-8000-000000000001)\n\nsummarize [[Alpha]]",
    });
    expect(result?.input[1]).toMatchObject({
      type: "additionalContext",
      key: "codex_panel_referenced_thread",
      kind: "untrusted",
      value: expect.stringContaining("Referenced thread context for the current user input:"),
    });
    expect(result?.input[1]).toMatchObject({
      value: expect.stringContaining("User follow-up:\nAdditional requirement"),
    });
    expect(result?.input[1]).toMatchObject({
      value: expect.stringContaining("Earlier turns not fetched: yes"),
    });
    expect(resolveFileReference).toHaveBeenCalledWith("Alpha", "snapshot.md");
    expect(result?.input.slice(2)).toEqual([
      { type: "fileReference", name: "Alpha", path: "notes/Alpha.md" },
      {
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value: "Obsidian references for the current user input:\n- [[Alpha]] -> notes/Alpha.md",
      },
    ]);
    expect(result?.text).toBe("[Other](codex://threads/019abcde-0000-7000-8000-000000000001)\n\nsummarize [[Alpha]]");
    expect(setStatus).toHaveBeenCalledWith("Referencing 019abcde (1/20 turns).");
  });

  it("does not request history when the app-server client is unavailable", async () => {
    const resolver = createThreadReferenceResolver({
      currentClient: () => null,
      resolveFileReference: () => null,
      setStatus: vi.fn(),
    });

    await expect(resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never)).rejects.toThrow("not connected");
  });

  it("reports when the referenced thread has no readable turns", async () => {
    const request = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    const resolver = resolverWithRequest(request);

    await expect(resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never)).rejects.toThrow(
      "Referenced thread has no readable turns.",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("reports app-server history failures", async () => {
    const request = vi.fn().mockRejectedValue(new Error("history unavailable"));
    const resolver = resolverWithRequest(request);

    await expect(resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never)).rejects.toThrow("history unavailable");
  });
});

function threadFixture(): Thread {
  return panelThreadFixture({
    id: "019abcde-0000-7000-8000-000000000001",
    name: "Other",
  });
}

function resolverWithRequest(request: AppServerClient["request"]) {
  const client = { request } as unknown as AppServerClient;
  return createThreadReferenceResolver({ currentClient: () => client, resolveFileReference: () => null, setStatus: vi.fn() });
}
