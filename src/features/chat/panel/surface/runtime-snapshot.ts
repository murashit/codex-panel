import { messageStreamItems } from "../../application/state/message-stream";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";
import type { ChatPanelComposerShellState, ChatPanelToolbarShellState } from "../shell-state";

export function runtimeSnapshotForShellState(state: ChatPanelComposerShellState): RuntimeSnapshot {
  return runtimeSnapshotForSurfaceState(state, messageStreamItems(state.messageStream));
}

export function runtimeSnapshotForToolbarShellState(state: ChatPanelToolbarShellState): RuntimeSnapshot {
  // Toolbar shell state intentionally avoids subscribing to messageStream.
  return runtimeSnapshotForSurfaceState(state, []);
}

function runtimeSnapshotForSurfaceState(
  state: {
    readonly connection: ChatPanelToolbarShellState["connection"];
    readonly activeThread: ChatPanelToolbarShellState["activeThread"];
    readonly runtime: ChatPanelToolbarShellState["runtime"];
  },
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
