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
  it("styles retained editor selection decorations", () => {
    const emphasis = ruleBody(".codex-panel-selection-emphasis");

    expect(emphasis).toContain("background-color: var(--text-selection)");
  });

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

  it.each([
    {
      row: ".codex-panel__thread-row",
      activeRow: ".codex-panel__thread-row:hover,\n.codex-panel__thread-row:focus-within",
      actions: ".codex-panel__thread-actions",
      activeActions:
        ".codex-panel__thread-row:hover .codex-panel__thread-actions,\n.codex-panel__thread-row:focus-within .codex-panel__thread-actions,\n.codex-panel__thread-row--archive-confirming .codex-panel__thread-actions",
    },
    {
      row: ".codex-panel-threads__row",
      activeRow: ".codex-panel-threads__row:hover,\n.codex-panel-threads__row:focus-within",
      actions: ".codex-panel-threads__actions",
      activeActions:
        ".codex-panel-threads__row:hover .codex-panel-threads__actions,\n.codex-panel-threads__row:focus-within .codex-panel-threads__actions",
    },
  ])("shrinks $row titles only while row actions are visible", ({ row, activeRow, actions, activeActions }) => {
    expect(ruleBody(row)).toContain("grid-template-columns: minmax(0, 1fr) 0");
    expect(ruleBody(activeRow)).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(ruleBody(actions)).toContain("width: 0");
    expect(ruleBody(actions)).not.toMatch(/^\s+(?:position:\s*absolute|background:)/m);
    expect(ruleBody(activeActions)).toContain("width: auto");
  });
});
