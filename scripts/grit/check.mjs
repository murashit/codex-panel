import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const biomeBin = path.join(repoRoot, "node_modules", ".bin", "biome");

// Regression probes for nontrivial source-policy scopes and syntax. Run only when editing policies or upgrading Biome.
const cases = [
  policyCase(
    "chat workflows cannot instantiate the Obsidian Vault destination",
    "src/features/chat/application/example.ts",
    'import { createObsidianVaultMarkdownDestination } from "../../../shared/vault/write-destination.obsidian";',
    'import type { VaultMarkdownDestination } from "../../../shared/vault/write-operations";',
  ),
  policyCase(
    "thread workflows cannot dynamically load the Obsidian Vault destination",
    "src/features/threads/workflows/example.ts",
    'const adapter = await import("../../../shared/vault/write-destination.obsidian");',
    'import { createObsidianVaultMarkdownDestination } from "../../../shared/vault/write-destination.obsidian";',
    "src/features/chat/host/example.ts",
  ),
  policyCase(
    "a workflow filename does not permit root host adapters",
    "src/features/threads/workflows/example.obsidian.ts",
    'import { getVaultPath } from "../../../plugin-vault.obsidian";',
    'import type { VaultPathDestination } from "../../../shared/vault/write-operations";',
  ),
  policyCase(
    "nested chat workflows cannot load host adapters with explicit extensions",
    "src/features/chat/application/composer/example.ts",
    'const adapter = await import("../../../../plugin-vault.obsidian.ts");',
    'import { getVaultPath } from "../../../../plugin-vault.obsidian";',
    "src/features/chat/host/composer/example.ts",
  ),
  policyCase(
    "thread workflows cannot depend on feature DOM adapters outside UI directories",
    "src/features/threads/workflows/example.ts",
    'import { ThreadRowControls } from "../list/row-controls.dom";',
    'import { createThreadRenameEditor } from "./thread-rename-editor";',
  ),
  policyCase(
    "workflow contracts cannot depend on colocated measurement adapters",
    "src/features/chat/application/example.ts",
    'import type { Measurement } from "./layout.measure";',
    'import type { Measurement } from "./layout";',
  ),
  policyCase(
    "workflow DOM handles cannot be enabled by suffix",
    "src/features/threads/workflows/operation.app-server.ts",
    "export function run(element: HTMLElement) { element.focus(); }",
    'export function run(params: URLSearchParams) { params.append("q", "value"); }',
  ),
  policyCase(
    "application contracts reject element subtypes",
    "src/features/chat/application/operation.dom.ts",
    "export function run(element: HTMLTextAreaElement) { element.select(); }",
    'export function run(signal: AbortSignal) { signal.addEventListener("abort", () => {}); }',
  ),
  policyCase(
    "domain contracts reject SVG handles",
    "src/domain/value.ts",
    "export function run(element: SVGSVGElement) { element.remove(); }",
    "export function run(value: string) { return value.trim(); }",
  ),
  policyCase(
    "workflow contracts reject generic nodes",
    "src/features/threads/workflows/operation.ts",
    "export function run(node: Node) { node.normalize(); }",
    "export function run(node: { value: string }) { return node.value; }",
  ),
  policyCase(
    "browser globals versus local values",
    "src/features/chat/application/operation.ts",
    'document.createElement("div");',
    "export function run(document: { text: string }) { return document.text; }",
  ),
  policyCase(
    "qualified browser access",
    "src/features/chat/application/operation.ts",
    'globalThis.document.createElement("div");',
    "export const value = globalThis.JSON.stringify({});",
  ),
  policyCase(
    "DOM observers belong to the host",
    "src/features/chat/application/operation.ts",
    "const observer = new ResizeObserver(() => {});",
    "const observer = new ResizeObserver(() => {});",
    "src/features/chat/host/operation.ts",
  ),
  policyCase(
    "UI owns DOM handles",
    "src/features/threads/workflows/operation.ts",
    "export function run(element: HTMLElement) { element.focus(); }",
    "export function run(element: HTMLElement) { element.focus(); }",
    "src/features/chat/ui/operation.ts",
  ),

  policyCase(
    "thread workflows depend on ports regardless of suffix",
    "src/features/threads/workflows/mutations.app-server.ts",
    'import { createThreadMutationAdapter } from "../app-server/workflow-adapters";',
    'import { createKeyedOperationCoordinator } from "../../../shared/async/keyed-operation-coordinator";',
  ),
  policyCase(
    "archive transport stays outside workflows",
    "src/features/threads/workflows/archive-export.ts",
    'import { archiveThread } from "../../../app-server/services/threads";',
    'import { archiveThread } from "../../../app-server/services/threads";',
    "src/features/threads/app-server/workflow-adapters.ts",
  ),
  policyCase(
    "preact named API versus local alias",
    "src/shared/ui/root.obsidian.tsx",
    'import { render as mount } from "preact";',
    'import { createContext as render, type ComponentChild } from "preact";',
  ),
  policyCase(
    "query cache owner",
    "src/execution-runtime.ts",
    'import { QueryClient } from "@tanstack/query-core";',
    'import { QueryClient } from "@tanstack/query-core";',
    "src/app-server/query/query-scope.ts",
  ),
  policyCase(
    "app-server root query access",
    "src/app-server/escape.ts",
    'import { Query } from "./query/query-scope";',
    'import { Query } from "./app-server/query/query-scope";',
    "src/execution-runtime.ts",
  ),
  policyCase(
    "no-preact-root-api-imports.grit",
    "src/features/chat/ui/escape.tsx",
    'const { render: mount } = await import("preact");',
    'import { render } from "preact";',
    "src/shared/ui/preact-root.dom.tsx",
  ),
  policyCase(
    "no-preact-root-api-imports.grit",
    "src/features/chat/ui/escape.tsx",
    'import Preact from "preact/compat"; Preact.render(null, container);',
    'import { memo } from "preact/compat";',
  ),
  policyCase(
    "no-preact-root-api-imports.grit",
    "src/features/chat/ui/escape.tsx",
    'import { createRoot } from "preact/compat/client";',
    'import { useState } from "preact/hooks";',
  ),
  policyCase(
    "no-preact-root-api-imports.grit",
    "src/app-server/query/escape.ts",
    'import * as Preact from "preact"; Preact.render(null, container);',
    'import type { ComponentChild } from "preact";',
  ),
  policyCase(
    "no-query-cache-imports.grit",
    "src/shared/ui/preact-root.dom.tsx",
    'const query = await import("@tanstack/query-core");',
    'import type { ObservedResult } from "../async/observed-result";',
  ),
  policyCase(
    "no-external-app-server-query-imports.grit",
    "src/app-server/services/escape.ts",
    'import type { Query } from "../query/query-scope";',
    'import type { Query } from "../query/query-scope";',
    "src/app-server/query/owner.ts",
  ),
  policyCase(
    "no-workspace-chat-internal-imports.grit",
    "src/workspace/nested/escape.ts",
    'import type { State } from "../../features/chat/application/state/model";',
    'import type { Host } from "../../features/chat/host/contracts";',
  ),
  policyCase(
    "no-chat-application-outer-layer-imports.grit",
    "src/features/chat/application/escape.ts",
    'import { listenDomEvent } from "../../../shared/ui/events.dom";',
    'import type { ObservedResult } from "../../../shared/async/observed-result";',
  ),
  policyCase(
    "no-domain-outer-layer-imports.grit",
    "src/domain/escape.ts",
    'import { useState } from "preact/hooks";',
    'import * as path from "node:path";',
  ),
  policyCase(
    "domain rejects relative imports of shared implementations",
    "src/domain/example/value.ts",
    'import { OwnerLifetime } from "../../shared/async/owner-lifetime";',
    'import * as path from "node:path";',
  ),
  policyCase(
    "shared implementations remain independent of features",
    "src/shared/example/adapter.obsidian.ts",
    'import { featureOperation } from "../../features/example/operation";',
    'import { normalizePath } from "obsidian";',
  ),
  policyCase(
    "no-external-app-server-query-imports.grit",
    "src/app-server/services/escape.ts",
    'const query = await import("../query/query-scope");',
    'const query = await import("../query/local");',
    "src/features/example/application/value.ts",
  ),
  policyCase(
    "no-domain-outer-layer-imports.grit",
    "src/features/example/domain/value.ts",
    'import { readFile } from "node:fs/promises";',
    'import * as path from "node:path";',
  ),
  policyCase(
    "no-direct-ambient-effects.grit",
    "src/domain/threads/example.ts",
    "export const clock = Date.now;",
    "export function timestamp(value: number): Date { return new Date(value); }",
  ),
  policyCase(
    "no-direct-ambient-effects.grit",
    "src/features/chat/domain/thread-stream/example.ts",
    "export const now = new Date();",
    "export function date(value: string): Date { return new Date(value); }",
  ),
  policyCase(
    "no-direct-ambient-effects.grit",
    "src/features/chat/host/toolbar/view-projection.ts",
    "export const timer = globalThis.setInterval(tick, 100);",
    "export const delayMs = 100;",
  ),
  policyCase(
    "no-direct-ambient-effects.grit",
    "src/features/chat/application/state/escape.ts",
    "export const clock = window.Date.now;",
    "export const epoch = Date.parse('2026-01-01');",
  ),
  policyCase(
    "no-uncontrolled-preact-form-state.grit",
    "src/features/chat/ui/form.tsx",
    'export function Form(): JSX.Element { return <select defaultValue="draft"><option value="draft">Draft</option></select>; }',
    "export function Form(): JSX.Element { return <Field defaultChecked={true} />; }",
  ),
  policyCase(
    "no-restricted-css-policy.grit",
    "src/styles/escape.css",
    ".codex-panel__item { color: #fff; }",
    ".codex-panel__item:where(.is-selected):has(> input:checked) { color: var(--text-normal); }",
  ),
];

