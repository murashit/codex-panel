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
    {
      invalid: [
        {
          path: "src/features/chat/domain/example/value.ts",
          source: 'import type { Store } from "../application/state/store";',
        },
      ],
      valid: [
        {
          path: "src/features/chat/domain/example/value.ts",
          source: 'import type { Item } from "../thread-stream/items";',
        },
      ],
    },
  ),
  policyCase(
    "no-core-outer-layer-imports.grit",
    "src/shared/runtime/escape.ts",
    'import type { Feature } from "../../features/escape";',
    "export type Value = string;",
    {
      invalid: [
        {
          path: "src/app-server/services/escape.ts",
          source: 'export const loadSettings = () => import("../../settings/model");',
        },
      ],
      valid: [
        {
          path: "src/app-server/services/value.ts",
          source: 'import type { Value } from "../../domain/example/value";',
        },
      ],
    },
  ),
  policyCase(
    "no-app-server-connection-boundary-imports.grit",
    "src/app-server/protocol/escape.ts",
    'import type { Client } from "../connection/client";',
    "export type Value = string;",
    {
      invalid: [
        {
          path: "src/domain/example/value.ts",
          source: 'import type { Client } from "../app-server/connection/client";',
        },
      ],
      valid: [
        {
          path: "src/domain/example/value.ts",
          source: 'import type { Item } from "./item";',
        },
      ],
    },
  ),
  policyCase(
    "no-external-app-server-query-imports.grit",
    "src/settings/escape.ts",
    'import type { QueryResult } from "../app-server/query/result";',
    'import type { ObservedResult } from "../shared/runtime/observed-result";',
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
    "no-feature-workspace-boundary-imports.grit",
    "src/features/selection-rewrite/escape.ts",
    'import type { Workspace } from "../../workspace/panel-coordinator";',
    "export type Value = string;",
  ),
  policyCase(
    "no-external-chat-domain-imports.grit",
    "src/features/threads/workflows/escape.ts",
    'import type { ChatState } from "../../chat/domain/runtime/state";',
    'import type { Thread } from "../../../domain/threads/model";',
    {
      invalid: [
        {
          path: "src/execution-runtime.ts",
          source: 'export const load = () => import("@/features/chat/domain/runtime/state");',
        },
      ],
      valid: [
        {
          path: "src/features/chat/application/escape.ts",
          source: 'import type { ChatState } from "../../chat/domain/runtime/state";',
        },
        {
          path: "src/features/threads/workflows/near-miss.ts",
          source: 'import type { ChatState } from "../../chat/domains/runtime/state";',
        },
      ],
    },
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
    'import type { QueryCache } from "../../../app-server/query/cache";',
    'import type { ThreadCatalogChange } from "../../../domain/threads/catalog-read-model";',
  ),
  policyCase(
    "no-chat-application-outer-layer-imports.grit",
    "src/features/chat/application/escape.ts",
    'import type { Host } from "../host/contracts";',
    'import type { Item } from "../domain/thread-stream/items";',
    {
      invalid: [
        {
          path: "src/features/chat/application/selection.ts",
          source: 'import type { Selection } from "../../selection-rewrite/model";',
        },
        {
          path: "src/features/chat/application/obsidian.ts",
          source: 'import { Notice } from "obsidian";',
        },
        {
          path: "src/features/chat/application/dynamic.ts",
          source: 'export const load = () => import("obsidian");',
        },
      ],
      valid: [
        {
          path: "src/features/chat/application/selection.ts",
          source: 'import type { Selection } from "../domain/thread-stream/items";',
        },
        {
          path: "src/features/chat/application/obsidian.ts",
          source: 'import type { Item } from "../domain/thread-stream/items";',
        },
        {
          path: "src/features/chat/application/dynamic.ts",
          source: 'export const load = () => import("../domain/thread-stream/items");',
        },
      ],
    },
  ),
  policyCase(
    "no-chat-app-server-outer-layer-imports.grit",
    "src/features/chat/app-server/escape.ts",
    'import type { Host } from "../host/toolbar/actions";',
    'import type { Store } from "../application/state/store";',
  ),
  policyCase(
    "no-chat-host-presentation-app-server-imports.grit",
    "src/features/chat/host/shell/escape.ts",
    'import type { Gateway } from "../../app-server/session-gateway";',
    'import type { Store } from "../../application/state/store";',
  ),
  policyCase(
    "no-chat-ui-outer-layer-imports.grit",
    "src/features/chat/ui/escape.ts",
    'import type { Host } from "../host/shell/selectors";',
    'import type { Item } from "../domain/thread-stream/items";',
  ),
  policyCase(
    "no-direct-ambient-effects.grit",
    "src/features/chat/application/state/escape.ts",
    "export const random = Math.random();",
    "export const now = 1;",
    {
      invalid: [
        {
          path: "src/features/threads/workflows/thread-projection.ts",
          source: "export const scheduled = setTimeout(() => undefined, 0);",
        },
        {
          path: "src/features/chat/application/state/client.ts",
          source: "export const client = new AppServerClient();",
        },
        {
          path: "src/features/chat/application/state/notice.ts",
          source: 'export const notice = new Notice("Saved");',
        },
        {
          path: "src/features/chat/application/state/frame.ts",
          source: "export const frame = requestAnimationFrame(() => undefined);",
        },
        {
          path: "src/features/chat/application/state/document.ts",
          source: "export const body = document.body;",
        },
        {
          path: "src/features/chat/application/state/storage.ts",
          source: 'export const value = localStorage.getItem("value");',
        },
      ],
      valid: [
        {
          path: "src/features/threads/workflows/thread-facts.ts",
          source: 'export const fact = { type: "thread-started" };',
        },
        {
          path: "src/features/threads/workflows/thread-projection.ts",
          source: "export const projected = 1;",
        },
      ],
    },
  ),
  policyCase(
    "no-direct-ambient-time.grit",
    "src/features/chat/application/state/escape.ts",
    "export const now = Date.now();",
    "export const state = {};",
    {
      invalid: [
        {
          path: "src/features/threads/workflows/thread-facts.ts",
          source: "export const now = new Date();",
        },
      ],
      valid: [
        {
          path: "src/features/chat/host/runtime/notices.ts",
          source: "export const now = Date.now();",
        },
      ],
    },
  ),
  policyCase(
    "no-implicit-dom-bridges.grit",
    "src/features/chat/ui/escape.ts",
    'export const element = document.createElement("div");',
    "export const value = 1;",
    {
      invalid: [
        {
          path: "src/features/chat/ui/query.ts",
          source: 'export const child = element.querySelector(".child");',
        },
        {
          path: "src/features/chat/ui/measurement.ts",
          source: "export const height = element.scrollHeight;",
        },
        {
          path: "src/features/chat/ui/style.ts",
          source: 'element.style.display = "none";',
        },
      ],
      valid: [
        {
          path: "src/features/chat/ui/abort.ts",
          source: 'signal.addEventListener("abort", handleAbort); signal.removeEventListener("abort", handleAbort);',
        },
      ],
    },
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
      { path: "src/styles/color-function.css", source: ".panel { color: rgb(1 2 3); }" },
      { path: "src/styles/token-definition.css", source: ":root { --codex-panel-text-color: #fff; }" },
      { path: "src/styles/font-size.css", source: ".panel { font-size: 12px; }" },
      { path: "src/styles/font-weight.css", source: ".panel { font-weight: 600; }" },
      { path: "src/styles/line-height.css", source: ".panel { line-height: 1.5; }" },
      { path: "src/styles/layout.css", source: ".panel { gap: 8px; }" },
      { path: "src/styles/has.css", source: ".panel:has(.child) { color: var(--text-normal); }" },
      { path: "src/styles/where.css", source: ".panel:where(.child) { color: var(--text-normal); }" },
      { path: "src/styles/id.css", source: "#panel { color: var(--text-normal); }" },
      { path: "src/styles/universal.css", source: ".panel * { color: var(--text-normal); }" },
      { path: "src/styles/keyframes.css", source: "@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }" },
    ],
    valid: [
      { path: "src/styles/shallow.css", source: ".panel .child:hover { color: var(--text-normal); }" },
      {
        path: "src/styles/tokens.css",
        source:
          ":root { --codex-panel-text-color: var(--text-normal); } @keyframes codex-panel-pulse { from { opacity: 0; } to { opacity: 1; } }",
      },
    ],
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
    $schema: "https://biomejs.dev/schemas/2.5.4/schema.json",
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
