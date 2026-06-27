import type { TargetedEvent, TargetedKeyboardEvent, ComponentChild as UiNode } from "preact";
import { useEffect, useState } from "preact/hooks";

import { DEFAULT_CODEX_PATH } from "../constants";
import { IconButton } from "../shared/ui/components.obsidian";
import type { SendShortcut } from "../shared/ui/keyboard";
import { ArchivedThreadSection } from "./archived-section";
import { HelperSettingsSection } from "./helper-section";
import { HookSection } from "./hook-section";
import type { SettingsSectionsState } from "./section-state";
import { SettingRow, SettingsGroup, SettingsHeading, SettingsItems } from "./setting-components";

const SEND_SHORTCUT_LABELS = {
  enter: "Enter",
  "mod-enter": "Cmd/Ctrl+Enter",
} as const;

interface SettingsTabPanelState {
  codexPath: string;
  showToolbar: boolean;
  sendShortcut: SendShortcut;
  scrollThreadFromComposerEdges: boolean;
}

interface SettingsTabShellActions {
  refreshDynamicSections: () => void;
  setCodexPath: (value: string) => void;
  setShowToolbar: (value: boolean) => void;
  setSendShortcut: (value: SendShortcut) => void;
  setScrollThreadFromComposerEdges: (value: boolean) => void;
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
      <PanelPreferenceSections panel={panel} actions={actions} />
      <HelperSettingsSection state={sections.helper} />
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

function PanelPreferenceSections({ panel, actions }: { panel: SettingsTabPanelState; actions: SettingsTabShellActions }): UiNode {
  return (
    <>
      <SettingsGroup className="codex-panel-settings__section codex-panel-settings__general-section">
        <SettingsItems>
          <SettingRow name="Codex executable" desc="Command used to start `codex app-server`; use an absolute path if needed.">
            <CommitTextInput value={panel.codexPath} placeholder={DEFAULT_CODEX_PATH} onCommit={actions.setCodexPath} />
          </SettingRow>
          <SettingRow name="Show chat toolbar" desc="Show the toolbar above the chat panel.">
            <SettingsCheckbox checked={panel.showToolbar} onChange={actions.setShowToolbar} />
          </SettingRow>
        </SettingsItems>
      </SettingsGroup>
      <SettingsGroup className="codex-panel-settings__section codex-panel-settings__composer-section">
        <SettingsHeading name="Composer" />
        <SettingsItems>
          <SettingRow name="Send shortcut" desc="Pick Enter or Cmd/Ctrl+Enter. Shift+Enter adds a newline when Enter sends.">
            <select
              value={panel.sendShortcut}
              onChange={(event) => {
                actions.setSendShortcut(event.currentTarget.value === "mod-enter" ? "mod-enter" : "enter");
              }}
            >
              <option value="enter">{SEND_SHORTCUT_LABELS.enter}</option>
              <option value="mod-enter">{SEND_SHORTCUT_LABELS["mod-enter"]}</option>
            </select>
          </SettingRow>
          <SettingRow
            name="Scroll thread from composer line edges"
            desc="Use Up/Ctrl+P and Down/Ctrl+N at composer line edges to scroll the thread."
          >
            <SettingsCheckbox checked={panel.scrollThreadFromComposerEdges} onChange={actions.setScrollThreadFromComposerEdges} />
          </SettingRow>
        </SettingsItems>
      </SettingsGroup>
    </>
  );
}

function CommitTextInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}): UiNode {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = (nextValue = draft): void => {
    onCommit(nextValue);
  };
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      onInput={(event) => {
        setDraft(event.currentTarget.value);
      }}
      onBlur={(event) => {
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event: TargetedKeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit(event.currentTarget.value);
      }}
    />
  );
}

function SettingsCheckbox({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }): UiNode {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event: TargetedEvent<HTMLInputElement>) => {
        onChange(event.currentTarget.checked);
      }}
    />
  );
}
