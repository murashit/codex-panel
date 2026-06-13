import { messageStreamDisplayItems } from "../../state/message-stream";
import type { ChatState } from "../../state/reducer";
import type { RuntimeSnapshot } from "../../runtime/snapshot";
import { runtimeSnapshotForChatSlices } from "../../runtime/snapshot";

export function runtimeSnapshotForShellState(
  state: Pick<ChatState, "connection" | "activeThread" | "runtime" | "messageStream">,
): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    displayItems: messageStreamDisplayItems(state.messageStream),
    availableModels: state.connection.availableModels,
  });
}

export function runtimeSnapshotForToolbarShellState(state: Pick<ChatState, "connection" | "activeThread" | "runtime">): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    displayItems: [],
    availableModels: state.connection.availableModels,
  });
}
