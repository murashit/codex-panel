import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sanitizeVaultPathSegment, vaultRelativeFolderPath } from "../../../src/domain/files/vault-write-paths";

describe("vault write paths", () => {
  it("sanitizes Obsidian path and subpath marker characters", () => {
    expect(sanitizeVaultPathSegment("Topic/[draft]#section^block?")).toBe("Topic--draft--section-block-");
  });

  it("keeps arbitrary folder segments within configured length and reserved-character rules", () => {
    const reservedChars = new Set('<>:"/\\|?*[]#^');
    const segment = fc.oneof(
      fc.string({ unit: "binary", maxLength: 180 }),
      fc.string({
        unit: fc.constantFrom("a", ".", " ", "\t", "\n", "<", ">", ":", '"', "/", "\\", "|", "?", "*", "[", "]", "#", "^", "😀"),
        maxLength: 180,
      }),
      fc.integer({ min: 121, max: 180 }).map((length) => "a".repeat(length)),
      fc.integer({ min: 1, max: 20 }).map((length) => ".".repeat(length)),
      fc.string({ unit: fc.constantFrom(" ", "\t", "\n"), minLength: 2, maxLength: 20 }).map((space) => `a${space}b`),
      fc.string({ unit: fc.constantFrom("a", "😀", "\ud800", "\udc00"), maxLength: 180 }),
    );
    fc.assert(
      fc.property(segment, (value) => {
        const result = sanitizeVaultPathSegment(value);

        expect(result.length).toBeLessThanOrEqual(120);
        expect(result).toBe(result.trim());
        expect([...result].every((char) => char.charCodeAt(0) >= 32 && !reservedChars.has(char))).toBe(true);
        expect(result).not.toMatch(/^\.+$/u);
        expect(result).not.toMatch(/\s{2,}/u);
        expect(new TextDecoder().decode(new TextEncoder().encode(result))).toBe(result);
      }),
    );
  });

  it("does not split Unicode characters or leave a dot-only segment at the length boundary", () => {
    expect(sanitizeVaultPathSegment(`${"a".repeat(119)}😀`)).toBe("a".repeat(119));
    expect(sanitizeVaultPathSegment(`${".".repeat(120)}a`)).toBe("");
    expect(sanitizeVaultPathSegment(`a\ud800b\udc00`)).toBe("a-b-");
  });

  it.each(["/outside", String.raw`C:\outside`, String.raw`\\server\share`])("rejects absolute vault folder path %s", (path) => {
    expect(() => vaultRelativeFolderPath(path, folderPathOptions())).toThrow("absolute");
  });

  it("validates vault-relative folder traversal before sanitizing its segments", () => {
    expect(() => vaultRelativeFolderPath("../outside", folderPathOptions())).toThrow("relative");
    expect(() => vaultRelativeFolderPath(" nested / .. /outside", folderPathOptions())).toThrow("relative");
    expect(() => vaultRelativeFolderPath("  /outside", folderPathOptions())).toThrow("absolute");
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
