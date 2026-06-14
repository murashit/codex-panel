import type { App } from "obsidian";

import type { CodexInput } from "../../../domain/chat/input";
import { MessageStreamScrollBridge } from "../panel/surface/message-stream-scroll";
import { currentModel, runtimeConfigOrDefault } from "../domain/runtime/effective";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import { activeTurnId, type ChatStateStore } from "../application/state/reducer";
import type { ComposerMetaViewModel } from "../ui/composer";
import type { ChatPanelComposerShellState } from "../ui/shell-state";
import type { CodexChatHost } from "../application/chat-host";
import type { ChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { ChatComposerController } from "../ui/composer-controller";

export interface ConversationComposerContext {
  app: App;
  plugin: CodexChatHost;
  stateStore: ChatStateStore;
  viewId: string;
  surface: {
    composerProjection: (state: ChatPanelComposerShellState) => {
      placeholder: string;
      meta: ComposerMetaViewModel;
    };
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
  codexInput: (text: string) => CodexInput;
  setDraft: (text: string, options?: { focus?: boolean; clearSuggestions?: boolean }) => void;
}

export function createConversationComposer(
  context: ConversationComposerContext,
  refs: ConversationComposerRefs,
): ConversationComposerParts {
  const { app, plugin, stateStore, viewId, surface, liveState } = context;
  const scrollBridge = new MessageStreamScrollBridge();
  const controller = new ChatComposerController({
    app,
    stateStore,
    viewId,
    sendShortcut: () => plugin.settings.sendShortcut,
    scrollThreadFromComposerEdges: () => plugin.settings.scrollThreadFromComposerEdges,
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
    codexInput: (text) => controller.codexInput(text),
    setDraft: (text, options) => {
      controller.setDraft(text, options);
    },
  };
}
