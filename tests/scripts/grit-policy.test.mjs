import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const biomeBin = path.join(repoRoot, "node_modules", ".bin", "biome");
const workspaces = new Set();
let projectPluginsPromise;

const policyCases = [
  policyCase("no-handwritten-reexports.grit", "src/example.ts", 'export { value } from "./owner";', "const value = 1;\nexport { value };"),
  policyCase("no-responsibility-root-module-files.grit", "src/domain/escape.ts", "export const value = 1;", "export const value = 1;", {
    validPath: "src/domain/example/safe.ts",
  }),
  policyCase(
    "no-misplaced-tsx.grit",
    "src/features/threads/escape.tsx",
    "export const value = 1;",
    "export function Safe(): JSX.Element { return <span />; }",
    {
      validPath: "src/features/chat/ui/safe.tsx",
    },
  ),
  policyCase(
    "no-self-referential-initializer-callback.grit",
    "src/example.ts",
    "const runner = new Runner(() => runner.stop());",
    "let runner: Runner;\nrunner = new Runner(() => runner.stop());",
  ),
  policyCase(
    "no-unsafe-iterator-value.grit",
    "src/example.ts",
    "export const value = iterator.next().value;",
    "const result = iterator.next();\nexport const value = result.done ? undefined : result.value;",
  ),
  policyCase(
    "no-uncontrolled-preact-form-state.grit",
    "src/features/chat/ui/form.tsx",
    'export function Form(): JSX.Element { return <input defaultValue="draft" />; }',
    'export function Form(): JSX.Element { return <input value="draft" />; }',
  ),
  policyCase(
    "no-domain-outer-layer-imports.grit",
    "src/domain/example/value.ts",
    'import type { App } from "obsidian";',
    "export type Value = string;",
  ),
  policyCase(
    "no-lower-level-feature-imports.grit",
    "src/shared/runtime/escape.ts",
    'import type { Feature } from "../../features/escape";',
    "export type Value = string;",
  ),
  policyCase(
    "no-app-server-subfolder-root-imports.grit",
    "src/app-server/protocol/escape.ts",
    'import type { Root } from "../root";',
    'import type { Client } from "../connection/client";',
  ),
  policyCase(
    "no-app-server-connection-boundary-imports.grit",
    "src/app-server/protocol/escape.ts",
    'import type { Client } from "../connection/client";',
    "export type Value = string;",
  ),
  policyCase(
    "no-app-server-protocol-boundary-imports.grit",
    "src/settings/escape.ts",
    'import type { Catalog } from "../app-server/protocol/catalog";',
    'import type { Catalog } from "../app-server/services/catalog";',
  ),
  policyCase(
    "no-chat-turn-item-non-turn-protocol-imports.grit",
    "src/features/chat/app-server/mappers/thread-stream/turn-items.ts",
    'import type { Catalog } from "../../../../../../app-server/protocol/catalog";',
    'import type { Turn } from "../../../../../../app-server/protocol/turn";',
  ),
  policyCase(
    "no-generated-app-server-boundary-imports.grit",
    "src/settings/escape.ts",
    'import type { Generated } from "../generated/app-server/types";',
    "export type Value = string;",
  ),
  policyCase(
    "no-app-server-direct-rpcs.grit",
    "src/settings/escape.ts",
    'export async function read(client) { await client.request("config/read"); }',
    "export async function read(service) { await service.readConfig(); }",
  ),
  policyCase(
    "no-chat-workspace-boundary-imports.grit",
    "src/features/chat/host/escape.ts",
    'import type { Workspace } from "../../../workspace/panel-coordinator";',
    "export type Value = string;",
  ),
  policyCase(
    "no-feature-workspace-boundary-imports.grit",
    "src/features/selection-rewrite/escape.ts",
    'import type { Workspace } from "../../workspace/panel-coordinator";',
    "export type Value = string;",
  ),
  policyCase(
    "no-workspace-chat-internal-imports.grit",
    "src/workspace/escape.ts",
    'import type { State } from "../features/chat/application/state/store";',
    'import type { Host } from "../features/chat/host/contracts";',
  ),
  policyCase(
    "no-thread-workflow-app-server-imports.grit",
    "src/features/threads/workflows/escape.ts",
    'import type { Client } from "../../../app-server/connection/client";',
    'import type { Transport } from "./ports";',
  ),
  policyCase(
    "no-chat-application-outer-layer-imports.grit",
    "src/features/chat/application/escape.ts",
    'import type { Host } from "../host/contracts";',
    'import type { Item } from "../domain/thread-stream/items";',
  ),
  policyCase(
    "no-chat-app-server-outer-layer-imports.grit",
    "src/features/chat/app-server/escape.ts",
    'import type { Panel } from "../panel/toolbar-actions";',
    'import type { Store } from "../application/state/store";',
  ),
  policyCase(
    "no-chat-host-rendering-layer-imports.grit",
    "src/features/chat/host/escape.ts",
    'import type { View } from "../presentation/thread-stream/view-model";',
    'import type { Store } from "../application/state/store";',
  ),
  policyCase(
    "no-chat-panel-runtime-boundary-imports.grit",
    "src/features/chat/panel/escape.ts",
    'import type { Host } from "../host/contracts";',
    'import type { View } from "../presentation/thread-stream/view-model";',
  ),
  policyCase(
    "no-chat-presentation-outer-layer-imports.grit",
    "src/features/chat/presentation/escape.ts",
    'import type { Store } from "../application/state/store";',
    'import type { Item } from "../domain/thread-stream/items";',
  ),
  policyCase(
    "no-chat-ui-outer-layer-imports.grit",
    "src/features/chat/ui/escape.ts",
    'import type { Store } from "../application/state/store";',
    'import type { View } from "../presentation/thread-stream/view-model";',
  ),
  policyCase(
    "no-state-module-side-effects.grit",
    "src/features/chat/application/state/escape.ts",
    "export const now = Date.now();",
    "export const now = 1;",
  ),
  policyCase(
    "no-implicit-dom-bridges.grit",
    "src/features/chat/ui/escape.ts",
    'export const element = document.createElement("div");',
    "export const value = 1;",
  ),
  policyCase(
    "no-dom-events-imports.grit",
    "src/features/chat/ui/escape.ts",
    'import { addDomEventListener } from "../../../shared/dom/events.dom";',
    "export const value = 1;",
  ),
  policyCase(
    "no-preact-root-imports.grit",
    "src/features/chat/ui/escape.ts",
    'import { renderPreactRoot } from "../../../shared/dom/preact-root.dom";',
    "export const value = 1;",
  ),
  policyCase("no-restricted-css-policy.grit", "src/styles/escape.css", ".escape { color: #fff; }", ".safe { color: var(--text-normal); }", {
    invalid: [
      { path: "src/styles/has.css", source: ".panel:has(.child) { color: var(--text-normal); }" },
      { path: "src/styles/where.css", source: ".panel:where(.child) { color: var(--text-normal); }" },
      { path: "src/styles/id.css", source: "#panel { color: var(--text-normal); }" },
      { path: "src/styles/universal.css", source: ".panel * { color: var(--text-normal); }" },
    ],
    valid: [{ path: "src/styles/shallow.css", source: ".panel .child:hover { color: var(--text-normal); }" }],
  }),
];

