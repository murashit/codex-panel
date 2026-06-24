import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("development scripts", () => {
  it("fails style builds when CSS files are missing from the style order file", async () => {
    const cwd = await styleOrderFixture();

    const result = runNodeScript("scripts/build-styles.mjs", [], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CSS files missing from src/styles/order.json: 10-unlisted.css");
  });

  it("passes the expected codex generate-ts arguments", async () => {
    const cwd = await tempWorkspace();
    const binDir = path.join(cwd, "bin");
    await mkdir(binDir, { recursive: true });
    await mkdir(path.join(cwd, "src", "generated", "app-server"), { recursive: true });
    const codexBin = path.join(binDir, "codex");
    await writeFile(
      codexBin,
      [
        "#!/usr/bin/env node",
        "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
        "appendFileSync('codex-args.txt', `${process.argv.slice(2).join('\\n')}\\n`);",
        "mkdirSync('src/generated/app-server/v2', { recursive: true });",
        "writeFileSync('src/generated/app-server/v2/Example.ts', '// GENERATED CODE! DO NOT MODIFY BY HAND!\\nexport type Example = string | null | null;\\n');",
      ].join("\n"),
    );
    await chmod(codexBin, 0o755);

    const result = runNodeScript("scripts/generate-app-server-types.mjs", [], cwd, {
      PATH: `${binDir}${path.delimiter}${process.env["PATH"] ?? ""}`,
    });

    expect(result.status).toBe(0);
    await expect(readFile(path.join(cwd, "codex-args.txt"), "utf8")).resolves.toBe(
      "app-server\ngenerate-ts\n--experimental\n--out\nsrc/generated/app-server\n",
    );
    await expect(readFile(path.join(cwd, "src", "generated", "app-server", "v2", "Example.ts"), "utf8")).resolves.toContain(
      "export type Example = string | null;",
    );
  });

  it("reads app-server initialize flags from the connection client in API baseline checks", async () => {
    const cwd = await tempWorkspace();
    const binDir = path.join(cwd, "bin");
    await mkdir(binDir, { recursive: true });
    await mkdir(path.join(cwd, "scripts"), { recursive: true });
    await mkdir(path.join(cwd, "src", "app-server", "connection"), { recursive: true });

    await writeJson(path.join(cwd, "package.json"), {
      version: "1.0.0",
      devDependencies: {
        obsidian: "~1.12.3",
      },
    });
    await writeJson(path.join(cwd, "package-lock.json"), {
      packages: {
        "node_modules/obsidian": {
          version: "1.12.3",
        },
      },
    });
    await writeJson(path.join(cwd, "manifest.json"), {
      minAppVersion: "1.12.0",
    });
    await writeJson(path.join(cwd, "versions.json"), {
      "1.0.0": "1.12.0",
    });
    await writeFile(
      path.join(cwd, "README.md"),
      [
        "## Compatibility",
        "",
        "| Key | Version | Notes |",
        "| --- | --- | --- |",
        "| `codex.testedCliVersion` | `0.139.0` | Tested CLI. |",
        "| `manifest.minAppVersion` | `1.12.0` | Minimum app version. |",
        "| `obsidian` API types | `1.12.3` | Compile-time API package. |",
      ].join("\n"),
    );
    await writeFile(
      path.join(cwd, "scripts", "generate-app-server-types.mjs"),
      'run("codex", ["app-server", "generate-ts", "--experimental"]);\n',
    );
    await writeFile(
      path.join(cwd, "src", "app-server", "connection", "client.ts"),
      [
        'const init = await this.request("initialize", {',
        "  capabilities: {",
        "    experimentalApi: true,",
        "    requestAttestation: false,",
        "  },",
        "});",
      ].join("\n"),
    );

    const codexBin = path.join(binDir, "codex");
    await writeFile(codexBin, "#!/usr/bin/env node\nconsole.log('codex 0.139.0');\n");
    await chmod(codexBin, 0o755);

    const result = runNodeScript("scripts/api-baseline.mjs", ["--json"], cwd, {
      PATH: `${binDir}${path.delimiter}${process.env["PATH"] ?? ""}`,
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.codex.initializeExperimentalApi).toBe(true);
    expect(report.codex.initializeRequestAttestationDisabled).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("keeps CSS usage checks quiet when every class is used", async () => {
    const cwd = await cssUsageFixture({
      "src/styles/10-component.css": ".codex-panel__used { display: block; }\n",
      "src/component.ts": 'export const className = "codex-panel__used";\n',
    });

    const result = runNodeScript("scripts/lint/check-css-usage.mjs", [], cwd);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("fails CSS usage checks for unused and test-only class candidates", async () => {
    const cwd = await cssUsageFixture({
      "src/styles/10-component.css": [
        ".codex-panel__used { display: block; }",
        ".codex-panel__test-only { display: block; }",
        ".codex-panel__unused { display: block; }",
      ].join("\n"),
      "src/component.ts": 'export const className = "codex-panel__used";\n',
      "tests/component.test.ts": 'expect("codex-panel__test-only").toBeTruthy();\n',
    });

    const result = runNodeScript("scripts/lint/check-css-usage.mjs", [], cwd);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("CSS usage check failed.");
    expect(result.stderr).toContain("codex-panel__test-only");
    expect(result.stderr).toContain("codex-panel__unused");
  });

  it("fails release prepare before changing version files when release notes already exist", async () => {
    const cwd = await tempWorkspace();
    await mkdir(path.join(cwd, ".github", "release-notes"), { recursive: true });

    const packageJson = { version: "2.3.2" };
    const packageLockJson = { version: "2.3.2", packages: { "": { version: "2.3.2" } } };
    const manifestJson = { version: "2.3.2", minAppVersion: "1.12.0" };
    const versionsJson = { "2.3.2": "1.12.0" };

    await writeJson(path.join(cwd, "package.json"), packageJson);
    await writeJson(path.join(cwd, "package-lock.json"), packageLockJson);
    await writeJson(path.join(cwd, "manifest.json"), manifestJson);
    await writeJson(path.join(cwd, "versions.json"), versionsJson);
    await writeFile(path.join(cwd, ".github", "release-notes", "2.3.3.md"), "## Changes\n\n- Existing\n");

    const result = runNodeScript("scripts/release/prepare.mjs", ["2.3.3"], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".github/release-notes/2.3.3.md already exists");
    await expect(readJson(path.join(cwd, "package.json"))).resolves.toEqual(packageJson);
    await expect(readJson(path.join(cwd, "package-lock.json"))).resolves.toEqual(packageLockJson);
    await expect(readJson(path.join(cwd, "manifest.json"))).resolves.toEqual(manifestJson);
    await expect(readJson(path.join(cwd, "versions.json"))).resolves.toEqual(versionsJson);
  });
});

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "codex-panel-scripts-"));
}

async function styleOrderFixture(): Promise<string> {
  const cwd = await tempWorkspace();
  await mkdir(path.join(cwd, "src", "styles"), { recursive: true });
  await writeJson(path.join(cwd, "src", "styles", "order.json"), ["00-tokens.css"]);
  await writeFile(path.join(cwd, "src", "styles", "00-tokens.css"), ".codex-panel { color: var(--text-normal); }\n");
  await writeFile(path.join(cwd, "src", "styles", "10-unlisted.css"), ".codex-panel__extra { display: block; }\n");
  return cwd;
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

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}
