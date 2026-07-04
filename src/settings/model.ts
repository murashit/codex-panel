import { type App, FileSystemAdapter } from "obsidian";

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
  attachActiveNoteOnSend: boolean;
  attachmentFolder: string;
  archiveExportEnabled: boolean;
  archiveExportFolderTemplate: string;
  archiveExportFilenameTemplate: string;
  archiveExportTags: string;
}

export const DEFAULT_ATTACHMENT_FOLDER = "Codex Attachments";

export const DEFAULT_SETTINGS: CodexPanelSettings = {
  codexPath: DEFAULT_CODEX_PATH,
  threadNamingModel: null,
  threadNamingEffort: null,
  rewriteSelectionModel: null,
  rewriteSelectionEffort: null,
  showToolbar: true,
  sendShortcut: "enter",
  scrollThreadFromComposerEdges: false,
  attachActiveNoteOnSend: false,
  attachmentFolder: DEFAULT_ATTACHMENT_FOLDER,
  archiveExportEnabled: false,
  archiveExportFolderTemplate: "Codex Archives",
  archiveExportFilenameTemplate: "{{date}} {{time}} {{title}} {{shortId}}.md",
  archiveExportTags: "",
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof CodexPanelSettings)[];

export function normalizeSettings(storedSettings: unknown): CodexPanelSettings {
  const record = asRecord(storedSettings);
  return {
    codexPath: stringOrDefault(record["codexPath"], DEFAULT_CODEX_PATH).trim() || DEFAULT_CODEX_PATH,
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
    attachActiveNoteOnSend: booleanOrDefault(record["attachActiveNoteOnSend"], DEFAULT_SETTINGS.attachActiveNoteOnSend),
    attachmentFolder:
      stringOrDefault(record["attachmentFolder"], DEFAULT_SETTINGS.attachmentFolder).trim() || DEFAULT_SETTINGS.attachmentFolder,
    archiveExportEnabled: booleanOrDefault(record["archiveExportEnabled"], DEFAULT_SETTINGS.archiveExportEnabled),
    archiveExportFolderTemplate: stringOrDefault(
      record["archiveExportFolderTemplate"],
      DEFAULT_SETTINGS.archiveExportFolderTemplate,
    ).trim(),
    archiveExportFilenameTemplate:
      stringOrDefault(record["archiveExportFilenameTemplate"], DEFAULT_SETTINGS.archiveExportFilenameTemplate).trim() ||
      DEFAULT_SETTINGS.archiveExportFilenameTemplate,
    archiveExportTags: stringOrDefault(record["archiveExportTags"], DEFAULT_SETTINGS.archiveExportTags).trim(),
  };
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

export function getVaultPath(app: App): string {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const basePath = adapter.getBasePath();
    if (basePath.length > 0) return basePath;
  }
  throw new Error("This plugin requires a desktop vault with a local basePath.");
}
