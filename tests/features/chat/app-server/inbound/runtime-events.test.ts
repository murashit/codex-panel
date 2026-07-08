import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../../../src/app-server/connection/rpc-messages";
import { turnRuntimeEventsFromNotification } from "../../../../../src/features/chat/app-server/inbound/runtime-events";

describe("app-server turn runtime event mapping", () => {
  it("maps assistant deltas to panel-owned runtime events", () => {
    const notification = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "hello" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>;

    expect(turnRuntimeEventsFromNotification(notification, (prefix) => `${prefix}-1`)).toEqual([
      { type: "assistantDelta", turnId: "turn-active", itemId: "a1", delta: "hello", completeReasoning: true },
    ]);
  });

  it("maps completed turns to completed turn snapshots", () => {
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

    const events = turnRuntimeEventsFromNotification(notification, (prefix) => `${prefix}-1`);

    expect(events).toEqual([
      expect.objectContaining({
        type: "turnCompleted",
        threadId: "thread-active",
        turnId: "turn-active",
        status: "completed",
        completedTurnTranscriptSummary: { userText: "hello", assistantText: "done" },
      }),
    ]);
    expect(events[0]).toMatchObject({
      completedItems: [
        expect.objectContaining({ id: "u1", kind: "dialogue", role: "user", text: "hello" }),
        expect.objectContaining({ id: "a1", kind: "dialogue", role: "assistant", text: "done" }),
      ],
    });
  });
});
