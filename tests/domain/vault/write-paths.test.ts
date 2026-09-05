import { describe, expect, it } from "vitest";
import { sanitizeVaultPathSegment, vaultRelativeFolderPath } from "../../../src/domain/vault/write-paths";

describe("vault write paths", () => {
  it("sanitizes Obsidian path and subpath marker characters", () => {
    expect(sanitizeVaultPathSegment("Topic/[draft]#section^block?")).toBe("Topic--draft--section-block-");
  });

  it.each(["/outside", String.raw`C:\outside`, String.raw`\\server\share`])("rejects absolute vault folder path %s", (path) => {
    expect(() => vaultRelativeFolderPath(path, folderPathOptions())).toThrow("absolute");
  });

  it("validates vault-relative folder traversal before sanitizing its segments", () => {
    expect(() => vaultRelativeFolderPath("../outside", folderPathOptions())).toThrow("relative");
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
});

function folderPathOptions(emptyFallback?: string) {
  return {
    normalizePath: (path: string) => path.replaceAll("\\", "/"),
    emptyPathMessage: "empty",
    absolutePathMessage: "absolute",
    relativeSegmentMessage: "relative",
    ...(emptyFallback === undefined ? {} : { emptyFallback }),
  };
}
