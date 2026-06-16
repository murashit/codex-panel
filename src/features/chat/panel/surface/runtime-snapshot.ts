import { messageStreamItems } from "../../application/state/message-stream";
import type { ChatState } from "../../application/state/root-reducer";
import type { RuntimeSnapshot } from "../../application/runtime/snapshot";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";

export function runtimeSnapshotForShellState(
  state: Pick<ChatState, "connection" | "activeThread" | "runtime" | "messageStream">,
): RuntimeSnapshot {
  return runtimeSnapshotForSurfaceState(state, messageStreamItems(state.messageStream));
}

export function runtimeSnapshotForToolbarShellState(state: Pick<ChatState, "connection" | "activeThread" | "runtime">): RuntimeSnapshot {
  // Toolbar shell state intentionally avoids subscribing to messageStream.
  return runtimeSnapshotForSurfaceState(state, []);
}

function runtimeSnapshotForSurfaceState(
  state: Pick<ChatState, "connection" | "activeThread" | "runtime">,
  items: Parameters<typeof runtimeSnapshotForChatSlices>[0]["items"],
): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    items,
    availableModels: state.connection.availableModels,
  });
}
