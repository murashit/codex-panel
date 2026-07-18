import { describe, expect, it, vi } from "vitest";
import type { ServerNotification, ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { appServerApprovalRequest, appServerUserInputRequest } from "../../../../../src/app-server/protocol/server-requests";
import type { TurnRecord } from "../../../../../src/app-server/protocol/turn";
import type { Thread as PanelThread } from "../../../../../src/domain/threads/model";
import {
  type ChatInboundHandler,
  type ChatInboundHandlerActions,
  createChatInboundHandler,
} from "../../../../../src/features/chat/app-server/inbound/handler";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import {
  activeThreadState,
  type ChatAction,
  type ChatState,
  chatReducer,
} from "../../../../../src/features/chat/application/state/root-reducer";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { pendingTurnStart } from "../../../../../src/features/chat/application/turns/turn-state";
import type { ThreadCatalogEvent } from "../../../../../src/features/threads/catalog/thread-catalog";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems, withChatStateThreadStreamItems } from "../../support/thread-stream";

type ThreadStartedNotification = Extract<ServerNotification, { method: "thread/started" }>;
const TEST_APP_SERVER_CONTEXT = { codexPath: "codex", vaultPath: "/vault", generation: 1 } as const;

type TestChatInboundHandler = Omit<ChatInboundHandler, "handleNotification"> & {
  handleNotification(notification: ServerNotification): void;
  currentState(): ChatState;
};

