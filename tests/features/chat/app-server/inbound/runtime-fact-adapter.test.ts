import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../../../src/app-server/connection/rpc-messages";
import { turnRuntimeFactsFromNotification } from "../../../../../src/features/chat/app-server/inbound/runtime-fact-adapter";

describe("app-server turn runtime fact adapter", () => {
  it.each([
    ["modelProvider/authRecoveryStarted", "running"],
    ["modelProvider/authRecoveryCompleted", "completed"],
  ] as const)("maps %s to transient auth recovery state", (method, phase) => {
    const notification = {
      method,
      params: { threadId: "thread-active", turnId: "turn-active", provider: " aws ", message: " Refreshing AWS authentication. " },
    } satisfies Extract<ServerNotification, { method: typeof method }>;

    expect(turnRuntimeFactsFromNotification(notification, (prefix) => `${prefix}-1`)).toEqual([
      {
        type: "authRecoveryUpdated",
        turnId: "turn-active",
        progress: {
          message: "Refreshing AWS authentication.",
          phase,
        },
      },
    ]);
  });

  it("provides an auth recovery fallback without exposing blank protocol values", () => {
    const notification = {
      method: "modelProvider/authRecoveryCompleted",
      params: { threadId: "thread-active", turnId: "turn-active", provider: "", message: " " },
    } satisfies Extract<ServerNotification, { method: "modelProvider/authRecoveryCompleted" }>;

    expect(turnRuntimeFactsFromNotification(notification, () => "unused")).toEqual([
      {
        type: "authRecoveryUpdated",
        turnId: "turn-active",
        progress: { message: "Credentials refreshed.", phase: "completed" },
      },
    ]);
  });

  it("maps assistant deltas to panel-owned runtime facts", () => {
    const notification = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "hello" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>;

    const facts = turnRuntimeFactsFromNotification(notification, (prefix) => `${prefix}-1`);

    expect(facts).toEqual([{ type: "assistantDelta", turnId: "turn-active", itemId: "a1", delta: "hello", completeReasoning: true }]);
  });

  it("maps observed user messages to a reconciliation fact", () => {
    const notification = {
      method: "item/started",
      params: {
        threadId: "thread-active",
        turnId: "turn-active",
        startedAtMs: 1,
        item: {
          type: "userMessage",
          id: "server-steer",
          clientId: "local-steer",
          content: [{ type: "text", text: "follow up", text_elements: [] }],
        },
      },
    } satisfies Extract<ServerNotification, { method: "item/started" }>;

    const facts = turnRuntimeFactsFromNotification(notification, (prefix) => `${prefix}-1`);

    expect(facts).toEqual([
      {
        type: "userMessageObserved",
        item: expect.objectContaining({
          id: "server-steer",
          clientId: "local-steer",
          kind: "dialogue",
          role: "user",
          text: "follow up",
          turnId: "turn-active",
        }),
      },
    ]);
  });

  it("preserves the normal completed-turn summary contract", () => {
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
          itemsView: "summary",
          items: [{ type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null, delivery: null }],
        },
      },
    } satisfies Extract<ServerNotification, { method: "turn/completed" }>;

    const facts = turnRuntimeFactsFromNotification(notification, (prefix) => `${prefix}-1`);

    expect(facts).toEqual([
      expect.objectContaining({
        type: "turnCompleted",
        threadId: "thread-active",
        turnId: "turn-active",
        status: "completed",
        itemsView: "summary",
        completedTurnTranscriptSummary: null,
      }),
    ]);
    expect(facts[0]).toMatchObject({
      completedItems: [expect.objectContaining({ id: "a1", kind: "dialogue", role: "assistant", text: "done" })],
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

    const facts = turnRuntimeFactsFromNotification(notification, (prefix) => `${prefix}-1`);

    expect(facts).toEqual([
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
    const fact = facts[0];
    if (fact?.type !== "hookRunObserved") throw new Error("Expected a hook runtime fact");
    if (fact.item.kind !== "hook") throw new Error("Expected a hook item");
    expect(fact.item.hookRun).not.toHaveProperty("durationMs");
  });
});
