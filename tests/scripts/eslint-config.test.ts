import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("eslint config", () => {
  it("reports imperative DOM writes in non-bridge source files", async () => {
    const messages = await lintSource(
      "src/features/chat/runtime/effective.ts",
      `
export function setStatus(element: HTMLElement): void {
  element.textContent = "Loading";
}
`,
    );

    expect(messages).toContain("codex-panel/no-imperative-dom");
  });

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
      "src/features/chat/runtime/effective.ts",
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
