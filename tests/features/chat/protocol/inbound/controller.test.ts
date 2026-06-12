import { describe, expect, it, vi } from "vitest";

import { ChatInboundController } from "../../../../../src/features/chat/protocol/inbound/controller";
import { attachHookRunsToTurn } from "../../../../../src/features/chat/state/transcript-updates";
import {
  activeTurnId,
  chatReducer,
  chatTurnBusy,
  createChatState,
  pendingTurnStart,
  type ChatAction,
  type ChatState,
  type ChatStateStore,
} from "../../../../../src/features/chat/state/reducer";
import type { ServerNotification, ServerRequest } from "../../../../../src/app-server/types";
import type { AppServerThread } from "../../../../../src/app-server/thread-model";
import type { Thread as PanelThread } from "../../../../../src/domain/threads/model";
import type { AppServerTurn } from "../../../../../src/app-server/turn-model";

function controllerForState(
  state = createChatState(),
  actions: Partial<ConstructorParameters<typeof ChatInboundController>[1]> = {},
): ChatInboundController {
  return new ChatInboundController(testStoreForState(state), {
    refreshThreads: vi.fn(),
    refreshRateLimits: vi.fn(),
    refreshSkills: vi.fn(),
    publishAppServerMetadata: vi.fn(),
    maybeNameThread: vi.fn(),
    notifyThreadArchived: vi.fn(),
    notifyThreadRenamed: vi.fn(),
    recordMcpStartupStatus: vi.fn(),
    respondToServerRequest: vi.fn(() => true),
    rejectServerRequest: vi.fn(() => true),
    ...actions,
  });
}

