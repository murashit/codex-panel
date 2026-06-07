import { describe, expect, it, vi } from "vitest";

import { ChatInboundController } from "../../../../../src/features/chat/inbound/controller";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import { createPendingRequestStatePort } from "../../../../../src/features/chat/controllers/state-ports";
import { PendingRequestController } from "../../../../../src/features/chat/controllers/requests/pending-request-controller";
import { toPendingUserInput } from "../../../../../src/features/chat/requests/user-input/model";
import type { ServerRequest } from "../../../../../src/generated/app-server/ServerRequest";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("PendingRequestController", () => {
  it("resolves user input from immutable draft state and refreshes the host", () => {
    const stateStore = createChatStateStore(createChatState());
    const respondToServerRequest = vi.fn().mockReturnValue(true);
    const refreshLiveState = vi.fn();
    const render = vi.fn();
    const controller = new ChatInboundController(stateStore, {
      refreshThreads: vi.fn(),
      refreshRateLimits: vi.fn(),
      refreshSkills: vi.fn(),
      publishAppServerMetadata: vi.fn(),
      maybeNameThread: vi.fn(),
      notifyThreadArchived: vi.fn(),
      notifyThreadRenamed: vi.fn(),
      recordMcpStartupStatus: vi.fn(),
      respondToServerRequest,
      rejectServerRequest: vi.fn(),
    });
    const pendingRequests = new PendingRequestController({
      state: createPendingRequestStatePort(stateStore),
      controller,
      composerHasFocus: () => false,
      refreshLiveState,
      render,
    });
    const input = expectPresent(toPendingUserInput(userInputRequest()));
    stateStore.dispatch({ type: "request/user-input-queued", input });
    stateStore.dispatch({ type: "request/user-input-draft-set", key: "7:direction", value: "Left" });

    pendingRequests.resolveUserInput(input);

    expect(respondToServerRequest).toHaveBeenCalledWith(7, { answers: { direction: { answers: ["Left"] } } });
    expect(stateStore.getState().requests.pendingUserInputs).toEqual([]);
    expect(refreshLiveState).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });
});

function userInputRequest(): ServerRequest {
  return {
    id: 7,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "item",
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
