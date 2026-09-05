import type { Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { createObsidianVaultMarkdownDestination } from "../../../src/shared/obsidian/vault-write-destination.obsidian";
import { uniqueVaultPath, withVaultWriteLock } from "../../../src/shared/vault/write-operations";
import { deferred, waitForAsyncWork } from "../../support/async";

describe("createObsidianVaultMarkdownDestination", () => {
  it("serializes writes from separate destinations for the same Vault before choosing a filename", async () => {
    const paths = new Set<string>();
    const vault = vaultMock(paths);
    const firstWrite = deferred<void>();
    vault.create.mockImplementation(async (path: string) => {
      await firstWrite.promise;
      paths.add(path);
      return { path };
    });
    const first = createObsidianVaultMarkdownDestination(vault);
    const second = createObsidianVaultMarkdownDestination(vault);
    const save = (destination: typeof first) =>
      withVaultWriteLock(destination, async () => {
        const path = await uniqueVaultPath(destination, "Archive", "Thread.md");
        await destination.createMarkdownFile(path, "body");
        return path;
      });
    const firstSave = save(first);
    await waitForAsyncWork(() => expect(vault.create).toHaveBeenCalledOnce());
    const secondSave = save(second);
    firstWrite.resolve();
    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual(["Archive/Thread.md", "Archive/Thread 2.md"]);
  });

  it("uses normalized Vault paths for existence checks, folder creation, and file writes", async () => {
    const vault = vaultMock(new Set(["Codex Archives/Café"]));
    const destination = createObsidianVaultMarkdownDestination(vault);

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
