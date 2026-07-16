import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sourceDir = path.join("src", "styles");
const sourceFiles = JSON.parse(readFileSync(path.join(sourceDir, "order.json"), "utf8")) as string[];
const styles = `${sourceFiles.map((file) => readFileSync(path.join(sourceDir, file), "utf8").trimEnd()).join("\n\n")}\n`;

function ruleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escapedSelector} \\{(?<body>[^}]+)\\}`).exec(styles)?.groups?.["body"] ?? "";
}

describe("panel CSS boundaries", () => {
  it("defines design tokens on every standalone UI root", () => {
    const tokenScopeEnd = styles.indexOf(" {");
    expect(tokenScopeEnd).toBeGreaterThan(0);
    const tokenScope = styles.slice(0, tokenScopeEnd);

    expect(tokenScope).toContain(".codex-panel");
    expect(tokenScope).toContain(".codex-panel-turn-diff");
    expect(tokenScope).toContain(".codex-panel-settings");
    expect(tokenScope).toContain(".codex-panel-threads");
    expect(tokenScope).toContain(".codex-panel-selection-rewrite");
  });
});

describe("panel CSS layout invariants", () => {
  it("lets the thread stream scroll inside the shell grid", () => {
    const threadStream = ruleBody(".codex-panel__thread-stream");

    expect(threadStream).toContain("overflow-y: auto");
    expect(threadStream).not.toMatch(/^\s+height:/m);
  });
});
