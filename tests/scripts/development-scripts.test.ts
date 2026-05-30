import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("development scripts", () => {
  it("propagates CI check failures", async () => {
    const cwd = await tempWorkspace();
    await writeFile(path.join(cwd, "fail.mjs"), "process.exit(7);\n");
    await writeJson(path.join(cwd, "package.json"), {
      scripts: {
        "typecheck:ci": "node fail.mjs",
        "test:ci": 'node -e "process.exit(0)"',
        "lint:ts:ci": 'node -e "process.exit(0)"',
        "lint:css": 'node -e "process.exit(0)"',
        "format:check:ci": 'node -e "process.exit(0)"',
        "build:prod": 'node -e "process.exit(0)"',
      },
    });

    const result = runNodeScript("scripts/check.mjs", ["--ci"], cwd);

    expect(result.status).toBe(7);
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
