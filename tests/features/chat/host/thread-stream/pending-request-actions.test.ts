import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { commandApprovalRequestFixture, userInputRequestFixture } from "../../../../support/server-requests";
import { pendingRequestFixture } from "../../support/pending-requests";
import { chatStateThreadStreamItems } from "../../support/thread-stream";

describe("pending request actions", () => {
  it("submits the latest answer draft, clears it, records the result and restores focus", () => {
    const { stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const response = receive(inputRequest());
    pendingRequests.actions.setUserInputDraft(7, "7:direction", "Left");
    pendingRequests.actions.setUserInputDraft(7, "7:direction", "Right");

    pendingRequests.actions.resolveUserInput(7);

    expect(response.respond).toHaveBeenCalledExactlyOnceWith({ answers: { direction: { answers: ["Right"] } } });
    expect(stateStore.getState().requests.pendingUserInputs).toEqual([]);
    expect(stateStore.getState().requests.userInputDrafts.size).toBe(0);
    expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).toMatchObject({
      kind: "userInputResult",
      turnId: "turn-active",
      questions: [{ id: "direction", answer: "Right" }],
      executionState: "completed",
    });
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

  it.each(["accept", "decline"] as const)("answers an approval with %s and records the choice", (action) => {
    const { stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const response = receive(approvalRequest());
    pendingRequests.actions.resolveApproval(1, action);

    expect(response.respond).toHaveBeenCalledExactlyOnceWith({ decision: action });
    expect(stateStore.getState().requests.approvals).toEqual([]);
    expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).toMatchObject({
      kind: "approvalResult",
      executionState: action === "accept" ? "completed" : "failed",
    });
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("uses the replayed approval's responder once without duplicating presentation", () => {
    const { stateStore, receive, pendingRequests } = pendingRequestFixture();
    const request = commandApprovalRequestFixture(51, { threadId: "thread-active", turnId: "turn-active" });
    const original = receive(request);
    const replayed = receive(request);
    expect(stateStore.getState().requests.approvals).toHaveLength(1);
    const action = stateStore.getState().requests.approvals[0]?.actionOptions?.[0]?.action;
    if (!action) throw new Error("Expected an offered approval action");
    pendingRequests.actions.resolveApproval(51, action);
    pendingRequests.actions.resolveApproval(51, action);
    expect(original.respond).not.toHaveBeenCalled();
    expect(original.reject).not.toHaveBeenCalled();
    expect(replayed.respond).toHaveBeenCalledExactlyOnceWith({ decision: "accept" });
    expect(stateStore.getState().requests.approvals).toEqual([]);
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

  it("submits an MCP draft through the same request workflow", () => {
    const { stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const response = receive(mcpRequest());
    pendingRequests.actions.setMcpElicitationDraft("9:mcp:title", "Fix tests");
    pendingRequests.actions.setMcpElicitationDraft("9:mcp:notify", "false");
    pendingRequests.actions.resolveMcpElicitation(9, "accept");

    expect(response.respond).toHaveBeenCalledExactlyOnceWith({
      action: "accept",
      content: { title: "Fix tests", notify: false },
      _meta: null,
    });
    expect(stateStore.getState().requests.mcpElicitationDrafts.size).toBe(0);
    expect(stateStore.getState().requests.pendingMcpElicitations).toEqual([]);
    expect(chatStateThreadStreamItems(stateStore.getState()).at(-1)).toMatchObject({
      kind: "userInputResult",
      questions: [
        { id: "title", answer: "Fix tests" },
        { id: "notify", answer: "false" },
      ],
    });
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("ignores actions for resolved requests and keeps blocking questions unskippable", () => {
    const { handler, stateStore, receive, pendingRequests, focusComposer } = pendingRequestFixture();
    const responses = [receive(approvalRequest()), receive(inputRequest()), receive(mcpRequest())];
    pendingRequests.actions.skipUserInput(7);
    expect(stateStore.getState().requests.pendingUserInputs).toHaveLength(1);
    for (const requestId of [1, 7, 9])
      handler.handleNotification({ method: "serverRequest/resolved", params: { threadId: "thread-active", requestId } });

    pendingRequests.actions.resolveApproval(1, "accept");
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
  return {
    id: 9,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread-active",
      turnId: "turn-active",
      serverName: "github",
      mode: "form",
      _meta: null,
      message: "Provide issue details",
      requestedSchema: {
        type: "object",
        properties: { title: { type: "string", title: "Title" }, notify: { type: "boolean", title: "Notify", default: true } },
        required: ["title"],
      },
    },
  };
}
