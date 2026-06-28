import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const biomeBin = path.join(repoRoot, "node_modules", ".bin", "biome");
const projectBiomeConfig = parseJsonc(readFileSync(path.join(repoRoot, "biome.jsonc"), "utf8"));
const projectPluginEntries = projectBiomeConfig.plugins;
const projectPluginByName = new Map(
  projectPluginEntries.map((plugin) => {
    const pluginPath = projectPluginPath(plugin);
    return [path.basename(pluginPath), plugin];
  }),
);
const APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE =
  "Source modules outside root src/app-server must use domain models and app-server services instead of app-server protocol modules. Chat turn-item conversion may consume turn protocol at its app-server boundary; feature state and UI must use Panel-owned models.";
const RESPONSIBILITY_ROOT_MODULE_FILE_MESSAGE =
  "Keep responsibility-split source roots free of module files; add modules to the matching subfolder instead of the root.";
const APP_SERVER_ROOT_MODULE_IMPORT_MESSAGE =
  "Import app-server boundary modules from responsibility subfolders, not src/app-server root modules.";
const APP_SERVER_SUBFOLDER_ROOT_IMPORT_MESSAGE =
  "App-server subfolders must not import sibling root modules; move the dependency into a responsibility subfolder.";
const SETTINGS_APP_SERVER_BOUNDARY_MESSAGE =
  "Settings modules must depend on settings-owned dynamic data ports instead of importing app-server modules or settings app-server adapters.";
const CHAT_APPLICATION_OUTER_LAYER_MESSAGE =
  "Chat application modules must not import app-server, host, panel, presentation, or UI layers; expose state and workflow contracts instead.";
const CHAT_APP_SERVER_OUTER_LAYER_MESSAGE = "Chat app-server adapters must not import chat host, panel, presentation, or UI layers.";
const CHAT_WORKSPACE_BOUNDARY_MESSAGE =
  "Chat modules must not import workspace modules; pass workspace capabilities through chat host contracts.";
const FEATURE_WORKSPACE_BOUNDARY_MESSAGE =
  "Feature modules must not import workspace modules; pass workspace capabilities through feature host contracts.";
const WORKSPACE_CHAT_INTERNAL_MESSAGE = "Workspace modules may coordinate chat only through chat host contracts and Obsidian views.";
const CHAT_HOST_RENDERING_LAYER_MESSAGE =
  "Chat host modules must not import chat presentation or UI layers; route render-facing projections through panel-owned adapters.";
const CHAT_PANEL_RUNTIME_BOUNDARY_MESSAGE = "Chat panel modules must not import app-server adapters or chat host internals.";
const CHAT_PRESENTATION_OUTER_LAYER_MESSAGE =
  "Chat presentation modules must stay pure view-model projection; keep application, app-server, host, panel, and UI dependencies outward.";
const CHAT_UI_OUTER_LAYER_MESSAGE =
  "Chat UI modules must not import application, app-server, host, or panel layers; pass render-ready props and actions through UI contracts.";
const DOM_BOUNDARY_MESSAGE =
  "Keep DOM reads, writes, measurements, hit-tests, focus, and event wiring in files named with a .dom, .obsidian, or .measure suffix.";
const DOM_EVENTS_IMPORT_MESSAGE = "Import DOM event listener helpers only from explicit .dom, .obsidian, or .measure bridge files.";
let appServerBoundaryPolicyReportPromise;
let renderingAndCssPolicyReportPromise;

