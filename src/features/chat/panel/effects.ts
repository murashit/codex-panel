import type { ChatAction } from "../chat-state";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import type { ChatViewRenderScheduleOptions, RestoredThreadState } from "./lifecycle";

export interface ChatViewEffects {
  render: {
    now: () => void;
    shellSlots: () => void;
    schedule: (options?: ChatViewRenderScheduleOptions) => void;
  };
  liveState: {
    refresh: () => void;
    deferRefresh: () => void;
  };
  scroll: {
    forceBottom: () => void;
    correctAfterLayoutChange: () => void;
    preservePosition: () => void;
    bottomOnFocus: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  };
  thread: {
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
    restorePlaceholder: (restoredThread: RestoredThreadState) => void;
    clearRestoredLifecycle: () => void;
    refreshTabHeader: () => void;
  };
  lifecycle: {
    invalidateConnectionWork: () => void;
    invalidateResumeWork: () => void;
    scheduleDeferredDiagnostics: () => void;
    clearDeferredDiagnostics: () => void;
    scheduleDeferredRestoredThreadHydration: () => void;
    clearDeferredRestoredThreadHydration: () => void;
    scheduleDeferredAppServerWarmup: () => void;
  };
  state: {
    dispatch: (action: ChatAction) => void;
    systemItem: (text: string) => DisplayItem;
  };
  client: {
    clear: () => void;
    ensureConnected: () => Promise<void>;
  };
  composer: {
    setText: (text: string) => void;
  };
}
