import { messageStreamItems } from "../../application/state/message-stream";
import type { ChatState } from "../../application/state/reducer";
import type { RuntimeSnapshot } from "../../application/runtime/snapshot";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";

export function runtimeSnapshotForShellState(
  state: Pick<ChatState, "connection" | "activeThread" | "runtime" | "messageStream">,
): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    items: messageStreamItems(state.messageStream),
    availableModels: state.connection.availableModels,
  });
}

export function runtimeSnapshotForToolbarShellState(state: Pick<ChatState, "connection" | "activeThread" | "runtime">): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    items: [],
    availableModels: state.connection.availableModels,
  });
}
