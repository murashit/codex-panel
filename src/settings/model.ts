import { FileSystemAdapter, type App } from "obsidian";

import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import { normalizeReasoningEffort } from "../runtime/model";
import type { SendShortcut } from "../shared/ui/keyboard";

export interface CodexPanelSettings {
  codexPath: string;
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
  sendShortcut: SendShortcut;
  archiveExportEnabled: boolean;
  archiveExportFolderTemplate: string;
  archiveExportFilenameTemplate: string;
  archiveExportTags: string;
}

export const DEFAULT_SETTINGS: CodexPanelSettings = {
  codexPath: DEFAULT_CODEX_PATH,
  threadNamingModel: null,
  threadNamingEffort: null,
  rewriteSelectionModel: null,
  rewriteSelectionEffort: null,
  sendShortcut: "enter",
  archiveExportEnabled: false,
  archiveExportFolderTemplate: "Codex Archives",
  archiveExportFilenameTemplate: "{{date}} {{time}} {{title}} {{shortId}}.md",
  archiveExportTags: "",
};

export function normalizeSettings(data: unknown): CodexPanelSettings {
  const record = asRecord(data);
  return {
    codexPath: stringOrDefault(record["codexPath"], DEFAULT_CODEX_PATH).trim() || DEFAULT_CODEX_PATH,
    threadNamingModel: modelOrDefault(record["threadNamingModel"]),
    threadNamingEffort: reasoningEffortOrDefault(record["threadNamingEffort"]),
    rewriteSelectionModel: modelOrDefault(record["rewriteSelectionModel"]),
    rewriteSelectionEffort: reasoningEffortOrDefault(record["rewriteSelectionEffort"]),
    sendShortcut: sendShortcutOrDefault(record["sendShortcut"]),
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

export function settingsMatchNormalizedData(data: unknown, settings: CodexPanelSettings): boolean {
  const record = asRecord(data);
  return (
    Object.keys(record).length === 10 &&
    record["codexPath"] === settings.codexPath &&
    record["threadNamingModel"] === settings.threadNamingModel &&
    record["threadNamingEffort"] === settings.threadNamingEffort &&
    record["rewriteSelectionModel"] === settings.rewriteSelectionModel &&
    record["rewriteSelectionEffort"] === settings.rewriteSelectionEffort &&
    record["sendShortcut"] === settings.sendShortcut &&
    record["archiveExportEnabled"] === settings.archiveExportEnabled &&
    record["archiveExportFolderTemplate"] === settings.archiveExportFolderTemplate &&
    record["archiveExportFilenameTemplate"] === settings.archiveExportFilenameTemplate &&
    record["archiveExportTags"] === settings.archiveExportTags
  );
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

function modelOrDefault(value: unknown): string | null {
  if (typeof value !== "string") return DEFAULT_SETTINGS.threadNamingModel;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function reasoningEffortOrDefault(value: unknown): ReasoningEffort | null {
  return normalizeReasoningEffort(value) ?? DEFAULT_SETTINGS.threadNamingEffort;
}

function sendShortcutOrDefault(value: unknown): SendShortcut {
  return value === "mod-enter" ? "mod-enter" : DEFAULT_SETTINGS.sendShortcut;
}

export function getVaultPath(app: App): string {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const basePath = adapter.getBasePath();
    if (basePath.length > 0) return basePath;
  }
  throw new Error("This plugin requires a desktop vault with a local basePath.");
}
