import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../../../src/app-server/connection/rpc-messages";
import { conversationRuntimeEventsFromNotification } from "../../../../../src/features/chat/app-server/inbound/runtime-events";

describe("app-server conversation runtime event mapping", () => {
  it("maps assistant deltas to panel-owned runtime events", () => {
    const notification = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "hello" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>;

    expect(conversationRuntimeEventsFromNotification(notification, (prefix) => `${prefix}-1`)).toEqual([
      { type: "assistantDelta", runId: "turn-active", itemId: "a1", delta: "hello", completeReasoning: true },
    ]);
  });

  it("maps completed turns to completed run snapshots", () => {
    const notification = {
      method: "turn/completed",
      params: {
        threadId: "thread-active",
        turn: {
          id: "turn-active",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          itemsView: "full",
          items: [
            { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "hello", text_elements: [] }] },
            { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
          ],
        },
      },
    } satisfies Extract<ServerNotification, { method: "turn/completed" }>;

    const events = conversationRuntimeEventsFromNotification(notification, (prefix) => `${prefix}-1`);

    expect(events).toEqual([
      expect.objectContaining({
        type: "runCompleted",
        threadId: "thread-active",
        runId: "turn-active",
        status: "completed",
        completedSummary: { userText: "hello", assistantText: "done" },
      }),
    ]);
    expect(events[0]).toMatchObject({
      completedItems: [
        expect.objectContaining({ id: "u1", kind: "message", role: "user", text: "hello" }),
        expect.objectContaining({ id: "a1", kind: "message", role: "assistant", text: "done" }),
      ],
    });
  });
});
