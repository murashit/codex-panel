import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const ESLINT_STARTUP_TEST_TIMEOUT_MS = 10_000;

describe("eslint config", () => {
  it(
    "reports imperative DOM writes in non-bridge source files",
    async () => {
      const messages = await lintSource(
        "src/features/chat/runtime/effective.ts",
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
      "src/features/chat/runtime/effective.ts",
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
      "src/features/chat/runtime/effective.ts",
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
      "src/features/chat/ui/shell-state.tsx",
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
      "src/features/chat/runtime/effective.ts",
      `
import { signal } from "@preact/signals";

export const status = signal("idle");
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });

  it("reports non-turn app-server protocol imports outside app-server", async () => {
    const messages = await lintSource(
      "src/features/chat/protocol/inbound/notification-plan.ts",
      `
import { threadTokenUsageFromAppServerUsage } from "../../../../app-server/protocol/runtime-metrics";

export const convert = threadTokenUsageFromAppServerUsage;
`,
    );

    expect(messages).toContain("no-restricted-imports");
  });

  it("allows turn protocol imports as the feature-side protocol exception", async () => {
    const messages = await lintSource(
      "src/features/chat/display/turn-items.ts",
      `
import type { TurnItem } from "../../../app-server/protocol/turn";

export type Item = TurnItem;
`,
    );

    expect(messages).not.toContain("no-restricted-imports");
  });

  it("reports direct ChatState alias mutation", async () => {
    const messages = await lintSource(
      "src/features/chat/runtime/effective.ts",
      `
import type { ChatState } from "../state/reducer";

export function mutateState(current: ChatState): void {
  current.activeThread.id = "thread";
}
`,
    );

    expect(messages).toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("reports direct ChatState collection mutation from getState", async () => {
    const messages = await lintSource(
      "src/features/chat/runtime/effective.ts",
      `
import type { ChatStateStore } from "../state/reducer";

export function mutateState(store: ChatStateStore): void {
  store.getState().requests.userInputDrafts.set("key", "value");
}
`,
    );

    expect(messages).toContain("codex-panel/no-chat-state-direct-mutation");
  });

  it("reports direct ChatState slice alias collection mutation", async () => {
    const messages = await lintSource(
      "src/features/chat/runtime/effective.ts",
      `
import type { ChatStateStore } from "../state/reducer";

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
      "src/features/chat/runtime/effective.ts",
      `
import type { ChatStateStore } from "../state/reducer";

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
      "src/features/chat/runtime/effective.ts",
      `
import type { ChatState } from "../state/reducer";

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
      "src/features/chat/runtime/effective.ts",
      `
import type { ChatState } from "../state/reducer";

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
      "src/features/chat/runtime/effective.ts",
      `
import type { ChatStateStore } from "../state/reducer";

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
      "src/features/chat/ui/shell-state.tsx",
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

  it("allows event wiring but not DOM writes in event-only bridge files", async () => {
    const messages = await lintSource(
      "src/shared/lifecycle/abortable.ts",
      `
export function attach(signal: AbortSignal, element: HTMLElement): void {
  signal.addEventListener("abort", () => undefined);
  element.replaceChildren();
}
`,
    );

    expect(messages.filter((message) => message === "codex-panel/no-imperative-dom")).toHaveLength(1);
  });

  it("allows DOM event wiring in the shared UI event bridge", async () => {
    const messages = await lintSource(
      "src/shared/ui/dom-events.ts",
      `
export function attach(element: HTMLElement): void {
  element.addEventListener("click", () => undefined);
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
      "src/features/chat/ui/shell.tsx",
      `
import { renderUiRoot } from "../../../shared/ui/ui-root";

export const render = renderUiRoot;
`,
    );

    expect(messages).not.toContain("no-restricted-syntax");
  });

  it("keeps all chat state modules deterministic", async () => {
    const messages = await lintSource(
      "src/features/chat/state/message-stream.ts",
      `
export function timestamp(): number {
  return Date.now();
}
`,
    );

    expect(messages).toContain("no-restricted-syntax");
  });
});

async function lintSource(filePath: string, source: string): Promise<string[]> {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, "eslint.config.mjs"),
  });
  const [result] = await eslint.lintText(source, { filePath: path.join(repoRoot, filePath) });
  return (result?.messages ?? []).map((message) => message.ruleId ?? message.message);
}
