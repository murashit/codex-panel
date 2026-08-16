import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../domain/catalog/metadata";
import { normalizeReasoningEffort } from "../domain/catalog/metadata";
import type { SendShortcut } from "../domain/input/send-shortcut";

export interface CodexPanelSettings {
  codexPath: string;
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
  showToolbar: boolean;
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
  sendShortcut: "enter",
  scrollThreadFromComposerEdges: false,
  referenceActiveNoteOnSend: false,
  attachmentFolder: DEFAULT_ATTACHMENT_FOLDER,
  archiveExportEnabled: false,
  archiveExportFolderTemplate: DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE,
  archiveExportFilenameTemplate: DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE,
  archiveExportTags: "",
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof CodexPanelSettings)[];

export function normalizeSettings(storedSettings: unknown): CodexPanelSettings {
  const record = asRecord(storedSettings);
  return {
    codexPath: normalizeCodexPath(record["codexPath"]),
    threadNamingModel: modelOrDefault(record["threadNamingModel"], DEFAULT_SETTINGS.threadNamingModel),
    threadNamingEffort: reasoningEffortOrDefault(record["threadNamingEffort"], DEFAULT_SETTINGS.threadNamingEffort),
    rewriteSelectionModel: modelOrDefault(record["rewriteSelectionModel"], DEFAULT_SETTINGS.rewriteSelectionModel),
    rewriteSelectionEffort: reasoningEffortOrDefault(record["rewriteSelectionEffort"], DEFAULT_SETTINGS.rewriteSelectionEffort),
    showToolbar: booleanOrDefault(record["showToolbar"], DEFAULT_SETTINGS.showToolbar),
    sendShortcut: record["sendShortcut"] === "mod-enter" ? "mod-enter" : DEFAULT_SETTINGS.sendShortcut,
    scrollThreadFromComposerEdges: booleanOrDefault(
      record["scrollThreadFromComposerEdges"],
      DEFAULT_SETTINGS.scrollThreadFromComposerEdges,
    ),
    referenceActiveNoteOnSend: booleanOrDefault(record["referenceActiveNoteOnSend"], DEFAULT_SETTINGS.referenceActiveNoteOnSend),
    attachmentFolder: normalizeAttachmentFolder(record["attachmentFolder"]),
    archiveExportEnabled: booleanOrDefault(record["archiveExportEnabled"], DEFAULT_SETTINGS.archiveExportEnabled),
    archiveExportFolderTemplate: normalizeArchiveExportFolderTemplate(record["archiveExportFolderTemplate"]),
    archiveExportFilenameTemplate: normalizeArchiveExportFilenameTemplate(record["archiveExportFilenameTemplate"]),
    archiveExportTags: normalizeArchiveExportTags(record["archiveExportTags"]),
  };
}

export function normalizeCodexPath(value: unknown): string {
  return stringOrDefault(value, DEFAULT_CODEX_PATH).trim() || DEFAULT_CODEX_PATH;
}

export function normalizeAttachmentFolder(value: unknown): string {
  return stringOrDefault(value, DEFAULT_ATTACHMENT_FOLDER).trim() || DEFAULT_ATTACHMENT_FOLDER;
}

export function normalizeArchiveExportFolderTemplate(value: unknown): string {
  return stringOrDefault(value, DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE).trim() || DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE;
}

export function normalizeArchiveExportFilenameTemplate(value: unknown): string {
  return stringOrDefault(value, DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE).trim() || DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE;
}

export function normalizeArchiveExportTags(value: unknown): string {
  return stringOrDefault(value, DEFAULT_SETTINGS.archiveExportTags).trim();
}

export function settingsMatchStoredSettings(storedSettings: unknown, settings: CodexPanelSettings): boolean {
  const record = asRecord(storedSettings);
  return Object.keys(record).length === SETTINGS_KEYS.length && SETTINGS_KEYS.every((key) => record[key] === settings[key]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
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
