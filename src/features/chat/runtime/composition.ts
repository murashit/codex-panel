import { createChatRuntimeSettingsActions } from "./runtime-settings-actions";
import type { ChatPanelContext } from "../panel/context";

export function createChatRuntimeControllerGroup(context: ChatPanelContext) {
  const { runtime, status } = context;

  const runtimeSettings = createChatRuntimeSettingsActions({
    stateStore: context.state.stateStore,
    currentClient: context.client.getClient,
    runtimeSnapshot: runtime.runtimeSnapshot,
    collaborationModeLabel: runtime.collaborationModeLabel,
    addSystemMessage: status.addSystemMessage,
  });

  return { runtimeSettings };
}
