import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("development scripts", () => {
  it("propagates check:ci script failures", async () => {
    const cwd = await tempWorkspace();
    const scripts = await readPackageScripts();
    await writeFile(path.join(cwd, "fail.mjs"), "process.exit(7);\n");
    await writeJson(path.join(cwd, "package.json"), {
      scripts: {
        "check:ci": scripts["check:ci"],
        "typecheck:ci": "node fail.mjs",
        "test:ci": 'node -e "process.exit(0)"',
        "lint:ci": 'node -e "process.exit(0)"',
        "format:check:ci": 'node -e "process.exit(0)"',
        "build:styles:check": 'node -e "process.exit(0)"',
        build: 'node -e "process.exit(0)"',
      },
    });

    const result = runNpmScript("check:ci", cwd);

    expect(result.status).toBe(7);
  });

  it("fails style builds when CSS files are missing from the style order file", async () => {
    const cwd = await tempWorkspace();
    await mkdir(path.join(cwd, "src", "styles"), { recursive: true });
    await writeJson(path.join(cwd, "src", "styles", "order.json"), ["00-tokens.css"]);
    await writeFile(path.join(cwd, "src", "styles", "00-tokens.css"), ".codex-panel { color: var(--text-normal); }\n");
    await writeFile(path.join(cwd, "src", "styles", "10-unlisted.css"), ".codex-panel__extra { display: block; }\n");

    const result = runNodeScript("scripts/build-styles.mjs", ["--check"], cwd);

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
        "| `obsidian.minAppVersion` | `1.12.0` | Minimum app version. |",
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

  it("keeps files unchanged when format check finds unformatted content", async () => {
    const cwd = await tempWorkspace();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await mkdir(path.join(cwd, "tests"), { recursive: true });
    await mkdir(path.join(cwd, "scripts"), { recursive: true });

    const sourcePath = path.join(cwd, "src", "unformatted.ts");
    const source = "export const value=1\n";
    await writeFile(sourcePath, source);

    const result = runNodeScript("scripts/format.mjs", ["--check"], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unformatted files:");
    expect(result.stderr).toContain("src/unformatted.ts");
    await expect(readFile(sourcePath, "utf8")).resolves.toBe(source);
  });

  it("detects runtime import cycles", async () => {
    const cwd = await tempWorkspace();
    await writeImportCycleFixture(cwd, {
      "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
      "src/b.ts": 'import { a } from "./a";\nexport const b = a;\n',
    });

    const result = runNodeScript("scripts/lint/check-import-cycles.mjs", [], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("found 1 cycle");
    expect(result.stderr).toContain("src/a.ts -> src/b.ts -> src/a.ts");
  });

  it("ignores type-only import cycles", async () => {
    const cwd = await tempWorkspace();
    await writeImportCycleFixture(cwd, {
      "src/a.ts": 'import type { B } from "./b";\nexport interface A { b?: B }\n',
      "src/b.ts": 'import type { A } from "./a";\nexport interface B { a?: A }\n',
    });

    const result = runNodeScript("scripts/lint/check-import-cycles.mjs", [], cwd);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No import cycles found.");
  });

  it("detects import cycles when mixed imports include runtime values", async () => {
    const cwd = await tempWorkspace();
    await writeImportCycleFixture(cwd, {
      "src/a.ts": 'import { type B, b } from "./b";\nexport interface A { b?: B }\nexport const a = b;\n',
      "src/b.ts": 'import { a, type A } from "./a";\nexport interface B { a?: A }\nexport const b = a;\n',
    });

    const result = runNodeScript("scripts/lint/check-import-cycles.mjs", [], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("found 1 cycle");
    expect(result.stderr).toContain("src/a.ts -> src/b.ts -> src/a.ts");
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

async function writeImportCycleFixture(cwd: string, files: Record<string, string>): Promise<void> {
  await writeJson(path.join(cwd, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      verbatimModuleSyntax: true,
      strict: true,
    },
    include: ["src/**/*.ts"],
  });

  for (const [file, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), source);
  }
}

function runNodeScript(script: string, args: string[] = [], cwd = repoRoot, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: false,
  });
}

function runNpmScript(script: string, cwd = repoRoot) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(npmCommand, ["run", script], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
}

async function readPackageScripts(): Promise<Record<string, string>> {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
  return packageJson.scripts;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}
