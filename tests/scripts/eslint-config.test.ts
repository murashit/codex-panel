import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const ESLINT_STARTUP_TEST_TIMEOUT_MS = 10_000;
const generatedAppServerImportRoot = "../../generated" + "/app-server";
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: path.join(repoRoot, "eslint.config.mjs"),
});

describe("eslint config", () => {
  describe("custom Codex Panel rules", () => {
    it(
      "rejects imperative DOM writes while leaving non-DOM writes alone",
      async () => {
        await expectReports(
          "reports DOM property writes",
          "src/features/chat/domain/runtime/effective.ts",
          `
export function setStatus(element: HTMLElement): void {
  element.textContent = "Loading";
}
`,
          "codex-panel/no-imperative-dom",
        );
        await expectReports(
          "reports Obsidian HTMLElement mutation helpers",
          "src/features/chat/domain/runtime/effective.ts",
          `
export function setStatus(element: HTMLElement): void {
  element.addClass("is-ready");
}
`,
          "codex-panel/no-imperative-dom",
        );
        await expectClean(
          "allows plain value properties",
          "src/features/chat/domain/runtime/effective.ts",
          `
interface Box {
  value: string;
}

export function setBoxValue(box: Box): void {
  box.value = "ready";
}
`,
          "codex-panel/no-imperative-dom",
        );
        await expectClean(
          "allows Preact signal value writes",
          "src/features/chat/panel/shell-state.tsx",
          `
import { signal } from "@preact/signals";

export function setSignalStatus(): string {
  const status = signal("idle");
  status.value = "ready";
  return status.value;
}
`,
          "codex-panel/no-imperative-dom",
        );
      },
      ESLINT_STARTUP_TEST_TIMEOUT_MS,
    );

    it("treats event wiring as imperative only for DOM targets", async () => {
      await expectClean(
        "allows AbortSignal event wiring",
        "src/app-server/services/abortable-operation.ts",
        `
export function attach(signal: AbortSignal): void {
  signal.addEventListener("abort", () => undefined);
}
`,
        "codex-panel/no-imperative-dom",
      );
      await expectClean(
        "allows generic EventTarget helpers",
        "src/shared/ui/dom-events.ts",
        `
export function attach(target: EventTarget): void {
  target.addEventListener("click", () => undefined);
}
`,
        "codex-panel/no-imperative-dom",
      );
      await expectReports(
        "reports DOM event wiring",
        "src/features/chat/ui/goal.tsx",
        `
export function attach(element: HTMLElement): void {
  element.addEventListener("click", () => undefined);
}
`,
        "codex-panel/no-imperative-dom",
      );
    });

    it("rejects direct ChatState mutation through aliases and store snapshots", async () => {
      await expectReports(
        "reports direct ChatState property mutation",
        "src/features/chat/domain/runtime/effective.ts",
        `
import type { ChatState } from "../../application/state/root-reducer";

export function mutateState(current: ChatState): void {
  current.activeThread.id = "thread";
}
`,
        "codex-panel/no-chat-state-direct-mutation",
      );
      await expectReports(
        "reports collection mutation from getState",
        "src/features/chat/domain/runtime/effective.ts",
        `
import type { ChatStateStore } from "../../application/state/store";

export function mutateState(store: ChatStateStore): void {
  store.getState().requests.userInputDrafts.set("key", "value");
}
`,
        "codex-panel/no-chat-state-direct-mutation",
      );
      await expectReports(
        "reports collection mutation through a slice alias",
        "src/features/chat/domain/runtime/effective.ts",
        `
import type { ChatStateStore } from "../../application/state/store";

export function mutateState(store: ChatStateStore): void {
  const requests = store.getState().requests;
  requests.userInputDrafts.set("key", "value");
}
`,
        "codex-panel/no-chat-state-direct-mutation",
      );
      await expectReports(
        "reports collection mutation through a state alias",
        "src/features/chat/domain/runtime/effective.ts",
        `
import type { ChatStateStore } from "../../application/state/store";

export function mutateState(store: ChatStateStore): void {
  const current = store.getState();
  current.requests.userInputDrafts.set("key", "value");
}
`,
        "codex-panel/no-chat-state-direct-mutation",
      );
    });

    it("allows local values that cannot mutate ChatState", async () => {
      await expectClean(
        "allows scalar values derived from ChatState",
        "src/features/chat/domain/runtime/effective.ts",
        `
import type { ChatState } from "../../application/state/root-reducer";

export function updateThreadId(state: ChatState, response: { threadId?: string }): string | null {
  let threadId = state.activeThread.id;
  threadId = response.threadId ?? null;
  return threadId;
}
`,
        "codex-panel/no-chat-state-direct-mutation",
      );
      await expectClean(
        "allows replacing a ChatState reference",
        "src/features/chat/domain/runtime/effective.ts",
        `
import type { ChatState } from "../../application/state/root-reducer";

export function replaceSnapshot(current: ChatState, next: ChatState): ChatState {
  current = next;
  return current;
}
`,
        "codex-panel/no-chat-state-direct-mutation",
      );
      await expectClean(
        "does not confuse shadowed local names with ChatState aliases",
        "src/features/chat/domain/runtime/effective.ts",
        `
import type { ChatStateStore } from "../../application/state/store";

export function mutateState(store: ChatStateStore): void {
  const requests = store.getState().requests;
  function update(requests: Map<string, string>): void {
    requests.set("key", "value");
  }
  update(new Map());
}
`,
        "codex-panel/no-chat-state-direct-mutation",
      );
    });
  });

  describe("source-shape policy", () => {
    it("rejects hand-written re-export barrels while allowing local exports", async () => {
      const reExportMessages = await lintSource(
        "src/shared/text/preview.ts",
        `
export { shortThreadId } from "../id/thread-id";
export type { Thread } from "../../domain/threads/model";
export * from "../id/thread-id";
`,
      );
      expect(reExportMessages.filter((message) => message === "no-restricted-syntax")).toHaveLength(3);

      await expectClean(
        "allows local exports from owning modules",
        "src/shared/text/preview.ts",
        `
const limit = 80;

export function truncate(value: string): string {
  return value.slice(0, limit);
}

export { limit };
`,
        "no-restricted-syntax",
      );
    });

    it("keeps Preact signals behind the chat shell-state adapter", async () => {
      await expectClean(
        "allows signals in the shell-state adapter",
        "src/features/chat/panel/shell-state.tsx",
        `
import { signal } from "@preact/signals";

export const status = signal("idle");
`,
        "no-restricted-syntax",
      );
      await expectReports(
        "reports signals outside the shell-state adapter",
        "src/shared/ui/components.tsx",
        `
import { signal } from "@preact/signals";

export const status = signal("idle");
`,
        "no-restricted-syntax",
      );
      await expectReports(
        "reports direct signals usage in tests",
        "tests/features/chat/panel/shell.test.tsx",
        `
import { signal } from "@preact/signals";

export const status = signal("idle");
`,
        "no-restricted-syntax",
      );
    });

    it("keeps the Preact root adapter in explicit root bridge files", async () => {
      await expectReports(
        "reports root adapter imports outside root bridges",
        "src/features/chat/ui/composer.tsx",
        `
import { renderUiRoot } from "../../../shared/ui/ui-root";

export const render = renderUiRoot;
`,
        "no-restricted-syntax",
      );
      await expectClean(
        "allows root adapter imports in root bridges",
        "src/features/chat/panel/shell.tsx",
        `
import { renderUiRoot } from "../../../shared/ui/ui-root";

export const render = renderUiRoot;
`,
        "no-restricted-syntax",
      );
    });

    it("keeps imperative DOM writes in explicit bridge files", async () => {
      await expectReports(
        "reports chat UI components outside the bridge allowlist",
        "src/features/chat/ui/composer.tsx",
        `
export function renderIcon(element: HTMLElement): void {
  element.replaceChildren();
}
`,
        "codex-panel/no-imperative-dom",
      );
      await expectClean(
        "allows DOM root attachment in explicit Preact renderer bridges",
        "src/features/threads-view/renderer.tsx",
        `
export function renderThreadsView(parent: HTMLElement): void {
  parent.addClass("codex-panel-threads");
}
`,
        "codex-panel/no-imperative-dom",
      );
    });

    it("keeps chat state transforms deterministic", async () => {
      await expectReports(
        "reports time reads in chat state transforms",
        "src/features/chat/application/state/message-stream.ts",
        `
export function timestamp(): number {
  return Date.now();
}
`,
        "no-restricted-syntax",
      );
    });

    it("keeps chat domain independent from outer chat layers", async () => {
      await expectReports(
        "reports imports from outer chat layers",
        "src/features/chat/domain/message-stream/selectors.ts",
        `
import type { ChatStateStore } from "../../application/state/store";

export type Store = ChatStateStore;
`,
        "no-restricted-syntax",
      );
      await expectClean(
        "allows sibling chat domain imports",
        "src/features/chat/domain/message-stream/selectors.ts",
        `
import type { MessageStreamItem } from "./items";

export type Item = MessageStreamItem;
`,
        "no-restricted-syntax",
      );
    });
  });

  describe("app-server boundary policy", () => {
    it("keeps app-server protocol modules behind app-server and chat ingestion boundaries", async () => {
      await expectReports(
        "reports non-turn protocol imports outside app-server",
        "src/features/chat/application/pending-requests/pending-request-actions.ts",
        `
import { threadTokenUsageFromAppServerUsage } from "../../../../app-server/protocol/runtime-metrics";

export const convert = threadTokenUsageFromAppServerUsage;
`,
        "no-restricted-imports",
      );
      await expectReports(
        "reports turn protocol imports outside chat ingestion boundaries",
        "src/features/chat/application/threads/history-controller.ts",
        `
import type { TurnItem } from "../../../../app-server/protocol/turn";

export type Item = TurnItem;
`,
        "no-restricted-imports",
      );
      await expectClean(
        "allows turn protocol imports in message-stream conversion boundaries",
        "src/features/chat/app-server/mappers/message-stream/turn-items.ts",
        `
import type { TurnItem } from "../../../../../app-server/protocol/turn";

export type Item = TurnItem;
`,
        "no-restricted-imports",
      );
      await expectClean(
        "allows turn protocol imports in notification planning boundaries",
        "src/features/chat/app-server/inbound/notification-plan.ts",
        `
import type { TurnRecord } from "../../../../app-server/protocol/turn";

export type Turn = TurnRecord;
`,
        "no-restricted-imports",
      );
      await expectReports(
        "reports non-turn protocol imports in turn-only chat ingestion boundaries",
        "src/features/chat/app-server/inbound/notification-plan.ts",
        `
import type { FileUpdateChange } from "../../../../app-server/protocol/file-change";

export type Change = FileUpdateChange;
`,
        "no-restricted-imports",
      );
    });

    it("keeps server request protocol imports in chat request boundaries only", async () => {
      await expectReports(
        "reports server request protocol imports outside app-server and chat request boundaries",
        "src/features/chat/panel/surface/message-stream-presenter.ts",
        `
import { appServerUserInputResponse } from "../../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`,
        "no-restricted-imports",
      );
      await expectClean(
        "allows server request protocol imports in inbound routing",
        "src/features/chat/app-server/inbound/routing.ts",
        `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`,
        "no-restricted-imports",
      );
      await expectClean(
        "allows server request protocol imports in inbound handlers",
        "src/features/chat/app-server/inbound/handler.ts",
        `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`,
        "no-restricted-imports",
      );
      await expectReports(
        "reports server request protocol imports in non-request chat app-server modules",
        "src/features/chat/app-server/inbound/app-server-logs.ts",
        `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`,
        "no-restricted-imports",
      );
    });

    it("keeps generated app-server bindings behind explicit exceptions", async () => {
      await expectReports(
        "reports generated bindings in non-exception protocol modules",
        "src/app-server/protocol/request-input.ts",
        `
import type { UserInput } from "${generatedAppServerImportRoot}/v2/UserInput";

export type Input = UserInput;
`,
        "no-restricted-imports",
      );
      await expectReports(
        "reports generated bindings in app-server services",
        "src/app-server/services/runtime-overrides.ts",
        `
import type { ModelListResponse } from "${generatedAppServerImportRoot}/v2/ModelListResponse";

export interface RuntimeOverrideModelClient {
  listModels(includeHidden: boolean): Promise<ModelListResponse>;
}
`,
        "no-restricted-imports",
      );
      await expectClean(
        "allows generated ThreadItem in the turn protocol exception",
        "src/app-server/protocol/turn.ts",
        `
import type { ThreadItem as GeneratedTurnItem } from "${generatedAppServerImportRoot}/v2/ThreadItem";

export type TurnItem = GeneratedTurnItem;
`,
        "no-restricted-imports",
      );
      await expectReports(
        "reports unrelated generated bindings in the turn protocol exception",
        "src/app-server/protocol/turn.ts",
        `
import type { UserInput } from "${generatedAppServerImportRoot}/v2/UserInput";

export type Input = UserInput;
`,
        "no-restricted-syntax",
      );
      await expectClean(
        "allows generated ServerRequest in the server request protocol exception",
        "src/app-server/protocol/server-requests.ts",
        `
import type { ServerRequest } from "${generatedAppServerImportRoot}/ServerRequest";

export type Request = ServerRequest;
`,
        "no-restricted-imports",
      );
      await expectReports(
        "reports unrelated generated bindings in the server request protocol exception",
        "src/app-server/protocol/server-requests.ts",
        `
import type { ToolRequestUserInputParams } from "${generatedAppServerImportRoot}/v2/ToolRequestUserInputParams";

export type Params = ToolRequestUserInputParams;
`,
        "no-restricted-syntax",
      );
    });

    it("keeps app-server protocol adapters independent from connection and feature layers", async () => {
      await expectReports(
        "reports connection-layer imports from protocol adapters",
        "src/app-server/protocol/catalog.ts",
        `
import type { AppServerClient } from "../connection/client";

export type Client = AppServerClient;
`,
        "no-restricted-imports",
      );
      await expectReports(
        "reports feature-layer imports from protocol adapters",
        "src/app-server/protocol/catalog.ts",
        `
import type { ThreadPickerModal } from "../../features/thread-picker/modal";

export type Modal = ThreadPickerModal;
`,
        "no-restricted-imports",
      );
    });
  });
});

async function expectReports(name: string, filePath: string, source: string, ruleId: string): Promise<void> {
  const messages = await lintSource(filePath, source);
  expect(messages, name).toContain(ruleId);
}

async function expectClean(name: string, filePath: string, source: string, ruleId: string): Promise<void> {
  const messages = await lintSource(filePath, source);
  expect(messages, name).not.toContain(ruleId);
}

async function lintSource(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: path.join(repoRoot, filePath) });
  return (result?.messages ?? []).map((message) => message.ruleId ?? message.message);
}
