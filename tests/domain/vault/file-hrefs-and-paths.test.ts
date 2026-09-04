import { describe, expect, it } from "vitest";

import { parseFileHref } from "../../../src/domain/vault/file-hrefs";
import { normalizeFilePath, pathRelativeToRoot, vaultRelativePath } from "../../../src/domain/vault/paths";

describe("file path helpers", () => {
  it("normalizes separators, duplicate slashes, and leading dot segments", () => {
    expect(normalizeFilePath("./docs//Guide.md")).toBe("docs/Guide.md");
    expect(normalizeFilePath("C:\\Vault\\Project\\src\\main.ts")).toBe("C:/Vault/Project/src/main.ts");
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
  });

  it("resolves vault-relative paths only when the caller allows relative inputs", () => {
    expect(vaultRelativePath("/Vault", "/Vault/docs/Guide.md")).toBe("docs/Guide.md");
    expect(vaultRelativePath("/Vault", "docs/Guide.md")).toBeNull();
    expect(vaultRelativePath("/Vault", "docs/Guide.md", { allowRelative: true })).toBe("docs/Guide.md");
  });

  it("labels paths relative to a root without hiding sibling absolute paths", () => {
    expect(pathRelativeToRoot("C:\\Vault\\project\\src\\main.ts", "C:\\Vault\\project")).toBe("src/main.ts");
    expect(pathRelativeToRoot("C:\\Vault\\project-other\\src\\main.ts", "C:\\Vault\\project")).toBe("C:/Vault/project-other/src/main.ts");
  });
});
