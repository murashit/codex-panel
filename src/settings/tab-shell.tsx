import type { ComponentChild as UiNode } from "preact";

import { DEFAULT_CODEX_PATH } from "../constants";
import type { SendShortcut } from "../domain/input/send-shortcut";
import { IconButton, ObsidianCommitTextInput, ObsidianDropdown, ObsidianToggle } from "../shared/obsidian/components.obsidian";
import { ArchivedThreadSection } from "./archived-section";
import { HelperSettingsSection } from "./helper-section";
import { HookSection } from "./hook-section";
import { DEFAULT_ATTACHMENT_FOLDER, DEFAULT_CLIP_FILENAME_TEMPLATE, DEFAULT_CLIP_FOLDER } from "./model";
import type { SettingsSectionsState } from "./section-state";
import { SettingRow, SettingsGroup, SettingsHeading, SettingsItems } from "./setting-components";

const SEND_SHORTCUT_LABELS = {
  enter: "Enter",
  "mod-enter": "Cmd/Ctrl+Enter",
} as const;
const SEND_SHORTCUT_OPTIONS: { value: SendShortcut; label: string }[] = [
  { value: "enter", label: SEND_SHORTCUT_LABELS.enter },
  { value: "mod-enter", label: SEND_SHORTCUT_LABELS["mod-enter"] },
];

interface SettingsTabPanelState {
  codexPath: string;
  showToolbar: boolean;
  sendShortcut: SendShortcut;
  scrollThreadFromComposerEdges: boolean;
  referenceActiveNoteOnSend: boolean;
  attachmentFolder: string;
  clipFolder: string;
  clipFilenameTemplate: string;
  clipTags: string;
}

interface SettingsTabShellActions {
  refreshDynamicSections: () => void;
  setCodexPath: (value: string) => void;
  setShowToolbar: (value: boolean) => void;
  setSendShortcut: (value: SendShortcut) => void;
  setScrollThreadFromComposerEdges: (value: boolean) => void;
  setReferenceActiveNoteOnSend: (value: boolean) => void;
  setAttachmentFolder: (value: string) => void;
  setClipFolder: (value: string) => void;
  setClipFilenameTemplate: (value: string) => void;
  setClipTags: (value: string) => void;
}

interface SettingsTabShellProps {
  introText: string;
  dynamicSectionsLoading: boolean;
  panel: SettingsTabPanelState;
  sections: SettingsSectionsState;
  actions: SettingsTabShellActions;
}

export function SettingsTabShell({ introText, dynamicSectionsLoading, panel, sections, actions }: SettingsTabShellProps): UiNode {
  return (
    <>
      <SettingsHeader introText={introText} loading={dynamicSectionsLoading} onRefresh={actions.refreshDynamicSections} />
      <GeneralSettingsSection panel={panel} actions={actions} />
      <HelperSettingsSection state={sections.helper} />
      <ComposerSettingsSection panel={panel} actions={actions} />
      <ArchivedThreadSection state={sections.archived} />
      <HookSection state={sections.hooks} />
    </>
  );
}

function SettingsHeader({ introText, loading, onRefresh }: { introText: string; loading: boolean; onRefresh: () => void }): UiNode {
  return (
    <div className="setting-item setting-item-heading codex-panel-settings__header">
      <div className="setting-item-info">
        <div className="setting-item-description codex-panel-settings__section-intro">{introText}</div>
      </div>
      <div className="setting-item-control">
        <IconButton
          icon="refresh-cw"
          label={loading ? "Refreshing Codex details" : "Refresh Codex details"}
          className="clickable-icon codex-panel-settings__refresh-button"
          disabled={loading}
          onClick={onRefresh}
        />
      </div>
    </div>
  );
}

function GeneralSettingsSection({ panel, actions }: { panel: SettingsTabPanelState; actions: SettingsTabShellActions }): UiNode {
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

function ComposerSettingsSection({ panel, actions }: { panel: SettingsTabPanelState; actions: SettingsTabShellActions }): UiNode {
  return (
    <>
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
            name="Scroll thread from composer line edges"
            desc="Lets Up/Ctrl+P and Down/Ctrl+N scroll the thread from composer line edges."
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
      <SettingsGroup className="codex-panel-settings__section codex-panel-settings__web-clipping-section">
        <SettingsHeading name="Web clipping" />
        <SettingsItems>
          <SettingRow name="Clipped note folder" desc="Vault-relative folder for notes created by /clip.">
            <ObsidianCommitTextInput
              value={panel.clipFolder}
              placeholder={DEFAULT_CLIP_FOLDER}
              normalizeValue={(value) => value.trim() || DEFAULT_CLIP_FOLDER}
              onCommit={actions.setClipFolder}
            />
          </SettingRow>
          <SettingRow
            name="Clipped note filename"
            desc="Filename template. Supports {{date}}, {{time}}, {{title}}, {{site}}, and {{domain}}."
          >
            <ObsidianCommitTextInput
              value={panel.clipFilenameTemplate}
              placeholder={DEFAULT_CLIP_FILENAME_TEMPLATE}
              normalizeValue={(value) => value.trim() || DEFAULT_CLIP_FILENAME_TEMPLATE}
              onCommit={actions.setClipFilenameTemplate}
            />
          </SettingRow>
          <SettingRow name="Clipped note tags" desc="Comma-separated tags added to clipped notes.">
            <ObsidianCommitTextInput
              value={panel.clipTags}
              placeholder="web, clipping"
              normalizeValue={(value) => value.trim()}
              onCommit={actions.setClipTags}
            />
          </SettingRow>
        </SettingsItems>
      </SettingsGroup>
    </>
  );
}