const project = JSON.parse((await readFile(path.join(repoRoot, "biome.jsonc"), "utf8")).replace(/^\s*\/\/.*$/gm, ""));
const workspace = await mkdtemp(path.join(tmpdir(), "codex-panel-grit-policy-"));
try {
  await writeFile(
    path.join(workspace, "biome.json"),
    JSON.stringify({
      $schema: project.$schema,
      vcs: { enabled: false },
      linter: { rules: { preset: "none" } },
      plugins: project.plugins.map((plugin) => ({ ...plugin, path: path.resolve(repoRoot, plugin.path) })),
    }),
  );
  const probes = await Promise.all(
    cases.map(async (testCase, index) => ({
      label: testCase.label,
      invalid: await writeFixture(`${index}/invalid`, testCase.path, testCase.invalidSource),
      valid: await writeFixture(`${index}/valid`, testCase.validPath, testCase.validSource),
    })),
  );
  // Check the actual policy set together, in one process. A boundary may be protected by more than one rule.
  const result = spawnSync(biomeBin, ["lint", ".", "--config-path", workspace, "--reporter=json", "--max-diagnostics=none"], {
    cwd: workspace,
    encoding: "utf8",
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  const rejected = new Set(
    report.diagnostics
      .filter((diagnostic) => diagnostic.category === "plugin")
      .map((diagnostic) => {
        const file = typeof diagnostic.location.path === "string" ? diagnostic.location.path : diagnostic.location.path.file;
        return path.relative(workspace, path.resolve(workspace, file)).replaceAll(path.sep, "/");
      }),
  );
  for (const probe of probes) {
    assert(rejected.has(probe.invalid), `${probe.label}: forbidden source was accepted (${probe.invalid})\n${output}`);
    assert(!rejected.has(probe.valid), `${probe.label}: allowed source was rejected (${probe.valid})\n${output}`);
  }
  console.log(`Validated ${probes.length} source-policy scenarios in one Biome invocation.`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

function policyCase(label, path, invalidSource, validSource, validPath = path) {
  return { label, path, invalidSource, validSource, validPath };
}

async function writeFixture(variant, fixturePath, source) {
  const target = path.join(variant, fixturePath).replaceAll(path.sep, "/");
  const targetPath = path.join(workspace, target);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, source);
  return target;
}