describe.concurrent("GritQL source policy", () => {
  it("keeps Biome wired to every checked-in Grit policy", async () => {
    const gritPolicyPaths = await listRelativeGritPolicyPaths(path.join(repoRoot, "scripts/grit"));
    const configuredGritPluginPaths = projectPluginEntries
      .map((plugin) => projectPluginPath(plugin))
      .filter((pluginPath) => pluginPath.endsWith(".grit"))
      .map(normalizeProjectRelativePath)
      .sort();
    const configuredGritPluginNames = configuredGritPluginPaths.map((pluginPath) => path.basename(pluginPath));

    expect(new Set(configuredGritPluginPaths).size).toBe(configuredGritPluginPaths.length);
    expect(new Set(configuredGritPluginNames).size).toBe(configuredGritPluginNames.length);
    expect(configuredGritPluginPaths).toEqual(gritPolicyPaths);
  });

  it("keeps project-wide source-shape policies enforceable as Biome plugin diagnostics", async () => {
    const cwd = await tempBiomeWorkspace([
      "no-handwritten-reexports.grit",
      "no-self-referential-initializer-callback.grit",
      "no-unsafe-iterator-value.grit",
      "no-uncontrolled-preact-form-state.grit",
    ]);
    await writeFile(
      path.join(cwd, "reexports.ts"),
      `
export { value } from "./owner";
export * from "./barrel";

const local = 1;
export { local };
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/shared/iterator.ts"),
      `
export function first<T>(iterator: Iterator<T>): T | undefined {
  return iterator.next().value;
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/form-state.tsx"),
      `
export function Composer(): JSX.Element {
  return (
    <>
      <input defaultValue="draft" />
      <input defaultChecked={true} />
    </>
  );
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/controlled-form-state.tsx"),
      `
export function Composer(): JSX.Element {
  return <input value="draft" />;
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/plugin-runtime.ts"),
      `
class Runner {
  constructor(readonly stop: () => void) {}
}

const runner = new Runner(() => runner.stop());
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/plugin-runtime-function.ts"),
      `
class Runner {
  constructor(readonly stop: () => void) {}
}

const runner = new Runner(function() {
  return runner.stop();
});
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/plugin-runtime-declared.ts"),
      `
class Runner {
  constructor(readonly stop: () => void) {}
}

let runner: Runner;
runner = new Runner(() => runner.stop());
`.trimStart(),
    );

    const report = biomeLint(
      [
        "reexports.ts",
        "src/shared/iterator.ts",
        "src/features/chat/ui/form-state.tsx",
        "src/features/chat/ui/controlled-form-state.tsx",
        "src/plugin-runtime.ts",
        "src/plugin-runtime-function.ts",
        "src/plugin-runtime-declared.ts",
      ],
      cwd,
    );

    expect(pluginDiagnostics(report, "reexports.ts")).toEqual([
      { line: 1, column: 8, endLine: 1, endColumn: 33 },
      { line: 2, column: 8, endLine: 2, endColumn: 26 },
    ]);
    expect(pluginMessages(report, "src/shared/iterator.ts")).toEqual([
      "Avoid reading iterator.next().value directly; use for...of or inspect the typed IteratorResult first.",
    ]);
    expect(pluginMessages(report, "src/features/chat/ui/form-state.tsx")).toEqual([
      "Keep Preact form state explicit with controlled value or checked props.",
      "Keep Preact form state explicit with controlled value or checked props.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/ui/controlled-form-state.tsx")).toEqual([]);
    expect(pluginMessages(report, "src/plugin-runtime.ts")).toEqual([
      "Avoid referencing a variable from a callback inside its own initializer; declare it first with an explicit type.",
    ]);
    expect(pluginMessages(report, "src/plugin-runtime-function.ts")).toEqual([
      "Avoid referencing a variable from a callback inside its own initializer; declare it first with an explicit type.",
    ]);
    expect(pluginDiagnostics(report, "src/plugin-runtime-declared.ts")).toEqual([]);
  });

  it("keeps chat runtime and DOM policies behind their intended boundaries", async () => {
    const cwd = await tempBiomeWorkspace([
      "no-implicit-dom-bridges.grit",
      "no-dom-events-imports.grit",
      "no-preact-signal-imports.grit",
      "no-state-module-side-effects.grit",
      "no-ui-root-imports.grit",
    ]);
    await writeFile(
      path.join(cwd, "src/features/chat/panel/shell-state.tsx"),
      `
import { signal } from "@preact/signals";

export const status = signal("idle");
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/shared/ui/components.tsx"),
      `
import { signal } from '@preact/signals';

export const status = signal("idle");
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/shared/ui/signal-escapes.tsx"),
      `
import type { Signal } from "@preact/signals";

export type SignalValue = Signal<string>;

export async function loadSignals() {
  return import("@preact/signals");
}

const signals = await import("@preact/signals");
export const loadedSignals = signals;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/dom-bridge-escape.tsx"),
      `
export function render(container: HTMLElement): void {
  const child = document.body;
  const input = container as HTMLInputElement;
  container.createDiv();
  container.append(child);
  container.setAttribute("role", "region");
  container.setAttr("aria-label", "Chat");
  container.addClass("codex-panel-chat");
  container.removeClass("codex-panel-chat--hidden");
  container.toggleClass("codex-panel-chat--active", true);
  container.setText("Ready");
  container.classList.add("codex-panel-chat--ready");
  container.classList.remove("codex-panel-chat--stale");
  container.classList.toggle("codex-panel-chat--busy", false);
  container.addEventListener("click", () => undefined);
  container.querySelector(".codex-panel-chat");
  container.querySelectorAll(".codex-panel-chat");
  container.closest(".codex-panel-chat");
  container.contains(child);
  container.getBoundingClientRect();
  container.focus();
  input.select();
  input.setSelectionRange(0, 0);
  container.setCssProps({ display: "block" });
  container.scrollHeight;
  container.scrollWidth;
  container.clientHeight;
  container.clientWidth;
  container.offsetTop;
  container.offsetHeight;
  input.selectionStart;
  input.selectionEnd;
  input.selectionDirection;
  const doc = container.ownerDocument;
  doc.defaultView;
  container.style.display;
  container.style.color;
  container.style.setProperty("display", "block");
  container.style.removeProperty("display");
  child.remove();
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/dom-bridge.dom.tsx"),
      `
export function render(container: HTMLElement): void {
  const child = document.body;
  const input = container as HTMLInputElement;
  container.createDiv();
  container.append(child);
  container.setAttribute("role", "region");
  container.setAttr("aria-label", "Chat");
  container.addClass("codex-panel-chat");
  container.removeClass("codex-panel-chat--hidden");
  container.toggleClass("codex-panel-chat--active", true);
  container.setText("Ready");
  container.classList.add("codex-panel-chat--ready");
  container.classList.remove("codex-panel-chat--stale");
  container.classList.toggle("codex-panel-chat--busy", false);
  container.addEventListener("click", () => undefined);
  container.querySelector(".codex-panel-chat");
  container.querySelectorAll(".codex-panel-chat");
  container.closest(".codex-panel-chat");
  container.contains(child);
  container.getBoundingClientRect();
  container.focus();
  input.select();
  input.setSelectionRange(0, 0);
  container.setCssProps({ display: "block" });
  container.scrollHeight;
  container.scrollWidth;
  container.clientHeight;
  container.clientWidth;
  container.offsetTop;
  container.offsetHeight;
  input.selectionStart;
  input.selectionEnd;
  input.selectionDirection;
  const doc = container.ownerDocument;
  doc.defaultView;
  container.style.display;
  container.style.color;
  container.style.setProperty("display", "block");
  container.style.removeProperty("display");
  child.remove();
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/dom-event-escape.tsx"),
      `
import { listenDomEvent } from "../../../shared/ui/dom-events.dom";

export const listen = listenDomEvent;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/services/runtime-overrides.ts"),
      `
export function onAbort(signal: AbortSignal): void {
  signal.addEventListener("abort", () => undefined);
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/root-import.tsx"),
      `
import { renderUiRoot } from '../../../shared/ui/ui-root.dom';

export const render = renderUiRoot;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/panel/shell.dom.tsx"),
      `
import { renderUiRoot } from "../../../shared/ui/ui-root.dom";

export const render = renderUiRoot;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/root-escapes.tsx"),
      `
import type { RootRenderer } from "../../../shared/ui/ui-root.dom";

export type { RootRenderer };

export async function loadRoot() {
  return import("../../../shared/ui/ui-root.dom");
}

const root = await import("../../../shared/ui/ui-root.dom");
export const loadedRoot = root;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/application/state/message-stream.ts"),
      `
export function timestamp(): number {
  setTimeout(() => undefined, 1);
  return Date.now();
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/application/threads/resume-actions.ts"),
      `
export function timestamp(): number {
  setTimeout(() => undefined, 1);
  return Date.now();
}
`.trimStart(),
    );

    const report = biomeLint(
      [
        "src/features/chat/panel/shell-state.tsx",
        "src/shared/ui/components.tsx",
        "src/shared/ui/signal-escapes.tsx",
        "src/features/chat/ui/dom-bridge-escape.tsx",
        "src/features/chat/ui/dom-event-escape.tsx",
        "src/features/chat/ui/dom-bridge.dom.tsx",
        "src/app-server/services/runtime-overrides.ts",
        "src/features/chat/ui/root-import.tsx",
        "src/features/chat/panel/shell.dom.tsx",
        "src/features/chat/ui/root-escapes.tsx",
        "src/features/chat/application/state/message-stream.ts",
        "src/features/chat/application/threads/resume-actions.ts",
      ],
      cwd,
    );

    expect(pluginDiagnostics(report, "src/features/chat/panel/shell-state.tsx")).toEqual([]);
    expect(pluginMessages(report, "src/shared/ui/components.tsx")).toEqual(["Do not import @preact/signals from this module."]);
    expect(pluginMessages(report, "src/shared/ui/signal-escapes.tsx")).toEqual([
      "Do not import @preact/signals from this module.",
      "Do not import @preact/signals from this module.",
      "Do not import @preact/signals from this module.",
    ]);
    expect(pluginMessages(report, "src/features/chat/ui/dom-bridge-escape.tsx")).toEqual(
      Array.from({ length: 37 }, () => DOM_BOUNDARY_MESSAGE),
    );
    expect(pluginMessages(report, "src/features/chat/ui/dom-event-escape.tsx")).toEqual([DOM_EVENTS_IMPORT_MESSAGE]);
    expect(pluginDiagnostics(report, "src/features/chat/ui/dom-bridge.dom.tsx")).toEqual([]);
    expect(pluginDiagnostics(report, "src/app-server/services/runtime-overrides.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/ui/root-import.tsx")).toEqual([
      "Import the Preact root adapter only from explicit root bridge files.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/panel/shell.dom.tsx")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/ui/root-escapes.tsx")).toEqual([
      "Import the Preact root adapter only from explicit root bridge files.",
      "Import the Preact root adapter only from explicit root bridge files.",
      "Import the Preact root adapter only from explicit root bridge files.",
    ]);
    expect(pluginMessages(report, "src/features/chat/application/state/message-stream.ts")).toEqual([
      "Keep this state module deterministic and free of app-server, Obsidian, scheduling, and browser side effects.",
      "Keep this state module deterministic and free of app-server, Obsidian, scheduling, and browser side effects.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/application/threads/resume-actions.ts")).toEqual([]);
  });

  it("keeps chat folder ownership boundaries explicit without filename-scoped Grit checks", async () => {
    const cwd = await tempBiomeWorkspace([
      "no-chat-application-outer-layer-imports.grit",
      "no-chat-app-server-outer-layer-imports.grit",
      "no-chat-workspace-boundary-imports.grit",
      "no-feature-workspace-boundary-imports.grit",
      "no-workspace-chat-internal-imports.grit",
      "no-responsibility-root-module-files.grit",
      "no-chat-host-rendering-layer-imports.grit",
      "no-chat-panel-runtime-boundary-imports.grit",
      "no-chat-presentation-outer-layer-imports.grit",
      "no-chat-ui-outer-layer-imports.grit",
    ]);
    await writeFile(
      path.join(cwd, "src/features/chat/application/outer.ts"),
      `
import type { Host } from "../host/contracts";
import type { ChatThreadHistoryPage } from "../app-server/threads/projection";
import type { ToolbarPanelActions } from "../panel/toolbar-actions";
import { statusText } from "../presentation/runtime/status";
import { Toolbar } from "../ui/toolbar";

export type Escape = ChatThreadHistoryPage | Host | ToolbarPanelActions;
export const values = [statusText, Toolbar] satisfies unknown[];
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/application/allowed.ts"),
      `
import type { MessageStreamItem } from "../domain/message-stream/items";

export type Item = MessageStreamItem;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/application/root-app-server.ts"),
      `
import type { AppServerClient } from "../../../app-server/connection/client";

export type Escape = AppServerClient;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/app-server/outer.ts"),
      `
import type { Host } from "../host/contracts";
import type { ToolbarPanelActions } from "../panel/toolbar-actions";
import { statusText } from "../presentation/runtime/status";
import { Toolbar } from "../ui/toolbar";

export type Escape = Host | ToolbarPanelActions;
export const values = [statusText, Toolbar] satisfies unknown[];
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/app-server/allowed.ts"),
      `
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatStateStore } from "../application/state/store";
import type { MessageStreamItem } from "../domain/message-stream/items";

export type Allowed = AppServerClient | ChatStateStore | MessageStreamItem;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/host/workspace-escape.ts"),
      `
import type { WorkspacePanelCoordinator } from "../../../workspace/panel-coordinator";

export type Escape = WorkspacePanelCoordinator;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/host/workspace-allowed.ts"),
      `
import type { ChatStateStore } from "../application/state/store";

export type Allowed = ChatStateStore;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/host/rendering-escape.ts"),
      `
import { statusText } from "../presentation/runtime/status";
import { Toolbar } from "../ui/toolbar";

export const values = [statusText, Toolbar] satisfies unknown[];
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/host/rendering-allowed.ts"),
      `
import type { ChatStateStore } from "../application/state/store";
import type { ChatPanelToolbarSurface } from "../panel/surface/toolbar-projection";

export type Allowed = ChatStateStore | ChatPanelToolbarSurface;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/threads-view/workspace-escape.ts"),
      `
import type { WorkspacePanelCoordinator } from "../../workspace/panel-coordinator";

export type Escape = WorkspacePanelCoordinator;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/threads-view/workspace-allowed.ts"),
      `
import type { Thread } from "../../domain/threads/model";

export type Allowed = Thread;
`.trimStart(),
    );
    await mkdir(path.join(cwd, "src/workspace"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/workspace/chat-internal-escape.ts"),
      `
import type { ToolbarPanelActions } from "../features/chat/panel/toolbar-actions";

export type Escape = ToolbarPanelActions;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/workspace/chat-host-allowed.ts"),
      `
import type { ChatWorkspacePanelSurface } from "../features/chat/host/contracts";
import type { CodexChatView } from "../features/chat/host/view.obsidian";

export type Allowed = ChatWorkspacePanelSurface | CodexChatView;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/domain/mixed-root.ts"),
      `
export const misplaced = true;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/shared/mixed-root.ts"),
      `
export const misplaced = true;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/mixed-root.ts"),
      `
export const misplaced = true;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/threads/mixed-root.ts"),
      `
export const misplaced = true;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/threads/list/rename-lifecycle.ts"),
      `
export const allowed = true;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/panel/outer.tsx"),
      `
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatServerActionsHost } from "../app-server/actions/host";
import type { Host } from "../host/contracts";

export type Escape = AppServerClient | ChatServerActionsHost | Host;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/panel/allowed.tsx"),
      `
import type { ChatStateStore } from "../application/state/store";
import { Toolbar } from "../ui/toolbar";

export type Allowed = ChatStateStore;
export const toolbar = Toolbar;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/presentation/outer.ts"),
      `
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatStateStore } from "../application/state/store";
import type { ChatServerActionsHost } from "../app-server/actions/host";
import type { Host } from "../host/contracts";
import type { ToolbarPanelActions } from "../panel/toolbar-actions";
import { Toolbar } from "../ui/toolbar";

export type Escape = AppServerClient | ChatStateStore | ChatServerActionsHost | Host | ToolbarPanelActions;
export const toolbar = Toolbar;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/presentation/allowed.ts"),
      `
import type { Thread } from "../../../domain/threads/model";
import type { MessageStreamItem } from "../domain/message-stream/items";

export type Allowed = Thread | MessageStreamItem;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/outer.tsx"),
      `
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatStateStore } from "../application/state/store";
import type { ChatServerActionsHost } from "../app-server/actions/host";
import type { Host } from "../host/contracts";
import type { ToolbarPanelActions } from "../panel/toolbar-actions";

export type Escape = AppServerClient | ChatStateStore | ChatServerActionsHost | Host | ToolbarPanelActions;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/allowed.tsx"),
      `
import type { Thread } from "../../../domain/threads/model";
import type { MessageStreamItem } from "../domain/message-stream/items";
import { statusText } from "../presentation/runtime/status";

export type Allowed = Thread | MessageStreamItem;
export const value = statusText;
`.trimStart(),
    );

    const report = biomeLint(
      [
        "src/features/chat/application/outer.ts",
        "src/features/chat/application/allowed.ts",
        "src/features/chat/application/root-app-server.ts",
        "src/features/chat/app-server/outer.ts",
        "src/features/chat/app-server/allowed.ts",
        "src/features/chat/host/workspace-escape.ts",
        "src/features/chat/host/workspace-allowed.ts",
        "src/features/chat/host/rendering-escape.ts",
        "src/features/chat/host/rendering-allowed.ts",
        "src/features/threads-view/workspace-escape.ts",
        "src/features/threads-view/workspace-allowed.ts",
        "src/workspace/chat-internal-escape.ts",
        "src/workspace/chat-host-allowed.ts",
        "src/domain/mixed-root.ts",
        "src/shared/mixed-root.ts",
        "src/features/chat/mixed-root.ts",
        "src/features/threads/mixed-root.ts",
        "src/features/threads/list/rename-lifecycle.ts",
        "src/features/chat/panel/outer.tsx",
        "src/features/chat/panel/allowed.tsx",
        "src/features/chat/presentation/outer.ts",
        "src/features/chat/presentation/allowed.ts",
        "src/features/chat/ui/outer.tsx",
        "src/features/chat/ui/allowed.tsx",
      ],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/application/outer.ts")).toEqual(
      Array.from({ length: 5 }, () => CHAT_APPLICATION_OUTER_LAYER_MESSAGE),
    );
    expect(pluginDiagnostics(report, "src/features/chat/application/allowed.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/application/root-app-server.ts")).toEqual([CHAT_APPLICATION_OUTER_LAYER_MESSAGE]);
    expect(pluginMessages(report, "src/features/chat/app-server/outer.ts")).toEqual(
      Array.from({ length: 4 }, () => CHAT_APP_SERVER_OUTER_LAYER_MESSAGE),
    );
    expect(pluginDiagnostics(report, "src/features/chat/app-server/allowed.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/host/workspace-escape.ts")).toEqual([CHAT_WORKSPACE_BOUNDARY_MESSAGE]);
    expect(pluginDiagnostics(report, "src/features/chat/host/workspace-allowed.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/host/rendering-escape.ts")).toEqual(
      Array.from({ length: 2 }, () => CHAT_HOST_RENDERING_LAYER_MESSAGE),
    );
    expect(pluginDiagnostics(report, "src/features/chat/host/rendering-allowed.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/threads-view/workspace-escape.ts")).toEqual([FEATURE_WORKSPACE_BOUNDARY_MESSAGE]);
    expect(pluginDiagnostics(report, "src/features/threads-view/workspace-allowed.ts")).toEqual([]);
    expect(pluginMessages(report, "src/workspace/chat-internal-escape.ts")).toEqual([WORKSPACE_CHAT_INTERNAL_MESSAGE]);
    expect(pluginDiagnostics(report, "src/workspace/chat-host-allowed.ts")).toEqual([]);
    expect(pluginMessages(report, "src/domain/mixed-root.ts")).toEqual([RESPONSIBILITY_ROOT_MODULE_FILE_MESSAGE]);
    expect(pluginMessages(report, "src/shared/mixed-root.ts")).toEqual([RESPONSIBILITY_ROOT_MODULE_FILE_MESSAGE]);
    expect(pluginMessages(report, "src/features/chat/mixed-root.ts")).toEqual([RESPONSIBILITY_ROOT_MODULE_FILE_MESSAGE]);
    expect(pluginMessages(report, "src/features/threads/mixed-root.ts")).toEqual([RESPONSIBILITY_ROOT_MODULE_FILE_MESSAGE]);
    expect(pluginDiagnostics(report, "src/features/threads/list/rename-lifecycle.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/panel/outer.tsx")).toEqual(
      Array.from({ length: 3 }, () => CHAT_PANEL_RUNTIME_BOUNDARY_MESSAGE),
    );
    expect(pluginDiagnostics(report, "src/features/chat/panel/allowed.tsx")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/presentation/outer.ts")).toEqual(
      Array.from({ length: 6 }, () => CHAT_PRESENTATION_OUTER_LAYER_MESSAGE),
    );
    expect(pluginDiagnostics(report, "src/features/chat/presentation/allowed.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/ui/outer.tsx")).toEqual(Array.from({ length: 5 }, () => CHAT_UI_OUTER_LAYER_MESSAGE));
    expect(pluginDiagnostics(report, "src/features/chat/ui/allowed.tsx")).toEqual([]);
  });

  it("keeps generated app-server imports behind explicit app-server boundaries", async () => {
    const report = await appServerBoundaryPolicyReport();

    expect(pluginMessages(report, "src/features/chat/domain/generated-thread.ts")).toEqual([
      "Keep generated app-server types behind src/app-server adapters; expose Panel-owned models outside raw app-server boundaries.",
    ]);
    expect(pluginMessages(report, "src/features/chat/domain/generated-thread-import.ts")).toEqual([
      "Keep generated app-server types behind src/app-server adapters; expose Panel-owned models outside raw app-server boundaries.",
    ]);
    expect(pluginDiagnostics(report, "src/app-server/connection/generated-thread.ts")).toEqual([]);
    expect(pluginDiagnostics(report, "tests/app-server/generated-thread.test.ts")).toEqual([]);
    expect(pluginMessages(report, "src/app-server/protocol/request-input.ts")).toEqual([
      "Keep generated app-server types behind src/app-server adapters; expose Panel-owned models outside raw app-server boundaries.",
    ]);
    expect(pluginMessages(report, "src/app-server/services/runtime-overrides.ts")).toEqual([
      "Keep generated app-server types behind src/app-server adapters; expose Panel-owned models outside raw app-server boundaries.",
    ]);
    expect(pluginDiagnostics(report, "src/app-server/protocol/turn.ts")).toEqual([]);
    expect(pluginDiagnostics(report, "src/app-server/protocol/server-requests.ts")).toEqual([]);
  });

  it("keeps TSX files in rendering-owned source folders", async () => {
    const report = await renderingAndCssPolicyReport();

    expect(pluginMessages(report, "src/features/chat/application/state/view.tsx")).toEqual([
      "Keep TSX files in rendering-owned source folders; non-rendering source should use .ts.",
    ]);
    expect(pluginMessages(report, "src/domain/threads/view.tsx")).toEqual([
      "Keep TSX files in rendering-owned source folders; non-rendering source should use .ts.",
    ]);
    expect(pluginMessages(report, "src/features/selection-rewrite/inline-popover.tsx")).toEqual([
      "Keep TSX files in rendering-owned source folders; non-rendering source should use .ts.",
    ]);
    expect(pluginMessages(report, "src/features/threads-view/inline-row.tsx")).toEqual([
      "Keep TSX files in rendering-owned source folders; non-rendering source should use .ts.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/ui/message.tsx")).toEqual([]);
    expect(pluginDiagnostics(report, "src/features/selection-rewrite/popover.dom.tsx")).toEqual([]);
    expect(pluginDiagnostics(report, "src/features/threads-view/shell.dom.tsx")).toEqual([]);
    expect(pluginDiagnostics(report, "src/features/turn-diff/render.dom.tsx")).toEqual([]);
    expect(pluginDiagnostics(report, "src/settings/section.tsx")).toEqual([]);
    expect(pluginDiagnostics(report, "src/shared/ui/diff.tsx")).toEqual([]);
  });

  it("keeps app-server protocol modules behind app-server and chat ingestion boundaries", async () => {
    const report = await appServerBoundaryPolicyReport();

    expect(pluginMessages(report, "src/features/chat/application/pending-requests/pending-request-actions.ts")).toEqual([
      APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE,
    ]);
    expect(pluginMessages(report, "src/features/chat/application/threads/history-controller.ts")).toEqual([
      APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE,
    ]);
    expect(pluginMessages(report, "src/features/chat/panel/surface/message-stream-presenter.ts")).toEqual([
      APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE,
    ]);
    expect(pluginMessages(report, "src/features/chat/ui/protocol-leak.tsx")).toEqual([APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE]);
    expect(pluginMessages(report, "src/features/chat/app-server/inbound/app-server-logs.ts")).toEqual([
      APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE,
    ]);
    expect(pluginMessages(report, "src/features/chat/app-server/mappers/message-stream/turn-items.ts")).toEqual([
      APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE,
      APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE,
    ]);
    expect(pluginMessages(report, "src/features/chat/app-server/inbound/server-request-protocol-leak.ts")).toEqual([
      APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE,
      APP_SERVER_PROTOCOL_BOUNDARY_MESSAGE,
    ]);
  });

  it("keeps domain modules independent from outer layers", async () => {
    const report = await appServerBoundaryPolicyReport();

    expect(pluginMessages(report, "src/domain/threads/model.ts")).toEqual([
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
    ]);
    expect(pluginDiagnostics(report, "src/domain/threads/format.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/domain/message-stream/selectors.ts")).toEqual([
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/domain/message-stream/items.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/domain/message-stream/outer-shapes.ts")).toEqual([
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
      "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
    ]);
  });

  it("keeps lower-level modules independent from feature modules", async () => {
    const report = await appServerBoundaryPolicyReport();

    expect(pluginMessages(report, "src/app-server/protocol/diagnostics.ts")).toEqual([
      "Do not import feature modules from this layer. Move shared behavior to shared, domain, or app-server adapters.",
    ]);
    expect(pluginMessages(report, "src/shared/thread-picker.ts")).toEqual([
      "Do not import feature modules from this layer. Move shared behavior to shared, domain, or app-server adapters.",
    ]);
    expect(pluginDiagnostics(report, "src/shared/date.ts")).toEqual([]);
  });

  it("keeps app-server connection internals behind app-server adapters", async () => {
    const report = await appServerBoundaryPolicyReport();

    expect(pluginMessages(report, "src/app-server/protocol/catalog.ts")).toEqual([
      "Do not import app-server connection internals from this module. Keep connection usage at app-server adapters.",
    ]);
    expect(pluginDiagnostics(report, "src/app-server/services/catalog.ts")).toEqual([]);
    const domainConnectionMessages = pluginMessages(report, "src/domain/connection-client.ts");
    expect(domainConnectionMessages).toHaveLength(2);
    expect(domainConnectionMessages).toEqual(
      expect.arrayContaining([
        "Domain modules must stay pure; outer layers may depend on domain, not the reverse.",
        "Do not import app-server connection internals from this module. Keep connection usage at app-server adapters.",
      ]),
    );
    expect(pluginMessages(report, "src/shared/connection-client.ts")).toEqual([
      "Do not import app-server connection internals from this module. Keep connection usage at app-server adapters.",
    ]);
  });

  it("keeps settings app-server access behind settings app-server adapters", async () => {
    const report = await appServerBoundaryPolicyReport();

    expect(pluginMessages(report, "src/settings/dynamic-sections-controller.ts")).toEqual([SETTINGS_APP_SERVER_BOUNDARY_MESSAGE]);
    expect(pluginMessages(report, "src/settings/adapter-leak.ts")).toEqual([SETTINGS_APP_SERVER_BOUNDARY_MESSAGE]);
    expect(pluginDiagnostics(report, "src/settings/app-server/dynamic-data.ts")).toEqual([]);
  });

  it("keeps app-server root from becoming a boundary escape hatch", async () => {
    const cwd = await tempBiomeWorkspace([
      "no-responsibility-root-module-files.grit",
      "no-app-server-root-module-imports.grit",
      "no-app-server-subfolder-root-imports.grit",
    ]);
    await writeFile(
      path.join(cwd, "src/app-server/escape.ts"),
      `
import type { AppServerClient } from "./connection/client";

export type Escape = AppServerClient;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/app-server/root-import.ts"),
      `
import { listThreads } from "../../../../app-server/threads";

export const read = listThreads;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/services/root-import.ts"),
      `
import { listThreads } from "../threads";

export const read = listThreads;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/services/allowed.ts"),
      `
import type { AppServerClient } from "../connection/client";
import { listThreads } from "./threads";

export type Allowed = AppServerClient;
export const read = listThreads;
`.trimStart(),
    );

    const report = biomeLint(
      [
        "src/app-server/escape.ts",
        "src/features/chat/app-server/root-import.ts",
        "src/app-server/services/root-import.ts",
        "src/app-server/services/allowed.ts",
      ],
      cwd,
    );

    expect(pluginMessages(report, "src/app-server/escape.ts")).toEqual([RESPONSIBILITY_ROOT_MODULE_FILE_MESSAGE]);
    expect(pluginMessages(report, "src/features/chat/app-server/root-import.ts")).toEqual([APP_SERVER_ROOT_MODULE_IMPORT_MESSAGE]);
    expect(pluginMessages(report, "src/app-server/services/root-import.ts")).toEqual([APP_SERVER_SUBFOLDER_ROOT_IMPORT_MESSAGE]);
    expect(pluginDiagnostics(report, "src/app-server/services/allowed.ts")).toEqual([]);
  });

  it("keeps chat application app-server projection RPCs behind facades", async () => {
    const report = await appServerBoundaryPolicyReport();

    expect(pluginMessages(report, "src/features/chat/application/threads/history.ts")).toEqual([
      "Keep app-server projection RPCs behind app-server facades; consume Panel-owned snapshots or view models here.",
    ]);
    expect(pluginDiagnostics(report, "src/app-server/services/threads.ts")).toEqual([]);
    expect(pluginDiagnostics(report, "src/features/chat/host/connection-bundle.ts")).toEqual([]);
  });

  it("keeps CSS on design tokens and scoped selectors", async () => {
    const report = await renderingAndCssPolicyReport();

    expect(pluginMessages(report, "src/styles/bad.css")).toEqual([
      "Avoid :has() because it can cause broad selector invalidation.",
      "Use Obsidian or Codex Panel design tokens instead of hardcoded colors.",
      "Prefer Obsidian or Codex Panel spacing and size tokens for layout dimensions.",
      "Do not hide class, id, or attribute selectors inside :where().",
      "Use Obsidian or Codex Panel typography tokens instead of hardcoded font sizes.",
      "Avoid ID selectors in Codex Panel CSS.",
      "Use Obsidian or Codex Panel typography tokens instead of hardcoded font weights.",
      "Prefix keyframes with codex-panel-.",
    ]);
    expect(pluginDiagnostics(report, "src/styles/good.css")).toEqual([]);
  });
});

function renderingAndCssPolicyReport() {
  renderingAndCssPolicyReportPromise ??= createRenderingAndCssPolicyReport();
  return renderingAndCssPolicyReportPromise;
}

async function createRenderingAndCssPolicyReport() {
  const cwd = await tempBiomeWorkspace(["no-misplaced-tsx.grit", "no-restricted-css-policy.grit"]);
  await writeFile(
    path.join(cwd, "src/features/chat/application/state/view.tsx"),
    `
export const value = <div />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/domain/threads/view.tsx"),
    `
export const value = <span />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/selection-rewrite/inline-popover.tsx"),
    `
export const value = <aside />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/selection-rewrite/popover.dom.tsx"),
    `
export const value = <aside />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/threads-view/inline-row.tsx"),
    `
export const value = <li />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/threads-view/shell.dom.tsx"),
    `
export const value = <main />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/turn-diff/render.dom.tsx"),
    `
export const value = <main />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/ui/message.tsx"),
    `
export const value = <article />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/settings/section.tsx"),
    `
export const value = <section />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/shared/ui/diff.tsx"),
    `
export const value = <pre />;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/styles/bad.css"),
    `
.codex-panel:has(.codex-panel__item) {
  color: black;
  margin-top: 8px;
}

:where(.codex-panel__item) {
  font-size: 12px;
}

#codex-panel-id {
  font-weight: bold;
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/styles/good.css"),
    `
.codex-panel__item:where(:hover, :focus-visible) {
  color: var(--text-normal);
  margin-top: var(--codex-panel-item-gap);
  font-size: var(--font-ui-small);
  font-weight: var(--font-normal);
}

.codex-panel__message-content.markdown-rendered pre {
  overflow-x: auto;
}

@keyframes codex-panel-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
`.trimStart(),
  );

  return biomeLint(
    [
      "src/features/chat/application/state/view.tsx",
      "src/domain/threads/view.tsx",
      "src/features/selection-rewrite/inline-popover.tsx",
      "src/features/selection-rewrite/popover.dom.tsx",
      "src/features/threads-view/inline-row.tsx",
      "src/features/threads-view/shell.dom.tsx",
      "src/features/turn-diff/render.dom.tsx",
      "src/features/chat/ui/message.tsx",
      "src/settings/section.tsx",
      "src/shared/ui/diff.tsx",
      "src/styles/bad.css",
      "src/styles/good.css",
    ],
    cwd,
  );
}

function appServerBoundaryPolicyReport() {
  appServerBoundaryPolicyReportPromise ??= createAppServerBoundaryPolicyReport();
  return appServerBoundaryPolicyReportPromise;
}

async function createAppServerBoundaryPolicyReport() {
  const cwd = await tempBiomeWorkspace([
    "no-generated-app-server-boundary-imports.grit",
    "no-app-server-protocol-boundary-imports.grit",
    "no-domain-outer-layer-imports.grit",
    "no-lower-level-feature-imports.grit",
    "no-app-server-connection-boundary-imports.grit",
    "no-app-server-projection-rpcs.grit",
    "no-settings-app-server-boundary-imports.grit",
  ]);
  await writeFile(
    path.join(cwd, "src/features/chat/domain/generated-thread.ts"),
    `
import type { Thread } from '../../../generated/app-server/v2/Thread';

export type GeneratedThread = Thread;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/domain/generated-thread-import.ts"),
    `
import type { Thread } from '../../../generated/app-server/v2/Thread';

export type GeneratedThread = Thread;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/connection/generated-thread.ts"),
    `
import type { Thread } from "../../generated/app-server/v2/Thread";

export type GeneratedThread = Thread;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "tests/app-server/generated-thread.test.ts"),
    `
import type { Thread } from "../../src/generated/app-server/v2/Thread";

export type GeneratedThread = Thread;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/protocol/request-input.ts"),
    `
import type { UserInput } from "../../generated/app-server/v2/UserInput";

export type Input = UserInput;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/services/runtime-overrides.ts"),
    `
import type { ModelListResponse } from "../../generated/app-server/v2/ModelListResponse";

export interface RuntimeOverrideModelClient {
  request(method: "model/list", params: { includeHidden: boolean }): Promise<ModelListResponse>;
}
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/protocol/turn.ts"),
    `
import type { ThreadItem as GeneratedTurnItem } from "../../generated/app-server/v2/ThreadItem";

export type TurnItem = GeneratedTurnItem;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/protocol/server-requests.ts"),
    `
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import type { ToolRequestUserInputParams } from "../../generated/app-server/v2/ToolRequestUserInputParams";

export type Request = ServerRequest;
export type Params = ToolRequestUserInputParams;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/application/pending-requests/pending-request-actions.ts"),
    `
import { threadTokenUsageFromAppServerUsage } from '../../../../app-server/protocol/runtime-metrics';

export const convert = threadTokenUsageFromAppServerUsage;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/application/threads/history-controller.ts"),
    `
import type { TurnItem } from "../../../../app-server/protocol/turn";

export type Item = TurnItem;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/panel/surface/message-stream-presenter.ts"),
    `
import { appServerUserInputResponse } from "../../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/ui/protocol-leak.tsx"),
    `
import { threadTokenUsageFromAppServerUsage } from "../../../app-server/protocol/runtime-metrics";

export const value = <div>{String(threadTokenUsageFromAppServerUsage)}</div>;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/app-server/inbound/app-server-logs.ts"),
    `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/app-server/mappers/message-stream/turn-items.ts"),
    `
import type { TurnItem } from "../../../../../app-server/protocol/turn";
import { toolInventoryAppsFromAppInfos } from "../../../../../app-server/protocol/tool-inventory";

const toolInventory = await import("../../../../../app-server/protocol/tool-inventory");

export const convert = [toolInventoryAppsFromAppInfos, toolInventory] satisfies unknown[];
export type Item = TurnItem;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/app-server/inbound/server-request-protocol-leak.ts"),
    `
import { appServerUserInputResponse } from "../../../../../app-server/protocol/server-requests";

const runtimeMetrics = await import("../../../../../app-server/protocol/runtime-metrics");

export const response = [appServerUserInputResponse, runtimeMetrics] satisfies unknown[];
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/domain/threads/model.ts"),
    `
import { listThreads } from "../../app-server/services/threads";
import type { ThreadPickerModal } from "../../features/thread-picker/modal";
import { copyText } from "../../shared/ui/clipboard";
import type { App } from "obsidian";

export type Host = App;
export type Modal = ThreadPickerModal;
export const list = listThreads;
export const copy = copyText;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/domain/threads/format.ts"),
    `
import { formatDate } from "../../shared/date";

export const format = formatDate;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/domain/message-stream/selectors.ts"),
    `
import type { ChatStateStore } from "../../application/state/store";
import type { Presenter } from 'src/features/chat/presentation/view';

export type Store = ChatStateStore;
export type View = Presenter;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/domain/message-stream/items.ts"),
    `
import type { MessageStreamItem } from "./item";

export type Item = MessageStreamItem;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/domain/message-stream/outer-shapes.ts"),
    `
import type { ChatStateStore } from "../../application/state/store";

export type OuterStore = ChatStateStore;

export async function loadComposer() {
  return import("src/features/chat/ui/composer");
}

const host = await import("../../host/session");
export const outerHost = host;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/protocol/diagnostics.ts"),
    `
import type { ThreadPickerModal } from '../../features/thread-picker/modal';

export type Modal = ThreadPickerModal;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/shared/thread-picker.ts"),
    `
import type { ThreadPickerModal } from "../features/thread-picker/modal";

export type Modal = ThreadPickerModal;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/shared/date.ts"),
    `
import { formatDate } from "./format";

export const format = formatDate;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/protocol/catalog.ts"),
    `
import type { AppServerClient } from "../connection/client";

export type Client = AppServerClient;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/services/catalog.ts"),
    `
import type { AppServerClient } from "../connection/client";

export type Client = AppServerClient;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/domain/connection-client.ts"),
    `
import type { AppServerClient } from "../app-server/connection/client";

export type Client = AppServerClient;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/shared/connection-client.ts"),
    `
import type { AppServerClient } from "src/app-server/connection/client";

export type Client = AppServerClient;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/application/threads/history.ts"),
    `
import type { AppServerClient } from "../../../../app-server/connection/client";

export async function read(appServerClient: AppServerClient): Promise<void> {
  await appServerClient.request("thread/turns/list", { threadId: "thread", cursor: null, limit: 20 });
}
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/app-server/services/threads.ts"),
    `
import type { AppServerClient } from "../connection/client";

export async function read(client: AppServerClient): Promise<void> {
  await client.request("thread/turns/list", { threadId: "thread", cursor: null, limit: 20 });
}
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/features/chat/host/connection-bundle.ts"),
    `
import type { AppServerClient } from "../../../app-server/connection/client";

export async function resume(client: AppServerClient): Promise<void> {
  await client.request("thread/resume", { threadId: "thread", cwd: "/vault" });
}
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/settings/dynamic-sections-controller.ts"),
    `
import { listHookCatalog } from "../app-server/services/catalog";

export const load = listHookCatalog;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/settings/adapter-leak.ts"),
    `
import { createSettingsAppServerDynamicData } from "./app-server/dynamic-data";

export const create = createSettingsAppServerDynamicData;
`.trimStart(),
  );
  await writeFile(
    path.join(cwd, "src/settings/app-server/dynamic-data.ts"),
    `
import { listHookCatalog } from "../../app-server/services/catalog";

export const load = listHookCatalog;
`.trimStart(),
  );

  return biomeLint(
    [
      "src/features/chat/domain/generated-thread.ts",
      "src/features/chat/domain/generated-thread-import.ts",
      "src/app-server/connection/generated-thread.ts",
      "tests/app-server/generated-thread.test.ts",
      "src/app-server/protocol/request-input.ts",
      "src/app-server/services/runtime-overrides.ts",
      "src/app-server/protocol/turn.ts",
      "src/app-server/protocol/server-requests.ts",
      "src/features/chat/application/pending-requests/pending-request-actions.ts",
      "src/features/chat/application/threads/history-controller.ts",
      "src/features/chat/panel/surface/message-stream-presenter.ts",
      "src/features/chat/ui/protocol-leak.tsx",
      "src/features/chat/app-server/inbound/app-server-logs.ts",
      "src/features/chat/app-server/mappers/message-stream/turn-items.ts",
      "src/features/chat/app-server/inbound/server-request-protocol-leak.ts",
      "src/domain/threads/model.ts",
      "src/domain/threads/format.ts",
      "src/features/chat/domain/message-stream/selectors.ts",
      "src/features/chat/domain/message-stream/items.ts",
      "src/features/chat/domain/message-stream/outer-shapes.ts",
      "src/app-server/protocol/diagnostics.ts",
      "src/shared/thread-picker.ts",
      "src/shared/date.ts",
      "src/app-server/protocol/catalog.ts",
      "src/app-server/services/catalog.ts",
      "src/domain/connection-client.ts",
      "src/shared/connection-client.ts",
      "src/features/chat/application/threads/history.ts",
      "src/app-server/services/threads.ts",
      "src/features/chat/host/connection-bundle.ts",
      "src/settings/dynamic-sections-controller.ts",
      "src/settings/adapter-leak.ts",
      "src/settings/app-server/dynamic-data.ts",
    ],
    cwd,
  );
}

