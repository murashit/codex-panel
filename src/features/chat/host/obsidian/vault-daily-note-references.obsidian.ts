import { type App, moment, normalizePath, TFile } from "obsidian";
import { appHasDailyNotesPluginLoaded, getDailyNoteSettings, type IPeriodicNoteSettings } from "obsidian-daily-notes-interface";

import type { DailyNoteReferenceCandidate } from "../../application/composer/daily-note-references";
import { displayNameForFile, linktextForFile } from "./vault-note-links.obsidian";

const RELATIVE_DAILY_NOTES = [
  { keyword: "today", display: "Today", dayOffset: 0 },
  { keyword: "tomorrow", display: "Tomorrow", dayOffset: 1 },
  { keyword: "yesterday", display: "Yesterday", dayOffset: -1 },
] as const;

interface DailyNoteMoment {
  add(amount: number, unit: "day"): DailyNoteMoment;
  format(pattern: string): string;
}

export function configuredDailyNoteReferences(app: App, sourcePath: string): readonly DailyNoteReferenceCandidate[] {
  try {
    if (!appHasDailyNotesPluginLoaded()) return [];
    const settings = getDailyNoteSettings() as IPeriodicNoteSettings | undefined;
    if (!settings?.format) return [];
    return dailyNoteReferencesFromSettings(app, sourcePath, settings, new Date());
  } catch {
    return [];
  }
}

function dailyNoteReferencesFromSettings(
  app: App,
  sourcePath: string,
  settings: IPeriodicNoteSettings,
  referenceDate: Date,
): readonly DailyNoteReferenceCandidate[] {
  const format = settings.format;
  if (!format) return [];
  const createMoment = moment as unknown as (input: Date) => DailyNoteMoment;
  return RELATIVE_DAILY_NOTES.map(({ keyword, display, dayOffset }) => {
    const filename = createMoment(referenceDate).add(dayOffset, "day").format(format);
    const path = dailyNotePath(settings.folder ?? "", filename);
    const existingFile = app.vault.getAbstractFileByPath(path);
    return {
      keyword,
      display,
      name: existingFile instanceof TFile ? displayNameForFile(existingFile) : dailyNoteName(filename),
      path,
      linktext: existingFile instanceof TFile ? linktextForFile(app, existingFile, sourcePath) : path.replace(/\.md$/i, ""),
    };
  });
}

function dailyNoteName(filename: string): string {
  return (filename.split("/").at(-1) ?? filename).replace(/\.md$/i, "");
}

function dailyNotePath(folder: string, filename: string): string {
  const markdownFilename = filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
  return normalizePath(folder ? `${folder}/${markdownFilename}` : markdownFilename);
}
