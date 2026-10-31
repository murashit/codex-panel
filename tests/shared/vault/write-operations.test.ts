import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  ensureVaultFolder,
  uniqueVaultPath,
  type VaultPathDestination,
  withVaultWriteLock,
} from "../../../src/shared/vault/write-operations";
import { deferred } from "../../support/async";

describe("vault write paths", () => {
  it.each(["implicit", "explicit"] as const)("serializes %s lock keys without blocking distinct keys", async (keyKind) => {
    const destination: VaultPathDestination = {
      ...(keyKind === "explicit" ? { writeLockKey: {} } : {}),
      normalizePath: (path) => path,
      exists: async () => false,
      createFolder: async () => undefined,
    };
    const release = deferred<void>();
    const nextOperation = vi.fn(async () => "next");
    const first = withVaultWriteLock(destination, () => release.promise);
    const next = withVaultWriteLock(destination, nextOperation);

    const independent = { ...destination, ...(keyKind === "explicit" ? { writeLockKey: {} } : {}) };
    await expect(withVaultWriteLock(independent, async () => "independent")).resolves.toBe("independent");
    expect(nextOperation).not.toHaveBeenCalled();
    release.resolve();

    await first;
    await expect(next).resolves.toBe("next");
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

function memoryDestination(existingPaths: readonly string[]): Pick<VaultPathDestination, "normalizePath" | "exists"> {
  const paths = new Set(existingPaths);
  return {
    normalizePath: (path) => path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, ""),
    exists: vi.fn(async (path) => paths.has(path)),
  };
}
