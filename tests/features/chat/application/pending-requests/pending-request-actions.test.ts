import { describe, expect, it, vi } from "vitest";
import { createPendingRequestActions } from "../../../../../src/features/chat/application/pending-requests/pending-request-actions";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type {
  ApprovalAction,
  PendingApproval,
  PendingMcpElicitation,
  PendingUserInput,
} from "../../../../../src/features/chat/domain/pending-requests/model";

describe("PendingRequestActions", () => {
  it("resolves user input from immutable draft state and restores composer focus", () => {
    const { stateStore, responder, focusComposer, pendingRequests } = actionsHarness();
    const input = userInputRequest();
    stateStore.dispatch({ type: "request/user-input-queued", input });
    stateStore.dispatch({ type: "request/user-input-draft-set", key: "7:direction", value: "Left" });

    pendingRequests.actions.resolveUserInput(input.requestId);

    expect(responder.resolveUserInput).toHaveBeenCalledWith(input.requestId, { direction: "Left" });
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it.each([
    ["allows", "accept"],
    ["denies", "decline"],
  ] satisfies [string, ApprovalAction][])("%s a queued approval and commits the action", (_label, action) => {
    const { stateStore, responder, focusComposer, pendingRequests } = actionsHarness();
    stateStore.dispatch({ type: "request/approval-queued", approval: approvalRequest() });

    pendingRequests.actions.resolveApproval(1, action);

    expect(responder.resolveApproval).toHaveBeenCalledWith(1, action);
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("cancels queued user input and commits the action", () => {
    const { stateStore, responder, focusComposer, pendingRequests } = actionsHarness();
    const input = userInputRequest();
    stateStore.dispatch({ type: "request/user-input-queued", input });

    pendingRequests.actions.cancelUserInput(input.requestId);

    expect(responder.cancelUserInput).toHaveBeenCalledWith(input.requestId);
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("skips optional user input without cancelling the request", () => {
    const { stateStore, responder, focusComposer, pendingRequests } = actionsHarness();
    const input = optionalUserInputRequest();
    stateStore.dispatch({ type: "request/user-input-queued", input });

    pendingRequests.actions.skipUserInput(input.requestId);

    expect(responder.skipUserInput).toHaveBeenCalledWith(input.requestId);
    expect(responder.cancelUserInput).not.toHaveBeenCalled();
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("resolves a queued MCP elicitation and commits the action", () => {
    const { stateStore, responder, focusComposer, pendingRequests } = actionsHarness();
    stateStore.dispatch({ type: "request/mcp-elicitation-queued", elicitation: mcpElicitationRequest() });

    pendingRequests.actions.resolveMcpElicitation(9, "accept");

    expect(responder.resolveMcpElicitation).toHaveBeenCalledWith(9, "accept");
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("ignores actions for requests that disappeared before the action ran", () => {
    const { stateStore, responder, focusComposer, pendingRequests } = actionsHarness();
    const input = userInputRequest();
    stateStore.dispatch({ type: "request/approval-queued", approval: approvalRequest() });
    stateStore.dispatch({ type: "request/user-input-queued", input });
    stateStore.dispatch({ type: "request/mcp-elicitation-queued", elicitation: mcpElicitationRequest() });
    stateStore.dispatch({ type: "request/resolved", requestId: 1 });
    stateStore.dispatch({ type: "request/resolved", requestId: input.requestId });
    stateStore.dispatch({ type: "request/resolved", requestId: 9 });

    pendingRequests.actions.resolveApproval(1, "accept");
    pendingRequests.actions.resolveUserInput(input.requestId);
    pendingRequests.actions.cancelUserInput(input.requestId);
    pendingRequests.actions.resolveMcpElicitation(9, "accept");

    expect(responder.resolveApproval).not.toHaveBeenCalled();
    expect(responder.resolveUserInput).not.toHaveBeenCalled();
    expect(responder.cancelUserInput).not.toHaveBeenCalled();
    expect(responder.resolveMcpElicitation).not.toHaveBeenCalled();
    expect(focusComposer).not.toHaveBeenCalled();
  });

  it("dispatches request drafts and approval disclosure state", () => {
    const { stateStore, responder, pendingRequests } = actionsHarness();
    const actions = pendingRequests.actions;

    actions.setUserInputDraft(7, "7:direction", "Right");
    actions.setMcpElicitationDraft("9:mcp:title", "Fix tests");
    actions.setApprovalDetailsExpanded?.(1, true);

    expect(stateStore.getState().requests.userInputDrafts.get("7:direction")).toBe("Right");
    expect(responder.extendUserInputAutoResolution).not.toHaveBeenCalled();
    expect(stateStore.getState().requests.mcpElicitationDrafts.get("9:mcp:title")).toBe("Fix tests");
    expect(stateStore.getState().ui.disclosures.approvalDetails.has("1:details")).toBe(true);

    actions.setApprovalDetailsExpanded?.(1, false);

    expect(stateStore.getState().ui.disclosures.approvalDetails.has("1:details")).toBe(false);
  });

  it("extends optional user-input auto-resolution when its draft changes", () => {
    const { stateStore, responder, pendingRequests } = actionsHarness();
    stateStore.dispatch({ type: "request/user-input-queued", input: optionalUserInputRequest() });

    pendingRequests.actions.setUserInputDraft(7, "7:direction", "Right");

    expect(responder.extendUserInputAutoResolution).toHaveBeenCalledWith(7);
  });

  it("consumes each pending-request focus signature once and resets after the queue clears", () => {
    const composerHasFocus = vi.fn(() => true);
    const { stateStore, pendingRequests } = actionsHarness(composerHasFocus);
    const input = userInputRequest();

    expect(pendingRequests.consumeAutoFocus()).toBe(false);
    stateStore.dispatch({ type: "request/user-input-queued", input });
    expect(pendingRequests.consumeAutoFocus()).toBe(true);
    expect(pendingRequests.consumeAutoFocus()).toBe(false);

    stateStore.dispatch({ type: "request/approval-queued", approval: approvalRequest() });
    expect(pendingRequests.consumeAutoFocus()).toBe(true);
    stateStore.dispatch({ type: "request/resolved", requestId: input.requestId });
    stateStore.dispatch({ type: "request/resolved", requestId: 1 });
    expect(pendingRequests.consumeAutoFocus()).toBe(false);

    stateStore.dispatch({ type: "request/user-input-queued", input });
    expect(pendingRequests.consumeAutoFocus()).toBe(true);
    expect(composerHasFocus).toHaveBeenCalledTimes(3);
  });

  it("does not request autofocus when focus was outside the composer", () => {
    const composerHasFocus = vi.fn(() => false);
    const { stateStore, pendingRequests } = actionsHarness(composerHasFocus);
    stateStore.dispatch({ type: "request/approval-queued", approval: approvalRequest() });

    expect(pendingRequests.consumeAutoFocus()).toBe(false);
    composerHasFocus.mockReturnValue(true);
    expect(pendingRequests.consumeAutoFocus()).toBe(false);
    expect(composerHasFocus).toHaveBeenCalledOnce();
  });
});

function actionsHarness(composerHasFocus = vi.fn(() => false)) {
  const stateStore = createChatStateStore(createChatState());
  const responder = {
    resolveApproval: vi.fn(),
    resolveUserInput: vi.fn(),
    skipUserInput: vi.fn(),
    extendUserInputAutoResolution: vi.fn(),
    cancelUserInput: vi.fn(),
    resolveMcpElicitation: vi.fn(),
  };
  const focusComposer = vi.fn();
  const pendingRequests = createPendingRequestActions({
    stateStore,
    responder,
    composerHasFocus,
    focusComposer,
  });
  return { stateStore, responder, focusComposer, pendingRequests };
}

function approvalRequest(): PendingApproval {
  return {
    requestId: 1,
    kind: "command",
    turnId: "turn",
    title: "Command approval",
    summary: "Run tests",
    resultSummary: "Run tests",
    details: [],
    actionOptions: null,
  };
}

function mcpElicitationRequest(): PendingMcpElicitation {
  return {
    requestId: 9,
    params: {
      turnId: "turn",
      serverName: "server",
      mode: "form",
      message: "Need input",
      fields: [],
    },
  };
}

function userInputRequest(): PendingUserInput {
  return {
    requestId: 7,
    autoResolutionAtMs: null,
    params: {
      turnId: "turn",
      isBlocking: true,
      questions: [
        {
          id: "direction",
          header: "Direction",
          question: "Which way?",
          isOther: true,
          isSecret: false,
          options: [{ label: "Recommended", description: "Use the default path" }],
        },
      ],
    },
  };
}

function optionalUserInputRequest(): PendingUserInput {
  const input = userInputRequest();
  return {
    ...input,
    autoResolutionAtMs: 120_000,
    params: { ...input.params, isBlocking: false },
  };
}
