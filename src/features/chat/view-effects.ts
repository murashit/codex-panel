import type { ChatAction } from "./chat-state";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ChatViewRenderScheduleOptions, RestoredThreadState } from "./view-lifecycle";

export interface ChatViewEffects {
  render: () => void;
  renderShellSlots: () => void;
  scheduleRender: (options?: ChatViewRenderScheduleOptions) => void;
  refreshLiveState: () => void;
  deferRefreshLiveState: () => void;
  forceMessagesToBottom: () => void;
  preserveMessageScrollPosition: () => void;
  scrollMessagesToBottomOnFocus: () => void;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  invalidateConnectionWork: () => void;
  invalidateResumeWork: () => void;
  scheduleDeferredDiagnostics: () => void;
  clearDeferredDiagnostics: () => void;
  scheduleDeferredRestoredThreadHydration: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  scheduleDeferredAppServerWarmup: () => void;
  dispatch: (action: ChatAction) => void;
  systemItem: (text: string) => DisplayItem;
  restoreThreadPlaceholder: (restoredThread: RestoredThreadState) => void;
  clearRestoredThreadLifecycle: () => void;
  refreshTabHeader: () => void;
  clearClient: () => void;
  setComposerText: (text: string) => void;
  ensureConnected: () => Promise<void>;
}
