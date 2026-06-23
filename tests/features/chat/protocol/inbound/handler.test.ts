import { describe, expect, it, vi } from "vitest";

import {
  createChatInboundHandler,
  type ChatInboundHandler,
  type ChatInboundHandlerActions,
} from "../../../../../src/features/chat/app-server/inbound/handler";
import { attachHookRunsToTurn } from "../../../../../src/features/chat/domain/message-stream/updates";
import { chatReducer, type ChatAction, type ChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { pendingTurnStart } from "../../../../../src/features/chat/application/conversation/turn-state";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ServerNotification, ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { appServerApprovalRequest, appServerUserInputRequest } from "../../../../../src/app-server/protocol/server-requests";
import type { Thread as PanelThread } from "../../../../../src/domain/threads/model";
import type { TurnRecord } from "../../../../../src/app-server/protocol/turn";
import type { ThreadCatalogEvent } from "../../../../../src/workspace/thread-catalog";
import { createLocalIdSource } from "../../../../../src/shared/id/local-id";
import { chatStateMessageStreamItems, withChatStateMessageStreamItems } from "../../support/message-stream";
import { chatStateFixture, chatStateWith } from "../../support/state";

type ThreadStartedNotification = Extract<ServerNotification, { method: "thread/started" }>;

function handlerForState(
  state = chatStateFixture(),
  actions: Partial<ChatInboundHandlerActions> = {},
): ChatInboundHandler & { currentState(): ChatState } {
  const store = testStoreForState(state);
  return Object.assign(
    createChatInboundHandler(
      store,
      {
        refreshActiveThreads: vi.fn(),
        applyAppServerResourceEvent: vi.fn(),
        maybeNameThread: vi.fn(),
        applyThreadCatalogEvent: vi.fn(),
        respondToServerRequest: vi.fn(() => true),
        rejectServerRequest: vi.fn(() => true),
        ...actions,
      },
      createLocalIdSource({ nowMs: () => 1, seed: "test" }),
    ),
    {
      currentState: () => store.getState(),
    },
  );
}

function testStoreForState(state: ChatState): ChatStateStore {
  let current = state;
  return {
    getState: () => current,
    dispatch(action: ChatAction) {
      current = chatReducer(current, action);
      return current;
    },
    subscribe: () => () => undefined,
  };
}

function activeRunningState(): ChatState {
  return chatStateFixture({
    activeThread: { id: "thread-active" },
    turn: { lifecycle: { kind: "running", turnId: "turn-active" } },
  });
}

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function pendingApprovalFromRequest(request: ServerRequest) {
  return expectPresent(appServerApprovalRequest(request));
}

function pendingUserInputFromRequest(request: ServerRequest) {
  return expectPresent(appServerUserInputRequest(request));
}

describe("ChatInboundHandler", () => {
  describe("active turn routing", () => {
    it("applies matching streaming deltas as assistant markdown", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "hello" },
      } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toMatchObject([{ id: "a1", text: "hello" }]);
    });

    it("marks active reasoning completed when assistant text starts", () => {
      let state = activeRunningState();
      state = withChatStateMessageStreamItems(state, [
        { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "turn-active" },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "answer" },
      } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "r1", kind: "reasoning", status: "completed", executionState: "completed" }),
          expect.objectContaining({ id: "a1", kind: "message", text: "answer" }),
        ]),
      );
    });

    it("streams plan deltas as plain assistant text until completion", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "item/plan/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "p1", delta: "<proposed_plan>\n# Plan" },
      } satisfies Extract<ServerNotification, { method: "item/plan/delta" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toMatchObject([
        { id: "p1", kind: "message", messageKind: "proposedPlan", role: "assistant", text: "# Plan", messageState: "streaming" },
      ]);
    });

    it("marks streamed plan deltas completed when the completed turn reconciles", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "item/plan/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "p1", delta: "<proposed_plan>\n# Plan" },
      } satisfies Extract<ServerNotification, { method: "item/plan/delta" }>);

      handler.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-active",
          turn: {
            id: "turn-active",
            status: "completed",
            error: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            itemsView: "full",
            items: [{ type: "plan", id: "p1", text: "<proposed_plan>\n# Plan\n</proposed_plan>" }],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([
        expect.objectContaining({
          id: "p1",
          kind: "message",
          role: "assistant",
          text: "# Plan",
          messageKind: "proposedPlan",
          messageState: "completed",
        }),
      ]);
    });

    it("updates structured turn plan progress", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "turn/plan/updated",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          explanation: "Plan",
          plan: [{ step: "Inspect code", status: "inProgress" }],
        },
      } satisfies Extract<ServerNotification, { method: "turn/plan/updated" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toMatchObject([
        {
          id: "plan-progress-turn-active",
          kind: "taskProgress",
          explanation: "Plan",
          steps: [{ step: "Inspect code", status: "inProgress" }],
          status: "inProgress",
        },
      ]);
    });
  });

  describe("app-server source of truth updates", () => {
    it("routes skill changes through the app-server resource event boundary", () => {
      const applyAppServerResourceEvent = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyAppServerResourceEvent });

      handler.handleNotification({
        method: "skills/changed",
        params: {},
      } satisfies Extract<ServerNotification, { method: "skills/changed" }>);

      expect(applyAppServerResourceEvent).toHaveBeenCalledWith({ type: "skills-changed", forceReload: true });
    });

    it("stores the latest aggregated turn diff for the active turn", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-active", diff: "@@\n-old\n+first" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);
      handler.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-active", diff: "@@\n-old\n+second" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);

      expect(handler.currentState().messageStream.turnDiffs.get("turn-active")).toBe("@@\n-old\n+second");
    });

    it("ignores aggregated turn diffs outside the active scope", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-other", turnId: "turn-active", diff: "@@\n-wrong\n+wrong" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);
      handler.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-other", diff: "@@\n-wrong\n+wrong" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);

      expect(handler.currentState().messageStream.turnDiffs.size).toBe(0);
    });

    it("formats hook runs as compact summaries with details", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
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
            completedAt: 2n,
            durationMs: 1n,
            entries: [{ kind: "feedback", text: "ok" }],
          },
        },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toMatchObject([
        {
          id: "hook-hook-1-1",
          kind: "hook",
          toolName: "hook",
          operation: "postToolUse",
          primaryTarget: { kind: "value", value: "Formatted 1 file." },
          status: "completed",
          executionState: "completed",
          output: "",
          hookRun: {
            eventName: "postToolUse",
            statusMessage: "Formatted 1 file.",
            durationMs: "1ms",
            entries: [{ kind: "feedback", text: "ok" }],
          },
        },
      ]);
    });

    it("omits hook duration details while duration is unavailable", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
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
            statusMessage: null,
            startedAt: 1n,
            completedAt: null,
            durationMs: null,
            entries: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState())[0]).toMatchObject({
        kind: "hook",
        hookRun: {
          eventName: "postToolUse",
          entries: [],
        },
      });
    });

    it("attaches unscoped hook runs to the active turn while streaming", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "hook/completed",
        params: {
          threadId: "thread-active",
          turnId: null,
          run: {
            id: "hook-1",
            eventName: "userPromptSubmit",
            handlerType: "command",
            executionMode: "sync",
            scope: "turn",
            sourcePath: "/vault/.codex/hooks.json",
            source: "project",
            displayOrder: 1n,
            status: "completed",
            statusMessage: "Saving jj baseline",
            startedAt: 1n,
            completedAt: 2n,
            durationMs: 1n,
            entries: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState())[0]).toMatchObject({
        id: "hook-hook-1-1",
        kind: "hook",
        turnId: "turn-active",
      });
    });

    it("leaves non-prompt unscoped hook runs outside the active turn", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "hook/completed",
        params: {
          threadId: "thread-active",
          turnId: null,
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
            statusMessage: "Rollback hook",
            startedAt: 1n,
            completedAt: 2n,
            durationMs: 1n,
            entries: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState())[0]).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(chatStateMessageStreamItems(handler.currentState())[0]?.turnId).toBeUndefined();
    });

    it("keeps repeated hook runs with the same run id as separate message stream items", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);
      const baseRun: Extract<ServerNotification, { method: "hook/completed" }>["params"]["run"] = {
        id: "hook-1",
        eventName: "userPromptSubmit",
        handlerType: "command",
        executionMode: "sync",
        scope: "turn",
        sourcePath: "/vault/.codex/hooks.json",
        source: "project",
        displayOrder: 1n,
        status: "completed",
        statusMessage: "Saving jj baseline",
        completedAt: 2n,
        durationMs: 1n,
        entries: [],
        startedAt: 1n,
      };

      handler.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: "turn-active", run: { ...baseRun, startedAt: 1n } },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);
      handler.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: "turn-active", run: { ...baseRun, startedAt: 3n } },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["hook-hook-1-1", "hook-hook-1-3"]);
    });

    it("attaches pre-turn prompt submit hook runs when the turn starts", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        turn: {
          lifecycle: {
            kind: "starting",
            pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] },
          },
        },
      });
      state = withChatStateMessageStreamItems(state, [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello" },
        {
          id: "hook-hook-1-1",
          kind: "hook",
          role: "tool",
          text: "userPromptSubmit: Saving jj baseline",
          toolName: "hook",
          status: "completed",
        },
      ]);
      const refreshActiveThreads = vi.fn();
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(state, { refreshActiveThreads, applyThreadCatalogEvent });

      handler.handleNotification({
        method: "turn/started",
        params: {
          threadId: "thread-active",
          turn: {
            id: "turn-active",
            status: "inProgress",
            startedAt: 1,
            completedAt: null,
            durationMs: null,
            error: null,
            itemsView: "full",
            items: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/started" }>);

      expect(chatStateMessageStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(chatStateMessageStreamItems(handler.currentState())[1]).toMatchObject({ id: "hook-hook-1-1", turnId: "turn-active" });
      expect(pendingTurnStart(handler.currentState())).toBeNull();
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-touched",
        threadId: "thread-active",
        recencyAt: 1,
      } satisfies ThreadCatalogEvent);
      expect(refreshActiveThreads).not.toHaveBeenCalled();
    });

    it("moves pre-turn hook runs after the optimistic user message when a turn id is assigned", () => {
      const items = attachHookRunsToTurn(
        [
          {
            id: "hook-old-1",
            kind: "hook",
            role: "tool",
            text: "userPromptSubmit: Stale hook",
            toolName: "hook",
            status: "completed",
          },
          {
            id: "hook-hook-1-1",
            kind: "hook",
            role: "tool",
            text: "userPromptSubmit: Saving jj baseline",
            toolName: "hook",
            status: "completed",
          },
          { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello" },
        ],
        "turn-active",
        ["hook-hook-1-1"],
        "local-user-1",
      );

      expect(items.map((item) => item.id)).toEqual(["hook-old-1", "local-user-1", "hook-hook-1-1"]);
      expect(items[0]?.turnId).toBeUndefined();
      expect(items[2]).toMatchObject({ id: "hook-hook-1-1", turnId: "turn-active" });
    });

    it("captures only prompt-submit hooks observed during the pending turn start", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        turn: { lifecycle: { kind: "starting", pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] } } },
      });
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "hook/completed",
        params: {
          threadId: "thread-active",
          turnId: null,
          run: {
            id: "hook-1",
            eventName: "userPromptSubmit",
            handlerType: "command",
            executionMode: "sync",
            scope: "turn",
            sourcePath: "/vault/.codex/hooks.json",
            source: "project",
            displayOrder: 1n,
            status: "completed",
            statusMessage: "Saving jj baseline",
            startedAt: 1n,
            completedAt: 2n,
            durationMs: 1n,
            entries: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(expectPresent(chatStateMessageStreamItems(handler.currentState())[0])).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(expectPresent(chatStateMessageStreamItems(handler.currentState())[0]).turnId).toBeUndefined();
      expect(expectPresent(pendingTurnStart(handler.currentState())).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);
    });

    it("keeps pre-turn prompt submit hooks through turn start and completed-turn reconciliation", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        turn: { lifecycle: { kind: "starting", pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] } } },
      });
      state = withChatStateMessageStreamItems(state, [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello" },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: null, run: promptSubmitHookRun("hook-1", 1n) },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(expectPresent(chatStateMessageStreamItems(handler.currentState())[1]).turnId).toBeUndefined();
      expect(expectPresent(pendingTurnStart(handler.currentState())).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);

      handler.handleNotification({
        method: "turn/started",
        params: {
          threadId: "thread-active",
          turn: {
            id: "turn-active",
            status: "inProgress",
            startedAt: 1,
            completedAt: null,
            durationMs: null,
            error: null,
            itemsView: "full",
            items: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/started" }>);

      expect(chatStateMessageStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(chatStateMessageStreamItems(handler.currentState()).find((item) => item.id === "local-user-1")).not.toHaveProperty("turnId");
      expect(chatStateMessageStreamItems(handler.currentState()).find((item) => item.id === "hook-hook-1-1")).toMatchObject({
        turnId: "turn-active",
      });
      expect(pendingTurnStart(handler.currentState())).toBeNull();

      handler.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-active",
          turn: {
            id: "turn-active",
            status: "completed",
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
            error: null,
            itemsView: "full",
            items: [
              { type: "userMessage", id: "u1", clientId: "local-user-1", content: [{ type: "text", text: "hello", text_elements: [] }] },
              { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
            ],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["u1", "hook-hook-1-1", "a1"]);
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", text: "hello", turnId: "turn-active" }),
          expect.objectContaining({ id: "hook-hook-1-1", kind: "hook", turnId: "turn-active" }),
          expect.objectContaining({ id: "a1", text: "done", turnId: "turn-active" }),
        ]),
      );
      expect(chatStateMessageStreamItems(handler.currentState()).some((item) => item.id === "local-user-1")).toBe(false);
    });

    it("ignores completed turn notifications while a new turn is still starting", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        turn: {
          lifecycle: {
            kind: "starting",
            pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] },
          },
        },
      });
      state = withChatStateMessageStreamItems(state, [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello" },
        {
          id: "hook-hook-1-1",
          kind: "hook",
          role: "tool",
          text: "userPromptSubmit: Saving jj baseline",
          toolName: "hook",
          status: "completed",
        },
      ]);
      const maybeNameThread = vi.fn();
      const refreshActiveThreads = vi.fn();
      const handler = handlerForState(state, { maybeNameThread, refreshActiveThreads });

      handler.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-active",
          turn: {
            id: "stale-turn",
            status: "completed",
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
            error: null,
            itemsView: "full",
            items: [{ type: "agentMessage", id: "a1", text: "stale", phase: "final_answer", memoryCitation: null }],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(pendingTurnStart(handler.currentState())).toEqual({
        anchorItemId: "local-user-1",
        promptSubmitHookItemIds: ["hook-hook-1-1"],
      });
      expect(chatStateMessageStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(maybeNameThread).not.toHaveBeenCalled();
      expect(refreshActiveThreads).not.toHaveBeenCalled();
    });

    it("routes sparse account rate limit updates through the app-server resource event boundary", () => {
      const state = chatStateFixture();
      const applyAppServerResourceEvent = vi.fn();
      const handler = handlerForState(state, { applyAppServerResourceEvent });

      handler.handleNotification({
        method: "account/rateLimits/updated",
        params: {
          rateLimits: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: null },
            secondary: null,
            credits: null,
            individualLimit: null,
            planType: null,
            rateLimitReachedType: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "account/rateLimits/updated" }>);

      expect(state.connection.rateLimit).toBeNull();
      expect(applyAppServerResourceEvent).toHaveBeenCalledWith({
        type: "rate-limits-updated",
        preserveExistingOnFailure: true,
      });
    });

    it("routes MCP startup status through the app-server resource event boundary", () => {
      const state = chatStateFixture();
      const applyAppServerResourceEvent = vi.fn();
      const handler = handlerForState(state, { applyAppServerResourceEvent });

      handler.handleNotification({
        method: "mcpServer/startupStatus/updated",
        params: {
          threadId: null,
          name: "github",
          status: "failed",
          error: "missing token",
        },
      } satisfies Extract<ServerNotification, { method: "mcpServer/startupStatus/updated" }>);

      expect(applyAppServerResourceEvent).toHaveBeenCalledWith({
        type: "mcp-startup-status-updated",
        name: "github",
        status: "failed",
        message: "missing token",
      });
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([]);
    });
  });

  describe("interactive server requests", () => {
    it("queues and resolves requestUserInput server requests", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, {
        requests: {
          mcpElicitationDrafts: new Map([
            ["45:mcp:title", "Fix tests"],
            ["45:mcp:notify", "false"],
          ]),
        },
      });
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { respondToServerRequest });

      handler.handleServerRequest({
        id: 42,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          itemId: "input-1",
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "How broad should this be?",
              isOther: true,
              isSecret: false,
              options: [{ label: "Narrow", description: "Small change" }],
            },
          ],
          autoResolutionMs: null,
        },
      });

      expect(handler.currentState().requests.pendingUserInputs).toHaveLength(1);
      handler.resolveUserInput(42, { scope: "Narrow" });
      expect(respondToServerRequest).toHaveBeenCalledWith(42, { answers: { scope: { answers: ["Narrow"] } } });
      expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "Input submitted for 1 question.",
        turnId: "turn-active",
        questions: [expect.objectContaining({ id: "scope", header: "Scope", answer: "Narrow" })],
      });
    });

    it("rejects cancelled requestUserInput server requests", () => {
      const state = chatStateFixture();
      const rejectServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { rejectServerRequest });

      handler.handleServerRequest({
        id: 43,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          itemId: "input-1",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
          autoResolutionMs: null,
        },
      });

      handler.cancelUserInput(43);
      expect(rejectServerRequest).toHaveBeenCalledWith(43, -32000, "User cancelled input request.");
      expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "Input request cancelled for 1 question.",
        turnId: "turn-active",
      });
    });

    it("queues and accepts MCP elicitation form server requests", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, {
        requests: {
          mcpElicitationDrafts: new Map([
            ["45:mcp:title", "Fix tests"],
            ["45:mcp:notify", "false"],
          ]),
        },
      });
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { respondToServerRequest });

      handler.handleServerRequest({
        id: 45,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-active",
          turnId: null,
          serverName: "github",
          mode: "form",
          _meta: null,
          message: "Provide issue details",
          requestedSchema: {
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string", title: "Title", default: "Issue" },
              notify: { type: "boolean", title: "Notify", default: true },
            },
          },
        },
      });

      expect(handler.currentState().requests.pendingMcpElicitations).toHaveLength(1);
      handler.resolveMcpElicitation(45, "accept");

      expect(respondToServerRequest).toHaveBeenCalledWith(45, {
        action: "accept",
        content: { title: "Fix tests", notify: false },
        _meta: null,
      });
      expect(handler.currentState().requests.pendingMcpElicitations).toEqual([]);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "MCP request from github accepted.",
        questions: [
          expect.objectContaining({ id: "title", answer: "Fix tests" }),
          expect.objectContaining({ id: "notify", answer: "false" }),
        ],
      });
    });

    it("declines MCP elicitation URL server requests", () => {
      const state = chatStateFixture();
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { respondToServerRequest });

      handler.handleServerRequest({
        id: 46,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          serverName: "github",
          mode: "url",
          _meta: null,
          message: "Confirm in browser",
          url: "https://example.com/confirm",
          elicitationId: "elicit-1",
        },
      });

      handler.resolveMcpElicitation(46, "decline");

      expect(respondToServerRequest).toHaveBeenCalledWith(46, { action: "decline", content: null, _meta: null });
      expect(handler.currentState().requests.pendingMcpElicitations).toEqual([]);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "userInputResult",
        text: "MCP request from github declined.",
        executionState: "failed",
      });
    });

    it("ignores missing requestUserInput ids", () => {
      const state = chatStateFixture();
      const respondToServerRequest = vi.fn(() => true);
      const rejectServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { respondToServerRequest, rejectServerRequest });

      handler.handleServerRequest(userInputRequest(44));
      const current = expectPresent(handler.currentState().requests.pendingUserInputs[0]);

      handler.resolveUserInput(45, { note: "stale" });
      handler.cancelUserInput(45);

      expect(respondToServerRequest).not.toHaveBeenCalled();
      expect(rejectServerRequest).not.toHaveBeenCalled();
      expect(handler.currentState().requests.pendingUserInputs).toEqual([current]);
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([]);
    });

    it("ignores missing MCP elicitation ids", () => {
      const state = chatStateFixture();
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { respondToServerRequest });

      handler.handleServerRequest(mcpElicitationRequest(47));
      const current = expectPresent(handler.currentState().requests.pendingMcpElicitations[0]);

      handler.resolveMcpElicitation(48, "accept");

      expect(respondToServerRequest).not.toHaveBeenCalled();
      expect(handler.currentState().requests.pendingMcpElicitations).toEqual([current]);
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([]);
    });

    it("records manual permission approvals as colored result items", () => {
      const state = chatStateFixture();
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { respondToServerRequest });

      handler.handleServerRequest(expectPresent(supportedApprovalRequests()[2]));
      handler.resolveApproval(12, "accept-session");

      expect(respondToServerRequest).toHaveBeenCalledWith(12, {
        scope: "session",
        permissions: {},
      });
      expect(handler.currentState().requests.approvals).toEqual([]);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        id: "approval-12",
        kind: "approvalResult",
        role: "tool",
        text: "Allowed for this session: Need access",
        turnId: "turn",
        executionState: "completed",
        approval: {
          status: "allowed for session",
          scope: "session",
          request: "Permission approval",
          auditFacts: expect.arrayContaining([{ key: "cwd", value: "/tmp/project" }]),
        },
      });
    });

    it("ignores missing approval ids", () => {
      const state = chatStateFixture();
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { respondToServerRequest });

      handler.handleServerRequest(expectPresent(supportedApprovalRequests()[2]));
      const current = expectPresent(handler.currentState().requests.approvals[0]);

      handler.resolveApproval(13, "accept-session");

      expect(respondToServerRequest).not.toHaveBeenCalled();
      expect(handler.currentState().requests.approvals).toEqual([current]);
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([]);
    });

    it("handles known server request families and rejects unsupported requests by default", () => {
      const state = chatStateFixture();
      const rejectServerRequest = vi.fn(() => true);
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { rejectServerRequest, respondToServerRequest });

      for (const request of supportedApprovalRequests()) {
        handler.handleServerRequest(request);
      }
      handler.handleServerRequest(userInputRequest(20));
      handler.handleServerRequest(mcpElicitationRequest(21));
      const dateNow = vi.spyOn(Date, "now").mockReturnValue(1_700_000_123_456);
      handler.handleServerRequest(currentTimeRequest(28, "thread"));
      const unsupported = unsupportedRequests();
      for (const request of unsupported) {
        handler.handleServerRequest(request);
      }
      dateNow.mockRestore();
      handler.handleServerRequest(unknownRequest());

      expect(handler.currentState().requests.approvals.map((approval) => approval.requestId)).toEqual([10, 11, 12]);
      expect(handler.currentState().requests.pendingUserInputs.map((input) => input.requestId)).toEqual([20]);
      expect(handler.currentState().requests.pendingMcpElicitations.map((elicitation) => elicitation.requestId)).toEqual([21]);
      expect(respondToServerRequest).toHaveBeenCalledWith(28, { currentTimeAt: 1_700_000_123 });
      const unsupportedMessages = unsupported.map((request) => `Rejected unsupported app-server request: ${request.method}`);
      expect(rejectServerRequest).toHaveBeenCalledTimes(unsupportedMessages.length + 1);
      for (const [index, request] of unsupported.entries()) {
        expect(rejectServerRequest).toHaveBeenNthCalledWith(index + 1, request.id, -32601, unsupportedMessages[index]);
      }
      expect(rejectServerRequest).toHaveBeenNthCalledWith(
        unsupportedMessages.length + 1,
        27,
        -32601,
        "Rejected unknown app-server request: appServer/newFutureRequest",
      );
      expect(chatStateMessageStreamItems(handler.currentState()).map((item) => ("text" in item ? item.text : ""))).toEqual(
        unsupportedMessages,
      );
      expect(
        chatStateMessageStreamItems(handler.currentState())
          .map((item) => ("text" in item ? item.text : ""))
          .join("\n"),
      ).not.toContain("do-not-render");
    });

    it("keeps unknown server request fallback out of the normal message stream", () => {
      const state = chatStateFixture();
      const rejectServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { rejectServerRequest });

      handler.handleServerRequest(unknownRequest());

      expect(rejectServerRequest).toHaveBeenCalledWith(27, -32601, "Rejected unknown app-server request: appServer/newFutureRequest");
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([]);
    });

    it("rejects server requests scoped to a different active thread or turn", () => {
      const state = activeRunningState();
      const rejectServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { rejectServerRequest });

      handler.handleServerRequest({
        id: 51,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-other",
          turnId: "turn-active",
          itemId: "input",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
          autoResolutionMs: null,
        },
      });
      handler.handleServerRequest({
        id: 52,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-active",
          turnId: "turn-other",
          itemId: "input",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
          autoResolutionMs: null,
        },
      });

      expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      expect(rejectServerRequest).toHaveBeenCalledTimes(2);
      expect(rejectServerRequest).toHaveBeenNthCalledWith(
        1,
        51,
        -32601,
        "Rejected inactive app-server request: item/tool/requestUserInput",
      );
      expect(rejectServerRequest).toHaveBeenNthCalledWith(
        2,
        52,
        -32601,
        "Rejected inactive app-server request: item/tool/requestUserInput",
      );
    });

    it("rejects delayed turn-scoped server requests after the active thread returns to idle", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, { turn: { lifecycle: { kind: "idle" } } });
      const rejectServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { rejectServerRequest });

      handler.handleServerRequest({
        id: 53,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-active",
          turnId: "turn-stale",
          itemId: "input",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
          autoResolutionMs: null,
        },
      });

      expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      expect(rejectServerRequest).toHaveBeenCalledWith(53, -32601, "Rejected inactive app-server request: item/tool/requestUserInput");
    });

    it("keeps pending requests when response delivery fails", () => {
      const state = chatStateFixture();
      const respondToServerRequest = vi.fn(() => false);
      const handler = handlerForState(state, { respondToServerRequest });

      handler.handleServerRequest(userInputRequest(55));
      handler.resolveUserInput(55, { note: "Later" });

      expect(handler.currentState().requests.pendingUserInputs).toHaveLength(1);
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([
        expect.objectContaining({ kind: "system", text: "Could not send user input because Codex app-server is not connected." }),
      ]);
    });

    it("clears pending request state when app-server resolves a request", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        requests: {
          approvals: [
            pendingApprovalFromRequest({
              id: 50,
              method: "item/commandExecution/requestApproval",
              params: {
                ...expectPresent(supportedApprovalRequests()[0]).params,
                threadId: "thread-active",
              } as Extract<ServerRequest, { method: "item/commandExecution/requestApproval" }>["params"],
            }),
          ],
        },
      });
      state = chatStateWith(state, {
        requests: {
          pendingUserInputs: [
            pendingUserInputFromRequest({
              id: 50,
              method: "item/tool/requestUserInput",
              params: {
                threadId: "thread-active",
                turnId: "turn-active",
                itemId: "input",
                questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
                autoResolutionMs: null,
              },
            }),
          ],
        },
      });
      state = chatStateWith(state, {
        requests: {
          pendingMcpElicitations: [
            {
              requestId: 50,
              params: {
                threadId: "thread-active",
                turnId: null,
                serverName: "github",
                mode: "form",
                message: "Need input",
                meta: null,
                fields: [
                  {
                    id: "title",
                    title: "Title",
                    description: null,
                    type: "string",
                    required: true,
                    format: null,
                    minLength: null,
                    maxLength: null,
                    defaultValue: "",
                  },
                ],
              },
            },
          ],
        },
      });
      state = chatStateWith(state, {
        requests: {
          userInputDrafts: new Map([["50:note", "draft"]]),
          mcpElicitationDrafts: new Map([["50:mcp:title", "draft"]]),
        },
      });
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "serverRequest/resolved",
        params: { threadId: "thread-active", requestId: 50 },
      } satisfies Extract<ServerNotification, { method: "serverRequest/resolved" }>);

      expect(handler.currentState().requests.approvals).toEqual([]);
      expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      expect(handler.currentState().requests.pendingMcpElicitations).toEqual([]);
      expect(handler.currentState().requests.userInputDrafts.size).toBe(0);
      expect(handler.currentState().requests.mcpElicitationDrafts.size).toBe(0);
    });
  });

  describe("thread lifecycle and reconciliation", () => {
    it("keeps user-visible app-server notices in the message stream", () => {
      const state = chatStateFixture();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "warning",
        params: { threadId: null, message: "careful" },
      } satisfies Extract<ServerNotification, { method: "warning" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([
        expect.objectContaining({
          kind: "system",
          text: 'warning: {\n  "threadId": null,\n  "message": "careful"\n}',
        }),
      ]);
    });

    it("clears all active-thread scoped state when the active thread is archived", () => {
      let state = activeRunningState();
      state = chatStateWith(state, { runtime: { activeModel: "gpt-5.5" } });
      state = chatStateWith(state, { runtime: { activeServiceTier: "fast" } });
      state = chatStateWith(state, {
        activeThread: {
          tokenUsage: {
            last: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3 },
            total: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3 },
            modelContextWindow: 100,
          },
        },
      });
      state = chatStateWith(state, { messageStream: { historyCursor: "cursor" } });
      state = chatStateWith(state, { messageStream: { loadingHistory: true } });
      state = withChatStateMessageStreamItems(state, [
        { id: "message", kind: "message", role: "assistant", text: "stale", messageKind: "assistantResponse", messageState: "completed" },
      ]);
      state = chatStateWith(state, { messageStream: { turnDiffs: new Map([["turn-active", "@@\n-stale\n+stale"]]) } });
      state = chatStateWith(state, { composer: { draft: "thread draft" } });
      state = chatStateWith(state, {
        requests: {
          approvals: [
            pendingApprovalFromRequest({
              id: 10,
              method: "item/commandExecution/requestApproval",
              params: expectPresent(supportedApprovalRequests()[0]).params as Extract<
                ServerRequest,
                { method: "item/commandExecution/requestApproval" }
              >["params"],
            }),
          ],
        },
      });
      state = chatStateWith(state, {
        requests: {
          pendingUserInputs: [
            pendingUserInputFromRequest({
              id: 20,
              method: "item/tool/requestUserInput",
              params: {
                threadId: "thread-active",
                turnId: "turn-active",
                itemId: "input",
                questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
                autoResolutionMs: null,
              },
            }),
          ],
        },
      });
      state = chatStateWith(state, { requests: { userInputDrafts: new Map([["20:note", "draft"]]) } });
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(state, { applyThreadCatalogEvent });

      handler.handleNotification({
        method: "thread/archived",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/archived" }>);

      expect(handler.currentState().activeThread.id).toBe("thread-active");
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-archived",
        threadId: "thread-active",
      } satisfies ThreadCatalogEvent);
    });

    it("records deleted thread notifications in the active catalog", () => {
      const applyThreadCatalogEvent = vi.fn();
      const refreshActiveThreads = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadCatalogEvent, refreshActiveThreads });

      handler.handleNotification({
        method: "thread/deleted",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/deleted" }>);

      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-deleted",
        threadId: "thread-active",
      } satisfies ThreadCatalogEvent);
      expect(refreshActiveThreads).not.toHaveBeenCalled();
    });

    it("routes unarchived thread notifications through the catalog instead of refreshing in the handler", () => {
      const applyThreadCatalogEvent = vi.fn();
      const refreshActiveThreads = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadCatalogEvent, refreshActiveThreads });

      handler.handleNotification({
        method: "thread/unarchived",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/unarchived" }>);

      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-unarchived",
        threadId: "thread-active",
      } satisfies ThreadCatalogEvent);
      expect(refreshActiveThreads).not.toHaveBeenCalled();
    });

    it("records unrelated thread-started notifications without replacing the active cwd", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, { activeThread: { cwd: "/workspace/active" } });
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(state, { applyThreadCatalogEvent });

      handler.handleNotification({
        method: "thread/started",
        params: { thread: appServerThread("thread-other", "/workspace/other") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(handler.currentState().activeThread.cwd).toBe("/workspace/active");
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-started",
        thread: expect.objectContaining({ id: "thread-other" }),
      });
    });

    it("records cwd from active thread-started notifications", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(state, { applyThreadCatalogEvent });

      handler.handleNotification({
        method: "thread/started",
        params: { thread: appServerThread("thread-active", "/workspace/active") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(handler.currentState().activeThread.cwd).toBe("/workspace/active");
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-started",
        thread: expect.objectContaining({ id: "thread-active" }),
      });
    });

    it("replaces optimistic user echoes when completed turns are reconciled", () => {
      let state = activeRunningState();
      state = withChatStateMessageStreamItems(state, [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello", turnId: "turn-active" },
        {
          id: "a1",
          sourceItemId: "a1",
          kind: "message",
          role: "assistant",
          messageKind: "assistantResponse",
          messageState: "completed",
          text: "partial",
          turnId: "turn-active",
        },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-active",
          turn: {
            id: "turn-active",
            status: "completed",
            error: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            itemsView: "full",
            items: [
              { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "hello", text_elements: [] }] },
              { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
            ],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState()).filter((item) => item.kind === "message" && item.role === "user")).toEqual(
        [expect.objectContaining({ id: "u1", text: "hello" })],
      );
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "a1", text: "done" })]),
      );
      expect(chatStateMessageStreamItems(handler.currentState()).some((item) => item.id === "local-user-1")).toBe(false);
    });

    it("reconciles optimistic user echoes by client id before falling back to same-turn text only when client ids are absent", () => {
      let state = activeRunningState();
      state = withChatStateMessageStreamItems(state, [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "same text", turnId: "turn-active" },
        { id: "local-steer-2", kind: "message", messageKind: "user", role: "user", text: "same text", turnId: "turn-active" },
        { id: "local-user-2", kind: "message", messageKind: "user", role: "user", text: "same text", turnId: "turn-other" },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-active",
          turn: {
            id: "turn-active",
            status: "completed",
            error: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            itemsView: "full",
            items: [
              {
                type: "userMessage",
                id: "u1",
                clientId: "local-user-1",
                content: [{ type: "text", text: "same text", text_elements: [] }],
              },
              { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
            ],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", clientId: "local-user-1", text: "same text" }),
          expect.objectContaining({ id: "local-steer-2", text: "same text" }),
          expect.objectContaining({ id: "local-user-2", text: "same text" }),
        ]),
      );
      expect(chatStateMessageStreamItems(handler.currentState()).some((item) => item.id === "local-user-1")).toBe(false);

      let fallbackStateWithoutClientId = chatStateFixture();
      fallbackStateWithoutClientId = chatStateWith(fallbackStateWithoutClientId, { activeThread: { id: "thread-active" } });
      fallbackStateWithoutClientId = chatStateWith(fallbackStateWithoutClientId, {
        turn: { lifecycle: { kind: "running", turnId: "turn-active" } },
      });
      fallbackStateWithoutClientId = withChatStateMessageStreamItems(fallbackStateWithoutClientId, [
        {
          id: "local-user-without-client-id",
          kind: "message",
          messageKind: "user",
          role: "user",
          text: "fallback text",
          turnId: "turn-active",
        },
        {
          id: "local-user-other-turn",
          kind: "message",
          messageKind: "user",
          role: "user",
          text: "fallback text",
          turnId: "turn-other",
        },
      ]);
      const fallbackHandlerWithoutClientId = handlerForState(fallbackStateWithoutClientId);

      fallbackHandlerWithoutClientId.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-active",
          turn: {
            id: "turn-active",
            status: "completed",
            error: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            itemsView: "full",
            items: [
              {
                type: "userMessage",
                id: "server-u1",
                clientId: null,
                content: [{ type: "text", text: "fallback text", text_elements: [] }],
              },
            ],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(chatStateMessageStreamItems(fallbackHandlerWithoutClientId.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "server-u1", text: "fallback text" }),
          expect.objectContaining({ id: "local-user-other-turn", text: "fallback text" }),
        ]),
      );
      expect(
        chatStateMessageStreamItems(fallbackHandlerWithoutClientId.currentState()).some(
          (item) => item.id === "local-user-without-client-id",
        ),
      ).toBe(false);
    });

    it("keeps the observed steer message order when completed turns reconcile by client id", () => {
      let state = activeRunningState();
      state = withChatStateMessageStreamItems(state, [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "start", turnId: "turn-active" },
        {
          id: "a1",
          sourceItemId: "a1",
          kind: "message",
          role: "assistant",
          messageKind: "assistantResponse",
          messageState: "completed",
          text: "first partial",
          turnId: "turn-active",
        },
        { id: "local-steer-1", kind: "message", messageKind: "user", role: "user", text: "steer", turnId: "turn-active" },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-active",
          turn: {
            id: "turn-active",
            status: "completed",
            error: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            itemsView: "full",
            items: [
              { type: "userMessage", id: "u1", clientId: "local-user-1", content: [{ type: "text", text: "start", text_elements: [] }] },
              { type: "agentMessage", id: "a1", text: "first done", phase: "final_answer", memoryCitation: null },
              { type: "userMessage", id: "u2", clientId: "local-steer-1", content: [{ type: "text", text: "steer", text_elements: [] }] },
              { type: "agentMessage", id: "a2", text: "second done", phase: "final_answer", memoryCitation: null },
            ],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2"]);
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", clientId: "local-user-1", text: "start" }),
          expect.objectContaining({ id: "a1", text: "first done" }),
          expect.objectContaining({ id: "u2", clientId: "local-steer-1", text: "steer" }),
          expect.objectContaining({ id: "a2", text: "second done" }),
        ]),
      );
    });

    it("asks the view to auto-name completed turns", () => {
      const state = activeRunningState();
      const maybeNameThread = vi.fn();
      const handler = handlerForState(state, { maybeNameThread });
      const turn = {
        id: "turn-active",
        status: "completed",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        itemsView: "full",
        items: [
          { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "hello", text_elements: [] }] },
          { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
        ],
      } satisfies TurnRecord;

      handler.handleNotification({
        method: "turn/completed",
        params: { threadId: "thread-active", turn },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(maybeNameThread).toHaveBeenCalledWith("thread-active", "turn-active", {
        userText: "hello",
        assistantText: "done",
      });
    });

    it("routes thread name notifications through catalog events", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, { threadList: { listedThreads: [panelThread("thread-active")] } });
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(state, { applyThreadCatalogEvent });

      handler.handleNotification({
        method: "thread/name/updated",
        params: { threadId: "thread-active", threadName: "  Codex   Panel自動命名  " },
      } satisfies Extract<ServerNotification, { method: "thread/name/updated" }>);

      expect(state.threadList.listedThreads[0]?.name).toBeNull();
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith({
        type: "thread-renamed",
        threadId: "thread-active",
        name: "Codex Panel自動命名",
      } satisfies ThreadCatalogEvent);
    });

    it("syncs active runtime state from thread settings notifications", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "thread/settings/updated",
        params: {
          threadId: "thread-active",
          threadSettings: {
            cwd: "/workspace/active",
            approvalsReviewer: "auto_review",
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            model: "gpt-5.5",
            modelProvider: "openai",
            serviceTier: "fast",
            approvalPolicy: "on-request",
            effort: "high",
            summary: null,
            collaborationMode: {
              mode: "default",
              settings: { model: "gpt-5.5", reasoning_effort: "high", developer_instructions: null },
            },
            activePermissionProfile: null,
            multiAgentMode: "explicitRequestOnly",
            personality: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "thread/settings/updated" }>);

      expect(handler.currentState().activeThread.cwd).toBe("/workspace/active");
      expect(handler.currentState().runtime.activeModel).toBe("gpt-5.5");
      expect(handler.currentState().runtime.activeServiceTier).toBe("fast");
      expect(handler.currentState().runtime.activeApprovalsReviewer).toBe("auto_review");
      expect(chatStateMessageStreamItems(handler.currentState())).toEqual([]);
    });

    it("ignores settings notifications for inactive threads", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, { activeThread: { cwd: "/workspace/active" } });
      state = chatStateWith(state, { runtime: { activeModel: "gpt-active" } });
      state = chatStateWith(state, { runtime: { activeServiceTier: "flex" } });
      state = chatStateWith(state, { runtime: { activeApprovalsReviewer: "user" } });
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "thread/settings/updated",
        params: {
          threadId: "thread-other",
          threadSettings: {
            cwd: "/workspace/other",
            approvalsReviewer: "auto_review",
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            model: "gpt-other",
            modelProvider: "openai",
            serviceTier: "fast",
            approvalPolicy: "never",
            effort: "high",
            summary: null,
            collaborationMode: {
              mode: "plan",
              settings: { model: "gpt-other", reasoning_effort: "high", developer_instructions: null },
            },
            activePermissionProfile: { id: ":read-only", extends: null },
            multiAgentMode: "explicitRequestOnly",
            personality: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "thread/settings/updated" }>);

      expect(handler.currentState().activeThread.cwd).toBe("/workspace/active");
      expect(handler.currentState().runtime.activeModel).toBe("gpt-active");
      expect(handler.currentState().runtime.activeServiceTier).toBe("flex");
      expect(handler.currentState().runtime.activeApprovalsReviewer).toBe("user");
    });

    it("syncs null service tier from settings notifications", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, { runtime: { activeServiceTier: "flex" } });
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "thread/settings/updated",
        params: {
          threadId: "thread-active",
          threadSettings: {
            cwd: "/workspace/active",
            approvalsReviewer: "user",
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            model: "gpt-5.5",
            modelProvider: "openai",
            serviceTier: null,
            approvalPolicy: "on-request",
            effort: "high",
            summary: null,
            collaborationMode: {
              mode: "default",
              settings: { model: "gpt-5.5", reasoning_effort: "high", developer_instructions: null },
            },
            activePermissionProfile: null,
            multiAgentMode: "explicitRequestOnly",
            personality: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "thread/settings/updated" }>);

      expect(handler.currentState().runtime.activeServiceTier).toBeNull();
    });

    it("adds goal events for goal state changes from notifications", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      const handler = handlerForState(state);
      const goal = {
        threadId: "thread-active",
        objective: "Finish",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>["params"]["goal"];

      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);

      expect(handler.currentState().activeThread.goal).toEqual(goal);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "goal",
        text: "set: Finish",
        objective: "Finish",
      });

      const afterSetMessageCount = chatStateMessageStreamItems(handler.currentState()).length;
      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(chatStateMessageStreamItems(handler.currentState())).toHaveLength(afterSetMessageCount);

      const updatedGoal = { ...goal, objective: "Finish well", updatedAt: 2 };
      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: updatedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "goal",
        text: "updated: Finish well",
        objective: "Finish well",
      });

      const pausedGoal = { ...updatedGoal, status: "paused", updatedAt: 3 } satisfies Extract<
        ServerNotification,
        { method: "thread/goal/updated" }
      >["params"]["goal"];
      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: pausedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "goal",
        text: "paused: Finish well",
        objective: "Finish well",
      });

      const resumedGoal = { ...pausedGoal, status: "active", updatedAt: 4 } satisfies Extract<
        ServerNotification,
        { method: "thread/goal/updated" }
      >["params"]["goal"];
      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: resumedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "goal",
        text: "resumed: Finish well",
        objective: "Finish well",
      });

      const messageCount = chatStateMessageStreamItems(handler.currentState()).length;
      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: { ...resumedGoal, tokensUsed: 10, timeUsedSeconds: 20 } },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(chatStateMessageStreamItems(handler.currentState())).toHaveLength(messageCount);

      handler.handleNotification({
        method: "thread/goal/cleared",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/goal/cleared" }>);

      expect(handler.currentState().activeThread.goal).toBeNull();
      expect(chatStateMessageStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "goal",
        text: "cleared: Finish well",
        objective: "Finish well",
      });
    });

    it("adds a goal event when a goal completes", () => {
      const activeGoal = {
        threadId: "thread-active",
        objective: "Finish",
        status: "active",
        tokenBudget: null,
        tokensUsed: 12,
        timeUsedSeconds: 60,
        createdAt: 1,
        updatedAt: 1,
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>["params"]["goal"];
      const state = chatStateFixture({
        activeThread: {
          id: "thread-active",
          goal: activeGoal,
        },
      });
      const handler = handlerForState(state);
      const completedGoal = {
        ...activeGoal,
        status: "complete",
        tokensUsed: 42,
        timeUsedSeconds: 120,
        updatedAt: 2,
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>["params"]["goal"];

      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: "turn-1", goal: completedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);

      expect(handler.currentState().activeThread.goal).toEqual(completedGoal);
      expect(chatStateMessageStreamItems(handler.currentState())).toHaveLength(1);
      expect(chatStateMessageStreamItems(handler.currentState())[0]).toMatchObject({
        kind: "goal",
        text: "completed: Finish",
        objective: "Finish",
      });

      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: "turn-1", goal: { ...completedGoal, tokensUsed: 43 } },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toHaveLength(1);
    });

    it("ignores goal notifications that do not match the active thread", () => {
      const goal = {
        threadId: "previous-thread",
        objective: "Stale",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>["params"]["goal"];

      const noActiveState = chatStateFixture();
      const noActiveHandler = handlerForState(noActiveState);
      noActiveHandler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "previous-thread", turnId: null, goal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(noActiveState.activeThread.goal).toBeNull();

      let otherThreadState = chatStateFixture();
      otherThreadState = chatStateWith(otherThreadState, { activeThread: { id: "thread-active" } });
      otherThreadState = chatStateWith(otherThreadState, {
        activeThread: { goal: { ...goal, threadId: "thread-active", objective: "Current" } },
      });
      const otherThreadHandler = handlerForState(otherThreadState);
      otherThreadHandler.handleNotification({
        method: "thread/goal/cleared",
        params: { threadId: "previous-thread" },
      } satisfies Extract<ServerNotification, { method: "thread/goal/cleared" }>);
      expect(expectPresent(otherThreadState.activeThread.goal).objective).toBe("Current");
    });
  });

  describe("auto-review display", () => {
    it("renders guardian warnings as review results instead of system messages", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "guardianWarning",
        params: { threadId: "thread-active", message: "Auto-review denied this command." },
      } satisfies Extract<ServerNotification, { method: "guardianWarning" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toMatchObject([
        {
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review denied this command.",
        },
      ]);
    });

    it("renders auto approval review notifications as upserted review results", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "item/autoApprovalReview/started",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          startedAtMs: 1,
          reviewId: "review-1",
          targetItemId: "cmd-1",
          review: { status: "inProgress", riskLevel: "low", userAuthorization: null, rationale: null },
          action: { type: "command", source: "shell", command: "npm test", cwd: "/vault" },
        },
      } satisfies Extract<ServerNotification, { method: "item/autoApprovalReview/started" }>);
      handler.handleNotification({
        method: "item/autoApprovalReview/completed",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          startedAtMs: 1,
          completedAtMs: 2,
          reviewId: "review-1",
          targetItemId: "cmd-1",
          decisionSource: "agent",
          review: { status: "approved", riskLevel: "low", userAuthorization: "medium", rationale: "Allowed by policy." },
          action: { type: "command", source: "shell", command: "npm test", cwd: "/vault" },
        },
      } satisfies Extract<ServerNotification, { method: "item/autoApprovalReview/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toHaveLength(1);
      expect(chatStateMessageStreamItems(handler.currentState())[0]).toMatchObject({
        id: "review-review-1",
        kind: "reviewResult",
        text: "Auto-review approved: npm test",
        executionState: "completed",
      });
      const reviewItem = expectPresent(chatStateMessageStreamItems(handler.currentState())[0]);
      expect(reviewItem).toMatchObject({ review: { auditFacts: expect.arrayContaining([{ key: "status", value: "approved" }]) } });
    });

    it("replaces guardian auto-review warnings when structured auto-review notifications arrive", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "guardianWarning",
        params: { threadId: "thread-active", message: "Auto-review approved: npm test" },
      } satisfies Extract<ServerNotification, { method: "guardianWarning" }>);
      handler.handleNotification({
        method: "item/autoApprovalReview/completed",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          startedAtMs: 1,
          completedAtMs: 2,
          reviewId: "review-1",
          targetItemId: "cmd-1",
          decisionSource: "agent",
          review: { status: "approved", riskLevel: "low", userAuthorization: "medium", rationale: "Allowed by policy." },
          action: { type: "command", source: "shell", command: "npm test", cwd: "/vault" },
        },
      } satisfies Extract<ServerNotification, { method: "item/autoApprovalReview/completed" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toHaveLength(1);
      expect(chatStateMessageStreamItems(handler.currentState())[0]).toMatchObject({
        id: "review-review-1",
        kind: "reviewResult",
        text: "Auto-review approved: npm test",
        turnId: "turn-active",
      });
    });

    it("ignores guardian auto-review warnings after structured auto-review notifications", () => {
      const state = activeRunningState();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "item/autoApprovalReview/completed",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          startedAtMs: 1,
          completedAtMs: 2,
          reviewId: "review-1",
          targetItemId: "cmd-1",
          decisionSource: "agent",
          review: { status: "approved", riskLevel: "low", userAuthorization: "medium", rationale: "Allowed by policy." },
          action: { type: "command", source: "shell", command: "npm test", cwd: "/vault" },
        },
      } satisfies Extract<ServerNotification, { method: "item/autoApprovalReview/completed" }>);
      handler.handleNotification({
        method: "guardianWarning",
        params: { threadId: "thread-active", message: "Auto-review approved: npm test" },
      } satisfies Extract<ServerNotification, { method: "guardianWarning" }>);

      expect(chatStateMessageStreamItems(handler.currentState())).toHaveLength(1);
      expect(chatStateMessageStreamItems(handler.currentState())[0]).toMatchObject({ id: "review-review-1" });
    });
  });
});

