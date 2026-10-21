import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  ensureVaultFolder,
  uniqueVaultPath,
  type VaultPathDestination,
  withVaultWriteLock,
} from "../../../src/shared/vault/write-operations";
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
    const second = withVaultWriteLock(destination, async () => "second completed");

    firstRelease.resolve();

    await expect(first).rejects.toThrow("write failed");
    await expect(second).resolves.toBe("second completed");
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

  it.each([
    ["Paper", ".pdf"],
    ["README", ""],
    [".env", ""],
    ["Paper.v1", ".pdf"],
    [".env", ".local"],
  ])("finds the first unused collision path for %s%s", async (stem, extension) => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { maxLength: 8 }), async (occupied) => {
        const filename = `${stem}${extension}`;
        const candidates = [
          `Files/${filename}`,
          ...Array.from({ length: occupied.length }, (_, index) => `Files/${stem} ${String(index + 2)}${extension}`),
        ];
        const destination = memoryDestination(candidates.filter((_, index) => occupied[index]));
        const expected = candidates.find((_, index) => !occupied[index]);

        await expect(uniqueVaultPath(destination, "Files", filename)).resolves.toBe(expected);
      }),
      { examples: [[[true, true]], [[true, false, true]], [[false, true]]] },
    );
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

function memoryDestination(existingPaths: readonly string[]): Pick<VaultPathDestination, "normalizePath" | "exists"> {
  const paths = new Set(existingPaths);
  return {
    normalizePath: (path) => path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, ""),
    exists: vi.fn(async (path) => paths.has(path)),
  };
}
