import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const biomeBin = path.join(repoRoot, "node_modules", ".bin", "biome");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "grit-policy");
const workspaces = new Set();

afterEach(async () => {
  await Promise.all([...workspaces].map((workspace) => rm(workspace, { recursive: true, force: true })));
  workspaces.clear();
});

describe("Biome Grit policies", () => {
  it("wires every checked-in policy once with a non-empty scope", async () => {
    const config = parseJsonc(await readFile(path.join(repoRoot, "biome.jsonc"), "utf8"));
    const configured = config.plugins.map((plugin) => ({
      path: typeof plugin === "string" ? plugin : plugin.path,
      includes: typeof plugin === "string" ? [] : plugin.includes,
    }));
    const checkedIn = await gritPolicyPaths(path.join(repoRoot, "scripts", "grit"));

    expect(new Set(configured.map((plugin) => plugin.path)).size).toBe(configured.length);
    expect(configured.every((plugin) => plugin.includes.length > 0)).toBe(true);
    expect(configured.map((plugin) => plugin.path.replace(/^\.\//, "")).sort()).toEqual(checkedIn);
  });

  it("rejects the checked-in invalid fixture for every retained matcher", async () => {
    const config = parseJsonc(await readFile(path.join(repoRoot, "biome.jsonc"), "utf8"));
    for (const plugin of config.plugins) {
      const workspace = await fixtureWorkspace();
      await writePluginConfig(workspace, plugin);
      const result = biomeLint(workspace, await fixtureSourcePaths(workspace));
      expect(result.status, `${pluginPath(plugin)}\n${result.output}`).toBe(1);
      expect(result.pluginErrors, `${pluginPath(plugin)}\n${result.output}`).toBeGreaterThan(0);
    }
  }, 30_000);

  it("accepts the checked-in valid fixture for every retained matcher", async () => {
    const config = parseJsonc(await readFile(path.join(repoRoot, "biome.jsonc"), "utf8"));
    for (const plugin of config.plugins) {
      const workspace = await fixtureWorkspace("valid");
      await writePluginConfig(workspace, plugin);
      const result = biomeLint(workspace, await fixtureSourcePaths(workspace));
      expect(result.status, `${pluginPath(plugin)}\n${result.output}`).toBe(0);
      expect(result.pluginErrors, pluginPath(plugin)).toBe(0);
    }
  }, 30_000);
});

async function fixtureWorkspace(kind = "invalid") {
  const parent = await mkdtemp(path.join(tmpdir(), "codex-panel-grit-policy-"));
  const workspace = path.join(parent, "fixture");
  workspaces.add(parent);
  await cp(path.join(fixtureRoot, kind), workspace, { recursive: true });
  return workspace;
}

async function writePluginConfig(workspace, plugin) {
  const config = {
    $schema: "https://biomejs.dev/schemas/2.5.1/schema.json",
    vcs: { enabled: false },
    plugins: [typeof plugin === "string" ? path.resolve(repoRoot, plugin) : { ...plugin, path: path.resolve(repoRoot, plugin.path) }],
  };
  await writeFile(path.join(workspace, "biome.json"), JSON.stringify(config));
}

function biomeLint(workspace, targets) {
  const result = spawnSync(biomeBin, ["lint", ...targets, "--config-path", workspace, "--reporter=json", "--max-diagnostics=none"], {
    cwd: workspace,
    encoding: "utf8",
  });
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  return {
    pluginErrors: report.diagnostics.filter((diagnostic) => diagnostic.category === "plugin" && diagnostic.severity === "error").length,
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

async function fixtureSourcePaths(workspace, directory = "src") {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(path.join(workspace, directory), { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(directory, entry.name);
      return entry.isDirectory() ? fixtureSourcePaths(workspace, relativePath) : [relativePath];
    }),
  );
  return paths.flat();
}

function pluginPath(plugin) {
  return typeof plugin === "string" ? plugin : plugin.path;
}

async function gritPolicyPaths(directory) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return gritPolicyPaths(entryPath);
      if (entry.isFile() && entry.name.endsWith(".grit")) return [path.relative(repoRoot, entryPath).split(path.sep).join("/")];
      return [];
    }),
  );
  return paths.flat().sort();
}

function parseJsonc(source) {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
}
