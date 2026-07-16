import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../../../src/app-server/connection/rpc-messages";
import { turnRuntimeEventsFromNotification } from "../../../../../src/features/chat/app-server/inbound/runtime-events";

describe("app-server turn runtime event mapping", () => {
  it("maps assistant deltas to panel-owned runtime events", () => {
    const notification = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "hello" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>;

    const events = turnRuntimeEventsFromNotification(notification, (prefix) => `${prefix}-1`);

    expect(events).toEqual([{ type: "assistantDelta", turnId: "turn-active", itemId: "a1", delta: "hello", completeReasoning: true }]);
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

  it("maps hook runs to compact items while omitting unavailable duration", () => {
    const notification = {
      method: "hook/completed",
      params: {
        threadId: "thread-active",
        turnId: "turn-active",
        run: {
          id: "hook-1",
          eventName: "postToolUse",
          handlerType: "command",
          executionMode: "sync",
          scope: "turn",
          sourcePath: "/vault/.codex/hooks.json",
          source: "project",
          displayOrder: 1n,
          status: "completed",
          statusMessage: "Formatted 1 file.",
          startedAt: 1n,
          completedAt: null,
          durationMs: null,
          entries: [{ kind: "feedback", text: "ok" }],
        },
      },
    } satisfies Extract<ServerNotification, { method: "hook/completed" }>;

    const events = turnRuntimeEventsFromNotification(notification, (prefix) => `${prefix}-1`);

    expect(events).toEqual([
      {
        type: "hookRunObserved",
        turnId: "turn-active",
        eventName: "postToolUse",
        item: expect.objectContaining({
          id: "hook-hook-1-1",
          kind: "hook",
          operation: "postToolUse",
          primaryTarget: { kind: "value", value: "Formatted 1 file." },
          executionState: "completed",
          hookRun: {
            eventName: "postToolUse",
            statusMessage: "Formatted 1 file.",
            entries: [{ kind: "feedback", text: "ok" }],
          },
        }),
      },
    ]);
    const event = events[0];
    if (event?.type !== "hookRunObserved") throw new Error("Expected a hook runtime event");
    if (event.item.kind !== "hook") throw new Error("Expected a hook item");
    expect(event.item.hookRun).not.toHaveProperty("durationMs");
  });
});