function handlerForState(state = chatStateFixture(), actions: Partial<ChatInboundHandlerActions> = {}): TestChatInboundHandler {
  const store = testStoreForState(state);
  const handler = createChatInboundHandler(
    store,
    {
      refreshActiveThreads: vi.fn(),
      refreshServerDiagnostics: vi.fn(),
      applyAppServerResourceEvent: vi.fn(),
      maybeNameThread: vi.fn(),
      applyThreadCatalogEvent: vi.fn(),
      respondToServerRequest: vi.fn(() => true),
      rejectServerRequest: vi.fn(() => true),
      ...actions,
    },
    createLocalIdSource({ nowMs: () => 1, seed: "test" }),
  );
  return Object.assign(
    {
      ...handler,
      handleNotification: (notification: ServerNotification) => {
        handler.handleNotification(notification, TEST_APP_SERVER_CONTEXT);
      },
    },
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

      expect(chatStateThreadStreamItems(handler.currentState())).toMatchObject([{ id: "a1", text: "hello" }]);
    });

    it("marks active reasoning completed when assistant text starts", () => {
      let state = activeRunningState();
      state = withChatStateThreadStreamItems(state, [
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
    it("routes skill changes through the app-server resource event boundary", () => {
      const applyAppServerResourceEvent = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyAppServerResourceEvent });

      handler.handleNotification({
        method: "skills/changed",
        params: {},
      } satisfies Extract<ServerNotification, { method: "skills/changed" }>);

      expect(applyAppServerResourceEvent).toHaveBeenCalledWith({ type: "skills-changed" });
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
        turn: {
          lifecycle: {
            kind: "starting",
            pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] },
          },
        },
      });
      state = withChatStateThreadStreamItems(state, [
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

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(chatStateThreadStreamItems(handler.currentState())[1]).toMatchObject({ id: "hook-hook-1-1", turnId: "turn-active" });
      expect(pendingTurnStart(handler.currentState())).toBeNull();
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith(
        {
          type: "thread-touched",
          threadId: "thread-active",
          recencyAt: 1,
        } satisfies ThreadCatalogEvent,
        TEST_APP_SERVER_CONTEXT,
      );
      expect(refreshActiveThreads).not.toHaveBeenCalled();
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

      expect(expectPresent(chatStateThreadStreamItems(handler.currentState())[0])).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(expectPresent(chatStateThreadStreamItems(handler.currentState())[0]).turnId).toBeUndefined();
      expect(expectPresent(pendingTurnStart(handler.currentState())).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);
    });

    it("keeps pre-turn prompt submit hooks through turn start and completed-turn reconciliation", () => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread-active" } });
      state = chatStateWith(state, {
        turn: { lifecycle: { kind: "starting", pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] } } },
      });
      state = withChatStateThreadStreamItems(state, [
        { id: "local-user-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "hello" },
      ]);
      const handler = handlerForState(state);

      handler.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: null, run: promptSubmitHookRun("hook-1", 1n) },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(expectPresent(chatStateThreadStreamItems(handler.currentState())[1]).turnId).toBeUndefined();
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

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(chatStateThreadStreamItems(handler.currentState()).find((item) => item.id === "local-user-1")).not.toHaveProperty("turnId");
      expect(chatStateThreadStreamItems(handler.currentState()).find((item) => item.id === "hook-hook-1-1")).toMatchObject({
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
        turn: {
          lifecycle: {
            kind: "starting",
            pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] },
          },
        },
      });
      state = withChatStateThreadStreamItems(state, [
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
      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
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
      expect(applyAppServerResourceEvent).toHaveBeenCalledWith({ type: "rate-limits-updated" });
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
          failureReason: null,
        },
      } satisfies Extract<ServerNotification, { method: "mcpServer/startupStatus/updated" }>);

      expect(applyAppServerResourceEvent).toHaveBeenCalledWith({
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

      expect(refreshServerDiagnostics).toHaveBeenCalledWith({ forceResourceProbes: false });
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual([]);
    });

    it("refreshes resource probes after MCP OAuth login completes", () => {
      const refreshServerDiagnostics = vi.fn();
      const handler = handlerForState(chatStateFixture(), { refreshServerDiagnostics });

      handler.handleNotification({
        method: "mcpServer/oauthLogin/completed",
        params: { name: "github", threadId: null, success: true },
      } satisfies Extract<ServerNotification, { method: "mcpServer/oauthLogin/completed" }>);

      expect(refreshServerDiagnostics).toHaveBeenCalledWith({ forceResourceProbes: true });
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
        turn: { lifecycle: { kind: "running", turnId: "turn-active" } },
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
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(state, { applyThreadCatalogEvent });

      handler.handleNotification({
        method: "thread/archived",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/archived" }>);

      expect(activeThreadState(handler.currentState())?.id).toBe("thread-active");
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith(
        {
          type: "thread-archived",
          threadId: "thread-active",
        } satisfies ThreadCatalogEvent,
        TEST_APP_SERVER_CONTEXT,
      );
    });

    it("records deleted thread notifications in the active catalog", () => {
      const applyThreadCatalogEvent = vi.fn();
      const refreshActiveThreads = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadCatalogEvent, refreshActiveThreads });

      handler.handleNotification({
        method: "thread/deleted",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/deleted" }>);

      expect(applyThreadCatalogEvent).toHaveBeenCalledWith(
        {
          type: "thread-deleted",
          threadId: "thread-active",
        } satisfies ThreadCatalogEvent,
        TEST_APP_SERVER_CONTEXT,
      );
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

      expect(applyThreadCatalogEvent).toHaveBeenCalledWith(
        {
          type: "thread-unarchived",
          threadId: "thread-active",
        } satisfies ThreadCatalogEvent,
        TEST_APP_SERVER_CONTEXT,
      );
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

      expect(activeThreadState(handler.currentState())?.cwd).toBe("/workspace/active");
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith(
        {
          type: "thread-started",
          thread: expect.objectContaining({ id: "thread-other" }),
        },
        TEST_APP_SERVER_CONTEXT,
      );
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

      expect(activeThreadState(handler.currentState())?.cwd).toBe("/workspace/active");
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith(
        {
          type: "thread-started",
          thread: expect.objectContaining({ id: "thread-active" }),
        },
        TEST_APP_SERVER_CONTEXT,
      );
    });

    it("keeps ephemeral thread-started notifications out of the shared catalog and an empty panel", () => {
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadCatalogEvent });

      handler.handleNotification({
        method: "thread/started",
        params: { thread: { ...appServerThread("side", "/workspace/active"), ephemeral: true } },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(handler.currentState().panelThread).toEqual({ kind: "empty" });
      expect(applyThreadCatalogEvent).not.toHaveBeenCalled();
    });

    it("keeps subagent thread-started notifications out of the shared catalog", () => {
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(chatStateFixture(), { applyThreadCatalogEvent });
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

      expect(applyThreadCatalogEvent).not.toHaveBeenCalled();
    });

    it("reconciles optimistic user echoes by client id before falling back to same-turn text only when client ids are absent", () => {
      let state = activeRunningState();
      state = withChatStateThreadStreamItems(state, [
        { id: "local-user-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "same text", turnId: "turn-active" },
        { id: "local-steer-2", kind: "dialogue", dialogueKind: "user", role: "user", text: "same text", turnId: "turn-active" },
        { id: "local-user-2", kind: "dialogue", dialogueKind: "user", role: "user", text: "same text", turnId: "turn-other" },
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

      expect(chatStateThreadStreamItems(handler.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", clientId: "local-user-1", text: "same text" }),
          expect.objectContaining({ id: "local-steer-2", text: "same text" }),
          expect.objectContaining({ id: "local-user-2", text: "same text" }),
        ]),
      );
      expect(chatStateThreadStreamItems(handler.currentState()).some((item) => item.id === "local-user-1")).toBe(false);

      let fallbackStateWithoutClientId = chatStateFixture();
      fallbackStateWithoutClientId = chatStateWith(fallbackStateWithoutClientId, { activeThread: { id: "thread-active" } });
      fallbackStateWithoutClientId = chatStateWith(fallbackStateWithoutClientId, {
        turn: { lifecycle: { kind: "running", turnId: "turn-active" } },
      });
      fallbackStateWithoutClientId = withChatStateThreadStreamItems(fallbackStateWithoutClientId, [
        {
          id: "local-user-without-client-id",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "fallback text",
          turnId: "turn-active",
        },
        {
          id: "local-user-other-turn",
          kind: "dialogue",
          dialogueKind: "user",
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

      expect(chatStateThreadStreamItems(fallbackHandlerWithoutClientId.currentState())).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "server-u1", text: "fallback text" }),
          expect.objectContaining({ id: "local-user-other-turn", text: "fallback text" }),
        ]),
      );
      expect(
        chatStateThreadStreamItems(fallbackHandlerWithoutClientId.currentState()).some(
          (item) => item.id === "local-user-without-client-id",
        ),
      ).toBe(false);
    });

    it("keeps the observed steer message order when completed turns reconcile by client id", () => {
      let state = activeRunningState();
      state = withChatStateThreadStreamItems(state, [
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
        { id: "local-steer-1", kind: "dialogue", dialogueKind: "user", role: "user", text: "steer", turnId: "turn-active" },
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

      expect(chatStateThreadStreamItems(handler.currentState()).map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2"]);
      expect(chatStateThreadStreamItems(handler.currentState())).toEqual(
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
      state = chatStateWith(state, { threadList: { listedThreads: [panelThread("thread-active")] } });
      const applyThreadCatalogEvent = vi.fn();
      const handler = handlerForState(state, { applyThreadCatalogEvent });

      handler.handleNotification({
        method: "thread/name/updated",
        params: { threadId: "thread-active", threadName: "  Codex   Panel自動命名  " },
      } satisfies Extract<ServerNotification, { method: "thread/name/updated" }>);

      expect(state.threadList.listedThreads[0]?.name).toBeNull();
      expect(applyThreadCatalogEvent).toHaveBeenCalledWith(
        {
          type: "thread-renamed",
          threadId: "thread-active",
          name: "Codex Panel自動命名",
        } satisfies ThreadCatalogEvent,
        TEST_APP_SERVER_CONTEXT,
      );
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

      expect(activeThreadState(handler.currentState())?.cwd).toBe("/workspace/active");
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
      state = chatStateWith(state, { activeThread: { cwd: "/workspace/active" } });
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

      expect(activeThreadState(handler.currentState())?.cwd).toBe("/workspace/active");
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
    provenance: { kind: "interactive" },
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
