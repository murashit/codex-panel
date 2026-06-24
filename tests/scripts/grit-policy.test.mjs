import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const biomeBin = path.join(repoRoot, "node_modules", ".bin", "biome");

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

    expect(pluginDiagnostics(report)).toEqual([
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

    expect(pluginDiagnostics(biomeLint(["src/features/chat/panel/shell-state.tsx"], cwd, { expectErrors: false }))).toEqual([]);
    expect(pluginMessages(biomeLint(["src/shared/ui/components.tsx"], cwd))).toEqual([
      "Use @preact/signals only in src/features/chat/panel/shell-state.tsx as the reducer-to-Preact derived projection adapter.",
    ]);
  });

  it("keeps removed chat state escape hatches out of source", async () => {
    const cwd = await tempBiomeWorkspace(["no-chat-state-escape-hatches.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/application/state/root-reducer.ts"),
      `
export const actionType = "state/patched";
`.trimStart(),
    );

    expect(pluginMessages(biomeLint(["src/features/chat/application/state/root-reducer.ts"], cwd))).toEqual([
      "Use a named ChatAction instead of reintroducing the generic state patch escape hatch.",
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

    expect(pluginMessages(biomeLint(["src/features/chat/domain/message-stream/selectors.ts"], cwd))).toEqual([
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/features/chat/domain/message-stream/items.ts"], cwd, { expectErrors: false }))).toEqual([]);
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

    expect(pluginMessages(biomeLint(["src/features/chat/domain/generated-thread.ts"], cwd))).toEqual([
      "Keep generated app-server types behind src/app-server and tests/app-server; expose Panel-owned models outside raw app-server adapters.",
    ]);
    expect(pluginMessages(biomeLint(["src/features/chat/domain/generated-thread-import.ts"], cwd))).toEqual([
      "Keep generated app-server types behind src/app-server and tests/app-server; expose Panel-owned models outside raw app-server adapters.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/app-server/connection/generated-thread.ts"], cwd, { expectErrors: false }))).toEqual([]);
    expect(pluginDiagnostics(biomeLint(["tests/app-server/generated-thread.test.ts"], cwd, { expectErrors: false }))).toEqual([]);
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

export const convert = toolInventoryAppsFromAppInfos;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/app-server/mappers/message-stream/turn-items.ts"),
      `
import type { TurnItem } from "../../../../../app-server/protocol/turn";

export type Item = TurnItem;
`.trimStart(),
    );

    expect(pluginMessages(biomeLint(["src/features/chat/application/pending-requests/pending-request-actions.ts"], cwd))).toEqual([
      "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
    ]);
    expect(pluginMessages(biomeLint(["src/features/chat/application/threads/history-controller.ts"], cwd))).toEqual([
      "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
    ]);
    expect(pluginMessages(biomeLint(["src/features/chat/app-server/inbound/notification-plan.ts"], cwd))).toEqual([
      "Chat app-server ingestion and message-stream conversion may consume the app-server turn protocol only. Convert other protocol payloads to local or domain models at the boundary.",
    ]);
    expect(
      pluginDiagnostics(biomeLint(["src/features/chat/app-server/mappers/message-stream/turn-items.ts"], cwd, { expectErrors: false })),
    ).toEqual([]);
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
      path.join(cwd, "src/features/chat/app-server/inbound/routing.ts"),
      `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`.trimStart(),
    );

    expect(pluginMessages(biomeLint(["src/features/chat/panel/surface/message-stream-presenter.ts"], cwd))).toEqual([
      "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
    ]);
    expect(pluginMessages(biomeLint(["src/features/chat/app-server/inbound/app-server-logs.ts"], cwd))).toEqual([
      "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/features/chat/app-server/inbound/routing.ts"], cwd, { expectErrors: false }))).toEqual([]);
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

    expect(pluginMessages(biomeLint(["src/app-server/protocol/request-input.ts"], cwd))).toEqual([
      "Keep generated app-server types behind src/app-server and tests/app-server; expose Panel-owned models outside raw app-server adapters.",
    ]);
    expect(pluginMessages(biomeLint(["src/app-server/services/runtime-overrides.ts"], cwd))).toEqual([
      "Keep generated app-server types behind src/app-server and tests/app-server; expose Panel-owned models outside raw app-server adapters.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/app-server/protocol/turn.ts"], cwd, { expectErrors: false }))).toEqual([]);
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

    expect(pluginMessages(biomeLint(["src/app-server/protocol/catalog.ts"], cwd))).toEqual([
      "Lower-level modules must not import feature modules or app-server connection internals. Move shared behavior to shared, domain, or app-server adapters.",
    ]);
    expect(pluginMessages(biomeLint(["src/app-server/protocol/diagnostics.ts"], cwd))).toEqual([
      "Lower-level modules must not import feature modules or app-server connection internals. Move shared behavior to shared, domain, or app-server adapters.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/shared/date.ts"], cwd, { expectErrors: false }))).toEqual([]);
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
`.trimStart(),
    );

    expect(pluginMessages(biomeLint(["src/app-server/connection/thread.ts"], cwd))).toEqual([
      "Import generated app-server Thread as AppServerThread, or use the Panel-owned domain Thread model.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/app-server/connection/aliased-thread.ts"], cwd, { expectErrors: false }))).toEqual([]);
    expect(pluginMessages(biomeLint(["src/app-server/protocol/turn.ts"], cwd))).toEqual([
      "Only generated ThreadItem is allowed in the turn protocol exception. Model other turn payload shapes locally.",
    ]);
    expect(pluginMessages(biomeLint(["src/app-server/protocol/server-requests.ts"], cwd))).toEqual([
      "Only generated RequestId and ServerRequest are allowed in the server request protocol exception.",
    ]);
  });

  it("keeps src index files as re-export-only boundaries", async () => {
    const cwd = await tempBiomeWorkspace(["no-non-reexport-index.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/index.ts"),
      `
