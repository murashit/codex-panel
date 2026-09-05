import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const tempWorkspaces = new Set<string>();

afterEach(async () => {
  await Promise.all([...tempWorkspaces].map((workspace) => rm(workspace, { recursive: true, force: true })));
  tempWorkspaces.clear();
});

describe("development scripts", () => {
  it("requires a sparse versions.json boundary only when the Obsidian floor changes", async () => {
    const { compatibilityBoundaryIsRecorded } = await import(
      pathToFileURL(path.join(repoRoot, "scripts", "release", "versioning.mjs")).href
    );
    const boundaries = { "0.1.0": "1.5.0", "5.7.1": "1.12.0" };

    expect(compatibilityBoundaryIsRecorded(boundaries, "5.7.1", "1.12.0", "1.13.0")).toBe(true);
    expect(compatibilityBoundaryIsRecorded(boundaries, "5.8.0", "1.13.0", "1.13.0")).toBe(true);
    expect(compatibilityBoundaryIsRecorded({ "0.1.0": "1.5.0" }, "5.7.1", "1.12.0", "1.13.0")).toBe(false);
  });

  it("reports mutation patterns that no longer match source", async () => {
    const cwd = await tempWorkspace();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "present.ts"), "export const present = true;\n");
    const { unmatchedMutationPatterns } = await import(pathToFileURL(path.join(repoRoot, "scripts", "check-mutation-scope.mjs")).href);

    await expect(unmatchedMutationPatterns(["src/**/*.ts", "src/removed.ts"], cwd)).resolves.toEqual(["src/removed.ts"]);
  });

  it("fails style builds when CSS files are missing from the style order file", async () => {
    const cwd = await styleOrderFixture();

    const result = runNodeScript("scripts/build-styles.mjs", [], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CSS files missing from src/styles/order.json: 10-unlisted.css");
  });

  it("passes the expected codex generate-ts arguments", async () => {
    const cwd = await tempWorkspace();
    const calls: { command: string; args: string[]; cwd: string }[] = [];
    const { generateAppServerTypes } = await import(pathToFileURL(path.join(repoRoot, "scripts", "generate-app-server-types.mjs")).href);

    await writeAppServerCompatibility(cwd, "0.144.4", ["app-server", "generate-ts", "--experimental", "--test-setting"]);

    await generateAppServerTypes({
      cwd,
      readCodexVersion: () => "0.144.4",
      async runCommand(command: string, args: string[], options: { cwd: string }) {
        calls.push({ command, args, cwd: options.cwd });
        const outIndex = args.indexOf("--out");
        const outputDir = args[outIndex + 1];
        if (!outputDir) throw new Error("Missing generated output directory");
        await mkdir(path.join(options.cwd, outputDir, "v2"), { recursive: true });
        await writeFile(
          path.join(options.cwd, outputDir, "v2", "Example.ts"),
          "// GENERATED CODE! DO NOT MODIFY BY HAND!\nexport type Example = string | null | null;\n",
        );
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: "codex", cwd });
    expect(calls[0]?.args.slice(0, 5)).toEqual(["app-server", "generate-ts", "--experimental", "--test-setting", "--out"]);
    expect(calls[0]?.args[5]?.replaceAll("\\", "/")).toMatch(/^src\/generated\/\.app-server-/);
    await expect(readFile(path.join(cwd, "src", "generated", "app-server", "v2", "Example.ts"), "utf8")).resolves.toContain(
      "export type Example = string | null;",
    );
  });

  it("checks normalized generated bindings without replacing the tracked tree", async () => {
    const cwd = await tempWorkspace();
    const generatedDir = path.join(cwd, "src", "generated", "app-server");
    await mkdir(path.join(generatedDir, "v2"), { recursive: true });
    await writeFile(
      path.join(generatedDir, "v2", "Example.ts"),
      "// GENERATED CODE! DO NOT MODIFY BY HAND!\n// This file was mechanically normalized after generation by scripts/generate-app-server-types.mjs.\nexport type Example = string | null;\n",
    );
    await writeAppServerCompatibility(cwd, "0.144.4");
    const { generateAppServerTypes } = await import(pathToFileURL(path.join(repoRoot, "scripts", "generate-app-server-types.mjs")).href);

    const generate = async (_command: string, args: string[], options: { cwd: string }) => {
      const outputDir = args[args.indexOf("--out") + 1];
      if (!outputDir) throw new Error("Missing generated output directory");
      await mkdir(path.join(options.cwd, outputDir, "v2"), { recursive: true });
      await writeFile(
        path.join(options.cwd, outputDir, "v2", "Example.ts"),
        "// GENERATED CODE! DO NOT MODIFY BY HAND!\nexport type Example = string | null | null;\n",
      );
    };

    await expect(
      generateAppServerTypes({ cwd, check: true, readCodexVersion: () => "0.144.4", runCommand: generate }),
    ).resolves.toBeUndefined();

    const trackedSource = await readFile(path.join(generatedDir, "v2", "Example.ts"), "utf8");
    await expect(
      generateAppServerTypes({
        cwd,
        check: true,
        readCodexVersion: () => "0.144.4",
        async runCommand(command: string, args: string[], options: { cwd: string }) {
          await generate(command, args, options);
          const outputDir = args[args.indexOf("--out") + 1];
          if (!outputDir) throw new Error("Missing generated output directory");
          await writeFile(path.join(options.cwd, outputDir, "v2", "Extra.ts"), "export type Extra = true;\n");
        },
      }),
    ).rejects.toThrow("generated app-server bindings are out of date:\n  added: v2/Extra.ts");
    await expect(readFile(path.join(generatedDir, "v2", "Example.ts"), "utf8")).resolves.toBe(trackedSource);
    await expect(readdir(path.join(cwd, "src", "generated"))).resolves.toEqual(["app-server"]);
  });

  it("refuses to generate bindings with a different Codex CLI patch", async () => {
    const cwd = await tempWorkspace();
    await writeAppServerCompatibility(cwd, "0.144.4");
    const { generateAppServerTypes } = await import(pathToFileURL(path.join(repoRoot, "scripts", "generate-app-server-types.mjs")).href);

    await expect(generateAppServerTypes({ cwd, readCodexVersion: () => "0.144.5", runCommand: async () => undefined })).rejects.toThrow(
      "Codex CLI 0.144.4 is required to generate app-server bindings; found 0.144.5.",
    );
  });

  it("reports app-server provenance drift between the recorded, README, and local CLI versions", async () => {
    const cwd = await apiBaselineFixture({ recordedCodexVersion: "0.144.4", readmeCodexVersion: "0.144.0" });
    const { createApiBaselineReport } = await import(pathToFileURL(path.join(repoRoot, "scripts", "api-baseline.mjs")).href);

    const report = await createApiBaselineReport({ cwd, readCodexVersion: () => "0.144.5" });

    expect(report.failures).toContain("README Codex CLI 0.144.0 does not match recorded tested CLI 0.144.4.");
    expect(report.failures).toContain("local Codex CLI 0.144.5 does not match recorded tested CLI 0.144.4.");
  });

  it("allows Obsidian API types to advance beyond the runtime floor", async () => {
    const cwd = await apiBaselineFixture({ recordedCodexVersion: "0.144.4", readmeCodexVersion: "0.144.4" });
    await writeJson(path.join(cwd, "package-lock.json"), {
      packages: {
        "node_modules/obsidian": {
          version: "1.14.0",
          peerDependencies: {
            "@codemirror/state": "6.5.0",
            "@codemirror/view": "6.38.6",
          },
        },
      },
    });
    const { createApiBaselineReport } = await import(pathToFileURL(path.join(repoRoot, "scripts", "api-baseline.mjs")).href);

    const report = await createApiBaselineReport({ cwd, readCodexVersion: () => "0.144.4" });

    expect(report.obsidian.minAppVersion).toBe("1.13.0");
    expect(report.obsidian.lockedPackageVersion).toBe("1.14.0");
    expect(report.failures).toEqual([]);
  });

  it("reports when Obsidian changes its pinned CodeMirror peers", async () => {
    const cwd = await apiBaselineFixture({ recordedCodexVersion: "0.144.4", readmeCodexVersion: "0.144.4" });
    await writeJson(path.join(cwd, "package-lock.json"), {
      packages: {
        "node_modules/obsidian": {
          version: "1.13.1",
          peerDependencies: {
            "@codemirror/state": "6.7.1",
            "@codemirror/view": "6.38.6",
          },
        },
      },
    });
    const { createApiBaselineReport } = await import(pathToFileURL(path.join(repoRoot, "scripts", "api-baseline.mjs")).href);

    const report = await createApiBaselineReport({ cwd, readCodexVersion: () => "0.144.4" });

    expect(report.failures).toContain("package.json devDependency @codemirror/state 6.5.0 must match locked obsidian peer 6.7.1.");
  });

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

    const result = runNodeScript("scripts/check-css-usage.mjs", [], cwd);

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

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "codex-panel-scripts-"));
  tempWorkspaces.add(workspace);
  return workspace;
}

