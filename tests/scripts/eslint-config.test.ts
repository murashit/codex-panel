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
  it(
    "reports imperative DOM writes in non-bridge source files",
    async () => {
      const messages = await lintSource(
        "src/features/chat/domain/runtime/effective.ts",
        `
export function setStatus(element: HTMLElement): void {
  element.textContent = "Loading";
}
`,
      );

      expect(messages).toContain("codex-panel/no-imperative-dom");
    },
    ESLINT_STARTUP_TEST_TIMEOUT_MS,
  );

  it("reports Obsidian HTMLElement mutation helpers in non-bridge source files", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
export function setStatus(element: HTMLElement): void {
  element.addClass("is-ready");
}
`,
    );

    expect(messages).toContain("codex-panel/no-imperative-dom");
  });

  it("keeps chat composer components outside the imperative DOM bridge allowlist", async () => {
    const messages = await lintSource(
      "src/features/chat/ui/composer.tsx",
      `
export function renderIcon(element: HTMLElement): void {
  element.replaceChildren();
}
`,
    );

    expect(messages).toContain("codex-panel/no-imperative-dom");
  });

  it("does not confuse plain value properties with DOM writes", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
interface Box {
  value: string;
}

export function setBoxValue(box: Box): void {
  box.value = "ready";
}
`,
    );

    expect(messages).not.toContain("codex-panel/no-imperative-dom");
  });

  it("does not confuse signal value writes with DOM writes", async () => {
    const messages = await lintSource(
      "src/features/chat/panel/shell-state.tsx",
      `
import { signal } from "@preact/signals";

export function setSignalStatus(): string {
  const status = signal("idle");
  status.value = "ready";
  return status.value;
}
`,
    );

    expect(messages).not.toContain("codex-panel/no-imperative-dom");
  });

  it("keeps chat signals inside the shell-state adapter", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
import { signal } from "@preact/signals";

export const status = signal("idle");
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });

  it("reports non-turn app-server protocol imports outside app-server", async () => {
    const messages = await lintSource(
      "src/features/chat/application/pending-requests/pending-request-actions.ts",
      `
import { threadTokenUsageFromAppServerUsage } from "../../../../app-server/protocol/runtime-metrics";

export const convert = threadTokenUsageFromAppServerUsage;
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("allows turn protocol imports at chat ingestion and message-stream conversion boundaries", async () => {
    const conversionMessages = await lintSource(
      "src/features/chat/app-server/mappers/message-stream/turn-items.ts",
      `
import type { TurnItem } from "../../../../../app-server/protocol/turn";

export type Item = TurnItem;
`,
    );
    const ingestionMessages = await lintSource(
      "src/features/chat/app-server/inbound/notification-plan.ts",
      `
import type { TurnRecord } from "../../../../app-server/protocol/turn";

export type Turn = TurnRecord;
`,
    );

    expect(conversionMessages).not.toContain("no-restricted-imports");
    expect(ingestionMessages).not.toContain("no-restricted-imports");
  });

  it("reports turn protocol imports outside chat app-server ingestion and conversion boundaries", async () => {
    const messages = await lintSource(
      "src/features/chat/application/threads/history-controller.ts",
      `
import type { TurnItem } from "../../../../app-server/protocol/turn";

export type Item = TurnItem;
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("reports non-turn protocol imports at chat app-server ingestion and conversion boundaries", async () => {
    const messages = await lintSource(
      "src/features/chat/app-server/inbound/notification-plan.ts",
      `
import type { FileUpdateChange } from "../../../../app-server/protocol/file-change";

export type Change = FileUpdateChange;
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("reports server request protocol imports outside app-server and chat request boundaries", async () => {
    const messages = await lintSource(
      "src/features/chat/panel/surface/message-stream-presenter.ts",
      `
import { appServerUserInputResponse } from "../../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("allows server request protocol imports in chat inbound request boundaries", async () => {
    const routingMessages = await lintSource(
      "src/features/chat/app-server/inbound/routing.ts",
      `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`,
    );
    const handlerMessages = await lintSource(
      "src/features/chat/app-server/inbound/handler.ts",
      `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`,
    );

    expect(routingMessages).not.toContain("no-restricted-imports");
    expect(handlerMessages).not.toContain("no-restricted-imports");
  });

  it("reports server request protocol imports in non-boundary chat app-server modules", async () => {
    const messages = await lintSource(
      "src/features/chat/app-server/inbound/app-server-logs.ts",
      `
import { appServerUserInputResponse } from "../../../../app-server/protocol/server-requests";

export const response = appServerUserInputResponse;
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("keeps generated app-server bindings out of non-exception protocol modules", async () => {
    const messages = await lintSource(
      "src/app-server/protocol/request-input.ts",
      `
import type { UserInput } from "${generatedAppServerImportRoot}/v2/UserInput";

export type Input = UserInput;
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("keeps app-server protocol adapters independent from the connection layer", async () => {
    const messages = await lintSource(
      "src/app-server/protocol/catalog.ts",
      `
import type { AppServerClient } from "../connection/client";

export type Client = AppServerClient;
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("keeps generated app-server bindings out of app-server service seams", async () => {
    const messages = await lintSource(
      "src/app-server/services/runtime-overrides.ts",
      `
import type { ModelListResponse } from "${generatedAppServerImportRoot}/v2/ModelListResponse";

export interface RuntimeOverrideModelClient {
  listModels(includeHidden: boolean): Promise<ModelListResponse>;
}
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("allows generated app-server bindings in the explicit turn protocol exception", async () => {
    const messages = await lintSource(
      "src/app-server/protocol/turn.ts",
      `
import type { ThreadItem as GeneratedTurnItem } from "${generatedAppServerImportRoot}/v2/ThreadItem";

export type TurnItem = GeneratedTurnItem;
`,
    );

    expect(messages).not.toContain("no-restricted-imports");
    expect(messages).not.toContain("no-restricted-syntax");
  });

  it("allows generated app-server bindings in the explicit server request protocol exception", async () => {
    const messages = await lintSource(
      "src/app-server/protocol/server-requests.ts",
      `
import type { ServerRequest } from "${generatedAppServerImportRoot}/ServerRequest";

export type Request = ServerRequest;
`,
    );

    expect(messages).not.toContain("no-restricted-imports");
  });

  it("reports unrelated generated app-server imports in the server request protocol exception", async () => {
    const messages = await lintSource(
      "src/app-server/protocol/server-requests.ts",
      `
import type { ToolRequestUserInputParams } from "${generatedAppServerImportRoot}/v2/ToolRequestUserInputParams";

export type Params = ToolRequestUserInputParams;
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });

  it("reports non-ThreadItem generated app-server imports in the turn protocol exception", async () => {
    const messages = await lintSource(
      "src/app-server/protocol/turn.ts",
      `
import type { UserInput } from "${generatedAppServerImportRoot}/v2/UserInput";

export type Input = UserInput;
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });

  it("reports direct ChatState alias mutation", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
import type { ChatState } from "../../application/state/root-reducer";

export function mutateState(current: ChatState): void {
  current.activeThread.id = "thread";
}
`,
    );

    expect(messages).toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("reports direct ChatState collection mutation from getState", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
import type { ChatStateStore } from "../../application/state/store";

export function mutateState(store: ChatStateStore): void {
  store.getState().requests.userInputDrafts.set("key", "value");
}
`,
    );

    expect(messages).toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("reports direct ChatState slice alias collection mutation", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
import type { ChatStateStore } from "../../application/state/store";

export function mutateState(store: ChatStateStore): void {
  const requests = store.getState().requests;
  requests.userInputDrafts.set("key", "value");
}
`,
    );

    expect(messages).toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("reports direct ChatState snapshot alias collection mutation", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
import type { ChatStateStore } from "../../application/state/store";

export function mutateState(store: ChatStateStore): void {
  const current = store.getState();
  current.requests.userInputDrafts.set("key", "value");
}
`,
    );

    expect(messages).toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("allows scalar values derived from ChatState", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
import type { ChatState } from "../../application/state/root-reducer";

export function updateThreadId(state: ChatState, response: { threadId?: string }): string | null {
  let threadId = state.activeThread.id;
  threadId = response.threadId ?? null;
  return threadId;
}
`,
    );

    expect(messages).not.toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("allows replacing a ChatState snapshot reference", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/runtime/effective.ts",
      `
import type { ChatState } from "../../application/state/root-reducer";

export function replaceSnapshot(current: ChatState, next: ChatState): ChatState {
  current = next;
  return current;
}
`,
    );

    expect(messages).not.toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("does not report shadowed ChatState alias names", async () => {
    const messages = await lintSource(
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
    );

    expect(messages).not.toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("allows signals in the chat shell-state adapter", async () => {
    const messages = await lintSource(
      "src/features/chat/panel/shell-state.tsx",
      `
import { signal } from "@preact/signals";

export const status = signal("idle");
`,
    );

    expect(messages).not.toContain("no-restricted-syntax");
  });

  it("reports signals outside the chat shell-state adapter", async () => {
    const messages = await lintSource(
      "src/shared/ui/components.tsx",
      `
import { signal } from "@preact/signals";

export const status = signal("idle");
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });

  it("does not treat AbortSignal event wiring as imperative DOM", async () => {
    const messages = await lintSource(
      "src/app-server/services/abortable-operation.ts",
      `
export function attach(signal: AbortSignal): void {
  signal.addEventListener("abort", () => undefined);
}
`,
    );

    expect(messages).not.toContain("codex-panel/no-imperative-dom");
  });

  it("still reports DOM writes beside AbortSignal event wiring", async () => {
    const messages = await lintSource(
      "src/app-server/services/abortable-operation.ts",
      `
export function attach(signal: AbortSignal, element: HTMLElement): void {
  signal.addEventListener("abort", () => undefined);
  element.replaceChildren();
}
`,
    );

    expect(messages.filter((message) => message === "codex-panel/no-imperative-dom")).toHaveLength(1);
  });

  it("does not treat generic EventTarget helpers as DOM event wiring", async () => {
    const messages = await lintSource(
      "src/shared/ui/dom-events.ts",
      `
export function attach(target: EventTarget): void {
  target.addEventListener("click", () => undefined);
}
`,
    );

    expect(messages).not.toContain("codex-panel/no-imperative-dom");
  });

  it("does not keep chat UI components on the DOM event bridge allowlist", async () => {
    const messages = await lintSource(
      "src/features/chat/ui/goal.tsx",
      `
export function attach(element: HTMLElement): void {
  element.addEventListener("click", () => undefined);
}
`,
    );

    expect(messages).toContain("codex-panel/no-imperative-dom");
  });

  it("allows DOM root attachment in explicit Preact renderer bridge files", async () => {
    const messages = await lintSource(
      "src/features/threads-view/renderer.tsx",
      `
export function renderThreadsView(parent: HTMLElement): void {
  parent.addClass("codex-panel-threads");
}
`,
    );

    expect(messages).not.toContain("codex-panel/no-imperative-dom");
  });

  it("reports Preact root adapter imports outside explicit root bridge files", async () => {
    const messages = await lintSource(
      "src/features/chat/ui/composer.tsx",
      `
import { renderUiRoot } from "../../../shared/ui/ui-root";

export const render = renderUiRoot;
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });

  it("allows Preact root adapter imports in explicit root bridge files", async () => {
    const messages = await lintSource(
      "src/features/chat/panel/shell.tsx",
      `
import { renderUiRoot } from "../../../shared/ui/ui-root";

export const render = renderUiRoot;
`,
    );

    expect(messages).not.toContain("no-restricted-syntax");
  });

  it("keeps all chat state modules deterministic", async () => {
    const messages = await lintSource(
      "src/features/chat/application/state/message-stream.ts",
      `
export function timestamp(): number {
  return Date.now();
}
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });

  it("keeps chat domain independent from outer chat layers", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/message-stream/selectors.ts",
      `
import type { ChatStateStore } from "../../application/state/store";

export type Store = ChatStateStore;
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });

  it("allows chat domain modules to depend on sibling domain modules", async () => {
    const messages = await lintSource(
      "src/features/chat/domain/message-stream/selectors.ts",
      `
import type { MessageStreamItem } from "./items";

export type Item = MessageStreamItem;
`,
    );

    expect(messages).not.toContain("no-restricted-syntax");
  });
});

async function lintSource(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: path.join(repoRoot, filePath) });
  return (result?.messages ?? []).map((message) => message.ruleId ?? message.message);
}
