import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const tempWorkspaces = new Set<string>();

afterEach(async () => {
  await Promise.all([...tempWorkspaces].map((workspace) => rm(workspace, { recursive: true, force: true })));
  tempWorkspaces.clear();
});

describe("CSS usage policy", () => {
  it("reports representative CSS usage policy failures", async () => {
    const cwd = await cssUsageFixture({
      "src/styles/10-component.css": [
        ".codex-panel__used { display: block; }",
        ".codex-panel__test-only { display: block; }",
        ".codex-panel__unused { display: block; }",
        ".codex-panel__item { display: block; }",
        ".codex-panel__item-detail { display: block; }",
        ".codex-panel__tokens {",
        "  --codex-panel-used-size: 1px;",
        "  --codex-panel-unused-size: 2px;",
        "  width: var(--codex-panel-used-size);",
        "  /*",
        "  --codex-panel-commented-size: 3px;",
        "  width: var(--codex-panel-unused-size);",
        "  */",
        "}",
      ].join("\n"),
      "src/component.ts": [
        'export const className = "codex-panel__used";',
        'export const detailClassName = "codex-panel__item-detail";',
        'export const tokenClassName = "codex-panel__tokens";',
        "export const dynamicClassName = `codex-panel__task-step--$" + "{status}`;",
      ].join("\n"),
      "tests/component.test.ts": 'expect("codex-panel__test-only").toBeTruthy();\n',
    });

    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts/check-css-usage.mjs")], {
      cwd,
      encoding: "utf8",
      shell: false,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("CSS usage check failed.");
    expect(result.stderr).toContain("Dynamic CSS class prefixes are not allowed:");
    expect(result.stderr).toContain("codex-panel__task-step--");
    expect(result.stderr).toContain("codex-panel__test-only");
    expect(result.stderr).toContain("codex-panel__unused");
    expect(result.stderr).toContain("  codex-panel__item\n");
    expect(result.stderr).toContain("--codex-panel-unused-size");
    expect(result.stderr).not.toContain("--codex-panel-used-size\n");
    expect(result.stderr).not.toContain("--codex-panel-commented-size");
  });
});

async function cssUsageFixture(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "codex-panel-css-usage-"));
  tempWorkspaces.add(cwd);
  await mkdir(path.join(cwd, "src", "styles"), { recursive: true });
  await mkdir(path.join(cwd, "tests"), { recursive: true });
  await writeFile(path.join(cwd, "src", "styles", "order.json"), JSON.stringify(["10-component.css"]));

  for (const [file, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), source);
  }

  return cwd;
}
