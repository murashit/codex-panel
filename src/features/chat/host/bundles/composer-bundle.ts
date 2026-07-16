import { Notice } from "obsidian";

import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import { runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import type { ChatStateStore } from "../../application/state/store";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import { ChatComposerController } from "../../panel/composer-controller";
import { chatPanelComposerProjection } from "../../panel/surface/composer-projection";
import type { ChatThreadStreamScrollBinding } from "../../panel/thread-stream-scroll-binding";
import type { ChatPanelEnvironment } from "../contracts";
import { createVaultComposerAttachmentHandler } from "../obsidian/composer-attachments.obsidian";
import { VaultComposerContextReferenceProvider } from "../obsidian/vault-composer-context-reference-provider.obsidian";
import { VaultNoteCandidateProvider } from "../obsidian/vault-note-candidate-provider.obsidian";
import type { ChatPanelRuntimeSettingsActions } from "./runtime-bundle";

interface ChatPanelComposerHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  threadStreamScrollBinding: ChatThreadStreamScrollBinding;
}

export function createChatComposerController(
  host: ChatPanelComposerHost,
  input: {
    runtimeSettings: ChatPanelRuntimeSettingsActions;
  },
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
    referenceActiveNoteOnSend: () => environment.plugin.settingsRef.settings.referenceActiveNoteOnSend(),
    sendShortcut: () => environment.plugin.settingsRef.settings.sendShortcut(),
    scrollThreadFromComposerEdges: () => environment.plugin.settingsRef.settings.scrollThreadFromComposerEdges(),
    canInterrupt: (model) => {
      return model.turnBusy && Boolean(model.activeThreadId && model.activeTurnId);
    },
    composerProjection: (model) =>
      chatPanelComposerProjection(model, {
        requestModel: (modelId) => input.runtimeSettings.requestModelFromUi(modelId),
        requestReasoningEffort: (effort) => input.runtimeSettings.requestReasoningEffortFromUi(effort),
      }),
    currentModelForSuggestions: () => {
      const current = stateStore.getState();
      const config = runtimeConfigOrDefault(current.connection.runtimeConfig);
      return resolveRuntimeControls(runtimeSnapshotForChatState(current), config).model.effective;
    },
    threadScrollFromComposer: (action) => {
      host.threadStreamScrollBinding.scrollFromComposer(action);
    },
    togglePlan: () => void input.runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void input.runtimeSettings.toggleAutoReview(),
    toggleFast: () => void input.runtimeSettings.toggleFastMode(),
    onDraftChange: () => {
      environment.plugin.workspace.refreshThreadsViewLiveState();
    },
    onHeightChange: () => undefined,
    onAttachmentError: (message) => {
      new Notice(message);
    },
  });
}
