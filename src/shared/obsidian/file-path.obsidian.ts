import { TExternalFile, type TFile } from "obsidian";

/** The vault identifier and the path that Codex can read differ for external files. */
export function fileReferencePath(file: TFile): string {
  return file instanceof TExternalFile ? file.getRealPath() : file.path;
}
