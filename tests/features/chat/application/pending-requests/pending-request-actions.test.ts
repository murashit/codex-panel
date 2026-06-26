import { describe, expect, it, vi } from "vitest";
import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { appServerUserInputRequest as toPendingUserInput } from "../../../../../src/app-server/protocol/server-requests";
import { createPendingRequestActions } from "../../../../../src/features/chat/application/pending-requests/pending-request-actions";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("PendingRequestActions", () => {
  it("resolves user input from immutable draft state and refreshes the host", () => {
    const stateStore = createChatStateStore(createChatState());
    const resolveUserInput = vi.fn();
    const refreshLiveState = vi.fn();
    const focusComposer = vi.fn();
    const pendingRequests = createPendingRequestActions({
      stateStore,
      responder: {
        resolveApproval: vi.fn(),
        resolveUserInput,
        cancelUserInput: vi.fn(),
        resolveMcpElicitation: vi.fn(),
      },
      composerHasFocus: () => false,
      focusComposer,
      refreshLiveState,
    });
    const input = expectPresent(toPendingUserInput(userInputRequest()));
    stateStore.dispatch({ type: "request/user-input-queued", input });
    stateStore.dispatch({ type: "request/user-input-draft-set", key: "7:direction", value: "Left" });

    pendingRequests.resolveUserInput(input.requestId);

    expect(resolveUserInput).toHaveBeenCalledWith(input.requestId, { direction: "Left" });
    expect(refreshLiveState).toHaveBeenCalledOnce();
    expect(focusComposer).toHaveBeenCalledOnce();
    expect(expectPresent(refreshLiveState.mock.invocationCallOrder[0])).toBeLessThan(
      expectPresent(focusComposer.mock.invocationCallOrder[0]),
    );
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
      autoResolutionMs: null,
    },
  };
}
