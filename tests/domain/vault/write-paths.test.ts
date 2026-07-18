import { describe, expect, it, vi } from "vitest";

import {
  ensureVaultFolder,
  sanitizeVaultPathSegment,
  uniqueVaultPath,
  type VaultPathDestination,
  vaultRelativeFolderPath,
  withVaultWriteLock,
} from "../../../src/domain/vault/write-paths";
import { deferred, waitForAsyncWork } from "../../support/async";

describe("vault write paths", () => {
  it("runs writes for the same destination in FIFO order", async () => {
    const destination = lockDestination();
    const firstRelease = deferred<void>();
    const secondRelease = deferred<void>();
    const events: string[] = [];

    const first = withVaultWriteLock(destination, async () => {
      events.push("first:start");
      await firstRelease.promise;
      events.push("first:end");
    });
    const second = withVaultWriteLock(destination, async () => {
      events.push("second:start");
      await secondRelease.promise;
      events.push("second:end");
    });

    await waitForAsyncWork(() => expect(events).toEqual(["first:start"]));
    firstRelease.resolve();
    await first;
    await waitForAsyncWork(() => expect(events).toEqual(["first:start", "first:end", "second:start"]));
    const third = withVaultWriteLock(destination, async () => {
      events.push("third");
    });
    await Promise.resolve();
    expect(events).toEqual(["first:start", "first:end", "second:start"]);

    secondRelease.resolve();
    await Promise.all([second, third]);

    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end", "third"]);
  });

  it("releases the write lock when an operation fails", async () => {
    const destination = lockDestination();
    const firstRelease = deferred<void>();
    const first = withVaultWriteLock(destination, async () => {
      await firstRelease.promise;
      throw new Error("write failed");
    });
    const firstFailure = expect(first).rejects.toThrow("write failed");
    const second = withVaultWriteLock(destination, async () => "second completed");

    firstRelease.resolve();

    await firstFailure;
    await expect(second).resolves.toBe("second completed");
  });

  it("shares serialization across destinations with the same write lock key", async () => {
    const writeLockKey = {};
    const firstDestination = lockDestination(writeLockKey);
    const secondDestination = lockDestination(writeLockKey);
    const firstRelease = deferred<void>();
    const events: string[] = [];

    const first = withVaultWriteLock(firstDestination, async () => {
      events.push("first");
      await firstRelease.promise;
    });
    const second = withVaultWriteLock(secondDestination, async () => {
      events.push("second");
    });

    await waitForAsyncWork(() => expect(events).toEqual(["first"]));
    firstRelease.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual(["first", "second"]);
  });

  it("allows destinations with different write lock keys to write concurrently", async () => {
    const firstRelease = deferred<void>();
    const secondRelease = deferred<void>();
    const events: string[] = [];

    const first = withVaultWriteLock(lockDestination({}), async () => {
      events.push("first");
      await firstRelease.promise;
    });
    const second = withVaultWriteLock(lockDestination({}), async () => {
      events.push("second");
      await secondRelease.promise;
    });

    await waitForAsyncWork(() => expect(events).toEqual(["first", "second"]));
    firstRelease.resolve();
    secondRelease.resolve();
    await Promise.all([first, second]);
  });

  it("sanitizes Obsidian path and subpath marker characters", () => {
    expect(sanitizeVaultPathSegment("Topic/[draft]#section^block?")).toBe("Topic--draft--section-block-");
  });

  it.each([
    "/outside",
    String.raw`C:\outside`,
    String.raw`z:\outside`,
    String.raw`\\server\share`,
  ])("rejects absolute vault folder path %s", (path) => {
    expect(() => vaultRelativeFolderPath(path, folderPathOptions())).toThrow("absolute");
  });

  it.each(["../outside", "./outside"])("validates vault-relative folder %s before sanitizing its segments", (path) => {
    expect(() => vaultRelativeFolderPath(path, folderPathOptions())).toThrow("relative");
  });

  it("uses and normalizes the configured fallback for empty or sanitized-empty folders", () => {
    const options = folderPathOptions("Fallback\\Notes");

    expect(vaultRelativeFolderPath("  ", options)).toBe("Fallback/Notes");
    expect(vaultRelativeFolderPath("...", options)).toBe("Fallback/Notes");
  });

  it("rejects an empty folder when no fallback is configured", () => {
    expect(() => vaultRelativeFolderPath("  ", folderPathOptions())).toThrow("empty");
  });

  it("normalizes whitespace and empty sanitized segments in a relative folder", () => {
    expect(vaultRelativeFolderPath(" Parent // ... / Child ", folderPathOptions())).toBe("Parent/Child");
    expect(vaultRelativeFolderPath("Notes/C:/outside", folderPathOptions())).toBe("Notes/C-/outside");
  });

  it("rejects relative traversal introduced by path normalization", () => {
    expect(() =>
      vaultRelativeFolderPath("safe", {
        ...folderPathOptions(),
        normalizePath: () => "../outside",
      }),
    ).toThrow("relative");
  });

  it("creates missing folder segments in parent-first order and skips existing segments", async () => {
    const events: string[] = [];
    const destination: VaultPathDestination = {
      normalizePath: (path) => path,
      exists: vi.fn(async (path) => {
        events.push(`exists:${path}`);
        return path === "Archive";
      }),
      createFolder: vi.fn(async (path) => {
        events.push(`create:${path}`);
      }),
    };

    await ensureVaultFolder(destination, "Archive/2026/July");

    expect(events).toEqual([
      "exists:Archive",
      "exists:Archive/2026",
      "create:Archive/2026",
      "exists:Archive/2026/July",
      "create:Archive/2026/July",
    ]);
  });

  it("starts collision suffixes at 2 for generated vault paths", async () => {
    const destination = memoryDestination(["Files/Paper.pdf"]);

    await expect(uniqueVaultPath(destination, "Files", "Paper.pdf")).resolves.toBe("Files/Paper 2.pdf");
  });

  it("increments collision suffixes until an unused vault path is found", async () => {
    const destination = memoryDestination(["Files/Paper.pdf", "Files/Paper 2.pdf"]);

    await expect(uniqueVaultPath(destination, "Files", "Paper.pdf")).resolves.toBe("Files/Paper 3.pdf");
  });
});

function lockDestination(writeLockKey?: object): VaultPathDestination {
  return {
    ...(writeLockKey === undefined ? {} : { writeLockKey }),
    normalizePath: (path) => path,
    exists: vi.fn(async () => false),
    createFolder: vi.fn(async () => undefined),
  };
}

function folderPathOptions(emptyFallback?: string) {
  return {
    normalizePath: (path: string) => path.replaceAll("\\", "/"),
    emptyPathMessage: "empty",
    absolutePathMessage: "absolute",
    relativeSegmentMessage: "relative",
    ...(emptyFallback === undefined ? {} : { emptyFallback }),
  };
}

function memoryDestination(existingPaths: readonly string[]): Pick<VaultPathDestination, "normalizePath" | "exists"> {
  const paths = new Set(existingPaths);
  return {
    normalizePath: (path) => path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, ""),
    exists: vi.fn(async (path) => paths.has(path)),
  };
}
