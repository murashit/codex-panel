import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { onTestFinished } from "vitest";

const sourceDir = path.join("src", "styles");
const sourceFiles = readdirSync(sourceDir)
  .filter((file) => file.endsWith(".css"))
  .sort();
const css = sourceFiles.map((file) => readFileSync(path.join(sourceDir, file), "utf8")).join("\n");

export function mountAuthoredStyles(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  onTestFinished(() => style.remove());
  return style;
}
