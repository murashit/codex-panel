import { Notice } from "obsidian";

import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import { runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import type { ChatStateStore } from "../../application/state/store";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import { ChatComposerController } from "../../panel/composer-controller";
import type { ChatMessageScrollController } from "../../panel/message-stream-scroll-controller";
import { type ChatPanelComposerSurface, chatPanelComposerProjection } from "../../panel/surface/composer-projection";
import type { ChatPanelEnvironment } from "../contracts";
import { createVaultComposerAttachmentHandler } from "../obsidian/composer-attachments.obsidian";
import { VaultComposerContextReferenceProvider } from "../obsidian/vault-composer-context-reference-provider.obsidian";
import { VaultNoteCandidateProvider } from "../obsidian/vault-note-candidate-provider.obsidian";
import type { ChatPanelRuntimeSettingsActions } from "./runtime-bundle";

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
    runtimeSettings: ChatPanelRuntimeSettingsActions;
  },
): ChatPanelComposerBundle {
  const surface = createSessionComposerSurface(input.runtimeSettings);
  const controller = createSessionComposerController(host, surface, input.runtimeSettings);

  return {
    controller,
    dispose: () => {
      controller.dispose();
    },
  };
}

function createSessionComposerSurface(runtimeSettings: ChatPanelRuntimeSettingsActions): ChatPanelComposerSurface {
  return {
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
    contextReferenceProvider: new VaultComposerContextReferenceProvider(environment.obsidian.app),
    attachmentHandler: createVaultComposerAttachmentHandler({
      app: environment.obsidian.app,
      attachmentFolder: () => environment.plugin.settingsRef.settings.attachmentFolder(),
    }),
    sourcePath: () => environment.obsidian.app.workspace.getActiveFile()?.path ?? "",
    stateStore,
    viewId: environment.obsidian.viewId,
    sendShortcut: () => environment.plugin.settingsRef.settings.sendShortcut(),
    scrollThreadFromComposerEdges: () => environment.plugin.settingsRef.settings.scrollThreadFromComposerEdges(),
    canInterrupt: (model) => {
      return model.turnBusy.value && Boolean(model.activeThreadId.value && model.activeTurnId.value);
    },
    composerProjection: (model) => chatPanelComposerProjection(composerSurface, model),
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
    onAttachmentError: (message) => {
      new Notice(message);
    },
  });
}
