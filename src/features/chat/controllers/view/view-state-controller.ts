import { parseRestoredThreadState } from "../../view-snapshot";
import type { RestoredThreadState } from "../../view-lifecycle";

export interface ChatViewStateControllerHost {
  invalidateResumeWork: () => void;
  clearRestoredThreadLifecycle: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  scheduleDeferredAppServerWarmup: () => void;
  restoreThreadPlaceholder: (restoredThread: RestoredThreadState) => void;
}

export class ChatViewStateController {
  constructor(private readonly host: ChatViewStateControllerHost) {}

  applyState(state: unknown): void {
    const restoredThread = parseRestoredThreadState(state);
    if (!restoredThread) {
      this.host.invalidateResumeWork();
      this.host.clearRestoredThreadLifecycle();
      this.host.clearDeferredRestoredThreadHydration();
      this.host.scheduleDeferredAppServerWarmup();
      return;
    }

    this.host.restoreThreadPlaceholder(restoredThread);
  }
}
