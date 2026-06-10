import { renderToolbar } from "../../ui/toolbar";
import { toolbarViewModel as buildToolbarViewModel } from "../model";
import type { ChatViewSlotRendererPorts } from "./types";

export function renderToolbarSlot(toolbar: HTMLElement, ports: ChatViewSlotRendererPorts): void {
  renderToolbar(toolbar, toolbarViewModel(ports), ports.actions.toolbar);
}

function toolbarViewModel(ports: ChatViewSlotRendererPorts) {
  return buildToolbarViewModel({
    state: ports.state.chat(),
    snapshot: ports.runtime.snapshot(),
    connected: ports.state.connected(),
    turnBusy: ports.state.turnBusy(),
    vaultPath: ports.settings.vaultPath(),
    configuredCommand: ports.settings.configuredCommand(),
    archiveConfirmThreadId: ports.actions.toolbar.archiveConfirmId(),
    archiveExportEnabled: ports.settings.archiveExportEnabled(),
    renameState: (threadId) => ports.actions.toolbar.renameState(threadId),
  });
}
