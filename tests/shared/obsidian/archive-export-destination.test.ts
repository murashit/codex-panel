import type { Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { createObsidianArchiveExportDestination } from "../../../src/shared/obsidian/archive-export-destination";

describe("createObsidianArchiveExportDestination", () => {
  it("uses normalized Vault paths for existence checks, folder creation, and file writes", async () => {
    const vault = vaultMock(new Set(["Codex Archives/Café"]));
    const destination = createObsidianArchiveExportDestination(vault);

    await expect(destination.exists("//Codex\u00a0Archives//Cafe\u0301//")).resolves.toBe(true);
    await destination.createFolder("//Codex\u00a0Archives//New//");
    await destination.createMarkdownFile("//Codex\u00a0Archives//Cafe\u0301//Thread.md", "body");

    expect(vault.getAbstractFileByPath).toHaveBeenCalledWith("Codex Archives/Café");
    expect(vault.createFolder).toHaveBeenCalledWith("Codex Archives/New");
    expect(vault.create).toHaveBeenCalledWith("Codex Archives/Café/Thread.md", "body");
  });
});

function vaultMock(existingPaths: Set<string>): Vault & {
  getAbstractFileByPath: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
} {
  return {
    getAbstractFileByPath: vi.fn((path: string) => (existingPaths.has(path) ? { path } : null)),
    createFolder: vi.fn(async (path: string) => ({ path })),
    create: vi.fn(async (path: string) => ({ path })),
  } as unknown as Vault & {
    getAbstractFileByPath: ReturnType<typeof vi.fn>;
    createFolder: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}
