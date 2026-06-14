import { parseRestoredThreadState } from "./snapshot";
import type { RestoredThreadState } from "../application/lifecycle";

export interface ChatViewStateHost {
  invalidateResumeWork: () => void;
  clearRestoredThreadLifecycle: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  scheduleDeferredAppServerWarmup: () => void;
  restoreThreadPlaceholder: (restoredThread: RestoredThreadState) => void;
}

export function applyChatViewState(host: ChatViewStateHost, state: unknown): void {
  const restoredThread = parseRestoredThreadState(state);
  if (!restoredThread) {
    host.invalidateResumeWork();
    host.clearRestoredThreadLifecycle();
    host.clearDeferredRestoredThreadHydration();
    host.scheduleDeferredAppServerWarmup();
    return;
  }

  host.restoreThreadPlaceholder(restoredThread);
}
