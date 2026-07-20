import type { ChatPanelSettingsAccess } from "../../../../src/features/chat/host/contracts";
import type { CodexPanelSettings } from "../../../../src/settings/model";

export function chatPanelSettingsAccess(settings: CodexPanelSettings): ChatPanelSettingsAccess {
  return {
    referenceActiveNoteOnSend: () => settings.referenceActiveNoteOnSend,
    attachmentFolder: () => settings.attachmentFolder,
    archiveExportEnabled: () => settings.archiveExportEnabled,
    archiveExportSettings: () => ({
      archiveExportFolderTemplate: settings.archiveExportFolderTemplate,
      archiveExportFilenameTemplate: settings.archiveExportFilenameTemplate,
      archiveExportTags: settings.archiveExportTags,
    }),
    scrollThreadFromComposerEdges: () => settings.scrollThreadFromComposerEdges,
    sendShortcut: () => settings.sendShortcut,
    showToolbar: () => settings.showToolbar,
  };
}
