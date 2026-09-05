import { describe, expect, it, vi } from "vitest";
import type { TurnRecord } from "../../../../src/app-server/protocol/turn";
import type { AppServerRequestClient } from "../../../../src/app-server/services/request-client";
import { readPersistedTitleContext } from "../../../../src/features/threads/app-server/persisted-title-context";

describe("persisted title context", () => {
  it("reads ascending pages until a completed dialogue can supply a title", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [turn(false)], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [turn(true)], nextCursor: "unused" });
    const client: AppServerRequestClient = { request };
    await expect(readPersistedTitleContext(client, "thread")).resolves.toEqual({ userRequest: "Request", assistantResponse: "Answer" });
    expect(request.mock.calls).toEqual([
      ["thread/turns/list", { threadId: "thread", cursor: null, limit: 20, sortDirection: "asc", itemsView: "full" }],
      ["thread/turns/list", { threadId: "thread", cursor: "next", limit: 20, sortDirection: "asc", itemsView: "full" }],
    ]);
  });

  it("stops at the end of history without a usable dialogue", async () => {
    const request = vi.fn().mockResolvedValue({ data: [turn(false)], nextCursor: null });
    await expect(readPersistedTitleContext({ request }, "thread")).resolves.toBeNull();
    expect(request).toHaveBeenCalledOnce();
  });

  it("bounds an unsuccessful search to five pages", async () => {
    const request = vi.fn().mockImplementation(async (_method, params: { cursor: string | null }) => ({
      data: [turn(false)],
      nextCursor: `${params.cursor ?? ""}next`,
    }));
    await expect(readPersistedTitleContext({ request }, "thread")).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(5);
  });
});

function turn(withAnswer: boolean): TurnRecord {
  return {
    id: "turn",
    status: "completed",
    itemsView: "full",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    items: [
      { type: "userMessage", id: "user", clientId: null, content: [{ type: "text", text: "Request", text_elements: [] }] },
      ...(withAnswer ? [{ type: "plan" as const, id: "plan", text: "Answer" }] : []),
    ],
  };
}
