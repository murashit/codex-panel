import { describe, expect, it, vi } from "vitest";

import {
  sanitizeVaultPathSegment,
  uniqueVaultPath,
  type VaultPathDestination,
  vaultRelativeFolderPath,
} from "../../../src/domain/vault/write-paths";

describe("vault write paths", () => {
  it("sanitizes Obsidian path and subpath marker characters", () => {
    expect(sanitizeVaultPathSegment("Topic/[draft]#section^block?")).toBe("Topic--draft--section-block-");
  });

  it("validates vault-relative folders before sanitizing relative segments", () => {
    expect(() =>
      vaultRelativeFolderPath("../outside", {
        normalizePath: (path) => path,
        emptyPathMessage: "empty",
        absolutePathMessage: "absolute",
        relativeSegmentMessage: "relative",
      }),
    ).toThrow("relative");
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

function memoryDestination(existingPaths: readonly string[]): Pick<VaultPathDestination, "normalizePath" | "exists"> {
  const paths = new Set(existingPaths);
  return {
    normalizePath: (path) => path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, ""),
    exists: vi.fn(async (path) => paths.has(path)),
  };
}
