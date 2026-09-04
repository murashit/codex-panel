import { type App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import { isAbsoluteFileHref, vaultRelativeFileLinkTarget } from "../../../../../src/domain/vault/file-hrefs";
import { vaultFileLinkTarget } from "../../../../../src/features/chat/host/thread-stream/vault-file-links.obsidian";

describe("markdown file links", () => {
  it("resolves absolute vault paths", () => {
    const app = appFixture(["docs/Guide.md"]);

    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/docs/Guide.md")).toBe("docs/Guide.md");
  });

  it("normalizes absolute vault paths without requiring an existing file", () => {
    expect(vaultRelativeFileLinkTarget("/Users/example/Vault", "vault-config", "/Users/example/Vault/docs/Missing.md")).toBe(
      "docs/Missing.md",
    );
    expect(vaultRelativeFileLinkTarget("/Users/example/Vault", "vault-config", "/Users/example/Vault/docs/Missing.md#Heading")).toBe(
      "docs/Missing.md#Heading",
    );
  });

  it("does not normalize vault config paths as openable vault links", () => {
    expect(
      vaultRelativeFileLinkTarget("/Users/example/Vault", "vault-config", "/Users/example/Vault/vault-config/plugins/foo/main.js"),
    ).toBeNull();
    expect(
      vaultRelativeFileLinkTarget("/Users/example/Vault", "vault-config", "/Users/example/Vault/docs/../vault-config/plugins/foo/main.js"),
    ).toBeNull();
  });

  it("requires an existing file for vault file links", () => {
    const app = appFixture([]);

    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/docs/Missing.md")).toBeNull();
  });

  it("strips Codex line suffixes from absolute vault paths", () => {
    const app = appFixture(["src/main.ts"]);

    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/src/main.ts:12")).toBe("src/main.ts");
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/src/main.ts:12:4")).toBe("src/main.ts");
  });

  it("keeps markdown fragments on vault file links", () => {
    const app = appFixture(["docs/foo.md", "src/main.ts"]);

    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/docs/foo.md#Heading")).toBe("docs/foo.md#Heading");
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/src/main.ts:12#L12")).toBe("src/main.ts#L12");
  });

  it("resolves relative markdown links when the file exists", () => {
    const app = appFixture(["docs/foo.md"]);

    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "docs/foo.md")).toBe("docs/foo.md");
  });

  it("resolves Windows absolute vault paths", () => {
    const app = appFixture(["docs/Guide.md", "src/main.ts"]);

    expect(vaultFileLinkTarget(app, "C:\\Users\\example\\Vault", "C:\\Users\\example\\Vault\\docs\\Guide.md")).toBe("docs/Guide.md");
    expect(vaultFileLinkTarget(app, "C:/Users/example/Vault", "C:/Users/example/Vault/src/main.ts:12")).toBe("src/main.ts");
  });

  it("leaves external and non-vault links untouched", () => {
    const app = appFixture(["docs/foo.md"]);

    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "https://example.com/docs/foo.md")).toBeNull();
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "mailto:test@example.com")).toBeNull();
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Other/docs/foo.md")).toBeNull();
    expect(vaultFileLinkTarget(app, "/Users/example/Vault", "/Users/example/Vault/../Other/docs/foo.md")).toBeNull();
    expect(vaultFileLinkTarget(app, "C:/Users/example/Vault", "C:/Users/example/Other/docs/foo.md")).toBeNull();
  });

  it("identifies filesystem absolute hrefs", () => {
    expect(isAbsoluteFileHref("/Users/example/Vault/docs/Guide.md")).toBe(true);
    expect(isAbsoluteFileHref("C:\\Users\\example\\Vault\\docs\\Guide.md")).toBe(true);
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