function supportedApprovalRequests(): ServerRequest[] {
  return [
    {
      id: 10,
      method: "item/commandExecution/requestApproval",
      params: {
        command: "npm test",
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        environmentId: null,
        startedAtMs: 1,
        reason: null,
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      },
    },
    {
      id: 11,
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "file",
        startedAtMs: 1,
        reason: "write",
        grantRoot: "/tmp/project",
      },
    },
    {
      id: 12,
      method: "item/permissions/requestApproval",
      params: {
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "permissions",
        environmentId: null,
        startedAtMs: 1,
        reason: "Need access",
        permissions: { network: null, fileSystem: null },
      },
    },
  ];
}

function userInputRequest(id: number): ServerRequest {
  return {
    id,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "input",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
      autoResolutionMs: null,
    },
  };
}

function mcpElicitationRequest(id: number): ServerRequest {
  return {
    id,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread",
      turnId: null,
      serverName: "server",
      mode: "form",
      _meta: null,
      message: "Need input",
      requestedSchema: { type: "object", properties: {} },
    },
  };
}

function appServerThread(id: string, cwd: string): ThreadStartedNotification["params"]["thread"] {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    recencyAt: null,
    status: { type: "active", activeFlags: [] },
    path: null,
    cwd,
    cliVersion: "codex",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

function panelThread(id: string): PanelThread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
  };
}

