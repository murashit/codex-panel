import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { commandApprovalRequestFixture, mcpFormRequestFixture, userInputRequestFixture } from "../../../../support/server-requests";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { pendingRequestFixture } from "../../support/pending-requests";
import { chatStateThreadStreamItems } from "../../support/thread-stream";

describe("pending request actions", () => {
  it.each(["disconnect", "close"] as const)(
    "retains unanswered human requests across resume and leaves %s without rejecting them",
    (reason) => {
      const { handler, stateStore, receive, pendingRequests } = pendingRequestFixture();
      const request = commandApprovalRequestFixture(81, {
        threadId: "thread-active",
        turnId: "turn-active",
        kind: "humanCommand",
        availableDecisions: ["accept"],
      });
      const original = receive(request);
      const action = stateStore.getState().requests.approvals[0]?.actionOptions?.[0]?.action;
      if (!action) throw new Error("Expected command approval");
      stateStore.dispatch({ ...threadActivationFixture(panelThreadFixture({ id: "thread-active" })), type: "active-thread/resumed" });
      expect(stateStore.getState().requests.approvals).toEqual([expect.objectContaining({ requestId: 81 })]);
      handler.clearServerRequests(reason);
      stateStore.dispatch({ type: "connection/scoped-cleared" });
      expect(stateStore.getState().requests.approvals).toEqual([]);
      stateStore.dispatch({ ...threadActivationFixture(panelThreadFixture({ id: "thread-active" })), type: "active-thread/resumed" });
      expect(original.respond).not.toHaveBeenCalled();
      expect(original.reject).not.toHaveBeenCalled();
      const replayed = receive(request);
      pendingRequests.actions.resolveApproval(81, action);
      expect(replayed.respond).toHaveBeenCalledExactlyOnceWith({ decision: "accept" });
      expect(stateStore.getState().requests.approvals).toEqual([]);
      expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).toMatchObject({ kind: "approvalResult" });
      expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)?.turnId).toBe("turn-active");
    },
  );

  it("submits the latest answers, omits secret values from the result, clears drafts and restores focus", () => {
    const { stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const request = inputRequest();
    request.params.questions.push({
      id: "secret",
      header: "Secret",
      question: "Enter the secret value",
      isOther: false,
      isSecret: true,
      options: null,
    });
    const response = receive(request);
    pendingRequests.actions.setUserInputDraft(7, "7:direction", "Left");
    pendingRequests.actions.setUserInputDraft(7, "7:direction", "Right");
    pendingRequests.actions.setUserInputDraft(7, "7:secret", "sensitive-answer");

    pendingRequests.actions.resolveUserInput(7);

    expect(response.respond).toHaveBeenCalledExactlyOnceWith({
      answers: { direction: { answers: ["Right"] }, secret: { answers: ["sensitive-answer"] } },
    });
    expect(stateStore.getState().requests.pendingUserInputs).toEqual([]);
    expect(stateStore.getState().requests.userInputDrafts.size).toBe(0);
    expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).toMatchObject({
      kind: "userInputResult",
      turnId: "turn-active",
      text: "Input submitted for 2 questions.",
      questions: [{ id: "direction", answer: "Right" }, { id: "secret" }],
      executionState: "completed",
    });
    expect(JSON.stringify(chatStateThreadStreamItems(stateStore.getState()))).not.toContain("sensitive-answer");
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("keeps a failed answer editable and retries with the new draft", () => {
    const { stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const response = receive(inputRequest());
    response.respond.mockImplementationOnce(() => {
      throw new Error("transport unavailable");
    });
    pendingRequests.actions.setUserInputDraft(7, "7:direction", "Left");
    pendingRequests.actions.resolveUserInput(7);

    expect(stateStore.getState().requests.pendingUserInputs).toHaveLength(1);
    expect(stateStore.getState().requests.userInputDrafts.get("7:direction")).toBe("Left");
    expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([
      expect.objectContaining({ kind: "system", text: "Could not send user input because Codex app-server is not connected." }),
    ]);
    pendingRequests.actions.setUserInputDraft(7, "7:direction", "Right");
    pendingRequests.actions.resolveUserInput(7);

    expect(response.respond).toHaveBeenLastCalledWith({ answers: { direction: { answers: ["Right"] } } });
    expect(stateStore.getState().requests.pendingUserInputs).toEqual([]);
    expect(chatStateThreadStreamItems(stateStore.getState()).filter((item) => item.kind === "userInputResult")).toHaveLength(1);
    expect(focusComposer).toHaveBeenCalledTimes(2);
  });

  it.each([
    { action: "accept", status: "allowed" },
    { action: "decline", status: "denied" },
    { action: "cancel", status: "cancelled" },
  ] as const)("answers an approval with $action and records the choice", ({ action, status }) => {
    const { stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const response = receive(approvalRequest());
    pendingRequests.actions.resolveApproval(1, action);

    expect(response.respond).toHaveBeenCalledExactlyOnceWith({ decision: action });
    expect(stateStore.getState().requests.approvals).toEqual([]);
    expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).toMatchObject({
      kind: "approvalResult",
      executionState: action === "accept" ? "completed" : "failed",
      approval: { status, scope: "turn" },
    });
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it.each(["command", "humanCommand"] as const)("uses the replayed %s responder once without duplicating presentation", (kind) => {
    const { stateStore, receive, pendingRequests } = pendingRequestFixture();
    const request = commandApprovalRequestFixture(51, {
      threadId: "thread-active",
      turnId: "turn-active",
      kind,
      availableDecisions: ["accept"],
    });
    const original = receive(request);
    const action = stateStore.getState().requests.approvals[0]?.actionOptions?.[0]?.action;
    if (!action) throw new Error("Expected an offered approval action");
    const replayed = receive(request);
    expect(stateStore.getState().requests.approvals).toHaveLength(1);
    pendingRequests.actions.resolveApproval(51, action);
    pendingRequests.actions.resolveApproval(51, action);
    expect(original.respond).not.toHaveBeenCalled();
    expect(original.reject).not.toHaveBeenCalled();
    expect(replayed.respond).toHaveBeenCalledExactlyOnceWith({ decision: "accept" });
    expect(stateStore.getState().requests.approvals).toEqual([]);
    const repeated = receive(request);
    pendingRequests.actions.resolveApproval(51, action);
    expect(repeated.respond).toHaveBeenCalledExactlyOnceWith({ decision: "accept" });
    const results = chatStateThreadStreamItems(stateStore.getState()).filter((item) => item.kind === "approvalResult");
    expect(results).toHaveLength(2);
    expect(new Set(results.map((item) => item.id)).size).toBe(2);
    expect(results.map((item) => item.provenance)).toEqual([
      expect.objectContaining({ source: "localUser", sourceId: "51" }),
      expect.objectContaining({ source: "localUser", sourceId: "51" }),
    ]);
  });

  it.each([
    {
      name: "session approval",
      decision: "acceptForSession" as const,
      label: "Allow session",
      text: "Allowed for this session",
      status: "allowed for session",
      scope: "session",
      executionState: "completed",
    },
    {
      name: "command rule",
      decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] } },
      label: "Allow rule",
      text: "Allowed with rule",
      status: "allowed with rule",
      scope: "rule",
      executionState: "completed",
    },
    {
      name: "network allow rule",
      decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "example.com", action: "allow" as const } } },
      label: "Allow network rule",
      text: "Allowed with rule",
      status: "allowed with rule",
      scope: "rule",
      executionState: "completed",
    },
    {
      name: "network deny rule",
      decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "example.com", action: "deny" as const } } },
      label: "Deny network rule",
      text: "Denied with rule",
      status: "denied with rule",
      scope: "rule",
      executionState: "failed",
    },
  ])("sends the offered $name and records its actual scope", ({ decision, label, text, status, scope, executionState }) => {
    const { stateStore, receive, pendingRequests } = pendingRequestFixture();
    const response = receive(
      commandApprovalRequestFixture(52, {
        threadId: "thread-active",
        turnId: "turn-active",
        reason: "Needs access",
        availableDecisions: [decision],
      }),
    );
    const option = stateStore.getState().requests.approvals[0]?.actionOptions?.[0];
    if (!option) throw new Error("Expected an offered approval action");
    expect(option.label).toBe(label);

    pendingRequests.actions.resolveApproval(52, option.action);

    expect(response.respond).toHaveBeenCalledExactlyOnceWith({ decision });
    expect(stateStore.getState().requests.approvals).toEqual([]);
    expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).toMatchObject({
      kind: "approvalResult",
      text: `${text}: Needs access`,
      executionState,
      approval: { status, scope },
    });
  });

  it("cancels user input without publishing an answer", () => {
    const { stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const response = receive(inputRequest());
    pendingRequests.actions.setUserInputDraft(7, "7:direction", "Left");
    pendingRequests.actions.cancelUserInput(7);

    expect(response.reject).toHaveBeenCalledExactlyOnceWith(-32000, "User cancelled input request.");
    expect(response.respond).not.toHaveBeenCalled();
    expect(stateStore.getState().requests.userInputDrafts.size).toBe(0);
    expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).toMatchObject({
      kind: "userInputResult",
      turnId: "turn-active",
      executionState: "failed",
    });
    expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).not.toHaveProperty("questions.0.answer");
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("keeps failed MCP replies editable and retries with current values", () => {
    const { stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const response = receive(mcpRequest());
    const onChange = vi.fn();
    const unsubscribe = stateStore.subscribe(onChange);
    pendingRequests.actions.setMcpElicitationField(9, "title", { type: "string", value: "" });
    expect(onChange).not.toHaveBeenCalled();
    pendingRequests.actions.setMcpElicitationField(9, "title", { type: "string", value: "x" });
    expect(onChange).toHaveBeenCalledOnce();
    unsubscribe();
    pendingRequests.actions.resolveMcpElicitation(9, "accept");
    expect(response.respond).not.toHaveBeenCalled();
    expect(stateStore.getState().requests.pendingMcpElicitations).toHaveLength(1);
    expect(focusComposer).not.toHaveBeenCalled();

    response.respond.mockImplementationOnce(() => {
      throw new Error("transport unavailable");
    });
    pendingRequests.actions.setMcpElicitationField(9, "title", { type: "string", value: "Fix tests" });
    pendingRequests.actions.setMcpElicitationField(9, "notify", { type: "boolean", value: false });
    pendingRequests.actions.resolveMcpElicitation(9, "accept");
    expect(response.respond).toHaveBeenCalledExactlyOnceWith({
      action: "accept",
      content: { title: "Fix tests", notify: false },
      _meta: null,
    });
    expect(stateStore.getState().requests.pendingMcpElicitations).toMatchObject([
      {
        requestId: 9,
        params: {
          fields: [
            { id: "title", value: "Fix tests" },
            { id: "notify", value: false },
          ],
        },
      },
    ]);
    expect(chatStateThreadStreamItems(stateStore.getState()).filter((item) => item.kind === "userInputResult")).toEqual([]);

    pendingRequests.actions.setMcpElicitationField(9, "title", { type: "string", value: "Retry tests" });
    pendingRequests.actions.resolveMcpElicitation(9, "accept");
    expect(response.respond).toHaveBeenNthCalledWith(2, {
      action: "accept",
      content: { title: "Retry tests", notify: false },
      _meta: null,
    });
    expect(stateStore.getState().requests.pendingMcpElicitations).toEqual([]);
    expect(chatStateThreadStreamItems(stateStore.getState()).filter((item) => item.kind === "userInputResult")).toMatchObject([
      {
        kind: "userInputResult",
        questions: [
          { id: "title", answer: "Retry tests" },
          { id: "notify", answer: "false" },
        ],
      },
    ]);
    expect(focusComposer).toHaveBeenCalledTimes(2);
  });

  it.each(["decline", "cancel"] as const)("allows %s with an invalid MCP draft", (action) => {
    const { stateStore, receive, pendingRequests } = pendingRequestFixture();
    const response = receive(mcpRequest());
    pendingRequests.actions.setMcpElicitationField(9, "title", { type: "string", value: "x" });
    pendingRequests.actions.resolveMcpElicitation(9, action);
    expect(response.respond).toHaveBeenCalledExactlyOnceWith({ action, content: null, _meta: null });
    expect(stateStore.getState().requests.pendingMcpElicitations).toEqual([]);
  });

  it("ignores actions for resolved requests and keeps blocking questions unskippable", () => {
    const { handler, stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const responses = [
      receive(approvalRequest()),
      receive(inputRequest()),
      receive(mcpRequest()),
      receive(
        commandApprovalRequestFixture(81, {
          threadId: "thread-active",
          turnId: "turn-active",
          kind: "humanCommand",
          availableDecisions: ["accept"],
        }),
      ),
    ];
    const humanAction = stateStore.getState().requests.approvals.find((item) => item.requestId === 81)?.actionOptions?.[0]?.action;
    if (!humanAction) throw new Error("Expected human command approval");
    pendingRequests.actions.skipUserInput(7);
    expect(stateStore.getState().requests.pendingUserInputs).toHaveLength(1);
    for (const requestId of [1, 7, 9, 81])
      handler.handleNotification({ method: "serverRequest/resolved", params: { threadId: "thread-active", requestId } });

    pendingRequests.actions.resolveApproval(1, "accept");
    pendingRequests.actions.resolveApproval(81, humanAction);
    pendingRequests.actions.resolveUserInput(7);
    pendingRequests.actions.cancelUserInput(7);
    pendingRequests.actions.skipUserInput(7);
    pendingRequests.actions.resolveMcpElicitation(9, "accept");

    for (const response of responses) {
      expect(response.respond).not.toHaveBeenCalled();
      expect(response.reject).not.toHaveBeenCalled();
    }
    expect(focusComposer).not.toHaveBeenCalled();
  });

  it("keeps approval disclosure state in the host", () => {
    const { stateStore, pendingRequests } = pendingRequestFixture();
    pendingRequests.actions.setApprovalDetailsExpanded?.(1, true);
    expect(stateStore.getState().ui.disclosures.approvalDetails.has("1:details")).toBe(true);
    pendingRequests.actions.setApprovalDetailsExpanded?.(1, false);
    expect(stateStore.getState().ui.disclosures.approvalDetails.has("1:details")).toBe(false);
  });

  it("consumes each focus signature once and resets after the queue clears", () => {
    const composerHasFocus = vi.fn(() => true);
    const { handler, receive, pendingRequests } = pendingRequestFixture({ composerHasFocus });
    expect(pendingRequests.consumeAutoFocus()).toBe(false);
    receive(inputRequest());
    expect(pendingRequests.consumeAutoFocus()).toBe(true);
    expect(pendingRequests.consumeAutoFocus()).toBe(false);
    receive(approvalRequest());
    expect(pendingRequests.consumeAutoFocus()).toBe(true);
    for (const requestId of [1, 7])
      handler.handleNotification({ method: "serverRequest/resolved", params: { threadId: "thread-active", requestId } });
    expect(pendingRequests.consumeAutoFocus()).toBe(false);
    receive(inputRequest());
    expect(pendingRequests.consumeAutoFocus()).toBe(true);
    expect(composerHasFocus).toHaveBeenCalledTimes(3);
  });

  it("does not steal focus when the composer was not focused", () => {
    const composerHasFocus = vi.fn(() => false);
    const { receive, pendingRequests } = pendingRequestFixture({ composerHasFocus });
    receive(approvalRequest());
    expect(pendingRequests.consumeAutoFocus()).toBe(false);
    composerHasFocus.mockReturnValue(true);
    expect(pendingRequests.consumeAutoFocus()).toBe(false);
    expect(composerHasFocus).toHaveBeenCalledOnce();
  });

  describe("optional questions", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal("window", globalThis);
      vi.setSystemTime(1_000);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it.each(["submit", "timeout"])("extends the deadline on editing before %s resolves the request", (action) => {
      const { stateStore, receive, pendingRequests } = pendingRequestFixture();
      const response = receive(inputRequest(false));
      vi.advanceTimersByTime(100_000);
      pendingRequests.actions.setUserInputDraft(7, "7:direction", "Left");
      expect(stateStore.getState().requests.pendingUserInputs[0]?.autoResolutionAtMs).toBe(221_000);
      vi.advanceTimersByTime(119_999);
      expect(response.respond).not.toHaveBeenCalled();
      if (action === "submit") {
        pendingRequests.actions.setUserInputDraft(7, "7:direction", "Right");
        pendingRequests.actions.resolveUserInput(7);
      } else {
        vi.advanceTimersByTime(1);
      }
      vi.advanceTimersByTime(120_000);
      expect(response.respond).toHaveBeenCalledExactlyOnceWith(
        action === "submit" ? { answers: { direction: { answers: ["Right"] } } } : { answers: {} },
      );
      expect(stateStore.getState().requests.pendingUserInputs).toEqual([]);
    });

    it.each(["timeout", "skip"])("resolves by %s without an answer or result item", (action) => {
      const { stateStore, receive, pendingRequests } = pendingRequestFixture();
      const response = receive(inputRequest(false));
      vi.advanceTimersByTime(119_999);
      expect(response.respond).not.toHaveBeenCalled();
      if (action === "skip") pendingRequests.actions.skipUserInput(7);
      vi.advanceTimersByTime(1);
      expect(response.respond).toHaveBeenCalledExactlyOnceWith({ answers: {} });
      expect(response.reject).not.toHaveBeenCalled();
      expect(stateStore.getState().requests.pendingUserInputs).toEqual([]);
      expect(chatStateThreadStreamItems(stateStore.getState())).toEqual([]);
    });

    it.each(["resolved", "disconnect", "close"] as const)("clears the timer when the request is %s", (action) => {
      const { handler, receive } = pendingRequestFixture();
      const response = receive(inputRequest(false));
      if (action === "resolved")
        handler.handleNotification({ method: "serverRequest/resolved", params: { threadId: "thread-active", requestId: 7 } });
      else handler.clearServerRequests(action);
      vi.advanceTimersByTime(120_000);
      expect(response.respond).not.toHaveBeenCalled();
      expect(response.reject).toHaveBeenCalledTimes(action === "resolved" ? 0 : 1);
    });
  });
});

function inputRequest(isBlocking = true) {
  return userInputRequestFixture(7, {
    isBlocking,
    questions: [
      {
        id: "direction",
        header: "Direction",
        question: "Which direction?",
        isOther: false,
        isSecret: false,
        options: [
          { label: "Left", description: "Go left" },
          { label: "Right", description: "Go right" },
        ],
      },
    ],
  });
}

function approvalRequest(): ServerRequest {
  return {
    id: 1,
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      itemId: "file",
      startedAtMs: 1,
      reason: "Write file",
      grantRoot: null,
    },
  };
}

function mcpRequest(): ServerRequest {
  return mcpFormRequestFixture(9, {
    type: "object",
    properties: {
      title: { type: "string", title: "Title", minLength: 2 },
      notify: { type: "boolean", title: "Notify", default: true },
    },
    required: ["title"],
  });
}
