// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystemAdapter } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../src/constants";

describe("CodexPanelPlugin boot restored panel loading", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("loads restored Codex panel leaves after startup without blocking onload", async () => {
    vi.useFakeTimers();
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    await plugin.onload();

    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();
    expect(secondLeaf.loadIfDeferred).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1);
    expect(firstLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
    expect(secondLeaf.loadIfDeferred).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(249);
    expect(secondLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
  });

  it("cancels pending boot panel loads on unload", async () => {
    vi.useFakeTimers();
    const firstLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf]);

    await plugin.onload();
    plugin.onunload();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(firstLeaf.loadIfDeferred).not.toHaveBeenCalled();
  });
});

async function pluginWithLeaves(leaves: ReturnType<typeof leaf>[]) {
  const { default: CodexPanelPlugin } = await import("../src/main");
  const adapter = new FileSystemAdapter();
  vi.spyOn(adapter, "getBasePath").mockReturnValue("/vault");
  return new CodexPanelPlugin(
    {
      vault: {
        adapter,
      },
      workspace: {
        getLeavesOfType: vi.fn((type: string) => (type === VIEW_TYPE_CODEX_PANEL ? leaves : [])),
      },
    } as never,
    {} as never,
  );
}

function leaf() {
  return {
    loadIfDeferred: vi.fn().mockResolvedValue(undefined),
  };
}
