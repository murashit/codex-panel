import type { App, TFile } from "obsidian";

export function linktextForFile(app: App, file: TFile, sourcePath: string): string {
  const linktext = app.metadataCache.fileToLinktext(file, sourcePath, true);
  const extension = file.extension.toLowerCase();
  return extension === "md" || extension.length === 0 || linktext.toLowerCase().endsWith(`.${extension}`)
    ? linktext
    : `${linktext}.${file.extension}`;
}

export function displayNameForFile(file: TFile): string {
  return file.extension === "md" ? file.basename : file.name;
}
