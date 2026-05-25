import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync("styles.css", "utf8");

describe("panel CSS token scope", () => {
  it("defines design tokens on every standalone UI root", () => {
    const tokenScope = /^(?<selectors>(?:\.[^{]+,\n)*\.[^{]+) \{/m.exec(styles)?.groups?.["selectors"] ?? "";

    expect(tokenScope).toContain(".codex-panel");
    expect(tokenScope).toContain(".codex-panel-chat-turn-diff");
    expect(tokenScope).toContain(".codex-panel-settings");
    expect(tokenScope).toContain(".codex-panel-threads");
    expect(tokenScope).toContain(".codex-panel-selection-rewrite");
  });
});