async function styleOrderFixture(): Promise<string> {
  const cwd = await tempWorkspace();
  await mkdir(path.join(cwd, "src", "styles"), { recursive: true });
  await writeJson(path.join(cwd, "src", "styles", "order.json"), ["00-tokens.css"]);
  await writeFile(path.join(cwd, "src", "styles", "00-tokens.css"), ".codex-panel { color: var(--text-normal); }\n");
  await writeFile(path.join(cwd, "src", "styles", "10-unlisted.css"), ".codex-panel__extra { display: block; }\n");
  return cwd;
}

async function apiBaselineFixture(options: { recordedCodexVersion: string; readmeCodexVersion: string }): Promise<string> {
  const cwd = await tempWorkspace();
  await writeJson(path.join(cwd, "package.json"), {
    version: "1.0.0",
    devDependencies: {
      "@codemirror/state": "6.5.0",
      "@codemirror/view": "6.38.6",
      obsidian: "^1.13.1",
    },
  });
  await writeJson(path.join(cwd, "package-lock.json"), {
    packages: {
      "node_modules/obsidian": {
        version: "1.13.1",
        peerDependencies: {
          "@codemirror/state": "6.5.0",
          "@codemirror/view": "6.38.6",
        },
      },
    },
  });
  await writeJson(path.join(cwd, "manifest.json"), { minAppVersion: "1.13.0" });
  await writeJson(path.join(cwd, "versions.json"), { "1.0.0": "1.12.0" });
  await writeFile(
    path.join(cwd, "README.md"),
    [
      "## Compatibility",
      "",
      "| Key | Version | Notes |",
      "| --- | --- | --- |",
      `| \`codexAppServer.testedCliVersion\` | \`${options.readmeCodexVersion}\` | Tested CLI. |`,
      "| `manifest.minAppVersion` | `1.13.0` | Minimum app version. |",
    ].join("\n"),
  );
  await writeAppServerCompatibility(cwd, options.recordedCodexVersion);
  return cwd;
}

async function writeAppServerCompatibility(
  cwd: string,
  testedCliVersion: string,
  generationArguments = ["app-server", "generate-ts", "--experimental"],
): Promise<void> {
  await mkdir(path.join(cwd, "src", "app-server", "connection"), { recursive: true });
  await writeJson(path.join(cwd, "src", "app-server", "connection", "compatibility.json"), {
    codexAppServer: {
      testedCliVersion,
      typeGeneration: {
        arguments: generationArguments,
      },
      initialize: {
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    },
  });
}

async function cssUsageFixture(files: Record<string, string>): Promise<string> {
  const cwd = await tempWorkspace();
  await mkdir(path.join(cwd, "src", "styles"), { recursive: true });
  await mkdir(path.join(cwd, "tests"), { recursive: true });
  await writeJson(path.join(cwd, "src", "styles", "order.json"), ["10-component.css"]);

  for (const [file, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), source);
  }

  return cwd;
}

function runNodeScript(script: string, args: string[] = [], cwd = repoRoot, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: false,
  });
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
