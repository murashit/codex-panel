import { describe, expect, it, vi } from "vitest";

import { PanelController } from "../../src/features/chat/controller";
import { attachHookRunsToTurn } from "../../src/features/chat/hook-display";
import { createPanelState } from "../../src/features/chat/state";
import type { ServerNotification } from "../../src/generated/app-server/ServerNotification";
import type { ServerRequest } from "../../src/generated/app-server/ServerRequest";
import type { Thread } from "../../src/generated/app-server/v2/Thread";
import type { Turn } from "../../src/generated/app-server/v2/Turn";

function controllerForState(
  state = createPanelState(),
  actions: Partial<ConstructorParameters<typeof PanelController>[1]> = {},
): PanelController {
  return new PanelController(state, {
    refreshThreads: vi.fn(),
    refreshSkills: vi.fn(),
    maybeNameThread: vi.fn(),
    recordMcpStartupStatus: vi.fn(),
    respondToServerRequest: vi.fn(() => true),
    rejectServerRequest: vi.fn(() => true),
    ...actions,
  });
}

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("PanelController", () => {
  describe("active turn routing", () => {
    it("applies matching streaming deltas as assistant markdown", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "hello" },
      } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

      expect(state.displayItems).toMatchObject([{ id: "a1", text: "hello", markdown: true }]);
    });

    it("marks active reasoning completed when assistant text starts", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      state.busy = true;
      state.displayItems = [{ id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "turn-active" }];
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "answer" },
      } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

      expect(state.displayItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "r1", kind: "reasoning", status: "completed", state: "completed" }),
          expect.objectContaining({ id: "a1", kind: "message", text: "answer" }),
        ]),
      );
    });

    it("streams plan deltas as plain assistant text until completion", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "item/plan/delta",
        params: { threadId: "thread-active", turnId: "turn-active", itemId: "p1", delta: "<proposed_plan>\n# Plan" },
      } satisfies Extract<ServerNotification, { method: "item/plan/delta" }>);

      expect(state.displayItems).toMatchObject([{ id: "p1", kind: "message", role: "assistant", text: "# Plan", markdown: false }]);
    });

    it("updates structured turn plan progress", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
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

      expect(state.displayItems).toMatchObject([
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
      const controller = controllerForState(createPanelState(), { refreshSkills });

      controller.handleNotification({
        method: "skills/changed",
        params: {},
      } satisfies Extract<ServerNotification, { method: "skills/changed" }>);

      expect(refreshSkills).toHaveBeenCalledWith(true);
    });

    it("stores the latest aggregated turn diff for the active turn", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-active", diff: "@@\n-old\n+first" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);
      controller.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-active", diff: "@@\n-old\n+second" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);

      expect(state.turnDiffs.get("turn-active")).toBe("@@\n-old\n+second");
    });

    it("ignores aggregated turn diffs outside the active scope", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-other", turnId: "turn-active", diff: "@@\n-wrong\n+wrong" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);
      controller.handleNotification({
        method: "turn/diff/updated",
        params: { threadId: "thread-active", turnId: "turn-other", diff: "@@\n-wrong\n+wrong" },
      } satisfies Extract<ServerNotification, { method: "turn/diff/updated" }>);

      expect(state.turnDiffs.size).toBe(0);
    });

    it("formats hook runs as compact summaries with details", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
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

      expect(state.displayItems).toMatchObject([
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
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
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

      expect(state.displayItems[0]).toMatchObject({
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
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      state.busy = true;
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

      expect(state.displayItems[0]).toMatchObject({ id: "hook-hook-1-1", kind: "hook", turnId: "turn-active" });
    });

    it("leaves non-prompt unscoped hook runs outside the active turn", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      state.busy = true;
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

      expect(state.displayItems[0]).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(state.displayItems[0]?.turnId).toBeUndefined();
    });

    it("keeps repeated hook runs with the same run id as separate display items", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
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

      expect(state.displayItems.map((item) => item.id)).toEqual(["hook-hook-1-1", "hook-hook-1-3"]);
    });

    it("attaches pre-turn prompt submit hook runs when the turn starts", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.pendingTurnStart = { anchorItemId: "local-user-1", promptSubmitHookItemIds: ["hook-hook-1-1"] };
      state.displayItems = [
        { id: "local-user-1", kind: "message", role: "user", text: "hello", markdown: true },
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

      expect(state.displayItems.map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(state.displayItems[1]).toMatchObject({ id: "hook-hook-1-1", turnId: "turn-active" });
      expect(state.pendingTurnStart).toBeNull();
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
          { id: "local-user-1", kind: "message", role: "user", text: "hello", markdown: true },
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
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.pendingTurnStart = { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] };
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

      expect(expectPresent(state.displayItems[0])).toMatchObject({ id: "hook-hook-1-1", kind: "hook" });
      expect(expectPresent(state.displayItems[0]).turnId).toBeUndefined();
      expect(expectPresent(state.pendingTurnStart).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);
    });

    it("keeps pre-turn prompt submit hooks through turn start and completed-turn reconciliation", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.pendingTurnStart = { anchorItemId: "local-user-1", promptSubmitHookItemIds: [] };
      state.displayItems = [{ id: "local-user-1", kind: "message", role: "user", text: "hello", markdown: true }];
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "hook/completed",
        params: { threadId: "thread-active", turnId: null, run: promptSubmitHookRun("hook-1", 1n) },
      } satisfies Extract<ServerNotification, { method: "hook/completed" }>);

      expect(state.displayItems.map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(expectPresent(state.displayItems[1]).turnId).toBeUndefined();
      expect(expectPresent(state.pendingTurnStart).promptSubmitHookItemIds).toEqual(["hook-hook-1-1"]);

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

      expect(state.displayItems.map((item) => item.id)).toEqual(["local-user-1", "hook-hook-1-1"]);
      expect(state.displayItems.find((item) => item.id === "local-user-1")).not.toHaveProperty("turnId");
      expect(state.displayItems.find((item) => item.id === "hook-hook-1-1")).toMatchObject({ turnId: "turn-active" });
      expect(state.pendingTurnStart).toBeNull();

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
              { type: "userMessage", id: "u1", content: [{ type: "text", text: "hello", text_elements: [] }] },
              { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
            ],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(state.displayItems.map((item) => item.id)).toEqual(["hook-hook-1-1", "u1", "a1"]);
      expect(state.displayItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "u1", text: "hello", turnId: "turn-active" }),
          expect.objectContaining({ id: "hook-hook-1-1", kind: "hook", turnId: "turn-active" }),
          expect.objectContaining({ id: "a1", text: "done", turnId: "turn-active" }),
        ]),
      );
      expect(state.displayItems.some((item) => item.id === "local-user-1")).toBe(false);
    });

    it("stores account rate limit updates outside thread scope", () => {
      const state = createPanelState();
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "account/rateLimits/updated",
        params: {
          rateLimits: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: null },
            secondary: null,
            credits: null,
            planType: null,
            rateLimitReachedType: null,
          },
        },
      } satisfies Extract<ServerNotification, { method: "account/rateLimits/updated" }>);

      expect(state.rateLimit).toMatchObject({
        limitId: "codex",
        primary: { usedPercent: 64 },
      });
    });

    it("records MCP startup status for diagnostics without a chat system message", () => {
      const state = createPanelState();
      const recordMcpStartupStatus = vi.fn();
      const controller = controllerForState(state, { recordMcpStartupStatus });

      controller.handleNotification({
        method: "mcpServer/startupStatus/updated",
        params: {
          name: "github",
          status: "failed",
          error: "missing token",
        },
      } satisfies Extract<ServerNotification, { method: "mcpServer/startupStatus/updated" }>);

      expect(recordMcpStartupStatus).toHaveBeenCalledWith("github", "failed", "missing token");
      expect(state.displayItems).toEqual([]);
    });
  });

  describe("interactive server requests", () => {
    it("queues and resolves requestUserInput server requests", () => {
      const state = createPanelState();
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

      expect(state.pendingUserInputs).toHaveLength(1);
      controller.resolveUserInput(expectPresent(state.pendingUserInputs[0]), { scope: "Narrow" });
      expect(respondToServerRequest).toHaveBeenCalledWith(42, { answers: { scope: { answers: ["Narrow"] } } });
      expect(state.pendingUserInputs).toEqual([]);
      expect(state.displayItems.at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "Input submitted for 1 question.",
        turnId: "turn-active",
        details: [{ title: "Scope", rows: expect.arrayContaining([{ key: "answer", value: "Narrow" }]) }],
      });
    });

    it("rejects cancelled requestUserInput server requests", () => {
      const state = createPanelState();
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

      controller.cancelUserInput(expectPresent(state.pendingUserInputs[0]));
      expect(rejectServerRequest).toHaveBeenCalledWith(43, -32000, "User cancelled input request.");
      expect(state.pendingUserInputs).toEqual([]);
      expect(state.displayItems.at(-1)).toMatchObject({
        kind: "userInputResult",
        role: "tool",
        text: "Input request cancelled for 1 question.",
        turnId: "turn-active",
      });
    });

    it("records manual permission approvals as colored result items", () => {
      const state = createPanelState();
      const respondToServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { respondToServerRequest });

      controller.handleServerRequest(expectPresent(supportedApprovalRequests()[2]));
      controller.resolveApproval(expectPresent(state.approvals[0]), "accept-session");

      expect(respondToServerRequest).toHaveBeenCalledWith(12, {
        scope: "session",
        permissions: {},
      });
      expect(state.approvals).toEqual([]);
      expect(state.displayItems.at(-1)).toMatchObject({
        id: "approval-12",
        kind: "approvalResult",
        role: "tool",
        text: "Allowed for this session: Need access",
        turnId: "turn",
        state: "completed",
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

    it("handles known server request families and rejects unsupported requests by default", () => {
      const state = createPanelState();
      const rejectServerRequest = vi.fn(() => true);
      const controller = controllerForState(state, { rejectServerRequest });

      for (const request of supportedApprovalRequests()) {
        controller.handleServerRequest(request);
      }
      controller.handleServerRequest(userInputRequest(20));
      for (const request of unsupportedRequests()) {
        controller.handleServerRequest(request);
      }

      expect(state.approvals.map((approval) => approval.requestId)).toEqual([10, 11, 12]);
      expect(state.pendingUserInputs.map((input) => input.requestId)).toEqual([20]);
      expect(rejectServerRequest).toHaveBeenCalledTimes(4);
      expect(rejectServerRequest).toHaveBeenNthCalledWith(
        1,
        21,
        -32601,
        "Rejected unsupported app-server request: mcpServer/elicitation/request",
      );
      expect(rejectServerRequest).toHaveBeenNthCalledWith(2, 22, -32601, "Rejected unsupported app-server request: item/tool/call");
      expect(rejectServerRequest).toHaveBeenNthCalledWith(
        3,
        23,
        -32601,
        "Rejected unsupported app-server request: account/chatgptAuthTokens/refresh",
      );
      expect(rejectServerRequest).toHaveBeenNthCalledWith(
        4,
        24,
        -32601,
        "Rejected unsupported app-server request: appServer/newFutureRequest",
      );
      expect(state.displayItems.map((item) => item.text)).toEqual([
        "Rejected unsupported app-server request: mcpServer/elicitation/request",
        "Rejected unsupported app-server request: item/tool/call",
        "Rejected unsupported app-server request: account/chatgptAuthTokens/refresh",
        "Rejected unsupported app-server request: appServer/newFutureRequest",
      ]);
      expect(state.displayItems.map((item) => item.text).join("\n")).not.toContain("do-not-render");
    });

    it("rejects server requests scoped to a different active thread or turn", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
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

      expect(state.pendingUserInputs).toEqual([]);
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

    it("keeps pending requests when response delivery fails", () => {
      const state = createPanelState();
      const respondToServerRequest = vi.fn(() => false);
      const controller = controllerForState(state, { respondToServerRequest });

      controller.handleServerRequest(userInputRequest(55));
      controller.resolveUserInput(expectPresent(state.pendingUserInputs[0]), { note: "Later" });

      expect(state.pendingUserInputs).toHaveLength(1);
      expect(state.displayItems).toEqual([
        expect.objectContaining({ kind: "system", text: "Could not send user input because Codex app-server is not connected." }),
      ]);
    });

    it("clears pending request state when app-server resolves a request", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.approvals = [
        {
          requestId: 50,
          method: "item/commandExecution/requestApproval",
          params: {
            ...expectPresent(supportedApprovalRequests()[0]).params,
            threadId: "thread-active",
          } as Extract<ServerRequest, { method: "item/commandExecution/requestApproval" }>["params"],
        },
      ];
      state.pendingUserInputs = [
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
      state.userInputDrafts.set("50:note", "draft");
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "serverRequest/resolved",
        params: { threadId: "thread-active", requestId: 50 },
      } satisfies Extract<ServerNotification, { method: "serverRequest/resolved" }>);

      expect(state.approvals).toEqual([]);
      expect(state.pendingUserInputs).toEqual([]);
      expect(state.userInputDrafts.size).toBe(0);
    });
  });

  describe("thread lifecycle and reconciliation", () => {
    it("keeps user-visible app-server notices in the message stream", () => {
      const state = createPanelState();
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "warning",
        params: { threadId: null, message: "careful" },
      } satisfies Extract<ServerNotification, { method: "warning" }>);

      expect(state.displayItems).toEqual([
        expect.objectContaining({
          kind: "system",
          text: 'warning: {\n  "threadId": null,\n  "message": "careful"\n}',
        }),
      ]);
    });

    it("clears all active-thread scoped state when the active thread is archived", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      state.activeModel = "gpt-5.5";
      state.activeServiceTier = "fast";
      state.activeThreadCliVersion = "codex-cli 1.0.0";
      state.tokenUsage = {
        last: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3 },
        total: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3 },
        modelContextWindow: 100,
      };
      state.historyCursor = "cursor";
      state.loadingHistory = true;
      state.displayItems = [{ id: "message", kind: "message", role: "assistant", text: "stale" }];
      state.turnDiffs.set("turn-active", "@@\n-stale\n+stale");
      state.composerDraft = "keep local draft";
      state.busy = true;
      state.approvals = [
        {
          requestId: 10,
          method: "item/commandExecution/requestApproval",
          params: expectPresent(supportedApprovalRequests()[0]).params as Extract<
            ServerRequest,
            { method: "item/commandExecution/requestApproval" }
          >["params"],
        },
      ];
      state.pendingUserInputs = [
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
      state.userInputDrafts.set("20:note", "draft");
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "thread/archived",
        params: { threadId: "thread-active" },
      } satisfies Extract<ServerNotification, { method: "thread/archived" }>);

      expect(state.activeThreadId).toBeNull();
      expect(state.activeTurnId).toBeNull();
      expect(state.activeModel).toBeNull();
      expect(state.activeServiceTier).toBeNull();
      expect(state.activeThreadCliVersion).toBeNull();
      expect(state.tokenUsage).toBeNull();
      expect(state.historyCursor).toBeNull();
      expect(state.loadingHistory).toBe(false);
      expect(state.displayItems).toEqual([]);
      expect(state.turnDiffs.size).toBe(0);
      expect(state.composerDraft).toBe("keep local draft");
      expect(state.busy).toBe(false);
      expect(state.approvals).toEqual([]);
      expect(state.pendingUserInputs).toEqual([]);
      expect(state.userInputDrafts.size).toBe(0);
    });

    it("does not replace the active cwd from unrelated thread-started notifications", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeThreadCwd = "/workspace/active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "thread/started",
        params: { thread: thread("thread-other", "/workspace/other") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(state.activeThreadCwd).toBe("/workspace/active");
    });

    it("records cwd from active thread-started notifications", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "thread/started",
        params: { thread: thread("thread-active", "/workspace/active") },
      } satisfies Extract<ServerNotification, { method: "thread/started" }>);

      expect(state.activeThreadCwd).toBe("/workspace/active");
    });

    it("replaces optimistic user echoes when completed turns are reconciled", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      state.displayItems = [
        { id: "local-user-1", kind: "message", role: "user", text: "hello", turnId: "turn-active", markdown: true },
        {
          id: "a1",
          itemId: "a1",
          kind: "message",
          role: "assistant",
          text: "partial",
          turnId: "turn-active",
          markdown: false,
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
              { type: "userMessage", id: "u1", content: [{ type: "text", text: "hello", text_elements: [] }] },
              { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
            ],
          },
        },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(state.displayItems.filter((item) => item.kind === "message" && item.role === "user")).toEqual([
        expect.objectContaining({ id: "u1", text: "hello" }),
      ]);
      expect(state.displayItems).toEqual(expect.arrayContaining([expect.objectContaining({ id: "a1", text: "done", markdown: true })]));
      expect(state.displayItems.some((item) => item.id === "local-user-1")).toBe(false);
    });

    it("asks the view to auto-name completed turns", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
      const maybeNameThread = vi.fn();
      const controller = controllerForState(state, { maybeNameThread });
      const turn: Turn = {
        id: "turn-active",
        status: "completed",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        itemsView: "full",
        items: [
          { type: "userMessage", id: "u1", content: [{ type: "text", text: "hello", text_elements: [] }] },
          { type: "agentMessage", id: "a1", text: "done", phase: "final_answer", memoryCitation: null },
        ],
      };

      controller.handleNotification({
        method: "turn/completed",
        params: { threadId: "thread-active", turn },
      } satisfies Extract<ServerNotification, { method: "turn/completed" }>);

      expect(maybeNameThread).toHaveBeenCalledWith("thread-active", turn);
    });

    it("updates listed thread names from thread name notifications", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.listedThreads = [thread("thread-active", "/workspace/active")];
      const refreshThreads = vi.fn();
      const controller = controllerForState(state, { refreshThreads });

      controller.handleNotification({
        method: "thread/name/updated",
        params: { threadId: "thread-active", threadName: "Codex Panel自動命名" },
      } satisfies Extract<ServerNotification, { method: "thread/name/updated" }>);

      expect(state.listedThreads[0]?.name).toBe("Codex Panel自動命名");
      expect(refreshThreads).toHaveBeenCalled();
    });

    it("syncs active runtime state from thread settings notifications", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
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

      expect(state.activeThreadCwd).toBe("/workspace/active");
      expect(state.activeModel).toBe("gpt-5.5");
      expect(state.activeServiceTier).toBe("fast");
      expect(state.activeApprovalsReviewer).toBe("auto_review");
      expect(state.displayItems).toEqual([]);
    });

    it("syncs null service tier from settings notifications", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeServiceTier = "standard";
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

      expect(state.activeServiceTier).toBeNull();
    });

    it("shows unsupported goal notifications as brief system messages", () => {
      const cases: { notification: ServerNotification; text: string }[] = [
        {
          notification: {
            method: "thread/goal/updated",
            params: {
              threadId: "thread-active",
              turnId: null,
              goal: {
                threadId: "thread-active",
                objective: "Finish",
                status: "active",
                tokenBudget: null,
                tokensUsed: 0,
                timeUsedSeconds: 0,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>,
          text: "Thread goal updated: status active. Codex Panel does not support goals.",
        },
        {
          notification: {
            method: "thread/goal/cleared",
            params: { threadId: "thread-active" },
          } satisfies Extract<ServerNotification, { method: "thread/goal/cleared" }>,
          text: "Thread goal cleared. Codex Panel does not support goals.",
        },
      ];

      for (const { notification, text } of cases) {
        const state = createPanelState();
        state.activeThreadId = "thread-active";
        const controller = controllerForState(state);

        controller.handleNotification(notification);

        expect(state.displayItems).toMatchObject([{ kind: "system", text }]);
      }
    });
  });

  describe("auto-review display", () => {
    it("renders guardian warnings as review results instead of system messages", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      const controller = controllerForState(state);

      controller.handleNotification({
        method: "guardianWarning",
        params: { threadId: "thread-active", message: "Auto-review denied this command." },
      } satisfies Extract<ServerNotification, { method: "guardianWarning" }>);

      expect(state.displayItems).toMatchObject([
        {
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review denied this command.",
          markdown: false,
        },
      ]);
    });

    it("renders auto approval review notifications as upserted review results", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
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

      expect(state.displayItems).toHaveLength(1);
      expect(state.displayItems[0]).toMatchObject({
        id: "review-review-1",
        kind: "reviewResult",
        text: "Auto-review approved: npm test",
        state: "completed",
      });
      const reviewItem = expectPresent(state.displayItems[0]);
      expect("details" in reviewItem ? reviewItem.details[0] : null).toMatchObject({
        title: "Review",
        rows: expect.arrayContaining([{ key: "status", value: "approved" }]),
      });
    });

    it("replaces guardian auto-review warnings when structured auto-review notifications arrive", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
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

      expect(state.displayItems).toHaveLength(1);
      expect(state.displayItems[0]).toMatchObject({
        id: "review-review-1",
        kind: "reviewResult",
        text: "Auto-review approved: npm test",
        turnId: "turn-active",
      });
    });

    it("ignores guardian auto-review warnings after structured auto-review notifications", () => {
      const state = createPanelState();
      state.activeThreadId = "thread-active";
      state.activeTurnId = "turn-active";
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

      expect(state.displayItems).toHaveLength(1);
      expect(state.displayItems[0]).toMatchObject({ id: "review-review-1" });
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

function thread(id: string, cwd: string): Thread {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
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
      method: "appServer/newFutureRequest",
      params: { secret: "do-not-render" },
    } as unknown as ServerRequest,
  ];
}
