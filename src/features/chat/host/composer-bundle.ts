import { runtimeConfigOrDefault } from "../../../domain/runtime/config";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatStateStore } from "../application/state/store";
import { resolveRuntimeControls } from "../domain/runtime/resolution";
import { ChatComposerController } from "../panel/composer-controller";
import { type ChatPanelComposerSurface, chatPanelComposerProjection } from "../panel/surface/composer-projection";
import type { ChatMessageScrollController } from "../panel/surface/message-stream-scroll";
import type { ChatPanelEnvironment } from "./contracts";
import type { ChatPanelRuntimeSettingsActions } from "./runtime-bundle";
import type { ChatPanelThreadLifecycle } from "./thread-bundle";
import { VaultNoteCandidateProvider } from "./vault-note-candidate-provider.obsidian";

interface ChatPanelComposerHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  messageScrollController: ChatMessageScrollController;
}

export interface ChatPanelComposerBundle {
  controller: ChatComposerController;
  dispose(): void;
}

export function createComposerBundle(
  host: ChatPanelComposerHost,
  input: {
    threadLifecycle: ChatPanelThreadLifecycle;
    runtimeSettings: ChatPanelRuntimeSettingsActions;
  },
): ChatPanelComposerBundle {
  const surface = createSessionComposerSurface(input.threadLifecycle, input.runtimeSettings);
  const controller = createSessionComposerController(host, surface, input.runtimeSettings);

  return {
    controller,
    dispose: () => {
      controller.dispose();
    },
  };
}

function createSessionComposerSurface(
  threadLifecycle: ChatPanelThreadLifecycle,
  runtimeSettings: ChatPanelRuntimeSettingsActions,
): ChatPanelComposerSurface {
  return {
    thread: {
      restoredPlaceholder: () => threadLifecycle.restoration.placeholder(),
    },
    runtime: {
      requestModel: (model) => runtimeSettings.requestModelFromUi(model),
      requestReasoningEffort: (effort) => runtimeSettings.requestReasoningEffortFromUi(effort),
    },
  };
}

function createSessionComposerController(
  host: ChatPanelComposerHost,
  composerSurface: ChatPanelComposerSurface,
  runtimeSettings: ChatPanelRuntimeSettingsActions,
): ChatComposerController {
  const { environment, stateStore } = host;
  return new ChatComposerController({
    noteCandidateProvider: new VaultNoteCandidateProvider(environment.obsidian.app),
    sourcePath: () => environment.obsidian.app.workspace.getActiveFile()?.path ?? "",
    stateStore,
    viewId: environment.obsidian.viewId,
    sendShortcut: () => environment.plugin.settingsRef.settings.sendShortcut,
    scrollThreadFromComposerEdges: () => environment.plugin.settingsRef.settings.scrollThreadFromComposerEdges,
    canInterrupt: (state) => {
      return state.turnBusy && Boolean(state.activeThreadId && state.activeTurnId);
    },
    composerProjection: (state) => chatPanelComposerProjection(composerSurface, state),
    currentModelForSuggestions: () => {
      const current = stateStore.getState();
      const config = runtimeConfigOrDefault(current.connection.runtimeConfig);
      return resolveRuntimeControls(runtimeSnapshotForChatState(current), config).model.effective;
    },
    threadScrollFromComposer: (action) => {
      host.messageScrollController.scrollFromComposer(action);
    },
    togglePlan: () => void runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void runtimeSettings.toggleAutoReview(),
    toggleFast: () => void runtimeSettings.toggleFastMode(),
    onDraftChange: () => {
      environment.plugin.workspace.refreshThreadsViewLiveState();
    },
    onHeightChange: () => undefined,
  });
}
