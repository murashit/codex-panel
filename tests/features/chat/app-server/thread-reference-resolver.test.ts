import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { CodexInput } from "../../../../src/domain/chat/input";
import { createThreadReferenceResolver } from "../../../../src/features/chat/app-server/thread-reference-resolver";

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
            { type: "agentMessage", id: "a1", text: "回答", phase: "final_answer", memoryCitation: null },
          ],
        },
      ],
      nextCursor: null,
    });
    const client = { request } as unknown as AppServerClient;
    const setStatus = vi.fn();
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const prepareInput = vi.fn((text: string) => ({ text, input: textInput(text) }));
    const resolver = createThreadReferenceResolver({
      currentClient: () => client,
      prepareInput,
      addSystemMessage: vi.fn(),
      setStatus,
    });

    const result = await resolver.referThread(
      {
        id: "019abcde-0000-7000-8000-000000000001",
        preview: "",
        name: "Other",
        createdAt: 1,
        updatedAt: 1,
        archived: false,
        provenance: { kind: "interactive" },
      },
      "summarize",
      inputSnapshot,
    );

    expect(request).toHaveBeenCalledWith("thread/turns/list", {
      threadId: "019abcde-0000-7000-8000-000000000001",
      cursor: null,
      limit: 20,
      sortDirection: "desc",
      itemsView: "full",
    });
    expect(result?.input[0]).toEqual({ type: "text", text: "summarize" });
    expect(result?.input[1]).toMatchObject({
      type: "additionalContext",
      kind: "untrusted",
      value: expect.stringContaining("Referenced thread context for the current user input:"),
      attachment: {
        kind: "referencedThread",
        threadId: "019abcde-0000-7000-8000-000000000001",
        includedTurns: 1,
        turnLimit: 20,
        omittedTurns: 0,
        truncated: false,
      },
    });
    expect(result?.text).toBe("summarize");
    expect(prepareInput).toHaveBeenCalledWith("summarize", inputSnapshot);
    expect(result?.referencedThread).toMatchObject({ title: "Other", includedTurns: 1, turnLimit: 20 });
    expect(setStatus).toHaveBeenCalledWith("Referencing 019abcde (1/20 turns).");
  });
});
