import type { ArchiveExportSettings } from "../../domain/threads/archive-markdown";
import type { CodexPanelSettings } from "../../settings/model";

export function archiveExportSettings(settings: CodexPanelSettings): ArchiveExportSettings {
  return {
    archiveExportFolderTemplate: settings.archiveExportFolderTemplate,
    archiveExportFilenameTemplate: settings.archiveExportFilenameTemplate,
    archiveExportTags: settings.archiveExportTags,
  };
}