function testStoreForState(state: ChatState): ChatStateStore {
  let current = state;
  return {
    getState: () => current,
    dispatch(action: ChatAction) {
      current = chatReducer(current, action);
      Object.assign(state, current);
      return current;
    },
    subscribe: () => () => undefined,
  };
}

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("ChatInboundController", () => {
  describe("active turn routing", () => {
    it("applies matching streaming deltas as assistant markdown", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "hello" },
      } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

      expect(state.transcript.displayItems).toMatchObject([{ id: "a1", text: "hello" }]);
    });

    it("marks active reasoning completed when assistant text starts", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      state.transcript.displayItems = [{ id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "turn-active" }];
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "answer" },
      } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

      expect(state.transcript.displayItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "r1", kind: "reasoning", status: "completed", executionState: "completed" }),
          expect.objectContaining({ id: "a1", kind: "message", text: "answer" }),
        ]),
      );
    });

    it("streams plan deltas as plain assistant text until completion", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "item/plan/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "p1", delta: "<proposed_plan>\n# Plan" },
      } satisfies Extract<ServerNotification, { method: "item/plan/delta" }>);

      expect(state.transcript.displayItems).toMatchObject([
        { id: "p1", kind: "message", messageKind: "proposedPlan", role: "assistant", text: "# Plan", messageState: "streaming" },
      ]);
    });

    it("marks streamed plan deltas completed when the completed turn reconciles", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "item/plan/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "p1", delta: "<proposed_plan>\n# Plan" },
      } satisfies Extract<ServerNotification, { method: "item/plan/delta" }>);

      controller.handleNotification({
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

      expect(state.transcript.displayItems).toEqual([
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
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "turn/plan/updated",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          explanation: "Plan",
          plan: [{ step: "Inspect code", status: "inProgress" }],
        },
      } satisfies Extract<ServerNotification, { method: "turn/plan/updated" }>);

      expect(state.transcript.displayItems).toMatchObject([
        {
          id: "plan-progress-turn-active",
          kind: "taskProgress",
          text: "Plan\n[>] Inspect code",
          steps: [{ step: "Inspect code", status: "inProgress" }],
          status: "inProgress",
        },
      ]);
    });
  });

  describe("app-server source of truth updates", () => {
    it("refreshes skills from disk when app-server reports skill changes", () => {
      const refreshSkills = vi.fn();
      const controller = controllerForState(createChatState(), { refreshSkills });

      controller.handleNotification({
        method: "skills/changed",
        params: {},
      } satisfies Extract<ServerNotification, { method: "skills/changed" }>);

      expect(refreshSkills).toHaveBeenCalledWith(true);
    });

    it("stores the latest aggregated turn diff for the active turn", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-active", diff: "@@\n-old\n+first" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);
      controller.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-active", diff: "@@\n-old\n+second" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);

      expect(state.transcript.turnDiffs.get("turn-active")).toBe("@@\n-old\n+second");
    });

    it("ignores aggregated turn diffs outside the active scope", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-other", turnId: "turn-active", diff: "@@\n-wrong\n+wrong" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);
      controller.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-other", diff: "@@\n-wrong\n+wrong" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);

      expect(state.transcript.turnDiffs.size).toBe(0);
    });

    it("formats hook runs as compact summaries with details", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(state.transcript.displayItems).toMatchObject([
        {
          id: "hook-hook-1-1",
          kind: "hook",
          text: "postToolUse: Formatted 1 file.",
          toolLabel: "hook",
          status: "completed",
          output: "",
          details: [
            {
              rows: [
                { key: "status", value: "completed" },
                { key: "event", value: "postToolUse" },
                { key: "message", value: "Formatted 1 file." },
                { key: "duration", value: "1ms" },
              ],
            },
            { title: "Hook output", body: "feedback: ok" },
          ],
        },
      ]);
    });

    it("omits hook duration details while duration is unavailable", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(state.transcript.displayItems[0]).toMatchObject({
        kind: "hook",
        details: [
          {
            rows: [
              { key: "status", value: "completed" },
              { key: "event", value: "postToolUse" },
            ],
          },
        ],
      });
    });

    it("attaches unscoped hook runs to the active turn while streaming", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(state.transcript.displayItems[0]).toMatchObject({ id: "hook-hook-1-1", kind: "hook", turnId: "turn-active" });
    });

    it("leaves non-prompt unscoped hook runs outside the active turn", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(state.transcript.displayItems[0]).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(state.transcript.displayItems[0]?.turnId).toBeUndefined();
    });

    it("keeps repeated hook runs with the same run id as separate display items", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);
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

      controller.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: "turn-active", run: { ...baseRun, startedAt: 1n } },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);
      controller.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: "turn-active", run: { ...baseRun, startedAt: 3n } },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(state.transcript.displayItems.map((item) => item.id)).toEqual(["hook-hook-1-1", "hook-hook-1-3"]);
    });

    it("attaches pre-turn prompt submit hook runs when the turn starts", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = {
        kind: "starting",
        pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] },
      };
      state.transcript.displayItems = [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello" },
        {
          id: "hook-hook-1-1",
          kind: "hook",
          role: "tool",
          text: "userPromptSubmit: Saving jj baseline",
          toolLabel: "hook",
          status: "completed",
        },
      ];
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(state.transcript.displayItems.map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(state.transcript.displayItems[1]).toMatchObject({ id: "hook-hook-1-1", turnId: "turn-active" });
      expect(pendingTurnStart(state)).toBeNull();
    });

    it("moves pre-turn hook runs after the optimistic user message when a turn id is assigned", () => {
      const items = attachHookRunsToTurn(
        [
          {
            id: "hook-old-1",
            kind: "hook",
            role: "tool",
            text: "userPromptSubmit: Stale hook",
            toolLabel: "hook",
            status: "completed",
          },
          {
            id: "hook-hook-1-1",
            kind: "hook",
            role: "tool",
            text: "userPromptSubmit: Saving jj baseline",
            toolLabel: "hook",
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
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "starting", pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] } };
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(expectPresent(state.transcript.displayItems[0])).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(expectPresent(state.transcript.displayItems[0]).turnId).toBeUndefined();
      expect(expectPresent(pendingTurnStart(state)).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);
    });

    it("keeps pre-turn prompt submit hooks through turn start and completed-turn reconciliation", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "starting", pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] } };
      state.transcript.displayItems = [{ id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello" }];
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: null, run: promptSubmitHookRun("hook-1", 1n) },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(state.transcript.displayItems.map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(expectPresent(state.transcript.displayItems[1]).turnId).toBeUndefined();
      expect(expectPresent(pendingTurnStart(state)).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);

      controller.handleNotification({
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

      expect(state.transcript.displayItems.map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(state.transcript.displayItems.find((item) => item.id === "local-user-1")).not.toHaveProperty("turnId");
      expect(state.transcript.displayItems.find((item) => item.id === "hook-hook-1-1")).toMatchObject({ turnId: "turn-active" });
      expect(pendingTurnStart(state)).toBeNull();

      controller.handleNotification({
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

      expect(state.transcript.displayItems.map((item) => item.id)).toEqual(["u1", "hook-hook-1-1", "a1"]);
      expect(state.transcript.displayItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", text: "hello", turnId: "turn-active" }),
          expect.objectContaining({ id: "hook-hook-1-1", kind: "hook", turnId: "turn-active" }),
          expect.objectContaining({ id: "a1", text: "done", turnId: "turn-active" }),
        ]),
      );
      expect(state.transcript.displayItems.some((item) => item.id === "local-user-1")).toBe(false);
    });

    it("ignores completed turn notifications while a new turn is still starting", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = {
        kind: "starting",
        pendingTurnStart: { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] },
      };
      state.transcript.displayItems = [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "hello" },
        {
          id: "hook-hook-1-1",
          kind: "hook",
          role: "tool",
          text: "userPromptSubmit: Saving jj baseline",
          toolLabel: "hook",
          status: "completed",
        },
      ];
      const maybeNameThread = vi.fn();
      const refreshThreads = vi.fn();
      const controller = controllerForState(state, { maybeNameThread, refreshThreads });

      controller.handleNotification({
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

      expect(pendingTurnStart(state)).toEqual({ anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] });
      expect(state.transcript.displayItems.map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(maybeNameThread).not.toHaveBeenCalled();
      expect(refreshThreads).not.toHaveBeenCalled();
    });

    it("refreshes account rate limits after sparse update notifications", () => {
      const state = createChatState();
      const refreshRateLimits = vi.fn();
      const controller = controllerForState(state, { refreshRateLimits });

      controller.handleNotification({
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
      expect(refreshRateLimits).toHaveBeenCalledOnce();
    });

    it("records MCP startup status for diagnostics without a chat system message", () => {
      const state = createChatState();
      const recordMcpStartupStatus = vi.fn();
      const publishAppServerMetadata = vi.fn();
      const controller = controllerForState(state, { recordMcpStartupStatus, publishAppServerMetadata });

      controller.handleNotification({
        method: "mcpServer/startupStatus/updated",
        params: {
          threadId: null,
          name: "github",
          status: "failed",
          error: "missing token",
        },
      } satisfies Extract<ServerNotification, { method: "mcpServer/startupStatus/updated" }>);

      expect(recordMcpStartupStatus).toHaveBeenCalledWith("github", "failed", "missing token");
      expect(publishAppServerMetadata).toHaveBeenCalledOnce();
      expect(state.transcript.displayItems).toEqual([]);
    });
  });

  describe("interactive server requests", () => {
    it("queues and resolves requestUserInput server requests", () => {
      const state = createChatState();
      const respondToServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { respondToServerRequest });

      controller.handleServerRequest({
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
        },
      });

      expect(state.requests.pendingUserInputs).toHaveLength(1);
      controller.resolveUserInput(expectPresent(state.requests.pendingUserInputs[0]), { scope: "Narrow" });
      expect(respondToServerRequest).toHaveBeenCalledWith(42, { answers: { scope: { answers: ["Narrow"] } } });
      expect(state.requests.pendingUserInputs).toEqual([]);
      expect(state.transcript.displayItems.at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "Input submitted for 1 question.",
        turnId: "turn-active",
        details: [{ title: "Question: Scope", rows: expect.arrayContaining([{ key: "Answer", value: "Narrow" }]) }],
      });
    });

    it("rejects cancelled requestUserInput server requests", () => {
      const state = createChatState();
      const rejectServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { rejectServerRequest });

      controller.handleServerRequest({
        id: 43,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-active",
          turnId: "turn-active",
          itemId: "input-1",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
        },
      });

      controller.cancelUserInput(expectPresent(state.requests.pendingUserInputs[0]));
      expect(rejectServerRequest).toHaveBeenCalledWith(43, -32000, "User cancelled input request.");
      expect(state.requests.pendingUserInputs).toEqual([]);
      expect(state.transcript.displayItems.at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "Input request cancelled for 1 question.",
        turnId: "turn-active",
      });
    });

    it("ignores stale requestUserInput objects with a reused request id", () => {
      const state = createChatState();
      const respondToServerRequest = vi.fn(() => true);
      const rejectServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { respondToServerRequest, rejectServerRequest });

      controller.handleServerRequest(userInputRequest(44));
      const current = expectPresent(state.requests.pendingUserInputs[0]);
      const stale = { ...current };

      controller.resolveUserInput(stale, { note: "stale" });
      controller.cancelUserInput(stale);

      expect(respondToServerRequest).not.toHaveBeenCalled();
      expect(rejectServerRequest).not.toHaveBeenCalled();
      expect(state.requests.pendingUserInputs).toEqual([current]);
      expect(state.transcript.displayItems).toEqual([]);
    });

    it("records manual permission approvals as colored result items", () => {
      const state = createChatState();
      const respondToServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { respondToServerRequest });

      controller.handleServerRequest(expectPresent(supportedApprovalRequests()[2]));
      controller.resolveApproval(expectPresent(state.requests.approvals[0]), "accept-session");

      expect(respondToServerRequest).toHaveBeenCalledWith(12, {
        scope: "session",
        permissions: {},
      });
      expect(state.requests.approvals).toEqual([]);
      expect(state.transcript.displayItems.at(-1)).toMatchObject({
        id: "approval-12",
        kind: "approvalResult",
        role: "tool",
        text: "Allowed for this session: Need access",
        turnId: "turn",
        executionState: "completed",
        details: [
          {
            title: "Approval",
            rows: expect.arrayContaining([
              { key: "status", value: "allowed for session" },
              { key: "scope", value: "session" },
              { key: "request", value: "Permission approval" },
              { key: "cwd", value: "/tmp/project" },
            ]),
          },
        ],
      });
    });

    it("ignores stale approval objects with a reused request id", () => {
      const state = createChatState();
      const respondToServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { respondToServerRequest });

      controller.handleServerRequest(expectPresent(supportedApprovalRequests()[2]));
      const current = expectPresent(state.requests.approvals[0]);
      const stale = { ...current };

      controller.resolveApproval(stale, "accept-session");

      expect(respondToServerRequest).not.toHaveBeenCalled();
      expect(state.requests.approvals).toEqual([current]);
      expect(state.transcript.displayItems).toEqual([]);
    });

    it("handles known server request families and rejects unsupported requests by default", () => {
      const state = createChatState();
      const rejectServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { rejectServerRequest });

      for (const request of supportedApprovalRequests()) {
        controller.handleServerRequest(request);
      }
      controller.handleServerRequest(userInputRequest(20));
      const unsupported = unsupportedRequests();
      for (const request of unsupported) {
        controller.handleServerRequest(request);
      }
      controller.handleServerRequest(unknownRequest());

      expect(state.requests.approvals.map((approval) => approval.requestId)).toEqual([10, 11, 12]);
      expect(state.requests.pendingUserInputs.map((input) => input.requestId)).toEqual([20]);
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
      expect(state.transcript.displayItems.map((item) => item.text)).toEqual(unsupportedMessages);
      expect(state.transcript.displayItems.map((item) => item.text).join("\n")).not.toContain("do-not-render");
    });

    it("keeps unknown server request fallback out of the normal transcript", () => {
      const state = createChatState();
      const rejectServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { rejectServerRequest });

      controller.handleServerRequest(unknownRequest());

      expect(rejectServerRequest).toHaveBeenCalledWith(27, -32601, "Rejected unknown app-server request: appServer/newFutureRequest");
      expect(state.transcript.displayItems).toEqual([]);
    });

    it("rejects server requests scoped to a different active thread or turn", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const rejectServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { rejectServerRequest });

      controller.handleServerRequest({
        id: 51,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-other",
          turnId: "turn-active",
          itemId: "input",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
        },
      });
      controller.handleServerRequest({
        id: 52,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-active",
          turnId: "turn-other",
          itemId: "input",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
        },
      });

      expect(state.requests.pendingUserInputs).toEqual([]);
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
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "idle" };
      const rejectServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { rejectServerRequest });

      controller.handleServerRequest({
        id: 53,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-active",
          turnId: "turn-stale",
          itemId: "input",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
        },
      });

      expect(state.requests.pendingUserInputs).toEqual([]);
      expect(rejectServerRequest).toHaveBeenCalledWith(53, -32601, "Rejected inactive app-server request: item/tool/requestUserInput");
    });

    it("keeps pending requests when response delivery fails", () => {
      const state = createChatState();
      const respondToServerRequest = vi.fn(() => false);
      const controller = controllerForState(state, { respondToServerRequest });

      controller.handleServerRequest(userInputRequest(55));
      controller.resolveUserInput(expectPresent(state.requests.pendingUserInputs[0]), { note: "Later" });

      expect(state.requests.pendingUserInputs).toHaveLength(1);
      expect(state.transcript.displayItems).toEqual([
        expect.objectContaining({ kind: "system", text: "Could not send user input because Codex app-server is not connected." }),
      ]);
    });

    it("clears pending request state when app-server resolves a request", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.requests.approvals = [
        {
          requestId: 50,
          method: "item/commandExecution/requestApproval",
          params: {
            ...expectPresent(supportedApprovalRequests()[0]).params,
            threadId: "thread-active",
          } as Extract<ServerRequest, { method: "item/commandExecution/requestApproval" }>["params"],
        },
      ];
      state.requests.pendingUserInputs = [
        {
          requestId: 50,
          method: "item/tool/requestUserInput",
          params: {
            threadId: "thread-active",
            turnId: "turn-active",
            itemId: "input",
            questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
          },
        },
      ];
      state.requests.userInputDrafts = new Map([["50:note", "draft"]]);
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "serverRequest/resolved",
        params: { threadId: "thread-active", requestId: 50 },
      } satisfies Extract<ServerNotification, { method: "serverRequest/resolved" }>);

      expect(state.requests.approvals).toEqual([]);
      expect(state.requests.pendingUserInputs).toEqual([]);
      expect(state.requests.userInputDrafts.size).toBe(0);
    });
  });

  describe("thread lifecycle and reconciliation", () => {
    it("keeps user-visible app-server notices in the message stream", () => {
      const state = createChatState();
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "warning",
        params: { threadId: null, message: "careful" },
      } satisfies Extract<ServerNotification, { method: "warning" }>);

      expect(state.transcript.displayItems).toEqual([
        expect.objectContaining({
          kind: "system",
          text: 'warning: {\n  "threadId": null,\n  "message": "careful"\n}',
        }),
      ]);
    });

    it("clears all active-thread scoped state when the active thread is archived", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      state.runtime.activeModel = "gpt-5.5";
      state.runtime.activeServiceTier = "fast";
      state.activeThread.tokenUsage = {
        last: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3 },
        total: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3 },
        modelContextWindow: 100,
      };
      state.transcript.historyCursor = "cursor";
      state.transcript.loadingHistory = true;
      state.transcript.displayItems = [
        { id: "message", kind: "message", role: "assistant", text: "stale", messageKind: "assistantResponse", messageState: "completed" },
      ];
      state.transcript.turnDiffs = new Map([["turn-active", "@@\n-stale\n+stale"]]);
      state.composer.draft = "thread draft";
      state.requests.approvals = [
        {
          requestId: 10,
          method: "item/commandExecution/requestApproval",
          params: expectPresent(supportedApprovalRequests()[0]).params as Extract<
            ServerRequest,
            { method: "item/commandExecution/requestApproval" }
          >["params"],
        },
      ];
      state.requests.pendingUserInputs = [
        {
          requestId: 20,
          method: "item/tool/requestUserInput",
          params: {
            threadId: "thread-active",
            turnId: "turn-active",
            itemId: "input",
            questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
          },
        },
      ];
      state.requests.userInputDrafts = new Map([["20:note", "draft"]]);
      const notifyThreadArchived = vi.fn();
      const controller = controllerForState(state, { notifyThreadArchived });

      controller.handleNotification({
        method: "thread/archived",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/archived" }>);

      expect(state.activeThread.id).toBeNull();
      expect(activeTurnId(state)).toBeNull();
      expect(state.runtime.activeModel).toBeNull();
      expect(state.runtime.activeServiceTier).toBeNull();
      expect(state.activeThread.tokenUsage).toBeNull();
      expect(state.transcript.historyCursor).toBeNull();
      expect(state.transcript.loadingHistory).toBe(false);
      expect(state.transcript.displayItems).toEqual([]);
      expect(state.transcript.turnDiffs.size).toBe(0);
      expect(state.composer.draft).toBe("");
      expect(chatTurnBusy(state)).toBe(false);
      expect(state.requests.approvals).toEqual([]);
      expect(state.requests.pendingUserInputs).toEqual([]);
      expect(state.requests.userInputDrafts.size).toBe(0);
      expect(notifyThreadArchived).toHaveBeenCalledWith("thread-active");
    });

    it("does not replace the active cwd from unrelated thread-started notifications", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.activeThread.cwd = "/workspace/active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "thread/started",
        params: { thread: appServerThread("thread-other", "/workspace/other") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(state.activeThread.cwd).toBe("/workspace/active");
    });

    it("records cwd from active thread-started notifications", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "thread/started",
        params: { thread: appServerThread("thread-active", "/workspace/active") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(state.activeThread.cwd).toBe("/workspace/active");
    });

    it("replaces optimistic user echoes when completed turns are reconciled", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      state.transcript.displayItems = [
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
      ];
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(state.transcript.displayItems.filter((item) => item.kind === "message" && item.role === "user")).toEqual([
        expect.objectContaining({ id: "u1", text: "hello" }),
      ]);
      expect(state.transcript.displayItems).toEqual(expect.arrayContaining([expect.objectContaining({ id: "a1", text: "done" })]));
      expect(state.transcript.displayItems.some((item) => item.id === "local-user-1")).toBe(false);
    });

    it("reconciles optimistic user echoes by client id before falling back to text only when client ids are absent", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      state.transcript.displayItems = [
        { id: "local-user-1", kind: "message", messageKind: "user", role: "user", text: "same text", turnId: "turn-active" },
        { id: "local-steer-2", kind: "message", messageKind: "user", role: "user", text: "same text", turnId: "turn-active" },
        { id: "local-user-2", kind: "message", messageKind: "user", role: "user", text: "same text", turnId: "turn-other" },
      ];
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(state.transcript.displayItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", clientId: "local-user-1", text: "same text" }),
          expect.objectContaining({ id: "local-steer-2", text: "same text" }),
          expect.objectContaining({ id: "local-user-2", text: "same text" }),
        ]),
      );
      expect(state.transcript.displayItems.some((item) => item.id === "local-user-1")).toBe(false);

      const fallbackStateWithoutClientId = createChatState();
      fallbackStateWithoutClientId.activeThread.id = "thread-active";
      fallbackStateWithoutClientId.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      fallbackStateWithoutClientId.transcript.displayItems = [
        {
          id: "local-user-without-client-id",
          kind: "message",
          messageKind: "user",
          role: "user",
          text: "fallback text",
          turnId: "turn-active",
        },
      ];
      const fallbackControllerWithoutClientId = controllerForState(fallbackStateWithoutClientId);

      fallbackControllerWithoutClientId.handleNotification({
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

      expect(fallbackStateWithoutClientId.transcript.displayItems).toEqual([
        expect.objectContaining({ id: "server-u1", text: "fallback text" }),
      ]);
      expect(fallbackStateWithoutClientId.transcript.displayItems.some((item) => item.id === "local-user-without-client-id")).toBe(false);
    });

    it("keeps the observed steer message order when completed turns reconcile by client id", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      state.transcript.displayItems = [
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
      ];
      const controller = controllerForState(state);

      controller.handleNotification({
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

      expect(state.transcript.displayItems.map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2"]);
      expect(state.transcript.displayItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", clientId: "local-user-1", text: "start" }),
          expect.objectContaining({ id: "a1", text: "first done" }),
          expect.objectContaining({ id: "u2", clientId: "local-steer-1", text: "steer" }),
          expect.objectContaining({ id: "a2", text: "second done" }),
        ]),
      );
    });

    it("asks the view to auto-name completed turns", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const maybeNameThread = vi.fn();
      const controller = controllerForState(state, { maybeNameThread });
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
      } satisfies AppServerTurn;

      controller.handleNotification({
        method: "turn/completed",
        params: { threadId: "thread-active", turn },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(maybeNameThread).toHaveBeenCalledWith("thread-active", "turn-active", {
        userText: "hello",
        assistantText: "done",
      });
    });

    it("updates listed thread names from thread name notifications", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.threadList.listedThreads = [panelThread("thread-active")];
      const notifyThreadRenamed = vi.fn();
      const controller = controllerForState(state, { notifyThreadRenamed });

      controller.handleNotification({
        method: "thread/name/updated",
        params: { threadId: "thread-active", threadName: "Codex Panel自動命名" },
      } satisfies Extract<ServerNotification, { method: "thread/name/updated" }>);

      expect(state.threadList.listedThreads[0]?.name).toBe("Codex Panel自動命名");
      expect(notifyThreadRenamed).toHaveBeenCalledWith("thread-active", "Codex Panel自動命名");
    });

    it("syncs active runtime state from thread settings notifications", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "thread/settings/updated",
        params: {
          threadId: "thread-active",
          threadSettings: {
            cwd: "/workspace/active",
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            activePermissionProfile: null,
            model: "gpt-5.5",
            modelProvider: "openai",
            serviceTier: "fast",
            effort: "high",
            summary: null,
            collaborationMode: {
              mode: "default",
              settings: { model: "gpt-5.5", reasoning_effort: "high", developer_instructions: null },
            },
            personality: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "thread/settings/updated" }>);

      expect(state.activeThread.cwd).toBe("/workspace/active");
      expect(state.runtime.activeModel).toBe("gpt-5.5");
      expect(state.runtime.activeServiceTier).toBe("fast");
      expect(state.runtime.activeApprovalPolicy).toBe("on-request");
      expect(state.runtime.activeApprovalsReviewer).toBe("auto_review");
      expect(state.runtime.activePermissionProfile).toBeNull();
      expect(state.transcript.displayItems).toEqual([]);
    });

    it("ignores settings notifications for inactive threads", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.activeThread.cwd = "/workspace/active";
      state.runtime.activeModel = "gpt-active";
      state.runtime.activeServiceTier = "flex";
      state.runtime.activeApprovalPolicy = "on-request";
      state.runtime.activeApprovalsReviewer = "user";
      state.runtime.activePermissionProfile = { id: ":workspace", extends: null };
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "thread/settings/updated",
        params: {
          threadId: "thread-other",
          threadSettings: {
            cwd: "/workspace/other",
            approvalPolicy: "never",
            approvalsReviewer: "auto_review",
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            activePermissionProfile: { id: ":read-only", extends: null },
            model: "gpt-other",
            modelProvider: "openai",
            serviceTier: "fast",
            effort: "high",
            summary: null,
            collaborationMode: {
              mode: "plan",
              settings: { model: "gpt-other", reasoning_effort: "high", developer_instructions: null },
            },
            personality: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "thread/settings/updated" }>);

      expect(state.activeThread.cwd).toBe("/workspace/active");
      expect(state.runtime.activeModel).toBe("gpt-active");
      expect(state.runtime.activeServiceTier).toBe("flex");
      expect(state.runtime.activeApprovalPolicy).toBe("on-request");
      expect(state.runtime.activeApprovalsReviewer).toBe("user");
      expect(state.runtime.activePermissionProfile).toEqual({ id: ":workspace", extends: null });
    });

    it("syncs null service tier from settings notifications", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.runtime.activeServiceTier = "flex";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "thread/settings/updated",
        params: {
          threadId: "thread-active",
          threadSettings: {
            cwd: "/workspace/active",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            activePermissionProfile: null,
            model: "gpt-5.5",
            modelProvider: "openai",
            serviceTier: null,
            effort: "high",
            summary: null,
            collaborationMode: {
              mode: "default",
              settings: { model: "gpt-5.5", reasoning_effort: "high", developer_instructions: null },
            },
            personality: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "thread/settings/updated" }>);

      expect(state.runtime.activeServiceTier).toBeNull();
    });

    it("adds goal events for goal state changes from notifications", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      const controller = controllerForState(state);
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

      controller.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);

      expect(state.activeThread.goal).toEqual(goal);
      expect(state.transcript.displayItems.at(-1)).toMatchObject({ kind: "goal", text: "set: Finish", objective: "Finish" });

      const afterSetMessageCount = state.transcript.displayItems.length;
      controller.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(state.transcript.displayItems).toHaveLength(afterSetMessageCount);

      const updatedGoal = { ...goal, objective: "Finish well", updatedAt: 2 };
      controller.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: updatedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(state.transcript.displayItems.at(-1)).toMatchObject({ kind: "goal", text: "updated: Finish well", objective: "Finish well" });

      const pausedGoal = { ...updatedGoal, status: "paused", updatedAt: 3 } satisfies Extract<
        ServerNotification,
        { method: "thread/goal/updated" }
      >["params"]["goal"];
      controller.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: pausedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(state.transcript.displayItems.at(-1)).toMatchObject({ kind: "goal", text: "paused: Finish well", objective: "Finish well" });

      const resumedGoal = { ...pausedGoal, status: "active", updatedAt: 4 } satisfies Extract<
        ServerNotification,
        { method: "thread/goal/updated" }
      >["params"]["goal"];
      controller.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: resumedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(state.transcript.displayItems.at(-1)).toMatchObject({ kind: "goal", text: "resumed: Finish well", objective: "Finish well" });

      const messageCount = state.transcript.displayItems.length;
      controller.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: null, goal: { ...resumedGoal, tokensUsed: 10, timeUsedSeconds: 20 } },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(state.transcript.displayItems).toHaveLength(messageCount);

      controller.handleNotification({
        method: "thread/goal/cleared",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/goal/cleared" }>);

      expect(state.activeThread.goal).toBeNull();
      expect(state.transcript.displayItems.at(-1)).toMatchObject({ kind: "goal", text: "cleared: Finish well", objective: "Finish well" });
    });

    it("adds a goal event when a goal completes", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.activeThread.goal = {
        threadId: "thread-active",
        objective: "Finish",
        status: "active",
        tokenBudget: null,
        tokensUsed: 12,
        timeUsedSeconds: 60,
        createdAt: 1,
        updatedAt: 1,
      };
      const controller = controllerForState(state);
      const completedGoal = {
        ...state.activeThread.goal,
        status: "complete",
        tokensUsed: 42,
        timeUsedSeconds: 120,
        updatedAt: 2,
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>["params"]["goal"];

      controller.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: "turn-1", goal: completedGoal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);

      expect(state.activeThread.goal).toEqual(completedGoal);
      expect(state.transcript.displayItems).toHaveLength(1);
      expect(state.transcript.displayItems[0]).toMatchObject({ kind: "goal", text: "completed: Finish", objective: "Finish" });

      controller.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "thread-active", turnId: "turn-1", goal: { ...completedGoal, tokensUsed: 43 } },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);

      expect(state.transcript.displayItems).toHaveLength(1);
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

      const noActiveState = createChatState();
      const noActiveController = controllerForState(noActiveState);
      noActiveController.handleNotification({
        method: "thread/goal/updated",
        params: { threadId: "previous-thread", turnId: null, goal },
      } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
      expect(noActiveState.activeThread.goal).toBeNull();

      const otherThreadState = createChatState();
      otherThreadState.activeThread.id = "thread-active";
      otherThreadState.activeThread.goal = { ...goal, threadId: "thread-active", objective: "Current" };
      const otherThreadController = controllerForState(otherThreadState);
      otherThreadController.handleNotification({
        method: "thread/goal/cleared",
        params: { threadId: "previous-thread" },
      } satisfies Extract<ServerNotification, { method: "thread/goal/cleared" }>);
      expect(otherThreadState.activeThread.goal.objective).toBe("Current");
    });
  });

  describe("auto-review display", () => {
    it("renders guardian warnings as review results instead of system messages", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "guardianWarning",
        params: { threadId: "thread-active", message: "Auto-review denied this command." },
      } satisfies Extract<ServerNotification, { method: "guardianWarning" }>);

      expect(state.transcript.displayItems).toMatchObject([
        {
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review denied this command.",
        },
      ]);
    });

    it("renders auto approval review notifications as upserted review results", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
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
      controller.handleNotification({
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

      expect(state.transcript.displayItems).toHaveLength(1);
      expect(state.transcript.displayItems[0]).toMatchObject({
        id: "review-review-1",
        kind: "reviewResult",
        text: "Auto-review approved: npm test",
        executionState: "completed",
      });
      const reviewItem = expectPresent(state.transcript.displayItems[0]);
      expect("details" in reviewItem ? reviewItem.details[0] : null).toMatchObject({
        title: "Review",
        rows: expect.arrayContaining([{ key: "status", value: "approved" }]),
      });
    });

    it("replaces guardian auto-review warnings when structured auto-review notifications arrive", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "guardianWarning",
        params: { threadId: "thread-active", message: "Auto-review approved: npm test" },
      } satisfies Extract<ServerNotification, { method: "guardianWarning" }>);
      controller.handleNotification({
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

      expect(state.transcript.displayItems).toHaveLength(1);
      expect(state.transcript.displayItems[0]).toMatchObject({
        id: "review-review-1",
        kind: "reviewResult",
        text: "Auto-review approved: npm test",
        turnId: "turn-active",
      });
    });

    it("ignores guardian auto-review warnings after structured auto-review notifications", () => {
      const state = createChatState();
      state.activeThread.id = "thread-active";
      state.turn.lifecycle = { kind: "running", turnId: "turn-active" };
      const controller = controllerForState(state);

      controller.handleNotification({
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
      controller.handleNotification({
        method: "guardianWarning",
        params: { threadId: "thread-active", message: "Auto-review approved: npm test" },
      } satisfies Extract<ServerNotification, { method: "guardianWarning" }>);

      expect(state.transcript.displayItems).toHaveLength(1);
      expect(state.transcript.displayItems[0]).toMatchObject({ id: "review-review-1" });
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
    },
  };
}

function appServerThread(id: string, cwd: string): AppServerThread {
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
    status: { type: "active", activeFlags: [] },
    path: null,
    cwd,
    cliVersion: "codex",
    source: "appServer",
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
      id: 21,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread",
        turnId: "turn",
        serverName: "server",
        mode: "form",
        _meta: null,
        message: "Need input",
        requestedSchema: { type: "object", properties: {} },
      },
    },
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

function unknownRequest(): ServerRequest {
  return {
    id: 27,
    method: "appServer/newFutureRequest",
    params: { secret: "do-not-render" },
  } as unknown as ServerRequest;
}
