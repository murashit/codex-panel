import type { ComponentChild as UiNode } from "preact";

import { DEFAULT_CODEX_PATH } from "../../constants";
import type { SendShortcut } from "../../domain/input/send-shortcut";
import { IconButton } from "../../shared/ui/icon.dom";
import { DEFAULT_ATTACHMENT_FOLDER } from "../preferences";
import { ArchivedThreadsSection } from "./archived-threads";
import { CodexHooksSection } from "./codex-hooks";
import { ObsidianCommitTextInput, ObsidianDropdown, ObsidianToggle } from "./controls.obsidian";
import { SettingRow, SettingsGroup, SettingsHeading, SettingsItems } from "./layout";
import { PanelHelpersSection } from "./panel-helpers";
import type { SettingsViewModel } from "./view-model";

const SEND_SHORTCUT_LABELS = {
  enter: "Enter",
  "mod-enter": "Cmd/Ctrl+Enter",
} as const;
const SEND_SHORTCUT_OPTIONS: { value: SendShortcut; label: string }[] = [
  { value: "enter", label: SEND_SHORTCUT_LABELS.enter },
  { value: "mod-enter", label: SEND_SHORTCUT_LABELS["mod-enter"] },
];

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
        <SettingRow
          name="Codex executable"
          desc="Command used to start `codex app-server`. Use an absolute path when Obsidian cannot find `codex`."
        >
          <ObsidianCommitTextInput
            value={panel.codexPath}
            placeholder={DEFAULT_CODEX_PATH}
            normalizeValue={(value) => value.trim() || DEFAULT_CODEX_PATH}
            onCommit={actions.setCodexPath}
          />
        </SettingRow>
        <SettingRow name="Show chat toolbar" desc="Shows the toolbar above chat panels.">
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
        <SettingRow
          name="Send shortcut"
          desc="Controls whether Enter or Cmd/Ctrl+Enter sends composer-style inputs. Shift+Enter adds a newline."
        >
          <ObsidianDropdown
            value={panel.sendShortcut}
            onChange={(value) => {
              actions.setSendShortcut(value === "mod-enter" ? "mod-enter" : "enter");
            }}
            options={SEND_SHORTCUT_OPTIONS}
          />
        </SettingRow>
        <SettingRow
          name="Scroll conversation from composer line edges"
          desc="Lets Up/Ctrl+P and Down/Ctrl+N scroll the conversation from composer line edges."
        >
          <ObsidianToggle checked={panel.scrollThreadFromComposerEdges} onChange={actions.setScrollThreadFromComposerEdges} />
        </SettingRow>
        <SettingRow
          name="Reference active file on send"
          desc="Adds the active file as context on each send without changing the prompt text."
        >
          <ObsidianToggle checked={panel.referenceActiveNoteOnSend} onChange={actions.setReferenceActiveNoteOnSend} />
        </SettingRow>
        <SettingRow name="Attachment folder" desc="Vault-relative folder for files pasted or dropped into composer inputs.">
          <ObsidianCommitTextInput
            value={panel.attachmentFolder}
            placeholder={DEFAULT_ATTACHMENT_FOLDER}
            normalizeValue={(value) => value.trim() || DEFAULT_ATTACHMENT_FOLDER}
            onCommit={actions.setAttachmentFolder}
          />
        </SettingRow>
      </SettingsItems>
    </SettingsGroup>
  );
}
