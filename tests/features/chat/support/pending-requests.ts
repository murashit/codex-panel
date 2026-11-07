import { vi } from "vitest";
import type { ServerRequest } from "../../../../src/app-server/connection/rpc-messages";
import { createChatInboundHandler } from "../../../../src/features/chat/app-server/inbound/handler";
import { createLocalIdSource } from "../../../../src/features/chat/application/local-id-source";
import { chatReducer } from "../../../../src/features/chat/application/state/reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createPendingRequestActions } from "../../../../src/features/chat/host/thread-stream/pending-request-actions";
import { chatStateFixture } from "./state";

export function pendingRequestFixture(
  options: { stateStore?: ChatStateStore; composerHasFocus?: () => boolean; focusComposer?: () => void } = {},
) {
  const stateStore =
    options.stateStore ??
    createChatStateStore(
      chatReducer(chatStateFixture({ activeThread: { id: "thread-active" } }), {
        type: "turn/started",
        threadId: "thread-active",
        turnId: "turn-active",
      }),
    );
  const handler = createChatInboundHandler(
    stateStore,
    {
      maybeNameThread: () => {},
      executeDynamicTool: () => ({ success: false, contentItems: [] }),
    },
    createLocalIdSource(),
  );
  const focusComposer = options.focusComposer ?? vi.fn();
  const pendingRequests = createPendingRequestActions({
    stateStore,
    requests: handler.pendingRequests,
    composerHasFocus: options.composerHasFocus ?? (() => false),
    focusComposer,
  });
  return {
    stateStore,
    handler,
    focusComposer,
    pendingRequests,
    receive: (request: ServerRequest) => {
      const responder = { respond: vi.fn(), reject: vi.fn() };
      handler.handleServerRequest(request, responder);
      return responder;
    },
  };
}
