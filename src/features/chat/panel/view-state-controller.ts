import { parseRestoredThreadState } from "./snapshot";
import type { RestoredThreadState } from "./lifecycle";

export interface ChatViewStateControllerHost {
  invalidateResumeWork: () => void;
  clearRestoredThreadLifecycle: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  scheduleDeferredAppServerWarmup: () => void;
  restoreThreadPlaceholder: (restoredThread: RestoredThreadState) => void;
}

export interface ChatViewStateActions {
  applyState(state: unknown): void;
}

export function createChatViewStateActions(host: ChatViewStateControllerHost): ChatViewStateActions {
  return {
    applyState(state) {
      const restoredThread = parseRestoredThreadState(state);
      if (!restoredThread) {
        host.invalidateResumeWork();
        host.clearRestoredThreadLifecycle();
        host.clearDeferredRestoredThreadHydration();
        host.scheduleDeferredAppServerWarmup();
        return;
      }

      host.restoreThreadPlaceholder(restoredThread);
    },
  };
}
