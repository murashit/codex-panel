import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";

import { isAbsoluteFileHref, vaultFileLinkTarget, vaultRelativeFileLinkTarget } from "../../../src/shared/obsidian/file-links";

describe("markdown file links", () => {
  it("resolves absolute vault paths", () => {
    const app = appFixture(["docs/Guide.md"]);

    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "/Users/showhey/Vault/docs/Guide.md")).toBe("docs/Guide.md");
  });

  it("normalizes absolute vault paths without requiring an existing file", () => {
    expect(vaultRelativeFileLinkTarget("/Users/showhey/Vault", "vault-config", "/Users/showhey/Vault/docs/Missing.md")).toBe(
      "docs/Missing.md",
    );
    expect(vaultRelativeFileLinkTarget("/Users/showhey/Vault", "vault-config", "/Users/showhey/Vault/docs/Missing.md#Heading")).toBe(
      "docs/Missing.md#Heading",
    );
  });

  it("does not normalize vault config paths as openable vault links", () => {
    expect(
      vaultRelativeFileLinkTarget("/Users/showhey/Vault", "vault-config", "/Users/showhey/Vault/vault-config/plugins/foo/main.js"),
    ).toBeNull();
  });

  it("requires an existing file for vault file links", () => {
    const app = appFixture([]);

    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "/Users/showhey/Vault/docs/Missing.md")).toBeNull();
  });

  it("strips Codex line suffixes from absolute vault paths", () => {
    const app = appFixture(["src/main.ts"]);

    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "/Users/showhey/Vault/src/main.ts:12")).toBe("src/main.ts");
    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "/Users/showhey/Vault/src/main.ts:12:4")).toBe("src/main.ts");
  });

  it("keeps markdown fragments on vault file links", () => {
    const app = appFixture(["docs/foo.md", "src/main.ts"]);

    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "/Users/showhey/Vault/docs/foo.md#Heading")).toBe("docs/foo.md#Heading");
    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "/Users/showhey/Vault/src/main.ts:12#L12")).toBe("src/main.ts#L12");
  });

  it("resolves relative markdown links when the file exists", () => {
    const app = appFixture(["docs/foo.md"]);

    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "docs/foo.md")).toBe("docs/foo.md");
  });

  it("resolves Windows absolute vault paths", () => {
    const app = appFixture(["docs/Guide.md", "src/main.ts"]);

    expect(vaultFileLinkTarget(app, "C:\\Users\\showhey\\Vault", "C:\\Users\\showhey\\Vault\\docs\\Guide.md")).toBe("docs/Guide.md");
    expect(vaultFileLinkTarget(app, "C:/Users/showhey/Vault", "C:/Users/showhey/Vault/src/main.ts:12")).toBe("src/main.ts");
  });

  it("leaves external and non-vault links untouched", () => {
    const app = appFixture(["docs/foo.md"]);

    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "https://example.com/docs/foo.md")).toBeNull();
    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "mailto:test@example.com")).toBeNull();
    expect(vaultFileLinkTarget(app, "/Users/showhey/Vault", "/Users/showhey/Other/docs/foo.md")).toBeNull();
    expect(vaultFileLinkTarget(app, "C:/Users/showhey/Vault", "C:/Users/showhey/Other/docs/foo.md")).toBeNull();
  });

  it("identifies filesystem absolute hrefs", () => {
    expect(isAbsoluteFileHref("/Users/showhey/Vault/docs/Guide.md")).toBe(true);
    expect(isAbsoluteFileHref("C:\\Users\\showhey\\Vault\\docs\\Guide.md")).toBe(true);
    expect(isAbsoluteFileHref("docs/Guide.md")).toBe(false);
    expect(isAbsoluteFileHref("https://example.com/docs/Guide.md")).toBe(false);
  });
});

function appFixture(paths: string[]): App {
  const files = new Map(paths.map((path) => [path, tFile(path)]));
  return {
    vault: {
      configDir: "vault-config",
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    },
  } as unknown as App;
}

function tFile(path: string): TFile {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  return Object.assign(new TFile(), { path, basename });
}
