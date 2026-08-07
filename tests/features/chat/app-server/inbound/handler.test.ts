import { describe, expect, it, vi } from "vitest";
import type { ServerNotification, ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import type { TurnRecord } from "../../../../../src/app-server/protocol/turn";
import {
  type ChatInboundHandler,
  type ChatInboundHandlerEffects,
  createChatInboundHandler,
} from "../../../../../src/features/chat/app-server/inbound/handler";
import {
  appServerApprovalRequest,
  appServerUserInputRequest,
} from "../../../../../src/features/chat/app-server/inbound/server-request-adapter";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import {
  activeThreadState,
  type ChatAction,
  type ChatState,
  chatReducer,
} from "../../../../../src/features/chat/application/state/root-reducer";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { pendingTurnStart } from "../../../../../src/features/chat/application/turns/turn-state";
import type { ThreadFact as ThreadCatalogEvent } from "../../../../../src/features/threads/workflows/thread-facts";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems, withChatStateStableThreadStreamItems } from "../../support/thread-stream";

type ThreadStartedNotification = Extract<ServerNotification, { method: "thread/started" }>;

type TestChatInboundHandler = Omit<ChatInboundHandler, "handleNotification"> & {
  handleNotification(notification: ServerNotification): void;
  currentState(): ChatState;
};