async function tempBiomeWorkspace(plugins) {
  const cwd = await mkdtemp(path.join(tmpdir(), "codex-panel-grit-policy-"));
  await mkdir(cwd, { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/domain/message-stream"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/application/state"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/application/threads"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/application/pending-requests"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/app-server/inbound"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/app-server/mappers/message-stream"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/host"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/panel"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/panel/surface"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/presentation"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/chat/ui"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/selection-rewrite"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/threads/list"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/threads/workflows"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/threads-view"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/turn-diff"), { recursive: true });
  await mkdir(path.join(cwd, "src/settings"), { recursive: true });
  await mkdir(path.join(cwd, "src/settings/app-server"), { recursive: true });
  await mkdir(path.join(cwd, "src/domain/threads"), { recursive: true });
  await mkdir(path.join(cwd, "src/app-server/connection"), { recursive: true });
  await mkdir(path.join(cwd, "src/app-server/protocol"), { recursive: true });
  await mkdir(path.join(cwd, "src/app-server/services"), { recursive: true });
  await mkdir(path.join(cwd, "src/shared"), { recursive: true });
  await mkdir(path.join(cwd, "src/shared/ui"), { recursive: true });
  await mkdir(path.join(cwd, "src/styles"), { recursive: true });
  await mkdir(path.join(cwd, "tests/app-server"), { recursive: true });
  await writeFile(
    path.join(cwd, "biome.jsonc"),
    JSON.stringify({
      $schema: "https://biomejs.dev/schemas/2.5.1/schema.json",
      vcs: { enabled: false },
      plugins: plugins.map((plugin) => projectPluginConfig(plugin)),
      css: { linter: { enabled: true } },
    }),
  );
  return cwd;
}

