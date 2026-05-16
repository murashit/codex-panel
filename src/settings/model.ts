import { FileSystemAdapter, type App } from "obsidian";

import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import { normalizeReasoningEffort } from "../runtime/model";

export interface CodexPanelSettings {
  codexPath: string;
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
  sendShortcut: SendShortcut;
}

export type SendShortcut = "enter" | "mod-enter";

export const DEFAULT_SETTINGS: CodexPanelSettings = {
  codexPath: DEFAULT_CODEX_PATH,
  threadNamingModel: null,
  threadNamingEffort: null,
  sendShortcut: "enter",
};

export function normalizeSettings(data: unknown): CodexPanelSettings {
  const record = asRecord(data);
  return {
    codexPath: stringOrDefault(record.codexPath, DEFAULT_CODEX_PATH).trim() || DEFAULT_CODEX_PATH,
    threadNamingModel: threadNamingModelOrDefault(record.threadNamingModel),
    threadNamingEffort: reasoningEffortOrDefault(record.threadNamingEffort),
    sendShortcut: sendShortcutOrDefault(record.sendShortcut),
  };
}

export function settingsMatchNormalizedData(data: unknown, settings: CodexPanelSettings): boolean {
  const record = asRecord(data);
  return (
    Object.keys(record).length === 4 &&
    record.codexPath === settings.codexPath &&
    record.threadNamingModel === settings.threadNamingModel &&
    record.threadNamingEffort === settings.threadNamingEffort &&
    record.sendShortcut === settings.sendShortcut
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function threadNamingModelOrDefault(value: unknown): string | null {
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
