import { DEFAULT_CODEX_PATH } from "../../constants";
import type { SendShortcut } from "../../domain/input/send-shortcut";
import {
  DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE,
  DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE,
  DEFAULT_ATTACHMENT_FOLDER,
} from "../preferences";

interface SettingDefinition {
  readonly name: string;
  readonly desc: string;
}

interface TextSettingDefinition extends SettingDefinition {
  readonly placeholder: string;
}

export const SETTINGS_INTRO_TEXT = "Codex Panel stores panel preferences only. Runtime settings still come from Codex.";

export const CODEX_EXECUTABLE_SETTING: TextSettingDefinition = {
  name: "Codex executable",
  desc: "Command used to start `codex app-server`. Use an absolute path when Obsidian cannot find `codex`.",
  placeholder: DEFAULT_CODEX_PATH,
};

export const SHOW_TOOLBAR_SETTING: SettingDefinition = {
  name: "Show chat toolbar",
  desc: "Shows the toolbar above chat panels.",
};

export const THREAD_NAMING_SETTING: SettingDefinition = {
  name: "Automatic thread naming",
  desc: "Model and effort used when Codex Panel generates thread names.",
};

export const SELECTION_REWRITE_SETTING: SettingDefinition = {
  name: "Selection rewrite",
  desc: "Model and effort used by Rewrite selection.",
};

export const SEND_SHORTCUT_LABELS: Record<SendShortcut, string> = {
  enter: "Enter",
  "mod-enter": "Cmd/Ctrl+Enter",
};

export const SEND_SHORTCUT_OPTIONS: readonly { value: SendShortcut; label: string }[] = [
  { value: "enter", label: SEND_SHORTCUT_LABELS.enter },
  { value: "mod-enter", label: SEND_SHORTCUT_LABELS["mod-enter"] },
];

export const SEND_SHORTCUT_SETTING: SettingDefinition = {
  name: "Send shortcut",
  desc: "Controls whether Enter or Cmd/Ctrl+Enter sends composer-style inputs. Shift+Enter adds a newline.",
};

export const COMPOSER_SCROLL_SETTING: SettingDefinition = {
  name: "Scroll conversation from composer line edges",
  desc: "Lets Up/Ctrl+P and Down/Ctrl+N scroll the conversation from composer line edges.",
};

export const ACTIVE_FILE_REFERENCE_SETTING: SettingDefinition = {
  name: "Reference active file on send",
  desc: "Adds the active file as context on each send without changing the prompt text.",
};

export const ATTACHMENT_FOLDER_SETTING: TextSettingDefinition = {
  name: "Attachment folder",
  desc: "Vault-relative folder for files pasted or dropped into composer inputs.",
  placeholder: DEFAULT_ATTACHMENT_FOLDER,
};

export const ARCHIVE_EXPORT_ENABLED_SETTING: SettingDefinition = {
  name: "Save note by default",
  desc: "Makes Save and archive thread the default archive action.",
};

export const ARCHIVE_EXPORT_FOLDER_SETTING: TextSettingDefinition = {
  name: "Saved note folder",
  desc: "Vault-relative folder for archived thread notes.",
  placeholder: DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE,
};

export const ARCHIVE_EXPORT_FILENAME_SETTING: TextSettingDefinition = {
  name: "Saved note filename",
  desc: "Filename template. Supports {{date}}, {{time}}, {{title}}, {{id}}, and {{shortId}}.",
  placeholder: DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE,
};

export const ARCHIVE_EXPORT_TAGS_SETTING: TextSettingDefinition = {
  name: "Saved note tags",
  desc: "Comma-separated tags added to saved thread notes.",
  placeholder: "codex, archive",
};
