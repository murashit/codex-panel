import { TExternalFile, type TFile } from "obsidian";

export function fileReferencePath(file: TFile): string {
  return file instanceof TExternalFile ? file.getRealPath() : file.path;
}
