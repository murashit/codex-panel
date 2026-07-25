import { Notice } from "obsidian";

import type { ChatRuntimeSettingsCommands } from "../../application/runtime/settings-commands";
import type { ChatStateStore } from "../../application/state/store";
import { ChatComposerController } from "../../panel/composer/controller";
import type { ChatThreadStreamScrollBinding } from "../../panel/thread-stream/scroll-binding";
import type { ChatPanelEnvironment } from "../contracts";
import { createVaultComposerAttachmentHandler } from "../obsidian/composer-attachments.obsidian";
import { VaultComposerContextReferenceProvider } from "../obsidian/vault-composer-context-reference-provider.obsidian";
import { VaultNoteCandidateProvider } from "../obsidian/vault-note-candidate-provider.obsidian";

interface ChatPanelComposerHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  threadStreamScrollBinding: ChatThreadStreamScrollBinding;
}

export function createChatComposerController(
  host: ChatPanelComposerHost,
  input: {
    runtimeSettings: ChatRuntimeSettingsCommands;
  },
): ChatComposerController {
  const { environment, stateStore } = host;
  return new ChatComposerController({
    noteCandidateProvider: new VaultNoteCandidateProvider(environment.obsidian.app),
    contextReferenceProvider: new VaultComposerContextReferenceProvider(environment.obsidian.app),
    attachmentHandler: createVaultComposerAttachmentHandler({
      app: environment.obsidian.app,
      attachmentFolder: () => environment.plugin.settings.attachmentFolder(),
    }),
    sourcePath: () => environment.obsidian.app.workspace.getActiveFile()?.path ?? "",
    stateStore,
    viewId: environment.obsidian.viewId,
    referenceActiveNoteOnSend: () => environment.plugin.settings.referenceActiveNoteOnSend(),
    sendShortcut: () => environment.plugin.settings.sendShortcut(),
    scrollThreadFromComposerEdges: () => environment.plugin.settings.scrollThreadFromComposerEdges(),
    runtimeActions: {
      requestModel: (modelId) => input.runtimeSettings.requestModelFromUi(modelId),
      requestReasoningEffort: (effort) => input.runtimeSettings.requestReasoningEffortFromUi(effort),
    },
    threadScrollFromComposer: (action) => {
      host.threadStreamScrollBinding.scrollFromComposer(action);
    },
    togglePlan: () => void input.runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void input.runtimeSettings.toggleAutoReview(),
    toggleFast: () => void input.runtimeSettings.toggleFastMode(),
    canFocus: environment.obsidian.isForeground,
    onAttachmentError: (message) => {
      new Notice(message);
    },
    sharedResources: {
      runtimeConfigSnapshot: () => environment.plugin.appServerQueries.runtimeConfigSnapshot(),
      rateLimitsSnapshot: () => environment.plugin.appServerQueries.rateLimitsSnapshot(),
      modelsSnapshot: () => environment.plugin.appServerQueries.modelsSnapshot(),
      skillsSnapshot: () => environment.plugin.appServerQueries.skillsSnapshot(),
      permissionProfilesSnapshot: () => environment.plugin.appServerQueries.permissionProfilesSnapshot(),
      activeThreadsSnapshot: () => environment.plugin.threadCatalog.activeThreadsSnapshot(),
      subscribe: (listener) => {
        const unsubscribers = [
          environment.plugin.appServerQueries.observeRuntimeConfigResource(() => {
            listener();
          }),
          environment.plugin.appServerQueries.observeModelsResource(() => {
            listener();
          }),
          environment.plugin.appServerQueries.observeSkillsResource(() => {
            listener();
          }),
          environment.plugin.appServerQueries.observePermissionProfilesResource(() => {
            listener();
          }),
          environment.plugin.threadCatalog.observeActiveThreadsResult(() => {
            listener();
          }),
        ];
        return () => {
          for (const unsubscribe of unsubscribers) unsubscribe();
        };
      },
    },
  });
}