function handlerForState(
  state = chatStateFixture(),
  actions: Partial<ChatInboundHandlerEffects> & {
    applyThreadFact?: ChatInboundHandlerEffects["applyThreadFact"];
  } = {},
): TestChatInboundHandler {
  const store = testStoreForState(state);
  const { applyThreadFact, ...inboundActions } = actions;
  const handler = createChatInboundHandler(
    store,
    {
      refreshServerDiagnostics: vi.fn(),
      handleAppServerResourceFact: vi.fn(),
      maybeNameThread: vi.fn(),
      applyThreadFact: applyThreadFact ?? vi.fn(),
      observeThreadGoal: vi.fn(),
      respondToServerRequest: vi.fn(() => true),
      rejectServerRequest: vi.fn(() => true),
      ...inboundActions,
    },
    createLocalIdSource({ nowMs: () => 1, seed: "test" }),
  );
  return Object.assign(handler, {
    currentState: () => store.getState(),
  });
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
    activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } },
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

      expect(chatStateThreadStreamItems(handler.currentState())).toMatchObject([{ id: "a1", text: "hello" }]);
    });

    it("marks active reasoning completed when assistant text starts", () => {
      let state = activeRunningState();
      state = withChatStateStableThreadStreamItems(state, [
        { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "turn-active" },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "answer" },
      } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

      expect(chatStateThreadStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "r1", kind: "reasoning", status: "completed", executionState: "completed" }),
          expect.objectContaining({ id: "a1", kind: "dialogue", text: "answer" }),
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

      expect(chatStateThreadStreamItems(handler.currentState())).toMatchObject([
        { id: "p1", kind: "dialogue", dialogueKind: "proposedPlan", role: "assistant", text: "# Plan", dialogueState: "streaming" },
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

      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([
        expect.objectContaining({
          id: "p1",
          kind: "dialogue",
          role: "assistant",
          text: "# Plan",
          dialogueKind: "proposedPlan",
          dialogueState: "completed",
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

      expect(chatStateThreadStreamItems(handler.currentState())).toMatchObject([
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
    it("routes skill changes through the app-server resource fact boundary", () => {
      const handleAppServerResourceFact = vi.fn();
      const handler = handlerForState(chatStateFixture(), { handleAppServerResourceFact });

      handler.handleNotification({
        method: "skills/changed",
        params: {},
      } satisfies Extract<ServerNotification, { method: "skills/changed" }>);

      expect(handleAppServerResourceFact).toHaveBeenCalledWith({ type: "skills-changed" });
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

      expect(handler.currentState().threadStream.turnDiffs.get("turn-active")).toBe("@@\n-old\n+second");
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

      expect(handler.currentState().threadStream.turnDiffs.size).toBe(0);
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

      expect(chatStateThreadStreamItems(handler.currentState())[0]).toMatchObject({
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

      expect(chatStateThreadStreamItems(handler.currentState())[0]).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(chatStateThreadStreamItems(handler.currentState())[0]?.turnId).toBeUndefined();
    });

    it("keeps repeated hook runs with the same run id as separate thread stream items", () => {
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

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["hook-hook-1-1", "hook-hook-1-3"]);
    });

    it("attaches pre-turn prompt submit hook runs when the turn starts", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        activeTurn: {
          lifecycle: {
            kind: "starting",
            pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] },
          },
        },
      });
      state = withChatStateStableThreadStreamItems(state, [
        { id: "local-user-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "hello" },
        {
          id: "hook-hook-1-1",
          kind: "hook",
          role: "tool",
          text: "userPromptSubmit: Saving jj baseline",
          toolName: "hook",
          status: "completed",
        },
      ]);
      const applyThreadFact = vi.fn();
      const handler = handlerForState(state, { applyThreadFact });

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

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(chatStateThreadStreamItems(handler.currentState())[1]).toMatchObject({ id: "hook-hook-1-1", turnId: "turn-active" });
      expect(pendingTurnStart(handler.currentState().activeTurn)).toBeNull();
      expect(applyThreadFact).not.toHaveBeenCalled();
    });

    it("captures only prompt-submit hooks observed during the pending turn start", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        activeTurn: { lifecycle: { kind: "starting", pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] } } },
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

      expect(expectPresent(chatStateThreadStreamItems(handler.currentState())[0])).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(expectPresent(chatStateThreadStreamItems(handler.currentState())[0]).turnId).toBeUndefined();
      expect(expectPresent(pendingTurnStart(handler.currentState().activeTurn)).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);
    });

    it("keeps pre-turn prompt submit hooks through turn start and completed-turn reconciliation", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        activeTurn: { lifecycle: { kind: "starting", pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] } } },
      });
      state = withChatStateStableThreadStreamItems(state, [
        { id: "local-user-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "hello" },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: null, run: promptSubmitHookRun("hook-1", 1n) },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(expectPresent(chatStateThreadStreamItems(handler.currentState())[1]).turnId).toBeUndefined();
      expect(expectPresent(pendingTurnStart(handler.currentState().activeTurn)).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);

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

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(chatStateThreadStreamItems(handler.currentState()).find((item) => item.id === "local-user-1")).not.toHaveProperty("turnId");
      expect(chatStateThreadStreamItems(handler.currentState()).find((item) => item.id === "hook-hook-1-1")).toMatchObject({
        turnId: "turn-active",
      });
      expect(pendingTurnStart(handler.currentState().activeTurn)).toBeNull();

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

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["u1", "hook-hook-1-1", "a1"]);
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", text: "hello", turnId: "turn-active" }),
          expect.objectContaining({ id: "hook-hook-1-1", kind: "hook", turnId: "turn-active" }),
          expect.objectContaining({ id: "a1", text: "done", turnId: "turn-active" }),
        ]),
      );
      expect(chatStateThreadStreamItems(handler.currentState()).some((item) => item.id === "local-user-1")).toBe(false);
    });

    it("ignores completed turn notifications while a new turn is still starting", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        activeTurn: {
          lifecycle: {
            kind: "starting",
            pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] },
          },
        },
      });
      state = withChatStateStableThreadStreamItems(state, [
        { id: "local-user-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "hello" },
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
      const handler = handlerForState(state, { maybeNameThread });

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

      expect(pendingTurnStart(handler.currentState().activeTurn)).toEqual({
        anchorItemId: "local-user-1",
        promptSubmitHookItemIds: ["hook-hook-1-1"],
      });
      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(maybeNameThread).not.toHaveBeenCalled();
    });

    it("routes sparse account rate limit updates through the app-server resource fact boundary", () => {
      const state = chatStateFixture();
      const handleAppServerResourceFact = vi.fn();
      const handler = handlerForState(state, { handleAppServerResourceFact });

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
            spendControlReached: null,
            planType: null,
            rateLimitReachedType: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "account/rateLimits/updated" }>);

      expect(state.connection).not.toHaveProperty("rateLimit");
      expect(handleAppServerResourceFact).toHaveBeenCalledWith({ type: "rate-limits-updated" });
    });

    it("routes MCP startup status through the app-server resource fact boundary", () => {
      const state = chatStateFixture();
      const handleAppServerResourceFact = vi.fn();
      const handler = handlerForState(state, { handleAppServerResourceFact });

      handler.handleNotification({
        method: "mcpServer/startupStatus/updated",
        params: {
          threadId: null,
          name: "github",
          status: "failed",
          error: "missing token",
          failureReason: null,
        },
      } satisfies Extract<ServerNotification, { method: "mcpServer/startupStatus/updated" }>);

      expect(handleAppServerResourceFact).toHaveBeenCalledWith({
        type: "mcp-startup-status-updated",
        name: "github",
        status: "failed",
        message: "missing token",
      });
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
    });

    it("refreshes tool inventory diagnostics when the app list changes", () => {
      const refreshServerDiagnostics = vi.fn();
      const handler = handlerForState(chatStateFixture(), { refreshServerDiagnostics });

      handler.handleNotification({
        method: "app/list/updated",
        params: { data: [] },
      } satisfies Extract<ServerNotification, { method: "app/list/updated" }>);

      expect(refreshServerDiagnostics).toHaveBeenCalledWith();
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
    });

    it("refreshes resource probes after MCP OAuth login completes", () => {
      const refreshServerDiagnostics = vi.fn();
      const handler = handlerForState(chatStateFixture(), { refreshServerDiagnostics });

      handler.handleNotification({
        method: "mcpServer/oauthLogin/completed",
        params: { name: "github", threadId: null, success: true },
      } satisfies Extract<ServerNotification, { method: "mcpServer/oauthLogin/completed" }>);

      expect(refreshServerDiagnostics).toHaveBeenCalledWith();
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
    });
  });

  describe("interactive server requests", () => {
    it("keeps matching requests actionable while a subagent is active", () => {
      const state = chatStateFixture({
        activeThread: {
          id: "thread-active",
          provenance: {
            kind: "subagent",
            subagentKind: "thread-spawn",
            parentThreadId: "parent",
            sessionId: "session",
            depth: 1,
            agentNickname: "Scout",
            agentRole: "explorer",
          },
        },
        activeTurn: { lifecycle: { kind: "running", turnId: "turn-active" } },
      });
      const handler = handlerForState(state);

      handler.handleServerRequest({
        id: 41,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          itemId: "input-1",
          questions: [{ id: "scope", header: "Scope", question: "What should I do?", isOther: false, isSecret: false, options: null }],
          isBlocking: true,
          autoResolutionMs: null,
        },
      });

      expect(handler.currentState().requests.pendingUserInputs).toHaveLength(1);
    });

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
          isBlocking: true,
          autoResolutionMs: null,
        },
      });

      expect(handler.currentState().requests.pendingUserInputs).toHaveLength(1);
      handler.resolveUserInput(42, { scope: "Narrow" });
      expect(respondToServerRequest).toHaveBeenCalledWith(42, { answers: { scope: { answers: ["Narrow"] } } });
      expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "Input submitted for 1 question.",
        turnId: "turn-active",
        questions: [expect.objectContaining({ id: "scope", header: "Scope", answer: "Narrow" })],
      });
    });

    it("auto-resolves non-blocking requestUserInput server requests after the client grace period", () => {
      vi.useFakeTimers();
      vi.stubGlobal("window", globalThis);
      try {
        const respondToServerRequest = vi.fn(() => true);
        const handler = handlerForState(chatStateFixture(), { respondToServerRequest });

        handler.handleServerRequest({
          id: 44,
          method: "item/tool/requestUserInput",
          params: {
            threadId: "thread-active",
            turnId: "turn-active",
            itemId: "input-1",
            questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
            isBlocking: false,
            autoResolutionMs: null,
          },
        });

        expect(handler.currentState().requests.pendingUserInputs).toEqual([
          expect.objectContaining({ requestId: 44, params: expect.objectContaining({ isBlocking: false }) }),
        ]);
        vi.advanceTimersByTime(119_999);
        expect(respondToServerRequest).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(respondToServerRequest).toHaveBeenCalledWith(44, { answers: {} });
        expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    });

    it("cancels non-blocking user-input auto-resolution when the server resolves the request", () => {
      vi.useFakeTimers();
      vi.stubGlobal("window", globalThis);
      try {
        const respondToServerRequest = vi.fn(() => true);
        const handler = handlerForState(chatStateFixture(), { respondToServerRequest });

        handler.handleServerRequest({
          id: 45,
          method: "item/tool/requestUserInput",
          params: {
            threadId: "thread-active",
            turnId: "turn-active",
            itemId: "input-1",
            questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
            isBlocking: false,
            autoResolutionMs: null,
          },
        });
        handler.handleNotification({
          method: "serverRequest/resolved",
          params: { threadId: "thread-active", requestId: 45 },
        });

        vi.advanceTimersByTime(120_000);
        expect(respondToServerRequest).not.toHaveBeenCalled();
        expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
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
          isBlocking: true,
          autoResolutionMs: null,
        },
      });

      handler.cancelUserInput(43);
      expect(rejectServerRequest).toHaveBeenCalledWith(43, -32000, "User cancelled input request.");
      expect(handler.currentState().requests.pendingUserInputs).toEqual([]);
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
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
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "MCP request from github accepted.",
        questions: [
          expect.objectContaining({ id: "title", answer: "Fix tests" }),
          expect.objectContaining({ id: "notify", answer: "false" }),
        ],
      });
    });

    it("records the accepted URL in the MCP elicitation result item", () => {
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

      handler.resolveMcpElicitation(46, "accept");

      expect(respondToServerRequest).toHaveBeenCalledWith(46, { action: "accept", content: null, _meta: null });
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "userInputResult",
        text: "MCP request from github accepted.",
        executionState: "completed",
        questions: [{ id: "url", answer: "https://example.com/confirm" }],
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
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "userInputResult",
        text: "MCP request from github declined.",
        executionState: "failed",
        questions: [{ id: "url" }],
      });
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).not.toHaveProperty("questions.0.answer");
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
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
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
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
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
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
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
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
    });

    it("responds to current-time requests and rejects a representative known unsupported request", () => {
      const state = chatStateFixture();
      const rejectServerRequest = vi.fn(() => true);
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { rejectServerRequest, respondToServerRequest });

      const dateNow = vi.spyOn(Date, "now").mockReturnValue(1_700_000_123_456);
      handler.handleServerRequest(currentTimeRequest(28, "thread"));
      dateNow.mockRestore();
      const unsupported = {
        id: 22,
        method: "item/tool/call",
        params: { threadId: "thread", turnId: "turn", callId: "call", namespace: null, tool: "tool", arguments: {} },
      } satisfies Extract<ServerRequest, { method: "item/tool/call" }>;
      handler.handleServerRequest(unsupported);

      expect(respondToServerRequest).toHaveBeenCalledWith(28, { currentTimeAt: 1_700_000_123 });
      expect(rejectServerRequest).toHaveBeenCalledWith(22, -32601, "Rejected unsupported app-server request: item/tool/call");
      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => ("text" in item ? item.text : ""))).toEqual([
        "Rejected unsupported app-server request: item/tool/call",
      ]);
    });

    it("keeps unknown server request fallback out of the normal thread stream", () => {
      const state = chatStateFixture();
      const rejectServerRequest = vi.fn(() => true);
      const handler = handlerForState(state, { rejectServerRequest });

      handler.handleServerRequest(unknownRequest());

      expect(rejectServerRequest).toHaveBeenCalledWith(27, -32601, "Rejected unknown app-server request: appServer/newFutureRequest");
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
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
          isBlocking: true,
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
          isBlocking: true,
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

    it("presents one parent-owned approval and answers both parent and tracked-child requests", () => {
      const respondToServerRequest = vi.fn(() => true);
      const rejectServerRequest = vi.fn(() => true);
      const handler = handlerForState(activeRunningState(), { respondToServerRequest, rejectServerRequest });
      trackDirectSubagent(handler, "child", "child-turn");

      handler.handleServerRequest(commandApprovalRequest(51, "child", "child-turn", "shared-command"));
      handler.handleServerRequest(commandApprovalRequest(52, "thread-active", "turn-active", "shared-command"));

      expect(rejectServerRequest).not.toHaveBeenCalled();
      expect(handler.currentState().requests.approvals).toEqual([expect.objectContaining({ requestId: 51, turnId: "turn-active" })]);

      handler.resolveApproval(51, "accept");

      expect(respondToServerRequest).toHaveBeenNthCalledWith(1, 51, { decision: "accept" });
      expect(respondToServerRequest).toHaveBeenNthCalledWith(2, 52, { decision: "accept" });
      expect(handler.currentState().requests.approvals).toEqual([]);
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "approvalResult",
        turnId: "turn-active",
      });
    });

    it("applies a locked decision when the parent copy arrives after the child approval was answered", () => {
      const respondToServerRequest = vi.fn(() => true);
      const handler = handlerForState(activeRunningState(), { respondToServerRequest });
      trackDirectSubagent(handler, "child", "child-turn");

      handler.handleServerRequest(commandApprovalRequest(51, "child", "child-turn", "shared-command"));
      handler.resolveApproval(51, "decline");
      handler.handleServerRequest(commandApprovalRequest(52, "thread-active", "turn-active", "shared-command"));

      expect(respondToServerRequest).toHaveBeenNthCalledWith(1, 51, { decision: "decline" });
      expect(respondToServerRequest).toHaveBeenNthCalledWith(2, 52, { decision: "decline" });
      expect(handler.currentState().requests.approvals).toEqual([]);
      expect(chatStateThreadStreamItems(handler.currentState()).filter((item) => item.kind === "approvalResult")).toHaveLength(1);
    });

    it("settles the UI once and retries only an undelivered approval copy", () => {
      const respondToServerRequest = vi
        .fn<(requestId: string | number, response: unknown) => boolean>()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      const handler = handlerForState(activeRunningState(), { respondToServerRequest });
      trackDirectSubagent(handler, "child", "child-turn");
      handler.handleServerRequest(commandApprovalRequest(51, "child", "child-turn", "shared-command"));
      handler.handleServerRequest(commandApprovalRequest(52, "thread-active", "turn-active", "shared-command"));

      handler.resolveApproval(51, "accept");

      expect(handler.currentState().requests.approvals).toEqual([]);
      expect(chatStateThreadStreamItems(handler.currentState()).filter((item) => item.kind === "approvalResult")).toHaveLength(1);

      handler.handleNotification({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          tokenUsage: {
            total: {
              inputTokens: 1,
              cachedInputTokens: 0,
              cacheWriteInputTokens: 0,
              outputTokens: 1,
              reasoningOutputTokens: 0,
              totalTokens: 2,
            },
            last: {
              inputTokens: 1,
              cachedInputTokens: 0,
              cacheWriteInputTokens: 0,
              outputTokens: 1,
              reasoningOutputTokens: 0,
              totalTokens: 2,
            },
            modelContextWindow: 100,
          },
        },
      } satisfies Extract<ServerNotification, { method: "thread/tokenUsage/updated" }>);

      expect(respondToServerRequest.mock.calls.map(([requestId]) => requestId)).toEqual([51, 52, 52]);
      expect(chatStateThreadStreamItems(handler.currentState()).filter((item) => item.kind === "approvalResult")).toHaveLength(1);
    });

    it("waits for both parent and child request-resolved notifications before clearing the approval", () => {
      const handler = handlerForState(activeRunningState());
      trackDirectSubagent(handler, "child", "child-turn");
      handler.handleServerRequest(commandApprovalRequest(51, "child", "child-turn", "shared-command"));
      handler.handleServerRequest(commandApprovalRequest(52, "thread-active", "turn-active", "shared-command"));

      handler.handleNotification({
        method: "serverRequest/resolved",
        params: { threadId: "child", requestId: 51 },
      } satisfies Extract<ServerNotification, { method: "serverRequest/resolved" }>);
      expect(handler.currentState().requests.approvals).toHaveLength(1);

      handler.handleNotification({
        method: "serverRequest/resolved",
        params: { threadId: "thread-active", requestId: 52 },
      } satisfies Extract<ServerNotification, { method: "serverRequest/resolved" }>);

      expect(handler.currentState().requests.approvals).toEqual([]);
      expect(chatStateThreadStreamItems(handler.currentState()).filter((item) => item.kind === "approvalResult")).toEqual([]);
    });

    it("does not carry delayed child activity into the parent turn that follows", () => {
      const handler = handlerForState(activeRunningState());
      trackDirectSubagent(handler, "child", "child-turn");
      handler.handleServerRequest(commandApprovalRequest(51, "child", "child-turn", "shared-command"));

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
            items: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);
      expect(handler.currentState().requests.approvals).toEqual([]);
      handler.handleNotification({
        method: "turn/started",
        params: {
          threadId: "thread-active",
          turn: {
            id: "next-turn",
            status: "inProgress",
            startedAt: 3,
            completedAt: null,
            durationMs: null,
            error: null,
            itemsView: "full",
            items: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/started" }>);
      handler.handleNotification({
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "child",
          turnId: "child-turn",
          itemId: "late-child-reasoning",
          summaryIndex: 0,
          delta: "stale child activity",
        },
      } satisfies Extract<ServerNotification, { method: "item/reasoning/summaryTextDelta" }>);

      expect(handler.currentState().activeTurn.lifecycle).toEqual({ kind: "running", turnId: "next-turn" });
      expect(handler.currentState().activeTurn.subagents.byThreadId).toEqual(new Map());
    });

    it("keeps different command approval callbacks separate", () => {
      const handler = handlerForState(activeRunningState());
      trackDirectSubagent(handler, "child", "child-turn");

      handler.handleServerRequest(commandApprovalRequest(51, "child", "child-turn", "shared-command", "child-callback"));
      handler.handleServerRequest(commandApprovalRequest(52, "thread-active", "turn-active", "shared-command", "parent-callback"));

      expect(handler.currentState().requests.approvals).toHaveLength(2);
    });

    it("rejects delayed turn-scoped server requests after the active thread returns to idle", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, { activeTurn: { lifecycle: { kind: "idle" } } });
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
          isBlocking: true,
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
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([
        expect.objectContaining({ kind: "system", text: "Could not send user input because Codex app-server is not connected." }),
      ]);
    });

    it.each([
      {
        name: "approval response",
        actions: { respondToServerRequest: vi.fn(() => false) },
        exercise(handler: TestChatInboundHandler) {
          handler.handleServerRequest(expectPresent(supportedApprovalRequests()[2]));
          handler.resolveApproval(12, "decline");
        },
        expectedMessages: ["Could not send approval response because Codex app-server is not connected."],
        pending(handler: TestChatInboundHandler) {
          return handler.currentState().requests.approvals.length;
        },
      },
      {
        name: "user-input cancellation",
        actions: { rejectServerRequest: vi.fn(() => false) },
        exercise(handler: TestChatInboundHandler) {
          handler.handleServerRequest(userInputRequest(56));
          handler.cancelUserInput(56);
        },
        expectedMessages: ["Could not cancel user input because Codex app-server is not connected."],
        pending(handler: TestChatInboundHandler) {
          return handler.currentState().requests.pendingUserInputs.length;
        },
      },
      {
        name: "MCP response",
        actions: { respondToServerRequest: vi.fn(() => false) },
        exercise(handler: TestChatInboundHandler) {
          handler.handleServerRequest(mcpElicitationRequest(57));
          handler.resolveMcpElicitation(57, "cancel");
        },
        expectedMessages: ["Could not send MCP request response because Codex app-server is not connected."],
        pending(handler: TestChatInboundHandler) {
          return handler.currentState().requests.pendingMcpElicitations.length;
        },
      },
      {
        name: "current-time response",
        actions: { respondToServerRequest: vi.fn(() => false) },
        exercise(handler: TestChatInboundHandler) {
          handler.handleServerRequest(currentTimeRequest(58, "thread"));
        },
        expectedMessages: ["Could not send current time because Codex app-server is not connected."],
        pending: null,
      },
      {
        name: "unsupported-request rejection",
        actions: { rejectServerRequest: vi.fn(() => false) },
        exercise(handler: TestChatInboundHandler) {
          handler.handleServerRequest(unsupportedToolCallRequest(59));
        },
        expectedMessages: [
          "Rejected unsupported app-server request: item/tool/call",
          "Could not reject app-server request because Codex app-server is not connected.",
        ],
        pending: null,
      },
    ])("reports failed $name delivery without resolving pending actions", ({ actions, exercise, expectedMessages, pending }) => {
      const handler = handlerForState(chatStateFixture(), actions);

      exercise(handler);

      if (pending) expect(pending(handler)).toBe(1);
      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => ("text" in item ? item.text : ""))).toEqual(expectedMessages);
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
                isBlocking: true,
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
                turnId: null,
                serverName: "github",
                mode: "form",
                message: "Need input",
                fields: [
                  {
                    id: "title",
                    title: "Title",
                    description: null,
                    type: "string",
                    required: true,
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
    it("keeps user-visible app-server notices in the thread stream", () => {
      const state = chatStateFixture();
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "warning",
        params: { threadId: null, message: "careful" },
      } satisfies Extract<ServerNotification, { method: "warning" }>);

      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([
        expect.objectContaining({
          kind: "system",
          text: 'warning: {\n  "threadId": null,\n  "message": "careful"\n}',
        }),
      ]);
    });

    it("keeps Windows world-writable warnings in the thread stream", () => {
      const handler = handlerForState(chatStateFixture());

      handler.handleNotification({
        method: "windows/worldWritableWarning",
        params: { samplePaths: ["C:\\tmp\\open"], extraCount: 2, failedScan: false },
      } satisfies Extract<ServerNotification, { method: "windows/worldWritableWarning" }>);

      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([
        expect.objectContaining({
          kind: "system",
          text: expect.stringContaining("windows/worldWritableWarning"),
        }),
      ]);
      expect(chatStateThreadStreamItems(handler.currentState())[0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining("open"),
        }),
      );
    });

    it("keeps failed Windows sandbox setup notices in the thread stream", () => {
      const handler = handlerForState(chatStateFixture());

      handler.handleNotification({
        method: "windowsSandbox/setupCompleted",
        params: { mode: "unelevated", success: false, error: "setup failed" },
      } satisfies Extract<ServerNotification, { method: "windowsSandbox/setupCompleted" }>);

      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([
        expect.objectContaining({
          kind: "system",
          text: expect.stringContaining("windowsSandbox/setupCompleted"),
        }),
      ]);
      expect(chatStateThreadStreamItems(handler.currentState())[0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining("setup failed"),
        }),
      );
    });

    it("suppresses successful Windows sandbox setup notices", () => {
      const handler = handlerForState(chatStateFixture());

      handler.handleNotification({
        method: "windowsSandbox/setupCompleted",
        params: { mode: "unelevated", success: true, error: null },
      } satisfies Extract<ServerNotification, { method: "windowsSandbox/setupCompleted" }>);

      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
    });

    it("routes active-thread archive notifications to the shared catalog without clearing the panel", () => {
      const state = chatStateWith(chatStateFixture(), { activeThread: { id: "thread-active" } });
      const applyThreadFact = vi.fn();
      const handler = handlerForState(state, { applyThreadFact });

      handler.handleNotification({
        method: "thread/archived",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/archived" }>);

      expect(activeThreadState(handler.currentState())?.id).toBe("thread-active");
      expect(applyThreadFact).toHaveBeenCalledWith({
        type: "thread-archived",
        threadId: "thread-active",
      } satisfies ThreadCatalogEvent);
    });

    it("records deleted thread notifications in the active catalog", () => {
      const applyThreadFact = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadFact });

      handler.handleNotification({
        method: "thread/deleted",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/deleted" }>);

      expect(applyThreadFact).toHaveBeenCalledWith({
        type: "thread-deleted",
        threadId: "thread-active",
      } satisfies ThreadCatalogEvent);
    });

    it("routes unarchived thread notifications through the catalog instead of refreshing in the handler", () => {
      const applyThreadFact = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadFact });

      handler.handleNotification({
        method: "thread/unarchived",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/unarchived" }>);

      expect(applyThreadFact).toHaveBeenCalledWith({
        type: "thread-unarchived",
        threadId: "thread-active",
      } satisfies ThreadCatalogEvent);
    });

    it("leaves interactive thread-started catalog publication to the command result", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      const applyThreadFact = vi.fn();
      const handler = handlerForState(state, { applyThreadFact });

      handler.handleNotification({
        method: "thread/started",
        params: { thread: appServerThread("thread-other", "/workspace/other") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(applyThreadFact).not.toHaveBeenCalled();
    });

    it("leaves interactive fork publication to the command response", () => {
      const applyThreadFact = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadFact });

      handler.handleNotification({
        method: "thread/started",
        params: { thread: { ...appServerThread("thread-forked", "/workspace"), forkedFromId: "thread-source" } },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(applyThreadFact).not.toHaveBeenCalled();
    });

    it("does not project an active thread-started notification into panel or catalog state", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      const applyThreadFact = vi.fn();
      const handler = handlerForState(state, { applyThreadFact });

      handler.handleNotification({
        method: "thread/started",
        params: { thread: appServerThread("thread-active", "/workspace/active") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(activeThreadState(handler.currentState())).not.toHaveProperty("cwd");
      expect(applyThreadFact).not.toHaveBeenCalled();
    });

    it("keeps ephemeral thread-started notifications out of the shared catalog and an empty panel", () => {
      const applyThreadFact = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadFact });

      handler.handleNotification({
        method: "thread/started",
        params: { thread: { ...appServerThread("side", "/workspace/active"), ephemeral: true } },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(handler.currentState().panelThread).toEqual({ kind: "empty" });
      expect(applyThreadFact).not.toHaveBeenCalled();
    });

    it("keeps subagent thread-started notifications out of the shared catalog", () => {
      const applyThreadFact = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadFact });
      const child = appServerThread("child", "/workspace/active");

      handler.handleNotification({
        method: "thread/started",
        params: {
          thread: {
            ...child,
            parentThreadId: "parent",
            source: {
              subAgent: {
                thread_spawn: {
                  parent_thread_id: "parent",
                  depth: 1,
                  agent_path: null,
                  agent_nickname: "Scout",
                  agent_role: "explorer",
                },
              },
            },
            agentNickname: "Scout",
            agentRole: "explorer",
          },
        },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(applyThreadFact).not.toHaveBeenCalled();
    });

    it("tracks direct subagent activity without admitting unrelated inactive notifications", () => {
      const handler = handlerForState(activeRunningState());

      handler.handleNotification({
        method: "thread/started",
        params: { thread: directSubagentThread("child", "thread-active") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);
      handler.handleNotification({
        method: "turn/started",
        params: {
          threadId: "child",
          turn: {
            id: "child-turn",
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
      handler.handleNotification({
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "child",
          turnId: "child-turn",
          itemId: "child-reasoning",
          summaryIndex: 0,
          delta: "Inspecting notification routing",
        },
      } satisfies Extract<ServerNotification, { method: "item/reasoning/summaryTextDelta" }>);
      handler.handleNotification({
        method: "item/started",
        params: {
          threadId: "child",
          turnId: "child-turn",
          startedAtMs: 1,
          item: {
            type: "userMessage",
            id: "child-user",
            clientId: "child-client",
            content: [{ type: "text", text: "child prompt", text_elements: [] }],
          },
        },
      } satisfies Extract<ServerNotification, { method: "item/started" }>);
      handler.handleNotification({
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "unrelated",
          turnId: "other-turn",
          itemId: "other-reasoning",
          summaryIndex: 0,
          delta: "Should stay hidden",
        },
      } satisfies Extract<ServerNotification, { method: "item/reasoning/summaryTextDelta" }>);

      expect(handler.currentState().activeTurn.subagents.byThreadId.get("child")).toMatchObject({
        childTurnId: "child-turn",
        latestItem: {
          id: "child-reasoning",
          kind: "reasoning",
          text: "reasoning: Inspecting notification routing",
        },
      });
      expect(handler.currentState().activeTurn.subagents.byThreadId.has("unrelated")).toBe(false);

      handler.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "child",
          turn: {
            id: "child-turn",
            status: "interrupted",
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
            error: null,
            itemsView: "full",
            items: [],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(handler.currentState().activeTurn.subagents.byThreadId.get("child")).toMatchObject({
        liveness: "stopped",
        outcome: null,
      });
    });

    it("does not track a nested subagent as direct parent activity", () => {
      const handler = handlerForState(activeRunningState());

      handler.handleNotification({
        method: "thread/started",
        params: { thread: directSubagentThread("grandchild", "child") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(handler.currentState().activeTurn.subagents.byThreadId.size).toBe(0);
    });

    it("preserves a started v2 child activity and its canonical path", () => {
      const handler = handlerForState(activeRunningState());

      handler.handleNotification({
        method: "item/started",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          startedAtMs: 1,
          item: {
            type: "subAgentActivity",
            id: "subagent-started",
            kind: "started",
            agentThreadId: "child",
            agentPath: "child",
          },
        },
      } satisfies Extract<ServerNotification, { method: "item/started" }>);

      expect(handler.currentState().activeTurn.subagents.byThreadId.get("child")).toMatchObject({
        threadId: "child",
        agentLabel: "child",
        liveness: "running",
        outcome: null,
        latestItem: null,
      });
      expect(chatStateThreadStreamItems(handler.currentState())).toMatchObject([
        {
          id: "subagent-activity:subagent-started",
          kind: "agent",
          action: "spawn",
          coordinationUpdate: "started",
          targets: [{ threadId: "child", label: "child" }],
        },
      ]);
    });

    it("preserves an interrupted v2 activity as stopped without inventing a failure", () => {
      const handler = handlerForState(activeRunningState());

      handler.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          completedAtMs: 2,
          item: {
            type: "subAgentActivity",
            id: "subagent-interrupted",
            kind: "interrupted",
            agentThreadId: "child",
            agentPath: "child",
          },
        },
      } satisfies Extract<ServerNotification, { method: "item/completed" }>);

      expect(handler.currentState().activeTurn.subagents.byThreadId.get("child")).toMatchObject({
        threadId: "child",
        agentLabel: "child",
        liveness: "stopped",
        outcome: null,
      });
      expect(chatStateThreadStreamItems(handler.currentState())).toMatchObject([
        {
          id: "subagent-activity:subagent-interrupted",
          kind: "agent",
          action: "interrupt",
          coordinationUpdate: "interrupted",
        },
      ]);
      expect(chatStateThreadStreamItems(handler.currentState())[0]).not.toHaveProperty("executionState");
    });

    it("moves a pending steer into canonical order when its user message starts", () => {
      let state = chatReducer(activeRunningState(), {
        type: "thread-stream/pending-steer-added",
        item: {
          id: "local-steer",
          clientId: "local-steer",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "follow up",
          turnId: "turn-active",
        },
      });
      state = withChatStateStableThreadStreamItems(state, [
        {
          id: "assistant",
          kind: "dialogue",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
          role: "assistant",
          text: "working",
          turnId: "turn-active",
        },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
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
      } satisfies Extract<ServerNotification, { method: "item/started" }>);

      expect(handler.currentState().activeTurn.pendingSteers).toEqual([]);
      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["assistant", "server-steer"]);
    });

    it("keeps an observed steer canonical when the normal completion summary arrives", () => {
      let state = chatReducer(activeRunningState(), {
        type: "thread-stream/pending-steer-added",
        item: {
          id: "local-steer-1",
          clientId: "local-steer-1",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "steer",
          turnId: "turn-active",
        },
      });
      state = withChatStateStableThreadStreamItems(state, [
        { id: "local-user-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "start", turnId: "turn-active" },
        {
          id: "a1",
          sourceItemId: "a1",
          kind: "dialogue",
          role: "assistant",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
          text: "first partial",
          turnId: "turn-active",
        },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "item/started",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          startedAtMs: 1,
          item: {
            type: "userMessage",
            id: "server-steer",
            clientId: "local-steer-1",
            content: [{ type: "text", text: "steer", text_elements: [] }],
          },
        },
      } satisfies Extract<ServerNotification, { method: "item/started" }>);
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
            itemsView: "summary",
            items: [{ type: "agentMessage", id: "a2", text: "second done", phase: "final_answer", memoryCitation: null }],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(handler.currentState().activeTurn.pendingSteers).toEqual([]);
      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual([
        "local-user-1",
        "a1",
        "server-steer",
        "a2",
      ]);
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "local-user-1", text: "start" }),
          expect.objectContaining({ id: "a1", text: "first partial" }),
          expect.objectContaining({ id: "server-steer", clientId: "local-steer-1", text: "steer" }),
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
        params: {
          threadId: "thread-active",
          turn: turn as unknown as Extract<ServerNotification, { method: "turn/completed" }>["params"]["turn"],
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(maybeNameThread).toHaveBeenCalledWith("thread-active", "turn-active", {
        userText: "hello",
        assistantText: "done",
      });
    });

    it("routes thread name notifications through catalog events", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      const applyThreadFact = vi.fn();
      const handler = handlerForState(state, { applyThreadFact });

      handler.handleNotification({
        method: "thread/name/updated",
        params: { threadId: "thread-active", threadName: "  Codex   Panel自動命名  " },
      } satisfies Extract<ServerNotification, { method: "thread/name/updated" }>);

      expect(state).not.toHaveProperty("threadList");
      expect(applyThreadFact).toHaveBeenCalledWith({
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

      expect(activeThreadState(handler.currentState())).not.toHaveProperty("cwd");
      expect(handler.currentState().runtime.active.model).toBe("gpt-5.5");
      expect(handler.currentState().runtime.active.serviceTier).toBe("fast");
      expect(handler.currentState().runtime.active.approvalsReviewer).toBe("auto_review");
      expect(handler.currentState().runtime.active.approvalPolicy).toBe("on-request");
      expect(handler.currentState().runtime.active.sandboxPolicy).toEqual({ type: "readOnly", networkAccess: false });
      expect(handler.currentState().runtime.active.activePermissionProfile).toBeNull();
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
    });

    it("ignores settings notifications for inactive threads", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, { runtime: { active: { model: "gpt-active" } } });
      state = chatStateWith(state, { runtime: { active: { serviceTier: "flex" } } });
      state = chatStateWith(state, { runtime: { active: { approvalsReviewer: "user" } } });
      state = chatStateWith(state, { runtime: { active: { approvalPolicy: "on-request" } } });
      state = chatStateWith(state, { runtime: { active: { sandboxPolicy: { type: "readOnly", networkAccess: false } } } });
      state = chatStateWith(state, { runtime: { active: { activePermissionProfile: null } } });
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

      expect(handler.currentState().runtime.active.model).toBe("gpt-active");
      expect(handler.currentState().runtime.active.serviceTier).toBe("flex");
      expect(handler.currentState().runtime.active.approvalsReviewer).toBe("user");
      expect(handler.currentState().runtime.active.approvalPolicy).toBe("on-request");
      expect(handler.currentState().runtime.active.sandboxPolicy).toEqual({ type: "readOnly", networkAccess: false });
      expect(handler.currentState().runtime.active.activePermissionProfile).toBeNull();
    });

    it("syncs null service tier from settings notifications", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, { runtime: { active: { serviceTier: "flex" } } });
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

      expect(handler.currentState().runtime.active.serviceTier).toBeNull();
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

      expect(activeThreadState(handler.currentState())?.goal).toEqual(goal);
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "goal",
        text: "set: Finish",
        objective: "Finish",
      });

      const afterSetMessageCount = chatStateThreadStreamItems(handler.currentState()).length;
      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(chatStateThreadStreamItems(handler.currentState())).toHaveLength(afterSetMessageCount);

      const updatedGoal = { ...goal, objective: "Finish well", updatedAt: 2 };
      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: updatedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
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
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
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
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "goal",
        text: "resumed: Finish well",
        objective: "Finish well",
      });

      const messageCount = chatStateThreadStreamItems(handler.currentState()).length;
      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: { ...resumedGoal, tokensUsed: 10, timeUsedSeconds: 20 } },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(chatStateThreadStreamItems(handler.currentState())).toHaveLength(messageCount);

      handler.handleNotification({
        method: "thread/goal/cleared",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/goal/cleared" }>);

      expect(activeThreadState(handler.currentState())?.goal).toBeNull();
      expect(chatStateThreadStreamItems(handler.currentState()).at(-1)).toMatchObject({
        kind: "goal",
        text: "cleared: Finish well",
        objective: "Finish well",
      });
    });

    it("observes authoritative goal notifications even for an inactive thread", () => {
      const observeThreadGoal = vi.fn();
      const handler = handlerForState(activeRunningState(), { observeThreadGoal });
      const goal = {
        threadId: "thread-inactive",
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
        params: { threadId: "thread-inactive", turnId: null, goal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      handler.handleNotification({
        method: "thread/goal/cleared",
        params: { threadId: "thread-inactive" },
      } satisfies Extract<ServerNotification, { method: "thread/goal/cleared" }>);

      expect(observeThreadGoal).toHaveBeenNthCalledWith(1, "thread-inactive");
      expect(observeThreadGoal).toHaveBeenNthCalledWith(2, "thread-inactive");
    });

    it("adds a goal fact when a goal completes", () => {
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

      expect(activeThreadState(handler.currentState())?.goal).toEqual(completedGoal);
      expect(chatStateThreadStreamItems(handler.currentState())).toHaveLength(1);
      expect(chatStateThreadStreamItems(handler.currentState())[0]).toMatchObject({
        kind: "goal",
        text: "completed: Finish",
        objective: "Finish",
      });

      handler.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: "turn-1", goal: { ...completedGoal, tokensUsed: 43 } },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);

      expect(chatStateThreadStreamItems(handler.currentState())).toHaveLength(1);
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

      expect(chatStateThreadStreamItems(handler.currentState())).toMatchObject([
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

      expect(chatStateThreadStreamItems(handler.currentState())).toHaveLength(1);
      expect(chatStateThreadStreamItems(handler.currentState())[0]).toMatchObject({
        id: "review-review-1",
        kind: "reviewResult",
        text: "Auto-review approved: npm test",
        executionState: "completed",
      });
      const reviewItem = expectPresent(chatStateThreadStreamItems(handler.currentState())[0]);
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

      expect(chatStateThreadStreamItems(handler.currentState())).toHaveLength(1);
      expect(chatStateThreadStreamItems(handler.currentState())[0]).toMatchObject({
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

      expect(chatStateThreadStreamItems(handler.currentState())).toHaveLength(1);
      expect(chatStateThreadStreamItems(handler.currentState())[0]).toMatchObject({ id: "review-review-1" });
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
      isBlocking: true,
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

function commandApprovalRequest(
  id: number,
  threadId: string,
  turnId: string,
  itemId: string,
  approvalId: string | null = null,
): ServerRequest {
  return {
    id,
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm test",
      cwd: "/tmp/project",
      threadId,
      turnId,
      itemId,
      approvalId,
      environmentId: null,
      startedAtMs: 1,
      reason: null,
      commandActions: [],
      proposedExecpolicyAmendment: null,
      proposedNetworkPolicyAmendments: [],
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    },
  };
}

function trackDirectSubagent(handler: TestChatInboundHandler, threadId: string, turnId: string): void {
  handler.handleNotification({
    method: "thread/started",
    params: { thread: directSubagentThread(threadId, "thread-active") },
  } satisfies Extract<ServerNotification, { method: "thread/started" }>);
  handler.handleNotification({
    method: "turn/started",
    params: {
      threadId,
      turn: {
        id: turnId,
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
}

function appServerThread(id: string, cwd: string): ThreadStartedNotification["params"]["thread"] {
  return {
    id,
    extra: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    recencyAt: null,
    section: null,
    sectionEnteredAt: null,
    status: { type: "active", activeFlags: [] },
    path: null,
    cwd,
    cliVersion: "codex",
    source: "unknown",
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

function directSubagentThread(id: string, parentThreadId: string): ThreadStartedNotification["params"]["thread"] {
  return {
    ...appServerThread(id, "/workspace/active"),
    parentThreadId,
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: parentThreadId,
          depth: 1,
          agent_path: null,
          agent_nickname: "Scout",
          agent_role: "explorer",
        },
      },
    },
    agentNickname: "Scout",
    agentRole: "explorer",
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

function currentTimeRequest(id: number, threadId: string): ServerRequest {
  return {
    id,
    method: "currentTime/read",
    params: { threadId },
  };
}

function unsupportedToolCallRequest(id: number): ServerRequest {
  return {
    id,
    method: "item/tool/call",
    params: { threadId: "thread", turnId: "turn", callId: "call", namespace: null, tool: "tool", arguments: {} },
  };
}

function unknownRequest(): ServerRequest {
  return {
    id: 27,
    method: "appServer/newFutureRequest",
    params: { secret: "do-not-render" },
  } as unknown as ServerRequest;
}