afterEach(async () => {
  await Promise.all([...workspaces].map((workspace) => rm(workspace, { recursive: true, force: true })));
  workspaces.clear();
});

describe("Biome Grit policies", () => {
  it("keeps one semantic case for every configured policy", async () => {
    const configured = (await projectPlugins()).map((plugin) => path.basename(pluginPath(plugin))).sort();
    const covered = policyCases.map((testCase) => testCase.plugin).sort();

    expect(new Set(configured).size).toBe(configured.length);
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered).toEqual(configured);
  });

  it.each(policyCases)("$plugin rejects invalid sources and accepts valid sources", async (testCase) => {
    const result = await lintPolicyCase(testCase);

    expect(result.status, result.output).toBe(1);
    for (const target of result.invalidTargets) expect(result.pluginErrorFiles, result.output).toContain(target);
    for (const target of result.validTargets) expect(result.errorFiles, result.output).not.toContain(target);
  });
});

function policyCase(plugin, invalidPath, invalidSource, validSource, options = {}) {
  return {
    plugin,
    invalid: [{ path: invalidPath, source: invalidSource }, ...(options.invalid ?? [])],
    valid: [{ path: options.validPath ?? invalidPath, source: validSource }, ...(options.valid ?? [])],
  };
}

async function lintPolicyCase(testCase) {
  const plugin = (await projectPlugins()).find((candidate) => path.basename(pluginPath(candidate)) === testCase.plugin);
  if (!plugin) throw new Error(`Missing configured Grit policy: ${testCase.plugin}`);
  const workspace = await mkdtemp(path.join(tmpdir(), "codex-panel-grit-policy-"));
  workspaces.add(workspace);
  const [invalidTargets, validTargets] = await Promise.all([
    writeFixtures(workspace, "invalid", testCase.invalid),
    writeFixtures(workspace, "valid", testCase.valid),
    writePluginConfig(workspace, plugin),
  ]);
  return { ...biomeLint(workspace, [...invalidTargets, ...validTargets]), invalidTargets, validTargets };
}

async function writeFixtures(workspace, variant, fixtures) {
  return Promise.all(
    fixtures.map(async (fixture) => {
      const target = path.join(variant, fixture.path).replaceAll(path.sep, "/");
      const fixturePath = path.join(workspace, target);
      await mkdir(path.dirname(fixturePath), { recursive: true });
      await writeFile(fixturePath, fixture.source);
      return target;
    }),
  );
}

async function projectPlugins() {
  projectPluginsPromise ??= readFile(path.join(repoRoot, "biome.jsonc"), "utf8").then((source) => parseJsonc(source).plugins);
  return projectPluginsPromise;
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
  const errorDiagnostics = report.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const diagnosticFiles = (diagnostics) =>
    diagnostics
      .map((diagnostic) => (typeof diagnostic.location?.path === "string" ? diagnostic.location.path : diagnostic.location?.path?.file))
      .filter(Boolean)
      .map((file) => path.relative(workspace, path.resolve(workspace, file)).replaceAll(path.sep, "/"));
  return {
    errorFiles: diagnosticFiles(errorDiagnostics),
    pluginErrorFiles: diagnosticFiles(errorDiagnostics.filter((diagnostic) => diagnostic.category === "plugin")),
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

function pluginPath(plugin) {
  return typeof plugin === "string" ? plugin : plugin.path;
}

function parseJsonc(source) {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
}
