import { DEFAULT_CODEX_PATH } from "../constants";
import type { SendShortcut } from "../domain/input/send-shortcut";
import { isObjectValue } from "../domain/objects/object-value";
import type { ReasoningEffort } from "../domain/runtime/catalog";
import { normalizeReasoningEffort } from "../domain/runtime/catalog";

export interface CodexPanelSettings {
  codexPath: string;
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
  showToolbar: boolean;
  newConversationsEphemeral: boolean;
  sendShortcut: SendShortcut;
  scrollThreadFromComposerEdges: boolean;
  referenceActiveNoteOnSend: boolean;
  attachmentFolder: string;
  archiveExportEnabled: boolean;
  archiveExportFolderTemplate: string;
  archiveExportFilenameTemplate: string;
  archiveExportTags: string;
}

export const DEFAULT_ATTACHMENT_FOLDER = "Codex Attachments";
export const DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE = "Codex Archives";
export const DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE = "{{date}} {{time}} {{title}} {{shortId}}.md";

export const DEFAULT_SETTINGS: CodexPanelSettings = {
  codexPath: DEFAULT_CODEX_PATH,
  threadNamingModel: null,
  threadNamingEffort: null,
  rewriteSelectionModel: null,
  rewriteSelectionEffort: null,
  showToolbar: true,
  newConversationsEphemeral: false,
  sendShortcut: "enter",
  scrollThreadFromComposerEdges: false,
  referenceActiveNoteOnSend: false,
  attachmentFolder: DEFAULT_ATTACHMENT_FOLDER,
  archiveExportEnabled: false,
  archiveExportFolderTemplate: DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE,
  archiveExportFilenameTemplate: DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE,
  archiveExportTags: "",
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This owned object literal defines every settings key and contains no external properties.
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof CodexPanelSettings)[];

export function isCodexPanelSettingsKey(key: string): key is keyof CodexPanelSettings {
  return Object.hasOwn(DEFAULT_SETTINGS, key);
}

export function normalizeSettings(storedSettings: unknown): CodexPanelSettings {
  const record = asRecord(storedSettings);
  return {
    codexPath: normalizeTextPreference("codexPath", record["codexPath"]),
    threadNamingModel: modelOrDefault(record["threadNamingModel"], DEFAULT_SETTINGS.threadNamingModel),
    threadNamingEffort: reasoningEffortOrDefault(record["threadNamingEffort"], DEFAULT_SETTINGS.threadNamingEffort),
    rewriteSelectionModel: modelOrDefault(record["rewriteSelectionModel"], DEFAULT_SETTINGS.rewriteSelectionModel),
    rewriteSelectionEffort: reasoningEffortOrDefault(record["rewriteSelectionEffort"], DEFAULT_SETTINGS.rewriteSelectionEffort),
    showToolbar: booleanOrDefault(record["showToolbar"], DEFAULT_SETTINGS.showToolbar),
    newConversationsEphemeral: booleanOrDefault(record["newConversationsEphemeral"], DEFAULT_SETTINGS.newConversationsEphemeral),
    sendShortcut: record["sendShortcut"] === "mod-enter" ? "mod-enter" : DEFAULT_SETTINGS.sendShortcut,
    scrollThreadFromComposerEdges: booleanOrDefault(
      record["scrollThreadFromComposerEdges"],
      DEFAULT_SETTINGS.scrollThreadFromComposerEdges,
    ),
    referenceActiveNoteOnSend: booleanOrDefault(record["referenceActiveNoteOnSend"], DEFAULT_SETTINGS.referenceActiveNoteOnSend),
    attachmentFolder: normalizeTextPreference("attachmentFolder", record["attachmentFolder"]),
    archiveExportEnabled: booleanOrDefault(record["archiveExportEnabled"], DEFAULT_SETTINGS.archiveExportEnabled),
    archiveExportFolderTemplate: normalizeTextPreference("archiveExportFolderTemplate", record["archiveExportFolderTemplate"]),
    archiveExportFilenameTemplate: normalizeTextPreference("archiveExportFilenameTemplate", record["archiveExportFilenameTemplate"]),
    archiveExportTags: normalizeTextPreference("archiveExportTags", record["archiveExportTags"]),
  };
}

export type TextPreferenceKey =
  | "codexPath"
  | "attachmentFolder"
  | "archiveExportFolderTemplate"
  | "archiveExportFilenameTemplate"
  | "archiveExportTags";

export function normalizeTextPreference(key: TextPreferenceKey, value: unknown): string {
  return (typeof value === "string" && value.trim()) || DEFAULT_SETTINGS[key];
}

export function settingsMatchStoredSettings(storedSettings: unknown, settings: CodexPanelSettings): boolean {
  const record = asRecord(storedSettings);
  return Object.keys(record).length === SETTINGS_KEYS.length && SETTINGS_KEYS.every((key) => record[key] === settings[key]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObjectValue(value) ? value : {};
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function modelOrDefault(value: unknown, fallback: string | null): string | null {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function reasoningEffortOrDefault(value: unknown, fallback: ReasoningEffort | null): ReasoningEffort | null {
  return normalizeReasoningEffort(value) ?? fallback;
}
