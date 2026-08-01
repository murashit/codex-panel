import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { Thread } from "../../../../src/domain/threads/model";
import type { CodexInput } from "../../../../src/domain/turns/input";
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
      addSystemMessage: vi.fn(),
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
    const addSystemMessage = vi.fn();
    const resolver = createThreadReferenceResolver({
      currentClient: () => null,
      prepareInput: vi.fn(),
      addSystemMessage,
      setStatus: vi.fn(),
    });

    const result = await resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never);

    expect(result).toBeNull();
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("reports when the referenced thread has no readable turns", async () => {
    const request = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    const addSystemMessage = vi.fn();
    const client = { request } as unknown as AppServerClient;
    const resolver = createThreadReferenceResolver({
      currentClient: () => client,
      prepareInput: vi.fn(),
      addSystemMessage,
      setStatus: vi.fn(),
    });

    const result = await resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never);

    expect(result).toBeNull();
    expect(request).toHaveBeenCalledOnce();
    expect(addSystemMessage).toHaveBeenCalledWith("Referenced thread has no readable turns.");
  });

  it("reports app-server history failures", async () => {
    const request = vi.fn().mockRejectedValue(new Error("history unavailable"));
    const addSystemMessage = vi.fn();
    const client = { request } as unknown as AppServerClient;
    const resolver = createThreadReferenceResolver({
      currentClient: () => client,
      prepareInput: vi.fn(),
      addSystemMessage,
      setStatus: vi.fn(),
    });

    const result = await resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never);

    expect(result).toBeNull();
    expect(addSystemMessage).toHaveBeenCalledWith("history unavailable");
  });

  it("discards history when the app-server client changes during the request", async () => {
    const request = vi.fn().mockResolvedValue({ data: [], nextCursor: null });
    const addSystemMessage = vi.fn();
    const client = { request } as unknown as AppServerClient;
    const replacementClient = { request: vi.fn() } as unknown as AppServerClient;
    const currentClient = vi.fn().mockReturnValueOnce(client).mockReturnValue(replacementClient);
    const resolver = createThreadReferenceResolver({
      currentClient,
      prepareInput: vi.fn(),
      addSystemMessage,
      setStatus: vi.fn(),
    });

    const result = await resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never);

    expect(result).toBeNull();
    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it("suppresses history errors from a stale app-server client", async () => {
    const request = vi.fn().mockRejectedValue(new Error("history unavailable"));
    const addSystemMessage = vi.fn();
    const client = { request } as unknown as AppServerClient;
    const replacementClient = { request: vi.fn() } as unknown as AppServerClient;
    const currentClient = vi.fn().mockReturnValueOnce(client).mockReturnValue(replacementClient);
    const resolver = createThreadReferenceResolver({
      currentClient,
      prepareInput: vi.fn(),
      addSystemMessage,
      setStatus: vi.fn(),
    });

    const result = await resolver(threadFixture(), "summarize", { sourcePath: "snapshot.md" } as never);

    expect(result).toBeNull();
    expect(addSystemMessage).not.toHaveBeenCalled();
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
    canAcceptDirectInput: null,
    provenance: { kind: "interactive" },
  };
}
