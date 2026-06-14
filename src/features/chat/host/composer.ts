import type { App } from "obsidian";

import { MessageStreamScrollBridge } from "../panel/surface/message-stream-scroll";
import { currentModel, runtimeConfigOrDefault } from "../domain/runtime/effective";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import { activeTurnId, type ChatStateStore } from "../application/state/reducer";
import type { ChatPanelComposerShellState } from "../panel/shell-state";
import type { PluginSettingsRef } from "../application/ports/chat-host";
import type { ChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { ChatComposerController } from "../panel/composer-controller";
import type { ChatPanelComposerProjection } from "../panel/surface/model";

export interface ConversationComposerContext {
  app: App;
  settingsRef: PluginSettingsRef;
  stateStore: ChatStateStore;
  viewId: string;
  surface: {
    composerProjection: (state: ChatPanelComposerShellState) => ChatPanelComposerProjection;
  };
  liveState: {
    refresh: () => void;
  };
}

export interface ConversationComposerRefs {
  runtimeSettings: ChatRuntimeSettingsActions;
}

export interface ConversationComposerParts {
  controller: ChatComposerController;
  scrollBridge: MessageStreamScrollBridge;
}

export function createConversationComposer(
  context: ConversationComposerContext,
  refs: ConversationComposerRefs,
): ConversationComposerParts {
  const { app, settingsRef, stateStore, viewId, surface, liveState } = context;
  const scrollBridge = new MessageStreamScrollBridge();
  const controller = new ChatComposerController({
    app,
    stateStore,
    viewId,
    sendShortcut: () => settingsRef.settings.sendShortcut,
    scrollThreadFromComposerEdges: () => settingsRef.settings.scrollThreadFromComposerEdges,
    canInterrupt: (state) => {
      return state.turn.lifecycle.kind !== "idle" && Boolean(state.activeThread.id && activeTurnId(state));
    },
    composerProjection: surface.composerProjection,
    currentModelForSuggestions: () => {
      const current = stateStore.getState();
      return currentModel(runtimeSnapshotForChatState(current), runtimeConfigOrDefault(current.connection.runtimeConfig));
    },
    threadScrollFromComposer: (action) => {
      scrollBridge.scrollFromComposer(action);
    },
    togglePlan: () => void refs.runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void refs.runtimeSettings.toggleAutoReview(),
    toggleFast: () => void refs.runtimeSettings.toggleFastMode(),
    onDraftChange: liveState.refresh,
    onHeightChange: () => {
      scrollBridge.repinMessageStreamToBottomIfPinned();
    },
  });

  return {
    controller,
    scrollBridge,
  };
}
