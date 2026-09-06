import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { runtimeSnapshotForChatSlices } from "../../application/runtime/snapshot";
import type { ComposerShellProps } from "../../ui/composer/composer";
import { composerPresentation } from "../../ui/composer/presentation";
import type { ChatPanelComposerModel } from "../shell/selectors";

export interface ChatPanelComposerRuntimeActions {
  requestModel: (model: string) => Promise<void>;
  requestReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
}

export interface ChatPanelComposerPresenter {
  renderState(model: ChatPanelComposerModel, actions: ChatPanelComposerActions): ComposerShellProps;
}

export interface ChatPanelComposerActions {
  submit: () => void;
}

export function projectChatPanelComposer(model: ChatPanelComposerModel, actions: ChatPanelComposerRuntimeActions) {
  const snapshot = runtimeSnapshotForChatSlices({
    runtimeConfig: model.runtimeConfig,
    activeThread: { id: model.activeThreadId, tokenUsage: model.activeThreadTokenUsage },
    runtime: model.runtime,
    rateLimit: model.rateLimit,
    hasThreadTurns: model.hasThreadTurns,
    availableModels: model.availableModels,
  });
  return composerPresentation(
    {
      snapshot,
      disconnected: model.connectionPhase.kind === "failed" || model.connectionPhase.kind === "disconnected",
      threadName: model.activeThreadId ? model.activeListedThreadName : null,
      sideChatActive: model.sideChatActive,
      sideChatSourceTitle: model.sideChatSourceTitle,
      inputRestriction:
        model.canAcceptDirectInput === false
          ? "read-only"
          : model.activeThreadSubagent && model.canAcceptDirectInput === null
            ? "agent-unknown"
            : null,
    },
    actions,
  );
}
