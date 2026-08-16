import type { ComponentChild as UiNode } from "preact";

import type { SendShortcut } from "../../domain/input/send-shortcut";
import { IconButton } from "../../shared/ui/icon.dom";
import { normalizeAttachmentFolder, normalizeCodexPath } from "../preferences";
import { ArchivedThreadsSection } from "./archived-threads";
import { CodexHooksSection } from "./codex-hooks";
import { ObsidianCommitTextInput, ObsidianDropdown, ObsidianToggle } from "./controls.obsidian";
import {
  ACTIVE_FILE_REFERENCE_SETTING,
  ATTACHMENT_FOLDER_SETTING,
  CODEX_EXECUTABLE_SETTING,
  COMPOSER_SCROLL_SETTING,
  SEND_SHORTCUT_OPTIONS,
  SEND_SHORTCUT_SETTING,
  SHOW_TOOLBAR_SETTING,
} from "./definitions";
import { SettingRow, SettingsGroup, SettingsHeading, SettingsItems } from "./layout";
import { PanelHelpersSection } from "./panel-helpers";
import type { SettingsViewModel } from "./view-model";

interface LegacySettingsPanelState {
  codexPath: string;
  showToolbar: boolean;
  sendShortcut: SendShortcut;
  scrollThreadFromComposerEdges: boolean;
  referenceActiveNoteOnSend: boolean;
  attachmentFolder: string;
}

interface LegacySettingsActions {
  refreshResources: () => void;
  setCodexPath: (value: string) => void;
  setShowToolbar: (value: boolean) => void;
  setSendShortcut: (value: SendShortcut) => void;
  setScrollThreadFromComposerEdges: (value: boolean) => void;
  setReferenceActiveNoteOnSend: (value: boolean) => void;
  setAttachmentFolder: (value: string) => void;
}

interface LegacySettingsViewProps {
  introText: string;
  resourcesRefreshDisabled: boolean;
  panel: LegacySettingsPanelState;
  viewModel: SettingsViewModel;
  actions: LegacySettingsActions;
}

export function LegacySettingsView({ introText, resourcesRefreshDisabled, panel, viewModel, actions }: LegacySettingsViewProps): UiNode {
  return (
    <>
      <SettingsHeader introText={introText} refreshDisabled={resourcesRefreshDisabled} onRefresh={actions.refreshResources} />
      <GeneralSettingsSection panel={panel} actions={actions} />
      <PanelHelpersSection state={viewModel.helper} />
      <ComposerSettingsSection panel={panel} actions={actions} />
      <ArchivedThreadsSection state={viewModel.archived} />
      <CodexHooksSection state={viewModel.hooks} />
    </>
  );
}

function SettingsHeader({
  introText,
  refreshDisabled,
  onRefresh,
}: {
  introText: string;
  refreshDisabled: boolean;
  onRefresh: () => void;
}): UiNode {
  return (
    <div className="setting-item setting-item-heading codex-panel-settings__header">
      <div className="setting-item-info">
        <div className="setting-item-description codex-panel-settings__section-intro">{introText}</div>
      </div>
      <div className="setting-item-control">
        <IconButton
          icon="refresh-cw"
          label={refreshDisabled ? "Refreshing Codex details" : "Refresh Codex details"}
          className="clickable-icon codex-panel-settings__refresh-button"
          disabled={refreshDisabled}
          onClick={onRefresh}
        />
      </div>
    </div>
  );
}

function GeneralSettingsSection({ panel, actions }: { panel: LegacySettingsPanelState; actions: LegacySettingsActions }): UiNode {
  return (
    <SettingsGroup className="codex-panel-settings__section codex-panel-settings__general-section">
      <SettingsItems>
        <SettingRow name={CODEX_EXECUTABLE_SETTING.name} desc={CODEX_EXECUTABLE_SETTING.desc}>
          <ObsidianCommitTextInput
            value={panel.codexPath}
            placeholder={CODEX_EXECUTABLE_SETTING.placeholder}
            normalizeValue={normalizeCodexPath}
            onCommit={actions.setCodexPath}
          />
        </SettingRow>
        <SettingRow name={SHOW_TOOLBAR_SETTING.name} desc={SHOW_TOOLBAR_SETTING.desc}>
          <ObsidianToggle checked={panel.showToolbar} onChange={actions.setShowToolbar} />
        </SettingRow>
      </SettingsItems>
    </SettingsGroup>
  );
}

function ComposerSettingsSection({ panel, actions }: { panel: LegacySettingsPanelState; actions: LegacySettingsActions }): UiNode {
  return (
    <SettingsGroup className="codex-panel-settings__section codex-panel-settings__composer-section">
      <SettingsHeading name="Composer" />
      <SettingsItems>
        <SettingRow name={SEND_SHORTCUT_SETTING.name} desc={SEND_SHORTCUT_SETTING.desc}>
          <ObsidianDropdown
            value={panel.sendShortcut}
            onChange={(value) => {
              actions.setSendShortcut(value === "mod-enter" ? "mod-enter" : "enter");
            }}
            options={SEND_SHORTCUT_OPTIONS}
          />
        </SettingRow>
        <SettingRow name={COMPOSER_SCROLL_SETTING.name} desc={COMPOSER_SCROLL_SETTING.desc}>
          <ObsidianToggle checked={panel.scrollThreadFromComposerEdges} onChange={actions.setScrollThreadFromComposerEdges} />
        </SettingRow>
        <SettingRow name={ACTIVE_FILE_REFERENCE_SETTING.name} desc={ACTIVE_FILE_REFERENCE_SETTING.desc}>
          <ObsidianToggle checked={panel.referenceActiveNoteOnSend} onChange={actions.setReferenceActiveNoteOnSend} />
        </SettingRow>
        <SettingRow name={ATTACHMENT_FOLDER_SETTING.name} desc={ATTACHMENT_FOLDER_SETTING.desc}>
          <ObsidianCommitTextInput
            value={panel.attachmentFolder}
            placeholder={ATTACHMENT_FOLDER_SETTING.placeholder}
            normalizeValue={normalizeAttachmentFolder}
            onCommit={actions.setAttachmentFolder}
          />
        </SettingRow>
      </SettingsItems>
    </SettingsGroup>
  );
}