import { value } from "./value";

export const local = value;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/thread-picker/index.ts"),
      `
export { openThreadPicker } from "./modal";
export type { ThreadPickerOptions } from "./types";
`.trimStart(),
    );

    expect(pluginMessages(biomeLint(["src/features/chat/index.ts"], cwd))).toEqual([
      "Keep src index files as re-export-only boundaries.",
      "Keep src index files as re-export-only boundaries.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/features/thread-picker/index.ts"], cwd, { expectErrors: false }))).toEqual([]);
  });

  it("keeps chat application app-server projection RPCs behind facades", async () => {
    const cwd = await tempBiomeWorkspace(["no-app-server-projection-rpcs.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/application/threads/history.ts"),
      `
import type { AppServerClient } from "../../../../app-server/connection/client";

export async function read(client: AppServerClient): Promise<void> {
  await client.threadTurnsList("thread", null, 20);
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

    expect(pluginMessages(biomeLint(["src/features/chat/application/threads/history.ts"], cwd))).toEqual([
      "Keep app-server projection RPCs behind app-server facades; chat application code should consume Panel-owned snapshots or view models.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/app-server/threads.ts"], cwd, { expectErrors: false }))).toEqual([]);
    expect(pluginMessages(biomeLint(["src/features/chat/host/connection-bundle.ts"], cwd))).toEqual([
      "Do not expose app-server projection RPC signatures through AppServerClient indexed access types; define a Panel-owned projection type instead.",
    ]);
  });

  it("keeps the Preact root adapter in explicit root bridge files", async () => {
    const cwd = await tempBiomeWorkspace(["no-ui-root-imports.grit"]);
    await writeFile(
      path.join(cwd, "src/features/chat/ui/composer.tsx"),
      `
import { renderUiRoot } from '../../../shared/ui/ui-root';

export const render = renderUiRoot;
`.trimStart(),
    );
    await writeFile(
      path.join(cwd, "src/features/chat/panel/shell.tsx"),
      `
import { renderUiRoot } from "../../../shared/ui/ui-root";

export const render = renderUiRoot;
`.trimStart(),
    );

    expect(pluginMessages(biomeLint(["src/features/chat/ui/composer.tsx"], cwd))).toEqual([
      "Import the Preact root adapter only from explicit root bridge files.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/features/chat/panel/shell.tsx"], cwd, { expectErrors: false }))).toEqual([]);
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

    expect(pluginMessages(biomeLint(["src/features/chat/application/state/message-stream.ts"], cwd))).toEqual([
      "Keep chat state transforms deterministic and free of app-server, Obsidian, scheduling, and browser side effects.",
      "Keep chat state transforms deterministic and free of app-server, Obsidian, scheduling, and browser side effects.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/features/chat/application/threads/resume-actions.ts"], cwd, { expectErrors: false }))).toEqual(
      [],
    );
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

    expect(pluginMessages(biomeLint(["src/shared/iterator.ts"], cwd))).toEqual([
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

    expect(pluginMessages(biomeLint(["src/features/chat/ui/composer.tsx"], cwd))).toEqual([
      "Keep Preact form state explicit with controlled value or checked props.",
      "Keep Preact form state explicit with controlled value or checked props.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/features/chat/ui/controlled-composer.tsx"], cwd, { expectErrors: false }))).toEqual([]);
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

    expect(pluginMessages(biomeLint(["src/plugin-runtime.ts"], cwd))).toEqual([
      "Avoid referencing a variable from a callback inside its own initializer; declare it first with an explicit type.",
    ]);
    expect(pluginMessages(biomeLint(["src/plugin-runtime-function.ts"], cwd))).toEqual([
      "Avoid referencing a variable from a callback inside its own initializer; declare it first with an explicit type.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/plugin-runtime-declared.ts"], cwd, { expectErrors: false }))).toEqual([]);
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

    expect(pluginMessages(biomeLint(["src/styles/bad.css"], cwd))).toEqual([
      "Avoid :has() because it can cause broad selector invalidation.",
      "Use Obsidian or Codex Panel design tokens instead of hardcoded colors.",
      "Prefer Obsidian or Codex Panel spacing and size tokens for layout dimensions.",
      "Do not hide class, id, or attribute selectors inside :where().",
      "Use Obsidian or Codex Panel typography tokens instead of hardcoded font sizes.",
      "Avoid ID selectors in Codex Panel CSS.",
      "Use Obsidian or Codex Panel typography tokens instead of hardcoded font weights.",
      "Prefix keyframes with codex-panel-.",
    ]);
    expect(pluginDiagnostics(biomeLint(["src/styles/good.css"], cwd, { expectErrors: false }))).toEqual([]);
  });
});

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
  await mkdir(path.join(cwd, "src/features/chat/ui"), { recursive: true });
  await mkdir(path.join(cwd, "src/features/thread-picker"), { recursive: true });
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
      plugins: plugins.map((plugin) => path.join(repoRoot, "scripts", "lint", "grit", plugin)),
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
  if (expectErrors && (result.status !== 1 || report.summary.errors === 0)) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  if (!expectErrors && (result.status !== 0 || report.summary.errors !== 0)) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  return report;
}

function pluginDiagnostics(report) {
  return report.diagnostics
    .filter((diagnostic) => diagnostic.category === "plugin")
    .map((diagnostic) => ({
      line: diagnostic.location.start.line,
      column: diagnostic.location.start.column,
      endLine: diagnostic.location.end.line,
      endColumn: diagnostic.location.end.column,
    }));
}

function pluginMessages(report) {
  return report.diagnostics.filter((diagnostic) => diagnostic.category === "plugin").map((diagnostic) => diagnostic.message);
}

function parseBiomeJsonReport(stdout, stderr) {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`Biome did not print a JSON report:\n${[stdout, stderr].filter(Boolean).join("\n")}`);
  }
  return JSON.parse(stdout.slice(jsonStart));
}
