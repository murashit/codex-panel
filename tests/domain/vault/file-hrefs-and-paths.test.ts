import { describe, expect, it } from "vitest";

import { parseFileHref, vaultRelativeFileHref } from "../../../src/domain/vault/file-hrefs";
import { isVaultConfigPath, normalizeFilePath, pathRelativeToRoot, vaultRelativePath } from "../../../src/domain/vault/paths";

describe("file path helpers", () => {
  it("normalizes separators, duplicate slashes, and leading dot segments", () => {
    expect(normalizeFilePath("./docs//Guide.md")).toBe("docs/Guide.md");
    expect(normalizeFilePath("C:\\Vault\\Project\\src\\main.ts")).toBe("C:/Vault/Project/src/main.ts");
    expect(normalizeFilePath("/Vault/docs/../Guide.md")).toBe("/Vault/Guide.md");
    expect(normalizeFilePath("docs/")).toBe("docs");
    expect(normalizeFilePath("/")).toBe("/");
  });

  it("parses file href paths separately from line suffixes and fragments", () => {
    expect(parseFileHref("/Vault/src/main.ts:12:4#L12")).toEqual({ path: "/Vault/src/main.ts", subpath: "#L12" });
    expect(parseFileHref("docs/Guide%20Book.md#Heading%201")).toEqual({
      path: "docs/Guide Book.md",
      subpath: "#Heading 1",
    });
  });

  it("keeps external hrefs out of file path handling", () => {
    expect(parseFileHref("https://example.com/docs/Guide.md")).toBeNull();
    expect(parseFileHref("//example.com/docs/Guide.md")).toBeNull();
    expect(parseFileHref("C:/Vault/docs/Guide.md")).toEqual({ path: "C:/Vault/docs/Guide.md", subpath: "" });
    expect(parseFileHref("\\\\server\\share\\Vault\\Guide.md")).toEqual({
      path: "\\\\server\\share\\Vault\\Guide.md",
      subpath: "",
    });
  });

  it("resolves vault-relative paths only when the caller allows relative inputs", () => {
    expect(vaultRelativePath("/Vault", "/Vault/docs/Guide.md")).toBe("docs/Guide.md");
    expect(vaultRelativePath("/Vault", "docs/Guide.md")).toBeNull();
    expect(vaultRelativePath("/Vault", "docs/Guide.md", { allowRelative: true })).toBe("docs/Guide.md");
    expect(vaultRelativePath("/Vault", "/Vault/docs/../Guide.md")).toBe("Guide.md");
    expect(vaultRelativePath("/Vault", "/Vault/../outside.md")).toBeNull();
    expect(vaultRelativePath("/Vault", "../outside.md", { allowRelative: true })).toBeNull();
    expect(vaultRelativePath("C:\\Vault", "C:outside.md", { allowRelative: true })).toBeNull();
    expect(vaultRelativePath("\\\\server\\share\\Vault", "\\\\server\\share\\Vault\\Notes\\Guide.md")).toBe("Notes/Guide.md");
  });

  it("labels paths relative to a root without hiding sibling absolute paths", () => {
    expect(pathRelativeToRoot("C:\\Vault\\project\\src\\main.ts", "C:\\Vault\\project")).toBe("src/main.ts");
    expect(pathRelativeToRoot("C:\\Vault\\project-other\\src\\main.ts", "C:\\Vault\\project")).toBe("C:/Vault/project-other/src/main.ts");
    expect(pathRelativeToRoot("/Vault/project/docs/../src/main.ts", "/Vault/project")).toBe("src/main.ts");
    expect(pathRelativeToRoot("C:\\Vault\\project\\src\\main.ts")).toBe("C:/Vault/project/src/main.ts");
  });

  it("canonicalizes paths before enforcing the configured Obsidian directory boundary", () => {
    expect(isVaultConfigPath("docs/../.obsidian/plugins/example/main.js", ".obsidian")).toBe(true);
    expect(isVaultConfigPath(".obsidian/plugins/example/main.js", ".obsidian/")).toBe(true);
    expect(isVaultConfigPath(".obsidian/../notes/example.md", ".obsidian")).toBe(false);
    expect(isVaultConfigPath(".OBSIDIAN/plugins/example/main.js", ".obsidian", "C:\\Vault")).toBe(true);
    expect(isVaultConfigPath("", "")).toBe(false);
    expect(vaultRelativeFileHref("/Vault", ".obsidian", "/Vault/docs/../.obsidian/plugins/example/main.js")).toBeNull();
    expect(vaultRelativeFileHref("C:\\Vault", ".obsidian", "C:\\Vault\\.OBSIDIAN\\plugins\\example\\main.js")).toBeNull();
  });
});