function promptSubmitHookRun(id: string, startedAt: bigint): Extract<ServerNotification, { method: "hook/completed" }>["params"]["run"] {
  return {
    id,
    eventName: "userPromptSubmit",
    handlerType: "command",
    executionMode: "sync",
    scope: "turn",
    sourcePath: "/vault/.codex/hooks.json",
    source: "project",
    displayOrder: 1n,
    status: "completed",
    statusMessage: "Saving jj baseline",
    startedAt,
    completedAt: startedAt + 1n,
    durationMs: 1n,
    entries: [],
  };
}

function unsupportedRequests(): ServerRequest[] {
  return [
    {
      id: 22,
      method: "item/tool/call",
      params: { threadId: "thread", turnId: "turn", callId: "call", namespace: null, tool: "tool", arguments: {} },
    },
    {
      id: 23,
      method: "account/chatgptAuthTokens/refresh",
      params: { reason: "unauthorized", previousAccountId: null },
    },
    {
      id: 24,
      method: "attestation/generate",
      params: {},
    },
    {
      id: 25,
      method: "applyPatchApproval",
      params: { conversationId: "thread", callId: "patch", fileChanges: {}, reason: "patch", grantRoot: null },
    },
    {
      id: 26,
      method: "execCommandApproval",
      params: {
        conversationId: "thread",
        callId: "exec",
        approvalId: null,
        command: ["npm", "test"],
        cwd: "/tmp/project",
        reason: "exec",
        parsedCmd: [],
      },
    },
  ];
}

function currentTimeRequest(id: number, threadId: string): ServerRequest {
  return {
    id,
    method: "currentTime/read",
    params: { threadId },
  };
}

function unknownRequest(): ServerRequest {
  return {
    id: 27,
    method: "appServer/newFutureRequest",
    params: { secret: "do-not-render" },
  } as unknown as ServerRequest;
}