function biomeLint(files, cwd, options = {}) {
  const expectErrors = options.expectErrors ?? true;
  const result = spawnSync(biomeBin, ["lint", ...files, "--config-path", cwd, "--reporter=json", "--max-diagnostics=none"], {
    cwd,
    encoding: "utf8",
  });
  const report = parseBiomeJsonReport(result.stdout, result.stderr);
  report.cwd = cwd;
  if (expectErrors && (result.status !== 1 || report.summary.errors === 0)) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  if (!expectErrors && (result.status !== 0 || report.summary.errors !== 0)) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  return report;
}

function projectPluginConfig(plugin) {
  const projectPlugin = projectPluginByName.get(plugin);
  if (!projectPlugin) {
    throw new Error(`Missing ${plugin} in biome.jsonc plugins`);
  }
  const pluginPath = path.resolve(repoRoot, projectPluginPath(projectPlugin));
  if (typeof projectPlugin === "string") {
    return pluginPath;
  }
  return { ...projectPlugin, path: pluginPath };
}

function projectPluginPath(plugin) {
  return typeof plugin === "string" ? plugin : plugin.path;
}

function pluginDiagnostics(report, filePath) {
  return report.diagnostics
    .filter((diagnostic) => diagnostic.category === "plugin" && diagnosticMatchesFile(report, diagnostic, filePath))
    .map((diagnostic) => ({
      line: diagnostic.location.start.line,
      column: diagnostic.location.start.column,
      endLine: diagnostic.location.end.line,
      endColumn: diagnostic.location.end.column,
    }));
}

