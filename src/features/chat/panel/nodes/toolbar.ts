import { toolbarNode } from "../../ui/toolbar";
import { toolbarViewModel as buildToolbarViewModel } from "../model";
import type { ChatPanelToolbarPorts } from "./types";

export function toolbarPanelNode(ports: ChatPanelToolbarPorts) {
  return toolbarNode(toolbarViewModel(ports), ports.actions.toolbar);
}

function toolbarViewModel(ports: ChatPanelToolbarPorts) {
  return buildToolbarViewModel({
    state: ports.state.chat(),
    snapshot: ports.runtime.snapshot(),
    connected: ports.state.connected(),
    turnBusy: ports.state.turnBusy(),
    vaultPath: ports.settings.vaultPath(),
    configuredCommand: ports.settings.configuredCommand(),
    archiveConfirmThreadId: ports.view.toolbar.archiveConfirmId(),
    archiveExportEnabled: ports.settings.archiveExportEnabled(),
    renameState: (threadId) => ports.view.toolbar.renameState(threadId),
  });
}
