import { describe, expect, it, vi } from "vitest";

import { PanelController } from "../src/panel/controller";
import { createPanelState } from "../src/state/panel-state";
import type { ServerNotification } from "../src/generated/app-server/ServerNotification";
import type { ServerRequest } from "../src/generated/app-server/ServerRequest";
import type { Thread } from "../src/generated/app-server/v2/Thread";
import type { Turn } from "../src/generated/app-server/v2/Turn";

function controllerForState(
  state = createPanelState(),
  actions: Partial<ConstructorParameters<typeof PanelController>[1]> = {},
): PanelController {
  return new PanelController(state, {
    refreshThreads: vi.fn(),
    maybeNameThread: vi.fn(),
    respondToServerRequest: vi.fn(() => true),
    rejectServerRequest: vi.fn(() => true),
    ...actions,
  });
}

describe("PanelController", () => {
  it("ignores item notifications for a different active thread", () => {
    const state = createPanelState();
    state.activeThreadId = "thread-active";
    state.activeTurnId = "turn-active";
    const controller = controllerForState(state);

    controller.handleNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-other", turnId: "turn-active", itemId: "a1", delta: "wrong" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

    expect(state.displayItems).toEqual([]);
  });

  it("ignores item notifications for a different active turn", () => {
    const state = createPanelState();
    state.activeThreadId = "thread-active";
    state.activeTurnId = "turn-active";
    const controller = controllerForState(state);

    controller.handleNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-active", turnId: "turn-other", itemId: "a1", delta: "wrong" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

    expect(state.displayItems).toEqual([]);
  });

  it("applies matching streaming deltas as lightweight assistant text", () => {
    const state = createPanelState();
    state.activeThreadId = "thread-active";
    state.activeTurnId = "turn-active";
    const controller = controllerForState(state);

    controller.handleNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-active", turnId: "turn-active", itemId: "a1", delta: "hello" },
    } satisfies Extract<ServerNotification, { method: "item/agentMessage/delta" }>);

    expect(state.displayItems).toMatchObject([{ id: "a1", text: "hello", markdown: false }]);
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
        id: "hook-hook-1",
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
    controller.resolveUserInput(state.pendingUserInputs[0], { scope: "Narrow" });
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

    controller.cancelUserInput(state.pendingUserInputs[0]);
    expect(rejectServerRequest).toHaveBeenCalledWith(43, -32000, "User cancelled input request.");
    expect(state.pendingUserInputs).toEqual([]);
    expect(state.displayItems.at(-1)).toMatchObject({
      kind: "userInputResult",
      role: "tool",
      text: "Input request cancelled for 1 question.",
      turnId: "turn-active",
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
    expect(rejectServerRequest).toHaveBeenNthCalledWith(1, 51, -32601, "Rejected inactive app-server request: item/tool/requestUserInput");
    expect(rejectServerRequest).toHaveBeenNthCalledWith(2, 52, -32601, "Rejected inactive app-server request: item/tool/requestUserInput");
  });

  it("keeps pending requests when response delivery fails", () => {
    const state = createPanelState();
    const respondToServerRequest = vi.fn(() => false);
    const controller = controllerForState(state, { respondToServerRequest });

    controller.handleServerRequest(userInputRequest(55));
    controller.resolveUserInput(state.pendingUserInputs[0], { note: "Later" });

    expect(state.pendingUserInputs).toHaveLength(1);
    expect(state.displayItems).toEqual([
      expect.objectContaining({ kind: "system", text: "Could not send user input because Codex app-server is not connected." }),
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
    state.busy = true;
    state.approvals = [
      {
        requestId: 10,
        method: "item/commandExecution/requestApproval",
        params: supportedApprovalRequests()[0]!.params as Extract<
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
    const reviewItem = state.displayItems[0];
    expect(reviewItem && "details" in reviewItem ? reviewItem.details?.[0] : null).toMatchObject({
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