function pluginMessages(report, filePath) {
  return report.diagnostics
    .filter((diagnostic) => diagnostic.category === "plugin" && diagnosticMatchesFile(report, diagnostic, filePath))
    .map((diagnostic) => diagnostic.message);
}

function diagnosticMatchesFile(report, diagnostic, filePath) {
  if (!filePath) return true;
  return normalizeDiagnosticPath(report, diagnostic) === normalizeRelativePath(filePath);
}

function normalizeDiagnosticPath(report, diagnostic) {
  const diagnosticPath = diagnostic.location?.path ?? "";
  const relativePath = path.isAbsolute(diagnosticPath) ? path.relative(report.cwd, diagnosticPath) : diagnosticPath;
  return normalizeRelativePath(relativePath);
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizeProjectRelativePath(filePath) {
  return normalizeRelativePath(filePath).replace(/^\.\//, "");
}

async function listRelativeGritPolicyPaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listRelativeGritPolicyPaths(entryPath);
      if (entry.isFile() && entry.name.endsWith(".grit")) return [normalizeRelativePath(path.relative(repoRoot, entryPath))];
      return [];
    }),
  );
  return paths.flat().sort();
}

function parseBiomeJsonReport(stdout, stderr) {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`Biome did not print a JSON report:\n${[stdout, stderr].filter(Boolean).join("\n")}`);
  }
  return JSON.parse(stdout.slice(jsonStart));
}

function parseJsonc(source) {
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
}
