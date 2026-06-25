import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const biomeBin = path.join(repoRoot, "node_modules", ".bin", "biome");
const workspaceByPlugins = new Map();

describe("GritQL source policy", () => {
  it("can report hand-written re-export barrels as Biome plugin diagnostics", async () => {
    const cwd = await tempBiomeWorkspace(["no-handwritten-reexports.grit"]);
    await writeFile(
      path.join(cwd, "reexports.ts"),
      `
export { value } from "./owner";
export * from "./barrel";

const local = 1;
export { local };
`.trimStart(),
    );

    const report = biomeLint(["reexports.ts"], cwd);

    expect(pluginDiagnostics(report, "reexports.ts")).toEqual([
      { line: 1, column: 8, endLine: 1, endColumn: 33 },
      { line: 2, column: 8, endLine: 2, endColumn: 26 },
    ]);
  });

  it("keeps Preact signals behind the chat shell-state adapter", async () => {
    const cwd = await tempBiomeWorkspace(["no-chat-signal-imports.grit"]);
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
export { signal } from "@preact/signals";
export type SignalValue = import("@preact/signals").Signal<string>;

export async function loadSignals() {
  return import("@preact/signals");
}

const signals = require("@preact/signals");
export const loadedSignals = signals;
`.trimStart(),
    );

    const report = biomeLint(
      ["src/features/chat/panel/shell-state.tsx", "src/shared/ui/components.tsx", "src/shared/ui/signal-escapes.tsx"],
      cwd,
    );

    expect(pluginDiagnostics(report, "src/features/chat/panel/shell-state.tsx")).toEqual([]);
    expect(pluginMessages(report, "src/shared/ui/components.tsx")).toEqual([
      "Use @preact/signals only in src/features/chat/panel/shell-state.tsx as the reducer-to-Preact derived projection adapter.",
    ]);
    expect(pluginMessages(report, "src/shared/ui/signal-escapes.tsx")).toEqual([
      "Use @preact/signals only in src/features/chat/panel/shell-state.tsx as the reducer-to-Preact derived projection adapter.",
      "Use @preact/signals only in src/features/chat/panel/shell-state.tsx as the reducer-to-Preact derived projection adapter.",
      "Use @preact/signals only in src/features/chat/panel/shell-state.tsx as the reducer-to-Preact derived projection adapter.",
      "Use @preact/signals only in src/features/chat/panel/shell-state.tsx as the reducer-to-Preact derived projection adapter.",
    ]);
  });

  it("keeps chat domain independent from outer chat layers", async () => {
    const cwd = await tempBiomeWorkspace(["no-chat-domain-outer-layer-imports.grit"]);
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
export { createChatStateStore } from "../../application/state/store";
export type OuterStore = import("../../application/state/store").ChatStateStore;

export async function loadComposer() {
  return import("src/features/chat/ui/composer");
}

const host = require("../../host/session");
export const outerHost = host;
`.trimStart(),
    );

    const report = biomeLint(
      [
        "src/features/chat/domain/message-stream/selectors.ts",
        "src/features/chat/domain/message-stream/items.ts",
        "src/features/chat/domain/message-stream/outer-shapes.ts",
      ],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/domain/message-stream/selectors.ts")).toEqual([
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/domain/message-stream/items.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/domain/message-stream/outer-shapes.ts")).toEqual([
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
    ]);
  });

  it("blocks generated app-server imports outside app-server boundaries", async () => {
    const cwd = await tempBiomeWorkspace(["no-generated-app-server-boundary-imports.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/domain/generated-thread.ts"),
      `
export type GeneratedThread = import('../../../generated/app-server/v2/Thread').Thread;
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
export type GeneratedThread = import("../../generated/app-server/v2/Thread").Thread;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "tests/app-server/generated-thread.test.ts"),
      `
export type GeneratedThread = import("../../src/generated/app-server/v2/Thread").Thread;
`.trimStart(),
    );

    const report = biomeLint(
      [
        "src/features/chat/domain/generated-thread.ts",
        "src/features/chat/domain/generated-thread-import.ts",
        "src/app-server/connection/generated-thread.ts",
        "tests/app-server/generated-thread.test.ts",
      ],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/domain/generated-thread.ts")).toEqual([
      "Keep generated app-server types behind src/app-server and tests/app-server; expose Panel-owned models outside raw app-server adapters.",
    ]);
    expect(pluginMessages(report, "src/features/chat/domain/generated-thread-import.ts")).toEqual([
      "Keep generated app-server types behind src/app-server and tests/app-server; expose Panel-owned models outside raw app-server adapters.",
    ]);
    expect(pluginDiagnostics(report, "src/app-server/connection/generated-thread.ts")).toEqual([]);
    expect(pluginDiagnostics(report, "tests/app-server/generated-thread.test.ts")).toEqual([]);
  });

  it("keeps app-server protocol modules behind app-server and chat ingestion boundaries", async () => {
    const cwd = await tempBiomeWorkspace(["no-app-server-protocol-boundary-imports.grit"]);
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
      path.join(cwd, "src/features/chat/app-server/inbound/notification-plan.ts"),
      `
import { toolInventoryAppsFromAppInfos } from "../../../../app-server/protocol/tool-inventory";

const toolInventory = require("../../../../app-server/protocol/tool-inventory");

export const convert = [toolInventoryAppsFromAppInfos, toolInventory];
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/app-server/mappers/message-stream/turn-items.ts"),
      `
import type { TurnItem } from "../../../../../app-server/protocol/turn";

export type Item = TurnItem;
`.trimStart(),
    );

    const report = biomeLint(
      [
        "src/features/chat/application/pending-requests/pending-request-actions.ts",
        "src/features/chat/application/threads/history-controller.ts",
        "src/features/chat/app-server/inbound/notification-plan.ts",
        "src/features/chat/app-server/mappers/message-stream/turn-items.ts",
      ],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/application/pending-requests/pending-request-actions.ts")).toEqual([
      "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
    ]);
    expect(pluginMessages(report, "src/features/chat/application/threads/history-controller.ts")).toEqual([
      "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
    ]);
    expect(pluginMessages(report, "src/features/chat/app-server/inbound/notification-plan.ts")).toEqual([
      "Chat app-server ingestion and message-stream conversion may consume the app-server turn protocol only. Convert other protocol payloads to local or domain models at the boundary.",
      "Chat app-server ingestion and message-stream conversion may consume the app-server turn protocol only. Convert other protocol payloads to local or domain models at the boundary.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/app-server/mappers/message-stream/turn-items.ts")).toEqual([]);
  });

  it("keeps server request protocol imports in chat request boundaries only", async () => {
    const cwd = await tempBiomeWorkspace(["no-app-server-protocol-boundary-imports.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/panel/surface/message-stream-presenter.ts"),
      `
import { appServerUserInputResponse } from "../../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
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
      path.join(cwd, "src/features/chat/app-server/inbound/handler.ts"),
      `
const runtimeMetrics = require("../../../../app-server/protocol/runtime-metrics");

export const response = runtimeMetrics;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/app-server/inbound/routing.ts"),
      `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`.trimStart(),
    );

    const report = biomeLint(
      [
        "src/features/chat/panel/surface/message-stream-presenter.ts",
        "src/features/chat/app-server/inbound/app-server-logs.ts",
        "src/features/chat/app-server/inbound/handler.ts",
        "src/features/chat/app-server/inbound/routing.ts",
      ],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/panel/surface/message-stream-presenter.ts")).toEqual([
      "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
    ]);
    expect(pluginMessages(report, "src/features/chat/app-server/inbound/app-server-logs.ts")).toEqual([
      "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
    ]);
    expect(pluginMessages(report, "src/features/chat/app-server/inbound/handler.ts")).toEqual([
      "Chat app-server request handling may consume server request protocol projections only. Convert app-server payloads to chat pending request domain models at this boundary.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/app-server/inbound/routing.ts")).toEqual([]);
  });

  it("keeps generated app-server bindings behind explicit exceptions", async () => {
    const cwd = await tempBiomeWorkspace(["no-generated-app-server-boundary-imports.grit"]);
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
import type { ModelListResponse } from "../generated/app-server/v2/ModelListResponse";

export interface RuntimeOverrideModelClient {
  listModels(includeHidden: boolean): Promise<ModelListResponse>;
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

    const report = biomeLint(
      ["src/app-server/protocol/request-input.ts", "src/app-server/services/runtime-overrides.ts", "src/app-server/protocol/turn.ts"],
      cwd,
    );

    expect(pluginMessages(report, "src/app-server/protocol/request-input.ts")).toEqual([
      "Keep generated app-server types behind src/app-server and tests/app-server; expose Panel-owned models outside raw app-server adapters.",
    ]);
    expect(pluginMessages(report, "src/app-server/services/runtime-overrides.ts")).toEqual([
      "Keep generated app-server types behind src/app-server and tests/app-server; expose Panel-owned models outside raw app-server adapters.",
    ]);
    expect(pluginDiagnostics(report, "src/app-server/protocol/turn.ts")).toEqual([]);
  });

  it("keeps lower-level source independent from connection and feature layers", async () => {
    const cwd = await tempBiomeWorkspace(["no-lower-level-boundary-imports.grit"]);
    await writeFile(
      path.join(cwd, "src/app-server/protocol/catalog.ts"),
      `
import type { AppServerClient } from "../connection/client";

export type Client = AppServerClient;
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
      path.join(cwd, "src/shared/date.ts"),
      `
import { formatDate } from "./format";

export const format = formatDate;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/domain/threads/model.ts"),
      `
import { listThreads } from "../../app-server/threads";
import { copyText } from "../../shared/ui/clipboard";
import type { App } from "obsidian";

export type Host = App;
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

    const report = biomeLint(
      [
        "src/app-server/protocol/catalog.ts",
        "src/app-server/protocol/diagnostics.ts",
        "src/shared/date.ts",
        "src/domain/threads/model.ts",
        "src/domain/threads/format.ts",
      ],
      cwd,
    );

    expect(pluginMessages(report, "src/app-server/protocol/catalog.ts")).toEqual([
      "Lower-level modules must not import feature modules or app-server connection internals. Move shared behavior to shared, domain, or app-server adapters.",
    ]);
    expect(pluginMessages(report, "src/app-server/protocol/diagnostics.ts")).toEqual([
      "Lower-level modules must not import feature modules or app-server connection internals. Move shared behavior to shared, domain, or app-server adapters.",
    ]);
    expect(pluginDiagnostics(report, "src/shared/date.ts")).toEqual([]);
    expect(pluginMessages(report, "src/domain/threads/model.ts")).toEqual([
      "Domain modules must stay pure and generated-independent; keep app-server, settings, workspace, UI, and Obsidian dependencies at boundary callers.",
      "Domain modules must stay pure and generated-independent; keep app-server, settings, workspace, UI, and Obsidian dependencies at boundary callers.",
      "Domain modules must stay pure and generated-independent; keep app-server, settings, workspace, UI, and Obsidian dependencies at boundary callers.",
    ]);
    expect(pluginDiagnostics(report, "src/domain/threads/format.ts")).toEqual([]);
  });

  it("keeps generated app-server import shapes behind narrow aliases and protocol exceptions", async () => {
    const cwd = await tempBiomeWorkspace(["no-generated-app-server-import-shapes.grit"]);
    await writeFile(
      path.join(cwd, "src/app-server/connection/thread.ts"),
      `
import type { Thread } from "../../generated/app-server/v2/Thread";

export type ConnectionThread = Thread;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/connection/aliased-thread.ts"),
      `
import type { Thread as AppServerThread } from "../../generated/app-server/v2/Thread";

export type ConnectionThread = AppServerThread;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/connection/record-thread.ts"),
      `
import type { Thread as ThreadRecord } from "../../generated/app-server/v2/Thread";

export type ConnectionThread = ThreadRecord;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/protocol/turn.ts"),
      `
import type { ThreadItem as GeneratedTurnItem } from "../../generated/app-server/v2/ThreadItem";
import type { UserInput } from "../../generated/app-server/v2/UserInput";

export type TurnItem = GeneratedTurnItem;
export type Input = UserInput;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/protocol/server-requests.ts"),
      `
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import type { ToolRequestUserInputParams } from "../../generated/app-server/v2/ToolRequestUserInputParams";

export type Request = ServerRequest;
export type Params = ToolRequestUserInputParams;
export type InputParams = import("../../generated/app-server/v2/ToolRequestUserInputParams").ToolRequestUserInputParams;

export async function loadParams() {
  return import("../../generated/app-server/v2/ToolRequestUserInputParams");
}

const params = require("../../generated/app-server/v2/ToolRequestUserInputParams");
export const loadedParams = params;
`.trimStart(),
    );

    const report = biomeLint(
      [
        "src/app-server/connection/thread.ts",
        "src/app-server/connection/aliased-thread.ts",
        "src/app-server/connection/record-thread.ts",
        "src/app-server/protocol/turn.ts",
        "src/app-server/protocol/server-requests.ts",
      ],
      cwd,
    );

    expect(pluginMessages(report, "src/app-server/connection/thread.ts")).toEqual([
      "Import generated app-server Thread as AppServerThread, or use the Panel-owned domain Thread model.",
    ]);
    expect(pluginDiagnostics(report, "src/app-server/connection/aliased-thread.ts")).toEqual([]);
    expect(pluginMessages(report, "src/app-server/connection/record-thread.ts")).toEqual([
      "Import generated app-server Thread as AppServerThread, or use the Panel-owned domain Thread model.",
    ]);
    expect(pluginMessages(report, "src/app-server/protocol/turn.ts")).toEqual([
      "Only generated ThreadItem is allowed in the turn protocol exception. Model other turn payload shapes locally.",
    ]);
    expect(pluginMessages(report, "src/app-server/protocol/server-requests.ts")).toEqual([
      "Only generated RequestId and ServerRequest are allowed in the server request protocol exception.",
      "Only generated RequestId and ServerRequest are allowed in the server request protocol exception.",
      "Only generated RequestId and ServerRequest are allowed in the server request protocol exception.",
      "Only generated RequestId and ServerRequest are allowed in the server request protocol exception.",
    ]);
  });

  it("keeps chat application app-server projection RPCs behind facades", async () => {
    const cwd = await tempBiomeWorkspace(["no-app-server-projection-rpcs.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/application/threads/history.ts"),
      `
import type { AppServerClient } from "../../../../app-server/connection/client";

export async function read(appServerClient: AppServerClient): Promise<void> {
  await appServerClient.threadTurnsList("thread", null, 20);
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/threads.ts"),
      `
import type { AppServerClient } from "./connection/client";

export async function read(client: AppServerClient): Promise<void> {
  await client.threadTurnsList("thread", null, 20);
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/host/connection-bundle.ts"),
      `
import type { AppServerClient } from "../../../app-server/connection/client";

type Resume = AppServerClient["resumeThread"];
`.trimStart(),
    );

    const report = biomeLint(
      ["src/features/chat/application/threads/history.ts", "src/app-server/threads.ts", "src/features/chat/host/connection-bundle.ts"],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/application/threads/history.ts")).toEqual([
      "Keep app-server projection RPCs behind app-server facades; chat application code should consume Panel-owned snapshots or view models.",
    ]);
    expect(pluginDiagnostics(report, "src/app-server/threads.ts")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/host/connection-bundle.ts")).toEqual([
      "Do not expose app-server projection RPC signatures through AppServerClient indexed access types; define a Panel-owned projection type instead.",
    ]);
  });

  it("keeps imperative DOM bridges behind filename suffixes", async () => {
    const cwd = await tempBiomeWorkspace(["no-implicit-dom-bridges.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/ui/composer.tsx"),
      `
export function render(container: HTMLElement): void {
  container.createDiv();
  container.addEventListener("click", () => undefined);
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/ui/composer.dom.tsx"),
      `
export function render(container: HTMLElement): void {
  container.createDiv();
  container.addEventListener("click", () => undefined);
}
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/app-server/services/abortable-operation.ts"),
      `
export function onAbort(signal: AbortSignal): void {
  signal.addEventListener("abort", () => undefined);
}
`.trimStart(),
    );

    const report = biomeLint(
      ["src/features/chat/ui/composer.tsx", "src/features/chat/ui/composer.dom.tsx", "src/app-server/services/abortable-operation.ts"],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/ui/composer.tsx")).toEqual([
      "Keep imperative DOM writes and event wiring in files named with a .dom, .obsidian, or .measure suffix.",
      "Keep imperative DOM writes and event wiring in files named with a .dom, .obsidian, or .measure suffix.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/ui/composer.dom.tsx")).toEqual([]);
    expect(pluginDiagnostics(report, "src/app-server/services/abortable-operation.ts")).toEqual([]);
  });

  it("keeps the Preact root adapter in explicit root bridge files", async () => {
    const cwd = await tempBiomeWorkspace(["no-ui-root-imports.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/ui/composer.tsx"),
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
export { renderUiRoot } from "../../../shared/ui/ui-root.dom";
export type RootRenderer = import("../../../shared/ui/ui-root.dom").RootRenderer;

export async function loadRoot() {
  return import("../../../shared/ui/ui-root.dom");
}

const root = require("../../../shared/ui/ui-root.dom");
export const loadedRoot = root;
`.trimStart(),
    );

    const report = biomeLint(
      ["src/features/chat/ui/composer.tsx", "src/features/chat/panel/shell.dom.tsx", "src/features/chat/ui/root-escapes.tsx"],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/ui/composer.tsx")).toEqual([
      "Import the Preact root adapter only from explicit root bridge files.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/panel/shell.dom.tsx")).toEqual([]);
    expect(pluginMessages(report, "src/features/chat/ui/root-escapes.tsx")).toEqual([
      "Import the Preact root adapter only from explicit root bridge files.",
      "Import the Preact root adapter only from explicit root bridge files.",
      "Import the Preact root adapter only from explicit root bridge files.",
      "Import the Preact root adapter only from explicit root bridge files.",
    ]);
  });

  it("keeps chat state transforms pure and catches global scheduling calls", async () => {
    const cwd = await tempBiomeWorkspace(["no-pure-chat-state-side-effects.grit"]);
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
      ["src/features/chat/application/state/message-stream.ts", "src/features/chat/application/threads/resume-actions.ts"],
      cwd,
    );

    expect(pluginMessages(report, "src/features/chat/application/state/message-stream.ts")).toEqual([
      "Keep chat state transforms deterministic and free of app-server, Obsidian, scheduling, and browser side effects.",
      "Keep chat state transforms deterministic and free of app-server, Obsidian, scheduling, and browser side effects.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/application/threads/resume-actions.ts")).toEqual([]);
  });

  it("reports unsafe iterator value reads", async () => {
    const cwd = await tempBiomeWorkspace(["no-unsafe-iterator-value.grit"]);
    await writeFile(
      path.join(cwd, "src/shared/iterator.ts"),
      `
export function first<T>(iterator: Iterator<T>): T | undefined {
  return iterator.next().value;
}
`.trimStart(),
    );

    const report = biomeLint(["src/shared/iterator.ts"], cwd);

    expect(pluginMessages(report, "src/shared/iterator.ts")).toEqual([
      "Avoid reading iterator.next().value directly; use for...of or inspect the typed IteratorResult first.",
    ]);
  });

  it("reports uncontrolled Preact form state attributes", async () => {
    const cwd = await tempBiomeWorkspace(["no-uncontrolled-preact-form-state.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/ui/composer.tsx"),
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
      path.join(cwd, "src/features/chat/ui/controlled-composer.tsx"),
      `
export function Composer(): JSX.Element {
  return <input value="draft" />;
}
`.trimStart(),
    );

    const report = biomeLint(["src/features/chat/ui/composer.tsx", "src/features/chat/ui/controlled-composer.tsx"], cwd);

    expect(pluginMessages(report, "src/features/chat/ui/composer.tsx")).toEqual([
      "Keep Preact form state explicit with controlled value or checked props.",
      "Keep Preact form state explicit with controlled value or checked props.",
    ]);
    expect(pluginDiagnostics(report, "src/features/chat/ui/controlled-composer.tsx")).toEqual([]);
  });

  it("keeps initializer callbacks from capturing their own variable", async () => {
    const cwd = await tempBiomeWorkspace(["no-self-referential-initializer-callback.grit"]);
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

    const report = biomeLint(["src/plugin-runtime.ts", "src/plugin-runtime-function.ts", "src/plugin-runtime-declared.ts"], cwd);

    expect(pluginMessages(report, "src/plugin-runtime.ts")).toEqual([
      "Avoid referencing a variable from a callback inside its own initializer; declare it first with an explicit type.",
    ]);
    expect(pluginMessages(report, "src/plugin-runtime-function.ts")).toEqual([
      "Avoid referencing a variable from a callback inside its own initializer; declare it first with an explicit type.",
    ]);
    expect(pluginDiagnostics(report, "src/plugin-runtime-declared.ts")).toEqual([]);
  });

  it("keeps CSS on design tokens and scoped selectors", async () => {
    const cwd = await tempBiomeWorkspace(["no-restricted-css-policy.grit"]);
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

    const report = biomeLint(["src/styles/bad.css", "src/styles/good.css"], cwd);

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

async function tempBiomeWorkspace(plugins) {
  const cacheKey = plugins.join("\0");
  const cached = workspaceByPlugins.get(cacheKey);
  if (cached) return cached;

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
  await mkdir(path.join(cwd, "src/features/chat/ui"), { recursive: true });
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
      plugins: plugins.map((plugin) => path.join(repoRoot, "scripts", "lint", plugin)),
      css: { linter: { enabled: true } },
    }),
  );
  workspaceByPlugins.set(cacheKey, cwd);
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

function parseBiomeJsonReport(stdout, stderr) {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`Biome did not print a JSON report:\n${[stdout, stderr].filter(Boolean).join("\n")}`);
  }
  return JSON.parse(stdout.slice(jsonStart));
}
