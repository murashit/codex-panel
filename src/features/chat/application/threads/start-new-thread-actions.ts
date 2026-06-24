import { chatTurnBusy } from "../conversation/turn-state";
import type { ChatStateStore } from "../state/store";
import type { ActiveThreadIdentitySync } from "./active-thread-identity-sync";

export interface StartNewThreadActions {
  startNewThread(): Promise<void>;
}

interface StartNewThreadActionsHost {
  stateStore: ChatStateStore;
  identity: ActiveThreadIdentitySync;
  focusComposer: () => void;
}

export function createStartNewThreadActions(host: StartNewThreadActionsHost): StartNewThreadActions {
  return {
    startNewThread: () => startNewThread(host),
  };
}

async function startNewThread(host: StartNewThreadActionsHost): Promise<void> {
  if (chatTurnBusy(host.stateStore.getState())) return;

  host.identity.clearActiveThreadIdentity();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  host.stateStore.dispatch({ type: "connection/status-set", statusText: "New chat." });
  host.focusComposer();
}
