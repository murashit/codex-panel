import type { App } from "obsidian";

import type { CodexInput } from "../../../../domain/chat/input";
import { MessageStreamScrollBridge } from "../../panel/surface/message-stream-scroll";
import { currentModel, runtimeConfigOrDefault } from "../../runtime/effective";
import { runtimeSnapshotForChatState } from "../../runtime/snapshot";
import { activeTurnId, type ChatStateStore } from "../../state/reducer";
import type { ComposerMetaViewModel } from "../../ui/composer";
import type { ChatPanelComposerShellState } from "../../ui/shell-state";
import type { CodexChatHost } from "../../chat-host";
import type { ChatRuntimeSettingsActions } from "../../runtime/settings-actions";
import { ChatComposerController } from "./controller";

export interface ConversationComposerContext {
  app: App;
  plugin: CodexChatHost;
  stateStore: ChatStateStore;
  viewId: string;
  surface: {
    composerPlaceholder: (state: ChatPanelComposerShellState) => string;
    composerMetaViewModel: (state: ChatPanelComposerShellState) => ComposerMetaViewModel;
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
    composerPlaceholder: surface.composerPlaceholder,
    composerMeta: surface.composerMetaViewModel,
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
