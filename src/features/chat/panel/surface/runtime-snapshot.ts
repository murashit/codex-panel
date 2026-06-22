import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";
import type { ChatPanelToolbarShellState } from "../shell-state";

export function runtimeSnapshotForToolbarShellState(state: ChatPanelToolbarShellState): RuntimeSnapshot {
  // Toolbar shell state intentionally avoids subscribing to messageStream.
  return runtimeSnapshotForSurfaceState(state, false);
}

function runtimeSnapshotForSurfaceState(
  state: {
    readonly connection: ChatPanelToolbarShellState["connection"];
    readonly activeThread: ChatPanelToolbarShellState["activeThread"];
    readonly runtime: ChatPanelToolbarShellState["runtime"];
  },
  hasThreadTurns: boolean,
): RuntimeSnapshot {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    hasThreadTurns,
    availableModels: state.connection.availableModels,
  });
}
