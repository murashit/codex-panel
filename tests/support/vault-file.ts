import { TFile } from "obsidian";

export function markdownFileFixture(path: string): TFile {
  const name = path.split("/").pop() ?? path;
  const basename = name.replace(/\.md$/, "");
  return Object.assign(new TFile(), { path, basename, name, extension: "md" });
}
