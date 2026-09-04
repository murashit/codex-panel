import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { CodexInput } from "../../../../../src/domain/turns/input";
import { createThreadReferenceResolver } from "../../../../../src/features/chat/app-server/adapters/thread-reference-resolver";

const textInput = (text: string): CodexInput => [{ type: "text", text }];

describe("thread reference resolver", () => {
  it("reads referenced history and prepares one bundled input", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        {
          id: "turn",
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          items: [
            { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "元の依頼", text_elements: [] }] },
            { type: "agentMessage", id: "a1", text: "途中回答", phase: "commentary", memoryCitation: null },
            { type: "userMessage", id: "u2", clientId: null, content: [{ type: "text", text: "追加条件", text_elements: [] }] },
            { type: "agentMessage", id: "a2", text: "回答", phase: "final_answer", memoryCitation: null },
          ],
        },
      ],
      nextCursor: "older-turns",
    });
    const client = { request } as unknown as AppServerClient;
    const setStatus = vi.fn();
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const prepareInput = vi.fn((text: string) => ({ text, input: textInput(text) }));
    const resolver = createThreadReferenceResolver({
      currentClient: () => client,
      prepareInput,
      setStatus,
    });

    const result = await resolver(threadFixture(), "summarize", inputSnapshot);

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "019abcde-0000-7000-8000-000000000001",
      cursor: null,
      limit: 20,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result?.input[0]).toEqual({
      type: "text",
      text: "[Other](codex://threads/019abcde-0000-7000-8000-000000000001)\n\nsummarize",
    });
    expect(result?.input[1]).toMatchObject({
      type: "additionalContext",
      key: "codex_panel_referenced_thread",
      kind: "untrusted",
      value: expect.stringContaining("Referenced thread context for the current user input:"),
    });
    expect(result?.input[1]).toMatchObject({
      value: expect.stringContaining("User follow-up:\n追加条件"),
    });
    expect(result?.input[1]).toMatchObject({
      value: expect.stringContaining("Earlier turns not fetched: yes"),
    });
    expect(result?.text).toBe("[Other](codex://threads/019abcde-0000-7000-8000-000000000001)\n\nsummarize");
    expect(prepareInput).toHaveBeenCalledWith("summarize", inputSnapshot);
    expect(setStatus).toHaveBeenCalledWith("Referencing 019abcde (1/20 turns).");
  });

  it("does not request history when the app-server client is unavailable", async () => {
    const resolver = createThreadReferenceResolver({
      currentClient: () => null,
      prepareInput: vi.fn(),
      setStatus: vi.fn(),
    });

    await expect(resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never)).rejects.toThrow("not connected");
  });

  it("reports when the referenced thread has no readable turns", async () => {
    const request = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    const client = { request } as unknown as AppServerClient;
    const resolver = createThreadReferenceResolver({
      currentClient: () => client,
      prepareInput: vi.fn(),
      setStatus: vi.fn(),
    });

    await expect(resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never)).rejects.toThrow(
      "Referenced thread has no readable turns.",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("reports app-server history failures", async () => {
    const request = vi.fn().mockRejectedValue(new Error("history unavailable"));
    const client = { request } as unknown as AppServerClient;
    const resolver = createThreadReferenceResolver({
      currentClient: () => client,
      prepareInput: vi.fn(),
      setStatus: vi.fn(),
    });

    await expect(resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never)).rejects.toThrow("history unavailable");
  });
});

function threadFixture(): Thread {
  return {
    id: "019abcde-0000-7000-8000-000000000001",
    preview: "",
    name: "Other",
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    provenance: { kind: "interactive" },
  };
}
