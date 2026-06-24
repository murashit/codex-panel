import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const ESLINT_STARTUP_TEST_TIMEOUT_MS = 10_000;
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

  describe("typed source policy", () => {
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
